import {
	AuditLogEvents,
	BaseChannel,
	Channel,
	ChannelPermissionManager,
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordChannel,
	DiscordChannelTypes,
	DiscordForumTag,
	DiscordOverwrite,
	DiscordPermissions,
	GuildForumChannel,
	GuildTextChannel,
	GuildThreadChannel,
	GuildVoiceChannel,
	ObjectValues,
	SeparatorBuilder,
	TextDisplayBuilder
} from "simplyjs";

import { COLOR } from "../Constants.js";
import { AuditAction } from "./Attribution.js";
import { ActorLine, LogMessage, Name, PermissionKeys, PermissionName, SetDiff, Truncate } from "./Format.js";
import { DescribeMove, Move } from "./ReorderBatch.js";

type ChannelType = ObjectValues<typeof DiscordChannelTypes>;

/**
 * The fields a channel log reads, taken from a cached `Channel` or a raw `DiscordChannel`. A
 * missing field is `null`, so "never set" and "removed" compare equal.
 */
export type ChannelSnapshot = {
	id: string;
	guildId: string | null;
	type: ChannelType;
	name: string | null;
	topic: string | null;
	nsfw: boolean | null;
	slowmode: number | null;
	parentId: string | null;
	bitrate: number | null;
	userLimit: number | null;
	rtcRegion: string | null;
	overwrites: DiscordOverwrite[];
	availableTags: DiscordForumTag[];
	appliedTags: string[];
	ownerId: string | null;
	archived: boolean | null;
	locked: boolean | null;
	invitable: boolean | null;
	autoArchiveMinutes: number | null;
	/** Only read to detect a reorder (see ReorderBatch.ts). Threads have none. */
	position: number | null;
};

// Every field any member of the `Channel` union declares. Reading one that a member lacks gives `undefined`
type AnyGuildChannel = BaseChannel
	& Partial<Pick<GuildTextChannel, "topic" | "nsfw" | "rateLimitPerUser" | "parentId" | "position">>
	& Partial<Pick<GuildVoiceChannel, "bitrate" | "userLimit" | "rtcRegion">>
	& Partial<Pick<GuildForumChannel, "availableTags">>
	& Partial<Pick<GuildThreadChannel, "appliedTags" | "threadMetadata" | "ownerId">>
	& { permissionOverwrites?: ChannelPermissionManager };

export function Snapshot(source: Channel | DiscordChannel): ChannelSnapshot {
	if (source instanceof BaseChannel) {
		const channel = source as AnyGuildChannel;
		const metadata = channel.threadMetadata;

		return {
			id: channel.id,
			guildId: channel.guildId ?? null,
			type: channel.type,
			name: channel.name ?? null,
			topic: channel.topic ?? null,
			nsfw: channel.nsfw ?? null,
			slowmode: channel.rateLimitPerUser ?? null,
			parentId: channel.parentId ?? null,
			bitrate: channel.bitrate ?? null,
			userLimit: channel.userLimit ?? null,
			rtcRegion: channel.rtcRegion ?? null,
			overwrites: [...(channel.permissionOverwrites?.cache.values() ?? [])],
			availableTags: channel.availableTags ?? [],
			appliedTags: channel.appliedTags ?? [],
			ownerId: channel.ownerId ?? null,
			archived: metadata?.archived ?? null,
			locked: metadata?.locked ?? null,
			invitable: metadata?.invitable ?? null,
			autoArchiveMinutes: metadata?.autoArchiveDuration ?? null,
			position: channel.position ?? null
		};
	}

	const metadata = source.thread_metadata;
	return {
		id: source.id,
		guildId: source.guild_id ?? null,
		type: source.type,
		name: source.name ?? null,
		topic: source.topic ?? null,
		nsfw: source.nsfw ?? null,
		slowmode: source.rate_limit_per_user ?? null,
		parentId: source.parent_id ?? null,
		bitrate: source.bitrate ?? null,
		userLimit: source.user_limit ?? null,
		rtcRegion: source.rtc_region ?? null,
		overwrites: source.permission_overwrites ?? [],
		availableTags: source.available_tags ?? [],
		appliedTags: source.applied_tags ?? [],
		ownerId: source.owner_id ?? null,
		archived: metadata?.archived ?? null,
		locked: metadata?.locked ?? null,
		invitable: metadata?.invitable ?? null,
		autoArchiveMinutes: metadata?.auto_archive_duration ?? null,
		position: source.position ?? null
	};
}

/**
 * The list a channel's position is counted in. Discord ranks categories, uncategorised channels and
 * each category's children separately, and lists text channels above voice channels within each.
 */
export type SortScope = { parentId: string | null; bucket: "category" | "text" | "voice" };

