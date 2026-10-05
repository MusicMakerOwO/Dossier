import { AuditLogEvents, Client, ClientEvents } from "simplyjs";
import { EventHandler } from "../../Types/InternalTypes.js";
import { SimpleMessage } from "../../Types/SimpleTypes.js";
import { Log } from "../../Log.js";
import { DeleteMessage, SimplifyMessage, GetMessage, SaveMessage } from "../../CRUD/Messages.js";
import { GetEventGroupConfig, GetGuildEvent } from "../../CRUD/GuildEvents.js";
import { SaveAttachment, SyncMessageAttachments } from "../../CRUD/Attachments.js"
import { DiffEmbeds } from "../../Logs/EmbedDiff.js";
import { AwaitAuditEntry } from "../../Logs/Attribution.js";
import { BuildBulkDeleteLog, BuildDeleteLog, BuildEditLog, BuildUnstoredDeleteLog } from "../../Logs/MessageLogs.js";
import { SendLog } from "../../Logs/Send.js";

/** Whether attachment files are downloaded for this guild. */
function StoresAttachments(guild_id: bigint): boolean {
	return GetEventGroupConfig(guild_id, "messages").state !== "off";
}

/**
 * Copies onto `after` what an edit cannot change: the stored ids, the creation time, and the
 * entries of attachments that are already on disk.
 */
function CarryOverStored(before: SimpleMessage, after: SimpleMessage): void {
	after.guild_id = before.guild_id;
	after.channel_id = before.channel_id;
	after.user_id = before.user_id;
	after.created_at = before.created_at;

	const known = new Map(before.payload.attachments.map((attachment) => [attachment.id, attachment]));
	after.payload.attachments = after.payload.attachments.map((attachment) => known.get(attachment.id) ?? attachment);
}

/** Usernames of the messages' authors, for those found in the guild's member cache. */
function CachedUsernames(client: Client, guildId: string, messages: SimpleMessage[]): Map<bigint, string> {
	const members = client.guilds.get(guildId)?.members;
	const names = new Map<bigint, string>();

	for (const { user_id } of messages) {
		const username = members?.get(user_id.toString())?.user.username;
		if (username !== undefined) names.set(user_id, username);
	}

	return names;
}

