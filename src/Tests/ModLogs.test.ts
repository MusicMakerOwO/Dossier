import { describe, it, expect } from "vitest";
import {
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordAuditLogEvent,
	DiscordAutoModerationActionType,
	DiscordAutoModerationRuleTriggerType,
	ResolveComponentsV2Flags
} from "simplyjs";
import { COLOR } from "../Constants.js";
import { AutoModHit } from "../Logs/AutoModBatch.js";
import { LogMessage } from "../Logs/Format.js";
import { BannedUser, BuildAutoModLog, BuildBanLog, BuildUnbanLog } from "../Logs/ModLogs.js";

const GUILD = "100";

function User(fields: Partial<BannedUser> = {}): BannedUser {
	return { id: "700", username: "spammer", globalName: null, ...fields };
}

function Entry(reason?: string): DiscordAuditLogEntry {
	return { id: "1", action_type: DiscordAuditLogEvent.MEMBER_BAN_ADD, target_id: "700", user_id: "900", ...(reason ? { reason } : {}) };
}

function Hit(fields: Partial<AutoModHit> = {}): AutoModHit {
	return {
		guildId: GUILD, ruleId: "300", ruleTriggerType: DiscordAutoModerationRuleTriggerType.KEYWORD,
		userId: "700", channelId: "200", content: "buy cheap nitro", matchedKeyword: "nitro", matchedContent: "nitro",
		actions: [{ type: DiscordAutoModerationActionType.BLOCK_MESSAGE }],
		...fields
	};
}

/** Returns every text display in the container, joined. */
function Text(container: ContainerBuilder): string {
	return container.components.flatMap((child) => "content" in child ? [child.content] : []).join("\n");
}

/** Runs the library's send-path validation on the log. */
function Sendable(log: LogMessage): number | undefined {
	return ResolveComponentsV2Flags({ components: [log.container], attachments: log.attachments });
}

describe("BuildBanLog", () => {
	it("should name the member, the moderator and the reason", () => {
		const log = BuildBanLog(User({ globalName: "Totally Real" }), Entry("raiding"));
		const text = Text(log.container);

		expect(log.container.accent_color).toBe(COLOR.LOG_MODERATION);
		expect(text).toContain("<@700> `spammer` (`Totally Real`)");
		expect(text).toContain("**By** <@900>");
		expect(text).toContain("**Reason** raiding");
		expect(Sendable(log)).toBeTruthy();
	});

	it("should say so when there is no audit entry", () => {
		expect(Text(BuildBanLog(User(), null).container)).toContain("*(no audit entry)*");
	});

	it("should not repeat a display name that matches the username", () => {
		expect(Text(BuildBanLog(User({ globalName: "spammer" }), null).container)).not.toContain("(`spammer`)");
	});
});

describe("BuildUnbanLog", () => {
	it("should use the additive color, not the moderation one", () => {
		const log = BuildUnbanLog(User(), Entry());
		expect(log.container.accent_color).toBe(COLOR.LOG_CREATE);
		expect(Text(log.container)).toContain("Ban lifted");
	});
});

describe("BuildAutoModLog", () => {
	it("should list every action the trigger took", () => {
		const text = Text(BuildAutoModLog(Hit({
			actions: [
				{ type: DiscordAutoModerationActionType.BLOCK_MESSAGE },
				{ type: DiscordAutoModerationActionType.SEND_ALERT_MESSAGE, metadata: { channel_id: "555" } },
				{ type: DiscordAutoModerationActionType.TIMEOUT, metadata: { duration_seconds: 3600 } },
				{ type: DiscordAutoModerationActionType.BLOCK_MEMBER_INTERACTION }
			]
		}), "No scams").container);

		expect(text).toContain("**Rule** `No scams`");
		expect(text).toContain("- Message blocked");
		expect(text).toContain("- Alert sent to <#555>");
		expect(text).toContain("- Timed out for 1 hour");
		expect(text).toContain("- Blocked from text, voice and other interactions");
	});

	it("should quote the content and the matched keyword", () => {
		const text = Text(BuildAutoModLog(Hit(), "No scams").container);
		expect(text).toContain("**Matched** `nitro`");
		expect(text).toContain("> buy cheap nitro");
	});

	it("should fall back to the rule type when the name is unknown", () => {
		const text = Text(BuildAutoModLog(Hit({ ruleTriggerType: DiscordAutoModerationRuleTriggerType.MENTION_SPAM }), null).container);
		expect(text).toContain("**Rule** *Mention spam*");
	});

	it("should link to the message only when one was let through", () => {
		expect(Text(BuildAutoModLog(Hit(), null).container)).not.toContain("Jump to message");
		expect(Text(BuildAutoModLog(Hit({ messageId: "800" }), null).container)).toContain(`https://discord.com/channels/${GUILD}/200/800`);
	});

	it("should say so when there was no content to quote", () => {
		expect(Text(BuildAutoModLog(Hit({ content: "", matchedKeyword: null }), null).container)).toContain("*No text content*");
	});

	it("should stay under the message text limit with the longest content", () => {
		const log = BuildAutoModLog(Hit({ content: "x\n".repeat(4000), matchedKeyword: "k".repeat(200) }), "r".repeat(200));
		expect(Text(log.container).length).toBeLessThanOrEqual(4000);
		expect(Sendable(log)).toBeTruthy();
	});
});