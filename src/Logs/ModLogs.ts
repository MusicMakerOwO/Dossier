import {
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordAutoModerationAction,
	DiscordAutoModerationActionType,
	DiscordAutoModerationRuleTriggerType,
	ObjectValues,
	SeparatorBuilder,
	TextDisplayBuilder,
	User
} from "simplyjs";

import { COLOR } from "../Constants.js";
import { AutoModHit } from "./AutoModBatch.js";
import { ActorLine, LogMessage, Name, Quote } from "./Format.js";

type TriggerType = ObjectValues<typeof DiscordAutoModerationRuleTriggerType>;

/** The user fields a ban log reads. */
export type BannedUser = Pick<User, "id" | "username" | "globalName">;

/** How much AutoMod-quoted content is shown. A blocked message is never stored, so this quote is its only copy. */
const ContentLimit = 2500;

/** Builds the log for a ban. */
export function BuildBanLog(user: BannedUser, entry: DiscordAuditLogEntry | null): LogMessage {
	return BanLog(user, entry, COLOR.LOG_MODERATION, "🔨 Member banned");
}

/** Builds the log for a lifted ban. Uses the create color, so it does not read as a second ban. */
export function BuildUnbanLog(user: BannedUser, entry: DiscordAuditLogEntry | null): LogMessage {
	return BanLog(user, entry, COLOR.LOG_CREATE, "🔓 Ban lifted");
}

function BanLog(user: BannedUser, entry: DiscordAuditLogEntry | null, color: number, title: string): LogMessage {
	const displayName = user.globalName && user.globalName !== user.username ? ` (${Name(user.globalName)})` : "";

	const container = new ContainerBuilder()
		.setAccentColor(color)
		.addComponents(
			new TextDisplayBuilder().setContent(
				`### ${title}\n` +
				`**Member** <@${user.id}> ${Name(user.username)}${displayName}\n` +
				ActorLine(entry)
			),
			new TextDisplayBuilder().setContent(`-# User ${user.id}`)
		);

	return { container, attachments: [] };
}

// The names Discord's AutoMod settings page uses for each rule type
const TriggerNames: Partial<Record<TriggerType, string>> = {
	[DiscordAutoModerationRuleTriggerType.KEYWORD]: "Custom words",
	[DiscordAutoModerationRuleTriggerType.SPAM]: "Suspected spam",
	[DiscordAutoModerationRuleTriggerType.KEYWORD_PRESET]: "Commonly flagged words",
	[DiscordAutoModerationRuleTriggerType.MENTION_SPAM]: "Mention spam",
	[DiscordAutoModerationRuleTriggerType.MEMBER_PROFILE]: "Member profile words"
};

export function TriggerName(type: TriggerType): string {
	return TriggerNames[type] ?? "AutoMod rule";
}

/** Builds the log for one AutoMod trigger, listing every action taken. When `ruleName` is null the rule's type is shown instead. */
export function BuildAutoModLog(hit: AutoModHit, ruleName: string | null): LogMessage {
	const rule = ruleName === null ? `*${TriggerName(hit.ruleTriggerType)}*` : Name(ruleName);
	const where = hit.channelId ? ` · **Channel** <#${hit.channelId}>` : "";

	// Only set when the message was let through (an alert-only rule)
	const jump = hit.messageId && hit.channelId
		? `\n[Jump to message](https://discord.com/channels/${hit.guildId}/${hit.channelId}/${hit.messageId})`
		: "";

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_MODERATION)
		.addComponents(
			new TextDisplayBuilder().setContent(
				"### 🛡️ AutoMod stepped in\n" +
				`**Rule** ${rule}\n` +
				`**Member** <@${hit.userId}>${where}\n` +
				hit.actions.map((action) => `- ${ActionLine(action)}`).join("\n") +
				jump
			),
			new SeparatorBuilder().setDivider()
		);

	const matched = hit.matchedKeyword ? `**Matched** ${Name(hit.matchedKeyword)}\n` : "";
	container.addComponents(
		new TextDisplayBuilder().setContent(matched + Quote(hit.content, ContentLimit)),
		new TextDisplayBuilder().setContent(`-# Member ${hit.userId} · Rule ${hit.ruleId}`)
	);

	return { container, attachments: [] };
}

function ActionLine(action: DiscordAutoModerationAction): string {
	switch (action.type) {
		case DiscordAutoModerationActionType.BLOCK_MESSAGE:
			return "Message blocked";
		case DiscordAutoModerationActionType.SEND_ALERT_MESSAGE:
			return action.metadata?.channel_id ? `Alert sent to <#${action.metadata.channel_id}>` : "Alert sent";
		case DiscordAutoModerationActionType.TIMEOUT:
			return action.metadata?.duration_seconds ? `Timed out for ${Duration(action.metadata.duration_seconds)}` : "Timed out";
		case DiscordAutoModerationActionType.BLOCK_MEMBER_INTERACTION:
			return "Blocked from text, voice and other interactions";
		default:
			return "Unknown action";
	}
}

/** Formats a timeout length in its largest whole unit. */
function Duration(seconds: number): string {
	const units = [["week", 604_800], ["day", 86_400], ["hour", 3600], ["minute", 60]] as const;
	for (const [unit, size] of units) {
		if (seconds >= size && seconds % size === 0) {
			const count = seconds / size;
			return `${count} ${unit}${count === 1 ? "" : "s"}`;
		}
	}
	return `${seconds} seconds`;
}