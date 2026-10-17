import {
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordMemberFlags,
	Member,
	SectionBuilder,
	SeparatorBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	UncachedMember
} from "simplyjs";

import { COLOR } from "../Constants.js";
import { ActorLine, LogMessage, Name, SetDiff, Truncate } from "./Format.js";

/** The fields a member log reads. `roles` is `null` for a member who left without having been cached. */
export type SimpleMember = {
	id: string;
	guildId: string;
	username: string;
	globalName: string | null;
	bot: boolean;
	/**
	 * The avatar shown in this guild: the server avatar, else the account's. Read at snapshot time
	 * because the library patches the shared user in place.
	 */
	avatarURL: string;
	nick: string | null;
	roles: string[] | null;
	joinedAt: string | null;
	/** The server avatar's hash. Compared, never shown. */
	serverAvatar: string | null;
	premiumSince: string | null;
	timeoutUntil: string | null;
	flags: number | null;
};

export function SimplifyMember(source: Member | UncachedMember): SimpleMember {
	const user = {
		id: source.id,
		username: source.user.username,
		globalName: source.user.globalName,
		bot: source.user.bot === true,
		avatarURL: source instanceof Member ? source.avatarURL() : source.user.avatarURL()
	};

	if (!(source instanceof Member)) {
		return {
			...user,
			guildId: source.guildId,
			nick: null,
			roles: null,
			joinedAt: null,
			serverAvatar: null,
			premiumSince: null,
			timeoutUntil: null,
			flags: null
		};
	}

	return {
		...user,
		guildId: source.guildId,
		nick: source.nick ?? null,
		// Copied: the cache hands out the payload's own array
		roles: [...source.roles],
		joinedAt: source.joinedAt,
		serverAvatar: source.avatar ?? null,
		premiumSince: source.premiumSince ?? null,
		timeoutUntil: source.communicationDisabledUntil ?? null,
		flags: source.flags
	};
}

const FieldsLimit = 3000;
const RolesLimit = 1500;

export type MemberCause = "left" | "kicked" | "banned";

/** Whether the member is timed out at `now`. Discord does not clear the field when a timeout expires. */
function TimedOut(member: SimpleMember, now: number): boolean {
	return member.timeoutUntil !== null && Date.parse(member.timeoutUntil) > now;
}

/**
 * Whether this update started or ended a timeout. An extension counts as a start. Only an early
 * removal is seen ending, because an expiry fires no event.
 */
export function TimeoutChange(before: SimpleMember, after: SimpleMember, now = Date.now()): "started" | "ended" | null {
	const was = TimedOut(before, now);
	const is = TimedOut(after, now);

	if (is) return was && before.timeoutUntil === after.timeoutUntil ? null : "started";
	return was ? "ended" : null;
}

const QuarantineFlags = [
	[DiscordMemberFlags.AUTOMOD_QUARANTINED_USERNAME, "name"],
	[DiscordMemberFlags.AUTOMOD_QUARANTINED_GUILD_TAG, "server tag"]
] as const;

/**
 * Returns one line per changed membership field. Timeouts have their own log. Account fields
 * (username, display name, avatar) and voice state are left out.
 */
export function DiffMember(before: SimpleMember, after: SimpleMember): string[] {
	const lines: string[] = [];

	if (before.nick !== after.nick) lines.push(`**Nickname** ${Optional(before.nick)} → ${Optional(after.nick)}`);

	const [added, removed] = SetDiff(before.roles ?? [], after.roles ?? []);
	if (added.length > 0) lines.push(Truncate(`**Roles added** ${added.map(Role).join(", ")}`, RolesLimit));
	if (removed.length > 0) lines.push(Truncate(`**Roles removed** ${removed.map(Role).join(", ")}`, RolesLimit));

	if (before.serverAvatar !== after.serverAvatar) {
		// Both are custom images, which differ only by hash
		if (before.serverAvatar !== null && after.serverAvatar !== null) lines.push("**Server avatar** replaced");
		else lines.push(after.serverAvatar === null ? "**Server avatar** removed" : "**Server avatar** set");
	}

	if ((before.premiumSince === null) !== (after.premiumSince === null)) {
		lines.push(after.premiumSince === null ? "**Stopped boosting the server**" : "**Started boosting the server**");
	}

	for (const [flag, what] of QuarantineFlags) {
		const had = ((before.flags ?? 0) & flag) !== 0;
		const has = ((after.flags ?? 0) & flag) !== 0;
		if (had === has) continue;

		lines.push(has ? `**AutoMod quarantined** their ${what}, so they cannot talk until it changes` : `**AutoMod quarantine lifted** for their ${what}`);
	}

	return lines;
}

