import { Message } from "simplyjs";
import { Database } from "../Database.js";
import { LRUCache } from "../DataStructures/LRUCache.js";
import { DB_Message } from "../Types/DatabaseTypes.js";
import { MessagePayload, SimpleMessage } from "../Types/SimpleTypes.js";
import { DeleteMessageAttachments, DescribeAttachment } from "./Attachments.js";

/** Messages kept in memory. At roughly 1KB each this is about 10MB of heap. */
const CacheCapacity = 10_000;

/**
 * Message cache. `undefined` means not cached and `null` means the row is known not to exist.
 * Misses are cached so that edits and deletes of messages that were never stored do not query
 * the database every time.
 */
const Cache = new LRUCache<bigint, SimpleMessage | null>(CacheCapacity);

const SelectMessage = Database.prepare(
	`SELECT message_id, guild_id, channel_id, user_id, created_at, encryption_version, payload
	 FROM Messages
	 WHERE message_id = @message_id`
);

const UpsertMessage = Database.prepare(
	`INSERT INTO Messages (message_id, guild_id, channel_id, user_id, created_at, encryption_version, payload)
	 VALUES (@message_id, @guild_id, @channel_id, @user_id, @created_at, @encryption_version, @payload)
	 ON CONFLICT (message_id) DO UPDATE SET
		guild_id           = excluded.guild_id,
		channel_id         = excluded.channel_id,
		user_id            = excluded.user_id,
		created_at         = excluded.created_at,
		encryption_version = excluded.encryption_version,
		payload            = excluded.payload`
);

const DeleteMsg = Database.prepare("DELETE FROM Messages WHERE message_id = @message_id");

/**
 * Decodes a database row. This and {@link ToDatabase} are the only code that knows how `payload`
 * is stored; encryption version 0 is UTF-8 JSON bytes.
 */
function ToSimple(row: DB_Message): SimpleMessage {
	if (row.encryption_version !== 0n) {
		throw new Error(`Message ${row.message_id} is stored at encryption version ${row.encryption_version}, which this build cannot read.`);
	}

	return { ...row, payload: JSON.parse(row.payload.toString("utf8")) as MessagePayload };
}

/** Encodes a message into its database row. */
function ToDatabase(message: SimpleMessage): DB_Message {
	if (message.encryption_version !== 0n) {
		throw new Error(`Message ${message.message_id} was given encryption version ${message.encryption_version}, which this build cannot write.`);
	}

	return { ...message, payload: Buffer.from(JSON.stringify(message.payload), "utf8") };
}

/**
 * Converts a Discord message into the stored shape, with every attachment marked as not stored.
 * `guild_id` is a parameter because a message fetched over REST carries no guild.
 */
export function SimplifyMessage(message: Message, guild_id: bigint): SimpleMessage {
	return {
		message_id: BigInt(message.id),
		guild_id: guild_id,
		channel_id: BigInt(message.channelId),
		user_id: BigInt(message.user.id),
		created_at: BigInt(Date.parse(message.timestamp)),
		encryption_version: 0n,
		payload: {
			content: message.content,
			embeds: message.embeds,
			attachments: message.attachments.map((attachment) => DescribeAttachment(attachment, false)),
			edited_at: message.editedTimestamp ?? null
		}
	};
}

/**
 * Returns the message, or undefined if it is not stored. The object is the cached one: after
 * mutating it, call {@link SaveMessage}, or the cache and the database drift apart.
 */
export function GetMessage(message_id: bigint): SimpleMessage | undefined {
	const cached = Cache.get(message_id);
	if (cached !== undefined) return cached ?? undefined;

	const row = SelectMessage.get({ message_id }) as DB_Message | undefined;
	const message = row ? ToSimple(row) : null;

	Cache.set(message_id, message);
	return message ?? undefined;
}

/**
 * Inserts the message, or overwrites it if it is already stored. Does not touch attachment files:
 * a caller that removes attachments runs SyncMessageAttachments afterwards.
 */
export function SaveMessage(message: SimpleMessage): void {
	UpsertMessage.run(ToDatabase(message));
	Cache.set(message.message_id, message);
}


const WriteMany = Database.transaction((messages: SimpleMessage[]): void => {
	for (const message of messages) UpsertMessage.run(ToDatabase(message));
}) as (messages: SimpleMessage[]) => void;

/** Inserts or overwrites many messages in one transaction. */
export function SaveMessageBulk(messages: SimpleMessage[]): void {
	WriteMany(messages);
	for (const message of messages) Cache.set(message.message_id, message);
}

/**
 * Deletes the message's row and its attachment files, and returns whether there was a row. The
 * files are removed even when no row exists, which is what cleans up an orphaned folder.
 */
export async function DeleteMessage(message_id: bigint): Promise<boolean> {
	const deleted = DeleteMsg.run({ message_id }).changes > 0;
	Cache.set(message_id, null);

	await DeleteMessageAttachments(message_id);
	return deleted;
}