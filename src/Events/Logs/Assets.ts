import { AuditLogEvents, ClientEvents } from "simplyjs";
import { EventHandler, FullClient } from "../../Types/InternalTypes.js";
import { LoggedEvent } from "../../Config/Groups.js";
import { Log } from "../../Log.js";
import { AuditAction, AwaitAuditEntry } from "../../Logs/Attribution.js";
import { SendLog } from "../../Logs/Send.js";
import {
	AssetSnapshot,
	BuildAssetCreateLog,
	BuildAssetDeleteLog,
	BuildAssetUpdateLog,
	DiffAsset,
	SnapshotEmoji,
	SnapshotSound,
	SnapshotSticker
} from "../../Logs/AssetLogs.js";

// Snapshot before the first await: the library evicts a deleted item once the event has been emitted

export const emojiCreate = {
	name: ClientEvents.EmojiCreate,
	async execute(client, guild, emoji) {
		await LogCreate(client, guild.id, "EmojiCreate", AuditLogEvents.EmojiCreate, SnapshotEmoji(emoji));
	}
} as EventHandler<typeof ClientEvents.EmojiCreate>;

export const emojiUpdate = {
	name: ClientEvents.EmojiUpdate,
	async execute(client, guild, old, now) {
		await LogUpdate(client, guild.id, "EmojiUpdate", AuditLogEvents.EmojiUpdate, old && SnapshotEmoji(old), SnapshotEmoji(now));
	}
} as EventHandler<typeof ClientEvents.EmojiUpdate>;

export const emojiDelete = {
	name: ClientEvents.EmojiDelete,
	async execute(client, guild, emoji) {
		await LogDelete(client, guild.id, "EmojiDelete", AuditLogEvents.EmojiDelete, SnapshotEmoji(emoji));
	}
} as EventHandler<typeof ClientEvents.EmojiDelete>;

export const stickerCreate = {
	name: ClientEvents.StickerCreate,
	async execute(client, guild, sticker) {
		await LogCreate(client, guild.id, "StickerCreate", AuditLogEvents.StickerCreate, SnapshotSticker(sticker));
	}
} as EventHandler<typeof ClientEvents.StickerCreate>;

export const stickerUpdate = {
	name: ClientEvents.StickerUpdate,
	async execute(client, guild, old, now) {
		await LogUpdate(client, guild.id, "StickerUpdate", AuditLogEvents.StickerUpdate, old && SnapshotSticker(old), SnapshotSticker(now));
	}
} as EventHandler<typeof ClientEvents.StickerUpdate>;

export const stickerDelete = {
	name: ClientEvents.StickerDelete,
	async execute(client, guild, sticker) {
		await LogDelete(client, guild.id, "StickerDelete", AuditLogEvents.StickerDelete, SnapshotSticker(sticker));
	}
} as EventHandler<typeof ClientEvents.StickerDelete>;

export const soundboardSoundCreate = {
	name: ClientEvents.SoundboardSoundCreate,
	async execute(client, guild, sound) {
		await LogCreate(client, guild.id, "SoundboardSoundCreate", AuditLogEvents.SoundboardSoundCreate, SnapshotSound(sound));
	}
} as EventHandler<typeof ClientEvents.SoundboardSoundCreate>;

export const soundboardSoundUpdate = {
	name: ClientEvents.SoundboardSoundUpdate,
	async execute(client, guild, old, now) {
		await LogUpdate(client, guild.id, "SoundboardSoundUpdate", AuditLogEvents.SoundboardSoundUpdate, old && SnapshotSound(old), SnapshotSound(now));
	}
} as EventHandler<typeof ClientEvents.SoundboardSoundUpdate>;

export const soundboardSoundDelete = {
	name: ClientEvents.SoundboardSoundDelete,
	async execute(client, guild, sound) {
		await LogDelete(client, guild.id, "SoundboardSoundDelete", AuditLogEvents.SoundboardSoundDelete, SnapshotSound(sound));
	}
} as EventHandler<typeof ClientEvents.SoundboardSoundDelete>;

/** Logs a created emoji, sticker or sound with whoever created it. */
async function LogCreate(client: FullClient, guildId: string, event: LoggedEvent, action: AuditAction, asset: AssetSnapshot): Promise<void> {
	try {
		const entry = await AwaitAuditEntry(client, guildId, action, asset.id);
		await SendLog(client, guildId, event, BuildAssetCreateLog(asset, entry).container);
	} catch (error) {
		Log('ERROR', error);
	}
}

/** Logs what changed on an emoji, sticker or sound. Posts nothing when the diff is empty. */
async function LogUpdate(client: FullClient, guildId: string, event: LoggedEvent, action: AuditAction, before: AssetSnapshot | undefined, after: AssetSnapshot): Promise<void> {
	try {
		const fields = before ? DiffAsset(before, after) : [];
		if (before && fields.length === 0) return;

		const entry = await AwaitAuditEntry(client, guildId, action, after.id);
		await SendLog(client, guildId, event, BuildAssetUpdateLog(before, after, fields, entry).container);
	} catch (error) {
		Log('ERROR', error);
	}
}

/** Logs a deleted emoji, sticker or sound with whoever deleted it. */
async function LogDelete(client: FullClient, guildId: string, event: LoggedEvent, action: AuditAction, asset: AssetSnapshot): Promise<void> {
	try {
		const entry = await AwaitAuditEntry(client, guildId, action, asset.id);
		await SendLog(client, guildId, event, BuildAssetDeleteLog(asset, entry).container);
	} catch (error) {
		Log('ERROR', error);
	}
}