/** Builds the log for a join. The audit entry, which only a bot join has, names who added it. */
export function BuildMemberJoinLog(member: SimpleMember, entry: DiscordAuditLogEntry | null): LogMessage {
	const rejoined = ((member.flags ?? 0) & DiscordMemberFlags.DID_REJOIN) !== 0 ? "\n-# Has been in this server before" : "";

	const lines = [
		member.bot ? "### 🤖 Bot added" : "### 📥 Member joined",
		Subject(member),
		`**Account created** ${Timestamp(CreatedAt(member.id), "R")}`
	];
	if (member.bot) lines.push(entry?.user_id ? `**Added by** <@${entry.user_id}>` : "**Added by** *(no audit entry)*");

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_CREATE)
		.addComponents(Header(member, lines.join("\n") + rejoined), Footer(member));

	return { container, attachments: [] };
}

/** Builds the log for a changed member. `before` is undefined when no earlier version is known, and the log says so. */
export function BuildMemberUpdateLog(before: SimpleMember | undefined, after: SimpleMember, fields: string[], entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(Header(after, `### ✏️ Member changed\n${Subject(after)}\n${ActorLine(entry)}`));

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

	container.addComponents(Footer(after));
	return { container, attachments: [] };
}

/** Builds the log for a timeout. No audit entry most likely means AutoMod, which is audited under a different action. */
export function BuildTimeoutLog(member: SimpleMember, entry: DiscordAuditLogEntry | null): LogMessage {
	const actor = entry?.user_id ? ActorLine(entry) : "**By** *(no audit entry, most likely AutoMod)*";
	const until = member.timeoutUntil === null ? "" : `\n**Until** ${Timestamp(Date.parse(member.timeoutUntil), "f")} (${Timestamp(Date.parse(member.timeoutUntil), "R")})`;

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_MODERATION)
		.addComponents(Header(member, `### 🔇 Member timed out\n${Subject(member)}${until}\n${actor}`), Footer(member));

	return { container, attachments: [] };
}

/** Builds the log for a timeout lifted early. Uses the create color, like an unban. */
export function BuildTimeoutEndLog(member: SimpleMember, entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_CREATE)
		.addComponents(Header(member, `### 🔊 Timeout removed\n${Subject(member)}\n${ActorLine(entry)}`), Footer(member));

	return { container, attachments: [] };
}

const LeaveTitles = {
	left: "### 📤 Member left",
	kicked: "### 👢 Member kicked",
	banned: "### 🔨 Member left (banned)"
} as const satisfies Record<MemberCause, string>;

/** Builds the log for a member leaving, with their roles. `cause` is what the audit log showed: a leave, kick or ban. */
export function BuildMemberLeaveLog(member: SimpleMember, cause: MemberCause, entry: DiscordAuditLogEntry | null): LogMessage {
	const lines = [LeaveTitles[cause], Subject(member)];
	if (cause !== "left") lines.push(ActorLine(entry));
	if (member.joinedAt !== null) lines.push(`**Joined** ${Timestamp(Date.parse(member.joinedAt), "R")}`);

	const container = new ContainerBuilder()
		.setAccentColor(cause === "left" ? COLOR.LOG_DELETE : COLOR.LOG_MODERATION)
		.addComponents(Header(member, lines.join("\n")));

	if (member.roles === null) {
		container.addComponents(new TextDisplayBuilder().setContent("-# *Was not cached, so their roles and join date are unknown.*"));
	} else if (member.roles.length > 0) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Truncate(`**Roles** ${member.roles.map(Role).join(", ")}`, RolesLimit))
		);
	}

	container.addComponents(Footer(member));
	return { container, attachments: [] };
}

/** Returns the header text beside the member's avatar. */
function Header(member: SimpleMember, content: string): SectionBuilder {
	const thumbnail = new ThumbnailBuilder().setMedia(member.avatarURL).setDescription(member.username);
	return new SectionBuilder().addComponents(new TextDisplayBuilder().setContent(content)).setAccessory(thumbnail);
}

function Subject(member: SimpleMember): string {
	const displayName = member.globalName && member.globalName !== member.username ? ` (${Name(member.globalName)})` : "";
	return `**Member** <@${member.id}> ${Name(member.username)}${displayName}`;
}

function Footer(member: SimpleMember): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(`-# User ${member.id}`);
}

function Role(id: string): string {
	return `<@&${id}>`;
}

function Optional(text: string | null): string {
	return text ? Name(text) : "*none*";
}

function Timestamp(ms: number, style: "R" | "f"): string {
	return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

/** Returns when an account was created, read from its snowflake. */
function CreatedAt(id: string): number {
	return Number((BigInt(id) >> 22n) + 1420070400000n);
}