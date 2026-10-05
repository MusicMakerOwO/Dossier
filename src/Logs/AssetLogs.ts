import {
	ContainerBuilder,
	DiscordAuditLogEntry,
	Emoji,
	SectionBuilder,
	SeparatorBuilder,
	SoundboardSound,
	Sticker,
	TextDisplayBuilder,
	ThumbnailBuilder,
	UncachedSoundboardSound
} from "simplyjs";

import { COLOR } from "../Constants.js";
import { ActorLine, LogMessage, Name, SetDiff, Truncate } from "./Format.js";

type Common = {
	id: string;
	/** `null` for a soundboard sound deleted before it was cached. */
	name: string | null;
	available: boolean | null;
	/** The uploader, which Discord only sends with `MANAGE_GUILD_EXPRESSIONS`. */
	creatorId: string | null;
	/**
	 * The item's image URL, read at snapshot time so a delete log can still show it. `null` for
	 * sounds and Lottie stickers, which have no image.
	 */
	imageURL: string | null;
};

export type EmojiSnapshot = Common & { kind: "emoji"; roles: string[] };
export type StickerSnapshot = Common & { kind: "sticker"; description: string | null; tags: string | null };
export type SoundSnapshot = Common & { kind: "sound"; volume: number | null; emojiId: string | null; emojiName: string | null };

/** The fields an asset log reads, taken from a cached item or from the bare ids of an uncached one. */
export type AssetSnapshot = EmojiSnapshot | StickerSnapshot | SoundSnapshot;

export type AssetKind = AssetSnapshot["kind"];

export function SnapshotEmoji(source: Emoji): EmojiSnapshot {
	return {
		kind: "emoji",
		id: source.id,
		name: source.name,
		available: source.available ?? null,
		roles: source.roles ?? [],
		creatorId: source.user?.id ?? null,
		imageURL: source.imageURL()
	};
}

export function SnapshotSticker(source: Sticker): StickerSnapshot {
	return {
		kind: "sticker",
		id: source.id,
		name: source.name,
		description: source.description ?? null,
		tags: source.tags || null,
		available: source.available ?? null,
		creatorId: source.user?.id ?? null,
		imageURL: source.imageURL()
	};
}

export function SnapshotSound(source: SoundboardSound | UncachedSoundboardSound): SoundSnapshot {
	if (!(source instanceof SoundboardSound)) {
		return { kind: "sound", id: source.soundId, name: null, volume: null, emojiId: null, emojiName: null, available: null, creatorId: null, imageURL: null };
	}

	return {
		kind: "sound",
		id: source.soundId,
		name: source.name,
		volume: source.volume,
		emojiId: source.emojiId,
		emojiName: source.emojiName,
		available: source.available,
		creatorId: source.user?.id ?? null,
		imageURL: null
	};
}

const KindNames = {
	emoji: "Emoji",
	sticker: "Sticker",
	sound: "Soundboard sound"
} as const satisfies Record<AssetKind, string>;

const FieldsLimit = 1500;

/** Returns one line per changed field. Returns nothing when the snapshots are of different kinds. */
export function DiffAsset(before: AssetSnapshot, after: AssetSnapshot): string[] {
	const lines: string[] = [];

	if (before.name !== after.name) lines.push(`**Name** ${Name(before.name)} → ${Name(after.name)}`);

	if (before.kind === "emoji" && after.kind === "emoji") {
		// An emoji with no roles is usable by everyone
		if (before.roles.length > 0 && after.roles.length === 0) {
			lines.push("**Role restriction lifted**, anyone can use it now");
		} else {
			const [added, removed] = SetDiff(before.roles, after.roles);
			if (added.length > 0) lines.push(`**${before.roles.length === 0 ? "Restricted to" : "Roles allowed"}** ${added.map(Role).join(", ")}`);
			if (removed.length > 0) lines.push(`**Roles no longer allowed** ${removed.map(Role).join(", ")}`);
		}
	}

	if (before.kind === "sticker" && after.kind === "sticker") {
		if (before.description !== after.description) lines.push(`**Description** ${Optional(before.description)} → ${Optional(after.description)}`);
		if (before.tags !== after.tags) lines.push(`**Related emoji** ${Optional(before.tags)} → ${Optional(after.tags)}`);
	}

	if (before.kind === "sound" && after.kind === "sound") {
		if (before.volume !== after.volume && after.volume !== null) lines.push(`**Volume** ${Percent(before.volume)} → ${Percent(after.volume)}`);
		if (before.emojiId !== after.emojiId || before.emojiName !== after.emojiName) lines.push(`**Icon** ${Icon(before)} → ${Icon(after)}`);
	}

	if (before.available !== after.available && after.available !== null) {
		lines.push(after.available ? "**Usable again**" : "**No longer usable**");
	}

	return lines;
}

