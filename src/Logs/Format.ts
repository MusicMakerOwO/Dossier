import { ContainerBuilder, DiscordAuditLogEntry, DiscordPermissions, FileAttachment } from "simplyjs";

/** A finished log: the container to post, and the files it references by `attachment://`. */
export type LogMessage = {
	container: ContainerBuilder;
	attachments: FileAttachment[];
};

export function Truncate(text: string, limit: number): string {
	return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

const NameLimit = 100;

/** Formats a name as inline code, so markdown in user text does not render. */
export function Name(name: string | null): string {
	if (name === null || name === "") return "*(no name)*";
	return `\`${Truncate(name.replaceAll("`", "'"), NameLimit)}\``;
}

/** Formats user content as a block quote, or a note when it is empty. */
export function Quote(content: string, limit: number): string {
	if (content === "") return "-# *No text content*";
	return Truncate(content.split("\n").map((line) => `> ${line}`).join("\n"), limit);
}

/** Returns the line naming who did it, with the reason from the audit entry when one was given. */
export function ActorLine(entry: DiscordAuditLogEntry | null): string {
	if (!entry?.user_id) return "**By** *(no audit entry)*";

	// A newline in the reason would break the line
	const reason = entry.reason ? `\n**Reason** ${Truncate(entry.reason.replaceAll("\n", " "), 200)}` : "";
	return `**By** <@${entry.user_id}>${reason}`;
}

/** 1 -> "1st", 12 -> "12th", 22 -> "22nd". */
export function Ordinal(rank: number): string {
	const teen = rank % 100 >= 11 && rank % 100 <= 13;
	const suffix = teen ? "th" : ["th", "st", "nd", "rd"][rank % 10] ?? "th";
	return `${rank}${suffix}`;
}

/** Returns what `after` has that `before` lacks, and what it lost. */
export function SetDiff(before: string[], after: string[]): [added: string[], removed: string[]] {
	const old = new Set(before);
	const now = new Set(after);
	return [after.filter((item) => !old.has(item)), before.filter((item) => !now.has(item))];
}

export type PermissionKey =keyof typeof DiscordPermissions;

// Names that read better than the wire key
const PermissionNameOverrides: Partial<Record<PermissionKey, string>> = {
	MANAGE_GUILD: "Manage Server",
	VIEW_GUILD_INSIGHTS: "View Server Insights",
	USE_VAD: "Use Voice Activity",
	SEND_TTS_MESSAGES: "Send Text-to-Speech Messages"
};

/** `MANAGE_CHANNELS` -> "Manage Channels". */
export function PermissionName(key: PermissionKey): string {
	return PermissionNameOverrides[key] ?? TitleCase(key);
}

/** `VERY_HIGH` -> "Very High". */
export function TitleCase(key: string): string {
	return key.split("_").map((word) => word[0] + word.slice(1).toLowerCase()).join(" ");
}

/** Every permission, in the order Discord documents them. */
export const PermissionKeys = Object.keys(DiscordPermissions) as PermissionKey[];