export function SortScopeOf(type: ChannelType, parentId: string | null): SortScope {
	if (type === DiscordChannelTypes.GUILD_CATEGORY) return { parentId: null, bucket: "category" };

	const voice = type === DiscordChannelTypes.GUILD_VOICE || type === DiscordChannelTypes.GUILD_STAGE_VOICE;
	return { parentId, bucket: voice ? "voice" : "text" };
}

/** A channel move, with the list its ranks are counted in. */
export type ChannelMove = Move & { scope: SortScope };

/**
 * Builds the log for a channel reorder batch: the channels that moved, each with its new
 * neighbours, and a count of those that only shifted. A move into another category is not included;
 * the update log reports that. There is no actor line, because whether Discord audits a channel
 * reorder has not been checked.
 */
export function BuildChannelReorderLog(moves: ChannelMove[], shifted: number, names: ReadonlyMap<string, string | null>): LogMessage {
	const lines = moves.map((move) => {
		const { moved, now } = DescribeMove(move, (id) => `<#${id}>`);
		return `<#${move.id}> ${Name(names.get(move.id) ?? null)} ${moved} ${ScopeText(move.scope)}\n-# ${now}`;
	});

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(
			new TextDisplayBuilder().setContent(`### ↕️ Channels reordered`),
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Truncate(lines.join("\n"), FieldsLimit + OverwritesLimit))
		);

	if (shifted > 0) {
		container.addComponents(new TextDisplayBuilder().setContent(`-# ${shifted} other ${shifted === 1 ? "channel" : "channels"} shifted to make room`));
	}

	return { container, attachments: [] };
}

function ScopeText(scope: SortScope): string {
	if (scope.bucket === "category") return "among categories";

	const where = scope.parentId ? `in <#${scope.parentId}>` : "outside any category";
	return scope.bucket === "voice" ? `among voice channels ${where}` : where;
}

const TypeNames: Partial<Record<ChannelType, string>> = {
	[DiscordChannelTypes.GUILD_TEXT]: "Text",
	[DiscordChannelTypes.GUILD_VOICE]: "Voice",
	[DiscordChannelTypes.GUILD_CATEGORY]: "Category",
	[DiscordChannelTypes.GUILD_ANNOUNCEMENT]: "Announcement",
	[DiscordChannelTypes.ANNOUNCEMENT_THREAD]: "Announcement thread",
	[DiscordChannelTypes.PUBLIC_THREAD]: "Thread",
	[DiscordChannelTypes.PRIVATE_THREAD]: "Private thread",
	[DiscordChannelTypes.GUILD_STAGE_VOICE]: "Stage",
	[DiscordChannelTypes.GUILD_FORUM]: "Forum",
	[DiscordChannelTypes.GUILD_MEDIA]: "Media"
};

export function ChannelTypeName(type: ChannelType): string {
	return TypeNames[type] ?? "Channel";
}

export function IsThread(type: ChannelType): boolean {
	return type === DiscordChannelTypes.ANNOUNCEMENT_THREAD
		|| type === DiscordChannelTypes.PUBLIC_THREAD
		|| type === DiscordChannelTypes.PRIVATE_THREAD;
}

/** Character budgets per section, within Discord's 4,000 per v2 message. */
const FieldsLimit = 1500;
const OverwritesLimit = 1500;
const TopicLimit = 300;

/**
 * Returns one line per changed field. Position is left out, because reorders are batched into their
 * own log. `tagNames` resolves a thread's applied tag ids to names.
 */