/** Builds the log for a new asset. Without an audit entry, the uploader on the item is named instead. */
export function BuildAssetCreateLog(asset: AssetSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const actor = !entry?.user_id && asset.creatorId ? `**By** <@${asset.creatorId}>` : ActorLine(entry);

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_CREATE)
		.addComponents(
			Header(asset, `### ➕ ${KindNames[asset.kind]} added\n${Subject(asset)}${Details(asset)}\n${actor}`),
			Footer(asset)
		);

	return { container, attachments: [] };
}

/** Builds the log for a changed asset. `before` is undefined when no earlier version is known, and the log says so. */
export function BuildAssetUpdateLog(before: AssetSnapshot | undefined, after: AssetSnapshot, fields: string[], entry: DiscordAuditLogEntry | null): LogMessage {
	// Discord disables items itself when a server loses the Boost level for their slot, and does not audit it
	const boostChange = !entry && before !== undefined && before.available !== after.available && fields.length === 1;
	const actor = boostChange ? "**By** *(no audit entry, most likely a Server Boost change)*" : ActorLine(entry);

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(Header(after, `### ✏️ ${KindNames[after.kind]} changed\n${Subject(after)}\n${actor}`));

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

/** Builds the log for a deleted asset. */
export function BuildAssetDeleteLog(asset: AssetSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_DELETE)
		.addComponents(
			Header(asset, `### 🗑️ ${KindNames[asset.kind]} removed\n${Subject(asset)}\n${ActorLine(entry)}`),
			Footer(asset)
		);

	return { container, attachments: [] };
}

/** Returns the header text, beside a thumbnail of the item when it has one. */
function Header(asset: AssetSnapshot, content: string): TextDisplayBuilder | SectionBuilder {
	const text = new TextDisplayBuilder().setContent(content);
	if (!asset.imageURL) return text;

	const thumbnail = new ThumbnailBuilder().setMedia(asset.imageURL);
	if (asset.name) thumbnail.setDescription(asset.name);
	return new SectionBuilder().addComponents(text).setAccessory(thumbnail);
}

function Subject(asset: AssetSnapshot): string {
	const name = asset.name === null ? "*(was not cached, name unknown)*" : Name(asset.name);
	const icon = asset.kind === "sound" && (asset.emojiId || asset.emojiName) ? `${Icon(asset)} ` : "";
	return `**${KindNames[asset.kind]}** ${icon}${name}`;
}

/** Returns the settings a new item starts with. */
function Details(asset: AssetSnapshot): string {
	if (asset.kind === "emoji" && asset.roles.length > 0) return `\n**Restricted to** ${asset.roles.map(Role).join(", ")}`;
	if (asset.kind === "sticker" && asset.description) return `\n**Description** ${Name(asset.description)}`;
	if (asset.kind === "sound" && asset.volume !== null) return `\n**Volume** ${Percent(asset.volume)}`;
	return "";
}

function Footer(asset: AssetSnapshot): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(`-# ${KindNames[asset.kind]} ${asset.id}`);
}

function Role(id: string): string {
	return `<@&${id}>`;
}

function Optional(text: string | null): string {
	return text ? Name(text) : "*none*";
}

function Percent(volume: number | null): string {
	return volume === null ? "*unknown*" : `${Math.round(volume * 100)}%`;
}

/** Returns a sound's icon as emoji markup. */
function Icon(sound: SoundSnapshot): string {
	if (sound.emojiId) return `<:emoji:${sound.emojiId}>`;
	return sound.emojiName ?? "*none*";
}
