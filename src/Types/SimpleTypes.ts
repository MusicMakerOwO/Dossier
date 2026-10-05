import { Embed } from "simplyjs";

export type SimpleMessage = {
	message_id: bigint;
	guild_id: bigint;
	channel_id: bigint;
	user_id: bigint;
	created_at: bigint;
	encryption_version: bigint;
	payload: MessagePayload;
}

/** The decoded form of DB_Message.payload. */
export type MessagePayload = {
	content: string;
	embeds: Embed[];
	attachments: StoredAttachment[];
	/**
	 * Changes only when the author edits, unlike the other causes of MESSAGE_UPDATE (unfurls, pins).
	 * Absent on rows stored before this field existed.
	 */
	edited_at?: string | null;
}

/**
 * An attachment's stored metadata. Optional fields are `null`, not undefined, because
 * JSON.stringify drops undefined keys.
 */
export type StoredAttachment = {
	id: string;
	filename: string;
	size: number;
	content_type: string | null;
	width: number | null;
	height: number | null;
	/** Whether the bytes are on disk. False when the file was too large or the download failed. */
	stored: boolean;
}

/** A group's configuration, collapsed from its per-event rows. `partial` means only some of its events are enabled. */
export type GroupConfig = {
	state: "on" | "off" | "partial";
	/** The group's channel, or null when it was never configured. Kept when the group is switched off. */
	channel_id: bigint | null;
}