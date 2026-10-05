import {
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordPermissions,
	Role,
	SeparatorBuilder,
	TextDisplayBuilder,
	UncachedRole
} from "simplyjs";

import { COLOR } from "../Constants.js";
import { ActorLine, LogMessage, Name, PermissionKeys, PermissionName, Truncate } from "./Format.js";
import { DescribeMove, Move } from "./ReorderBatch.js";

/** The fields a role log reads. Everything past the ids is `null` for a role deleted before it was cached. */
export type RoleSnapshot = {
	id: string;
	guildId: string;
	name: string | null;
	colors: { primary: number; secondary: number | null; tertiary: number | null } | null;
	hoist: boolean | null;
	mentionable: boolean | null;
	managed: boolean | null;
	/** The custom icon's hash. Compared, never shown (simplyjs-findings.md #13). */
	icon: string | null;
	unicodeEmoji: string | null;
	permissions: bigint | null;
	/** The bot an integration role belongs to. */
	botId: string | null;
	/** Only read to detect a reorder (see ReorderBatch.ts). */
	position: number | null;
};

export function SnapshotRole(source: Role | UncachedRole): RoleSnapshot {
	if (!(source instanceof Role)) {
		return {
			id: source.id,
			guildId: source.guildId,
			name: null,
			colors: null,
			hoist: null,
			mentionable: null,
			managed: null,
			icon: null,
			unicodeEmoji: null,
			permissions: null,
			botId: null,
			position: null
		};
	}

	return {
		id: source.id,
		guildId: source.guildId,
		name: source.name,
		colors: {
			primary: source.colors.primaryColor,
			secondary: source.colors.secondaryColor,
			tertiary: source.colors.tertiaryColor
		},
		hoist: source.hoist,
		mentionable: source.mentionable,
		managed: source.managed,
		icon: source.icon ?? null,
		unicodeEmoji: source.unicodeEmoji ?? null,
		permissions: source.permissions.value,
		botId: source.tags.botId ?? null,
		position: source.position
	};
}

/** Character budget for all changed fields together, within Discord's 4,000 per v2 message. */
const FieldsLimit = 3000;
const PermissionsLimit = 1500;

/** Returns one line per changed field. Position is left out, because reorders are batched into their own log. */
export function DiffRole(before: RoleSnapshot, after: RoleSnapshot): string[] {
	const lines: string[] = [];

	if (before.name !== after.name && after.name !== null) lines.push(`**Name** ${Name(before.name)} → ${Name(after.name)}`);

	if (after.colors && !SameColors(before.colors, after.colors)) {
		lines.push(`**Color** ${Colors(before.colors)} → ${Colors(after.colors)}`);
	}

	if (before.hoist !== after.hoist && after.hoist !== null) {
		lines.push(`**Shown separately in the member list** ${after.hoist ? "turned on" : "turned off"}`);
	}

	if (before.mentionable !== after.mentionable && after.mentionable !== null) {
		lines.push(`**Anyone can @mention it** ${after.mentionable ? "turned on" : "turned off"}`);
	}

	if (before.icon !== after.icon || before.unicodeEmoji !== after.unicodeEmoji) {
		// Both are custom images, which differ only by hash
		const replaced = before.icon !== null && after.icon !== null;
		lines.push(replaced ? "**Icon** custom image replaced" : `**Icon** ${Icon(before)} → ${Icon(after)}`);
	}

	if (before.permissions !== null && after.permissions !== null && before.permissions !== after.permissions) {
		lines.push(`**Permissions** ${PermissionMoves(before.permissions, after.permissions)}`);
	}

	return lines;
}

/**
 * Builds the log for a new role, listing its starting permissions. An integration role has no
 * audit entry of its own, so its bot is named instead.
 */
export function BuildRoleCreateLog(role: RoleSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const actor = !entry?.user_id && role.botId ? `**By** *(integration role for <@${role.botId}>)*` : ActorLine(entry);

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_CREATE)
		.addComponents(
			new TextDisplayBuilder().setContent(`### ➕ Role created\n${Subject(role)}\n${actor}`),
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Truncate(`**Permissions** ${PermissionList(role.permissions)}`, PermissionsLimit)),
			Footer(role)
		);

	return { container, attachments: [] };
}