/** Stores a new message, and its attachment files when the guild logs messages. */
export const messageCreate = {
	name: ClientEvents.MessageCreate,
	async execute(_client, message) {
		if (!message.guildId) return;

		try {
			const guild_id = BigInt(message.guildId);
			const message_id = BigInt(message.id);

			const stored = SimplifyMessage(message, guild_id);

			SaveMessage(stored);

			if (message.attachments.length === 0) return;
			if (!StoresAttachments(guild_id)) return;

			stored.payload.attachments = await Promise.all(
				message.attachments.map((attachment) => SaveAttachment(message_id, attachment))
			);

			SaveMessage(stored);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.MessageCreate>;

/** Stores the new version of a message and logs it when the author edited it. */
export const messageUpdate = {
	name: ClientEvents.MessageUpdate,
	async execute(client, message) {
		if (!message.guildId) return;

		try {
			const guild_id = BigInt(message.guildId);
			const message_id = BigInt(message.id);

			const before = GetMessage(message_id);
			const after = SimplifyMessage(message, guild_id);

			if (before) CarryOverStored(before, after);

			// Unfurls, pins and embed suppression also fire this event, but do not change edited_at
			const edited = after.payload.edited_at !== (before?.payload.edited_at ?? null);

			if (!edited && before && before.payload.content !== "" && after.payload.content === "") {
				Log('WARN', `Message ${message.id} lost its content in an update that was not an edit. Was a partial payload read as empty?`);
			}

			SaveMessage(after);

			const kept = new Set(after.payload.attachments.map((attachment) => attachment.id));
			const removed = before?.payload.attachments.filter((attachment) => !kept.has(attachment.id)) ?? [];

			if (edited) {
				const embeds = before ? DiffEmbeds(before.payload.embeds, after.payload.embeds) : [];

				if (before) {
					Log('UPDATE', `Message ${message.id} was edited:`, {
						before: before.payload.content,
						after: after.payload.content,
						embeds,
						removed
					});
				} else {
					Log('UPDATE', `Message ${message.id} was edited, but no earlier version is stored:`, after);
				}

				const log = await BuildEditLog(before, after, embeds, removed);
				await SendLog(client, message.guildId, "MessageUpdate", log.container, log.attachments);
			}

			// Must run after the log, which re-uploads the removed files
			if (removed.length > 0) await SyncMessageAttachments(message_id, after.payload.attachments);

			const added = message.attachments.filter((attachment) => !before?.payload.attachments.some((old) => old.id === attachment.id));
			if (added.length === 0) return;
			if (!StoresAttachments(guild_id)) return;

			const saved = new Map((await Promise.all(
				added.map((attachment) => SaveAttachment(message_id, attachment))
			)).map((attachment) => [attachment.id, attachment]));

			after.payload.attachments = after.payload.attachments.map((attachment) => saved.get(attachment.id) ?? attachment);
			SaveMessage(after);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.MessageUpdate>;

/** Logs a deleted message with whoever deleted it, then removes it from the store. */
export const messageDelete = {
	name: ClientEvents.MessageDelete,
	async execute(client, payload) {
		const message_id = BigInt(payload.id);
		const message = GetMessage(message_id);

		// Either the message predates the bot joining the guild or it expired (2 weeks)
		if (!message) {
			Log('DELETE', `Message ${payload.id} was deleted, but nothing is stored for it`);
			if (payload.guildId) {
				const log = BuildUnstoredDeleteLog(payload.id, payload.channelId);
				await SendLog(client, payload.guildId, "MessageDelete", log.container);
			}
			await DeleteMessage(message_id);
			return;
		}

		// The audit entry targets the author. No entry means the author deleted the message themselves
		const entry = await AwaitAuditEntry(client, payload.guildId!, AuditLogEvents.MessageDelete, message.user_id.toString());

		if (entry?.user_id) Log('DELETE', `Message ${payload.id} was deleted by ${entry.user_id}:`, message);
		else Log('DELETE', `Message ${payload.id} was deleted:`, message);

		// Must run before DeleteMessage, which removes the files the log re-uploads
		const log = await BuildDeleteLog(message, entry?.user_id ?? null);
		await SendLog(client, message.guild_id.toString(), "MessageDelete", log.container, log.attachments);

		await DeleteMessage(message_id);
	}
} as EventHandler<typeof ClientEvents.MessageDelete>;

/** Logs a bulk delete as one transcript, then removes every message in it from the store. */
export const messageDeleteBulk = {
	name: ClientEvents.MessageDeleteBulk,
	async execute(client, payload) {
		if (!payload.guildId) return;

		try {
			const guild_id = BigInt(payload.guildId);
			const ids = payload.ids.map(BigInt);

			// Oldest first. Discord does not guarantee the order of the payload
			const stored = ids
				.map((id) => GetMessage(id))
				.filter((message) => message !== undefined)
				.sort((a, b) => (a.message_id < b.message_id ? -1 : 1));

			Log('DELETE', `${ids.length} message(s) were deleted in bulk from channel ${payload.channelId}, ${stored.length} of them stored`);

			// SendLog checks this too. Checking here skips the audit log wait for a log nobody gets
			const logging = GetGuildEvent(guild_id, "MessageDeleteBulk")?.enabled === 1n;

			if (logging) {
				const entry = await AwaitAuditEntry(client, payload.guildId, AuditLogEvents.MessageDeleteBulk, payload.channelId);
				const names = CachedUsernames(client, payload.guildId, stored);

				const log = BuildBulkDeleteLog(payload.channelId, ids.length, stored, entry, names);
				await SendLog(client, payload.guildId, "MessageDeleteBulk", log.container, log.attachments);
			}

			// Every id, not only the stored ones: DeleteMessage also removes orphaned attachment folders
			for (const id of ids) await DeleteMessage(id);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.MessageDeleteBulk>;
