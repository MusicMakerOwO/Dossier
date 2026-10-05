import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	AutoModerationActionExecutionPayload,
	AutoModerationRule,
	Client,
	DiscordAuditLogEvent,
	DiscordAutoModerationActionType,
	DiscordAutoModerationRuleTriggerType,
	DiscordGuildCreate,
	DiscordUser,
	Guild
} from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";
import { AUTOMOD_BATCH_MS } from "../Logs/AutoModBatch.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited } = vi.hoisted(() => ({ Awaited: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const { Configured } = vi.hoisted(() => ({ Configured: vi.fn() }));
vi.mock("../CRUD/GuildEvents.js", () => ({ GetGuildEvent: Configured }));

const Events = await import("../Events/Logs/Mod.js");

const GUILD = "100";
const RULE = "300";

const client = new Client({ token: "test", intents: [] }) as FullClient;
const guild: Guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);
const user = client.users.upsert({ id: "700", username: "spammer", discriminator: "0", global_name: null, avatar: null } as DiscordUser);

let NextMessage = 1000n;

function Payload(fields: Partial<AutoModerationActionExecutionPayload> = {}): AutoModerationActionExecutionPayload {
	return {
		guildId: GUILD, ruleId: RULE, ruleTriggerType: DiscordAutoModerationRuleTriggerType.KEYWORD,
		userId: "700", channelId: "200", content: `hit ${NextMessage++}`, matchedKeyword: "hit", matchedContent: "hit",
		action: { type: DiscordAutoModerationActionType.BLOCK_MESSAGE },
		...fields
	};
}

/** Fires every payload, then closes the batch window. */
async function Trigger(...payloads: AutoModerationActionExecutionPayload[]): Promise<void> {
	for (const payload of payloads) await Events.autoModerationActionExecution.execute(client, payload);
	await vi.advanceTimersByTimeAsync(AUTOMOD_BATCH_MS);
}

/** The text of the one log posted, for asserting on what the batch merged. */
function Posted(): string {
	const container = Sent.mock.calls[0][3];
	return container.components.flatMap((child: { content?: string }) => child.content ?? []).join("\n");
}

beforeEach(() => {
	vi.useFakeTimers();
	Logged.mockClear();
	Awaited.mockReset().mockResolvedValue(null);
	Sent.mockReset().mockResolvedValue(true);
	Configured.mockReset().mockReturnValue({ enabled: 1n, channel_id: 1n });
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("guildBanAdd", () => {
	it("should wait on MEMBER_BAN_ADD for the banned user", async () => {
		await Events.guildBanAdd.execute(client, guild, user);

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, DiscordAuditLogEvent.MEMBER_BAN_ADD, "700");
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "GuildBanAdd", expect.anything());
	});
});

describe("guildBanRemove", () => {
	it("should wait on MEMBER_BAN_REMOVE for the unbanned user", async () => {
		await Events.guildBanRemove.execute(client, guild, user);

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, DiscordAuditLogEvent.MEMBER_BAN_REMOVE, "700");
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "GuildBanRemove", expect.anything());
	});
});

describe("autoModerationActionExecution", () => {
	it("should post one log for every action of one trigger", async () => {
		vi.spyOn(guild.autoModerationRules, "fetch").mockRejectedValue(new Error("Missing Permissions"));
		const content = "one trigger";

		await Trigger(
			Payload({ content }),
			Payload({ content, action: { type: DiscordAutoModerationActionType.SEND_ALERT_MESSAGE, metadata: { channel_id: "555" } } }),
			Payload({ content, action: { type: DiscordAutoModerationActionType.TIMEOUT, metadata: { duration_seconds: 60 } } })
		);

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("Message blocked");
		expect(Posted()).toContain("Alert sent to <#555>");
		expect(Posted()).toContain("Timed out for 1 minute");
	});

	it("should post separately for two members tripping the same rule", async () => {
		vi.spyOn(guild.autoModerationRules, "fetch").mockRejectedValue(new Error("Missing Permissions"));

		await Trigger(Payload({ userId: "701", content: "same" }), Payload({ userId: "702", content: "same" }));

		expect(Sent).toHaveBeenCalledTimes(2);
	});

	it("should not fetch the rule when the guild is not logging AutoMod", async () => {
		Configured.mockReturnValue({ enabled: 0n, channel_id: 1n });
		const fetch = vi.spyOn(guild.autoModerationRules, "fetch");

		await Trigger(Payload());

		expect(fetch).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should name the rule from the cache without fetching it", async () => {
		vi.spyOn(guild.autoModerationRules, "get").mockReturnValue({ name: "No scams" } as AutoModerationRule);
		const fetch = vi.spyOn(guild.autoModerationRules, "fetch");

		await Trigger(Payload());

		expect(fetch).not.toHaveBeenCalled();
		expect(Posted()).toContain("`No scams`");
	});

	it("should still post when the rule cannot be fetched", async () => {
		vi.spyOn(guild.autoModerationRules, "fetch").mockRejectedValue(new Error("Missing Permissions"));

		await Trigger(Payload());

		expect(Sent).toHaveBeenCalledWith(client, GUILD, "AutoModerationActionExecution", expect.anything());
		expect(Posted()).toContain("*Custom words*");
	});
});