/** Builds the log for a changed role. `before` is undefined when no earlier version is known, and the log says so. */
export function BuildRoleUpdateLog(before: RoleSnapshot | undefined, after: RoleSnapshot, fields: string[], entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(new TextDisplayBuilder().setContent(`### ✏️ Role changed\n${Subject(after)}\n${ActorLine(entry)}`));

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

/** Builds the log for a deleted role. The name is plain text, because a mention of a deleted role renders as "@deleted-role". */
export function BuildRoleDeleteLog(role: RoleSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const name = role.name === null ? "*(was not cached, name unknown)*" : Name(role.name);

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_DELETE)
		.addComponents(
			new TextDisplayBuilder().setContent(`### 🗑️ Role deleted\n**Role** ${name}\n${ActorLine(entry)}`),
			Footer(role)
		);

	return { container, attachments: [] };
}

/**
 * Builds the log for a role reorder batch: the roles that moved, each with its new neighbours, and
 * a count of those that only shifted. It names no actor, because Discord writes no audit entry for
 * a role reorder.
 */
export function BuildRoleReorderLog(guildId: string, moves: Move[], shifted: number, names: ReadonlyMap<string, string>): LogMessage {
	const lines = moves.map((move) => {
		const { moved, now } = DescribeMove(move, (id) => RoleRef(id, guildId));
		return `${RoleRef(move.id, guildId)} ${Name(names.get(move.id) ?? null)} ${moved}\n-# ${now}`;
	});

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(
			new TextDisplayBuilder().setContent(`### ↕️ Roles reordered\n**By** *(Discord does not record who reorders roles)*`),
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Truncate(lines.join("\n"), FieldsLimit))
		);

	if (shifted > 0) {
		container.addComponents(new TextDisplayBuilder().setContent(`-# ${shifted} other ${shifted === 1 ? "role" : "roles"} shifted to make room`));
	}

	return { container, attachments: [] };
}

/** Returns the role as a mention, or as "@everyone" for the everyone role. */
function RoleRef(id: string, guildId: string): string {
	return id === guildId ? "@everyone" : `<@&${id}>`;
}

function Subject(role: RoleSnapshot): string {
	// @everyone's role id is the guild id, and `<@&guildId>` renders as a broken mention
	if (role.id === role.guildId) return "**Role** @everyone";
	return `**Role** <@&${role.id}> ${Name(role.name)}`;
}

function Footer(role: RoleSnapshot): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(`-# Role ${role.id}`);
}

/** Returns each permission change as a grant or a revoke. */
function PermissionMoves(before: bigint, after: bigint): string {
	const granted: string[] = [];
	const revoked: string[] = [];

	for (const key of PermissionKeys) {
		const bit = DiscordPermissions[key];
		const had = (before & bit) !== 0n;
		const has = (after & bit) !== 0n;
		if (had === has) continue;

		(has ? granted : revoked).push(PermissionName(key));
	}

	const parts: string[] = [];
	if (granted.length > 0) parts.push(`✅ ${granted.join(", ")}`);
	if (revoked.length > 0) parts.push(`❌ ${revoked.join(", ")}`);
	return parts.join(" · ");
}

function PermissionList(permissions: bigint | null): string {
	if (permissions === null) return "*unknown*";

	const names = PermissionKeys.filter((key) => (permissions & DiscordPermissions[key]) !== 0n).map(PermissionName);
	return names.length > 0 ? names.join(", ") : "*none*";
}

function SameColors(before: RoleSnapshot["colors"], after: NonNullable<RoleSnapshot["colors"]>): boolean {
	return before !== null
		&& before.primary === after.primary
		&& before.secondary === after.secondary
		&& before.tertiary === after.tertiary;
}

/** Formats a role's colors. A primary of 0 is Discord's "no color", not black. */
function Colors(colors: RoleSnapshot["colors"]): string {
	if (colors === null) return "*unknown*";

	const stops = [colors.primary, colors.secondary, colors.tertiary].filter((stop): stop is number => stop !== null);
	if (stops.length === 1) return stops[0] === 0 ? "*default*" : Hex(stops[0]);
	return `gradient ${stops.map(Hex).join(" / ")}`;
}

function Hex(color: number): string {
	return `\`#${color.toString(16).padStart(6, "0")}\``;
}

function Icon(role: RoleSnapshot): string {
	if (role.unicodeEmoji) return role.unicodeEmoji;
	return role.icon ? "custom image" : "*none*";
}