export function DiffChannel(before: ChannelSnapshot, after: ChannelSnapshot, tagNames: ReadonlyMap<string, string> = new Map()): string[] {
	const lines: string[] = [];

	if (before.name !== after.name) lines.push(`**Name** ${Name(before.name)} → ${Name(after.name)}`);

	if (before.topic !== after.topic) {
		lines.push(`**Topic**\n${Topic(before.topic)}\n→\n${Topic(after.topic)}`);
	}

	if (before.nsfw !== after.nsfw && after.nsfw !== null) {
		lines.push(`**Age-restricted** ${after.nsfw ? "turned on" : "turned off"}`);
	}

	if (before.slowmode !== after.slowmode) {
		lines.push(`**Slowmode** ${Seconds(before.slowmode)} → ${Seconds(after.slowmode)}`);
	}

	if (before.parentId !== after.parentId) {
		lines.push(`**Category** ${Parent(before.parentId)} → ${Parent(after.parentId)}`);
	}

	if (before.bitrate !== after.bitrate && after.bitrate !== null) {
		lines.push(`**Bitrate** ${Kbps(before.bitrate)} → ${Kbps(after.bitrate)}`);
	}

	if (before.userLimit !== after.userLimit && after.userLimit !== null) {
		lines.push(`**User limit** ${Limit(before.userLimit)} → ${Limit(after.userLimit)}`);
	}

	if (before.rtcRegion !== after.rtcRegion) {
		lines.push(`**Voice region** ${before.rtcRegion ?? "Automatic"} → ${after.rtcRegion ?? "Automatic"}`);
	}

	const [tagsAdded, tagsRemoved] = SetDiff(before.availableTags.map((tag) => tag.name), after.availableTags.map((tag) => tag.name));
	if (tagsAdded.length > 0) lines.push(`**Tags added** ${tagsAdded.map(Name).join(", ")}`);
	if (tagsRemoved.length > 0) lines.push(`**Tags removed** ${tagsRemoved.map(Name).join(", ")}`);

	const [applied, unapplied] = SetDiff(before.appliedTags, after.appliedTags);
	const tag = (id: string): string => Name(tagNames.get(id) ?? `tag ${id}`);
	if (applied.length > 0) lines.push(`**Tagged** ${applied.map(tag).join(", ")}`);
	if (unapplied.length > 0) lines.push(`**Untagged** ${unapplied.map(tag).join(", ")}`);

	if (before.archived !== after.archived && after.archived !== null) lines.push(after.archived ? "**Archived**" : "**Unarchived**");
	if (before.locked !== after.locked && after.locked !== null) lines.push(after.locked ? "**Locked**" : "**Unlocked**");

	if (before.invitable !== after.invitable && after.invitable !== null) {
		lines.push(`**Members can add others** ${after.invitable ? "turned on" : "turned off"}`);
	}

	if (before.autoArchiveMinutes !== after.autoArchiveMinutes && after.autoArchiveMinutes !== null) {
		lines.push(`**Hide after inactivity** ${Minutes(before.autoArchiveMinutes)} → ${Minutes(after.autoArchiveMinutes)}`);
	}

	return lines;
}

/** One changed permission overwrite, with the audit action Discord files that kind of change under. */
export type OverwriteChange = { action: AuditAction; line: string };

/** Returns every permission overwrite that was added, removed or changed, naming the permissions that moved. */
export function DiffOverwrites(before: DiscordOverwrite[], after: DiscordOverwrite[], guildId: string | null): OverwriteChange[] {
	const old = new Map(before.map((overwrite) => [overwrite.id, overwrite]));
	const now = new Map(after.map((overwrite) => [overwrite.id, overwrite]));
	const changes: OverwriteChange[] = [];

	for (const [id, overwrite] of now) {
		const previous = old.get(id);
		const target = OverwriteTarget(overwrite, guildId);

		if (!previous) {
			changes.push({ action: AuditLogEvents.ChannelOverwriteCreate, line: `${target} override added${Moves(null, overwrite)}` });
			continue;
		}

		if (previous.allow === overwrite.allow && previous.deny === overwrite.deny) continue;
		changes.push({ action: AuditLogEvents.ChannelOverwriteUpdate, line: `${target} override changed${Moves(previous, overwrite)}` });
	}

	for (const [id, overwrite] of old) {
		if (now.has(id)) continue;
		changes.push({ action: AuditLogEvents.ChannelOverwriteDelete, line: `${OverwriteTarget(overwrite, guildId)} override removed` });
	}

	return changes;
}

/** Builds the log for a new channel, listing its starting permission overwrites. */
export function BuildChannelCreateLog(channel: ChannelSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_CREATE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				`### ➕ ${ChannelTypeName(channel.type)} channel created\n` +
				`**Channel** <#${channel.id}> ${Name(channel.name)}${InParent(channel.parentId)}\n` +
				ActorLine(entry)
			)
		);

	const overwrites = DiffOverwrites([], channel.overwrites, channel.guildId);
	if (overwrites.length > 0) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(`**Permission overrides**\n${Bullets(overwrites.map((change) => change.line), OverwritesLimit)}`)
		);
	}

	container.addComponents(Footer(channel));
	return { container, attachments: [] };
}

/** Builds the log for a new thread. The thread's owner is shown as its creator. */
export function BuildThreadCreateLog(thread: ChannelSnapshot): LogMessage {
	const startedBy = thread.ownerId ? `**Started by** <@${thread.ownerId}>` : "**Started by** *(unknown)*";

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_CREATE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				`### 🧵 ${ChannelTypeName(thread.type)} started\n` +
				`**Thread** <#${thread.id}> ${Name(thread.name)}${InParent(thread.parentId)}\n` +
				startedBy
			),
			Footer(thread)
		);

	return { container, attachments: [] };
}

