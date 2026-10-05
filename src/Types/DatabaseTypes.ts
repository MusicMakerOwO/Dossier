// Row shapes for the tables in SQL/. Integer columns come back as bigint (see defaultSafeIntegers in Database.ts)

export type DB_GuildEvent = {
	guild_id: bigint;
	event_name: string;
	channel_id: bigint;
	enabled: 1n | 0n
}

export type DB_Guild = {
	guild_id: bigint;
	first_seen_at: bigint;
	/** Null until the join-time backfill finishes. */
	backfilled_at: bigint | null;
}

export type DB_Message = {
	message_id: bigint;
	guild_id: bigint;
	channel_id: bigint;
	user_id: bigint;
	created_at: bigint;
	encryption_version: bigint;
	/** Serialized MessagePayload. Only CRUD/Messages.ts reads or writes it. */
	payload: Buffer;
}