/** Builds the log for a changed channel or thread. `before` is undefined when no earlier version is known, and the log says so. */
export function BuildChannelUpdateLog(before: ChannelSnapshot | undefined, after: ChannelSnapshot, fields: string[], overwrites: OverwriteChange[], entry: DiscordAuditLogEntry | null): LogMessage {
	const thread = IsThread(after.type);

	// Discord archives an idle thread itself and does not audit it, but a late entry looks the same
	const autoArchived = !entry && after.archived === true && before?.archived === false;
	const actor = autoArchived ? "**By** *(no audit entry, most likely hidden after inactivity)*" : ActorLine(entry);

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				`### ✏️ ${thread ? "Thread" : "Channel"} changed\n` +
				`**${thread ? "Thread" : "Channel"}** <#${after.id}> ${Name(after.name)}${InParent(after.parentId)}\n` +
				actor
			)
		);

	if (!before) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent("-# *No earlier version cached, so Dossier cannot tell what changed.*")
		);
	}

	if (fields.length > 0) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Truncate(fields.join("\n"), FieldsLimit))
		);
	}

	if (overwrites.length > 0) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(`**Permission overrides**\n${Bullets(overwrites.map((change) => change.line), OverwritesLimit)}`)
		);
	}

	container.addComponents(Footer(after));
	return { container, attachments: [] };
}

/** Builds the log for a deleted channel or thread. The name is plain text, because a mention of a deleted channel renders as "#deleted-channel". */
export function BuildChannelDeleteLog(channel: ChannelSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const thread = IsThread(channel.type);
	const kind = thread ? ChannelTypeName(channel.type) : `${ChannelTypeName(channel.type)} channel`;

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_DELETE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				`### 🗑️ ${kind} deleted\n` +
				`**${thread ? "Thread" : "Channel"}** ${Name(channel.name)}${InParent(channel.parentId)}\n` +
				ActorLine(entry)
			),
			Footer(channel)
		);

	return { container, attachments: [] };
}

function Footer(channel: ChannelSnapshot): TextDisplayBuilder {
	const parent = channel.parentId ? ` · Parent ${channel.parentId}` : "";
	return new TextDisplayBuilder().setContent(`-# ${IsThread(channel.type) ? "Thread" : "Channel"} ${channel.id}${parent}`);
}

function OverwriteTarget(overwrite: DiscordOverwrite, guildId: string | null): string {
	// @everyone's role id is the guild id, and `<@&guildId>` renders as a broken mention
	if (overwrite.type === 0 && overwrite.id === guildId) return "@everyone";
	return overwrite.type === 0 ? `<@&${overwrite.id}>` : `<@${overwrite.id}>`;
}

/** Returns each permission's change, grouped by direction. A new overwrite counts as a change from inherit. */
function Moves(before: DiscordOverwrite | null, after: DiscordOverwrite): string {
	const allowed: string[] = [];
	const denied: string[] = [];
	const reset: string[] = [];

	const oldAllow = BigInt(before?.allow ?? 0);
	const oldDeny = BigInt(before?.deny ?? 0);
	const newAllow = BigInt(after.allow);
	const newDeny = BigInt(after.deny);

	for (const key of PermissionKeys) {
		const bit = DiscordPermissions[key];
		const was = oldAllow & bit ? "allow" : oldDeny & bit ? "deny" : "inherit";
		const now = newAllow & bit ? "allow" : newDeny & bit ? "deny" : "inherit";
		if (was === now) continue;

		const name = PermissionName(key);
		if (now === "allow") allowed.push(name);
		else if (now === "deny") denied.push(name);
		else reset.push(name);
	}

	const parts: string[] = [];
	if (allowed.length > 0) parts.push(`✅ ${allowed.join(", ")}`);
	if (denied.length > 0) parts.push(`❌ ${denied.join(", ")}`);
	if (reset.length > 0) parts.push(`➖ ${reset.join(", ")}`);
	return parts.length > 0 ? `: ${parts.join(" · ")}` : "";
}

function Bullets(lines: string[], limit: number): string {
	return Truncate(lines.map((line) => `- ${line}`).join("\n"), limit);
}

function Topic(topic: string | null): string {
	if (topic === null || topic === "") return "-# *No topic*";
	return Truncate(topic.split("\n").map((line) => `> ${line}`).join("\n"), TopicLimit);
}

function InParent(parentId: string | null): string {
	return parentId ? ` in <#${parentId}>` : "";
}

function Parent(parentId: string | null): string {
	return parentId ? `<#${parentId}>` : "*none*";
}

function Seconds(seconds: number | null): string {
	if (!seconds) return "off";
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${seconds / 60}m`;
	return `${seconds / 3600}h`;
}

function Minutes(minutes: number | null): string {
	if (minutes === null) return "*unset*";
	if (minutes < 60) return `${minutes} minutes`;
	if (minutes < 1440) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
	if (minutes === 10_080) return "1 week";
	return `${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
}

function Kbps(bitrate: number | null): string {
	return bitrate === null ? "*unset*" : `${bitrate / 1000}kbps`;
}

function Limit(limit: number | null): string {
	return !limit ? "unlimited" : `${limit}`;
}
