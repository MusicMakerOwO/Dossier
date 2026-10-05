import fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { Attachment } from "simplyjs";
import { Log } from "../Log.js";
import { StoredAttachment } from "../Types/SimpleTypes.js";
import { ROOT_FOLDER } from "../Constants.js";

/** Root folder of the attachment store. ATTACHMENT_DIR overrides it, which the test suite relies on. */
const Root = process.env.ATTACHMENT_DIR ?? `${ROOT_FOLDER}/Attachments`

/** Largest attachment Dossier stores. Anything larger is recorded as unstored. */
const MaxBytes = 10 * 1024 * 1024;

/** Discord's epoch in milliseconds, for reading the creation time out of a snowflake. */
const DiscordEpoch = 1_420_070_400_000n;

/** Returns the day folder (YYYY-MM-DD) a message's files are stored under, taken from its snowflake. */
function DayKey(message_id: bigint): string {
	return new Date(Number((message_id >> 22n) + DiscordEpoch)).toISOString().slice(0, 10);
}

/**
 * Returns the filename's extension with its dot, or "" when there is none or it is not plain
 * alphanumeric. Filenames are user input, so this is the only part of one that reaches a path.
 */
function Extension(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot <= 0) return "";

	const extension = filename.slice(dot + 1);
	return /^[a-zA-Z0-9]{1,16}$/.test(extension) ? `.${extension}` : "";
}

/** Returns the folder holding one message's files. */
function MessageFolder(message_id: bigint): string {
	return join(Root, DayKey(message_id), message_id.toString());
}

/** Returns the attachment id a file in a message folder belongs to. */
function EntryId(entry: string): string {
	const dot = entry.indexOf(".");
	return dot === -1 ? entry : entry.slice(0, dot);
}

/** Whether the attachment is within the size limit and has a content type. */
function ShouldStoreAttachment(attachment: Attachment): boolean {
	if (attachment.size > MaxBytes) return false;
	return attachment.content_type !== undefined;
}

/**
 * Returns the path an attachment's bytes are written to. Only the write path uses this; reads and
 * deletes find the file by id through {@link Resolve}.
 *
 * @throws {Error} When the attachment id is not numeric, since such an id could escape the store.
 */
export function AttachmentPath(message_id: bigint, attachment_id: string, filename: string): string {
	if (!/^\d+$/.test(attachment_id)) {
		throw new Error(`Refusing to build an attachment path for non-numeric id "${attachment_id}".`);
	}

	return MessageFolder(message_id) + '/' + attachment_id + Extension(filename);
}

/**
 * Returns the path an attachment is stored at, or undefined if nothing is stored for that id.
 * Finds the file by id and ignores its extension.
 */
async function Resolve(message_id: bigint, attachment_id: string): Promise<string | undefined> {
	if (!/^\d+$/.test(attachment_id)) return undefined;

	const folder = MessageFolder(message_id);

	let entries: string[];
	try {
		entries = await fs.readdir(folder);
	} catch {
		// No folder: nothing was stored for this message
		return undefined;
	}

	// Match the whole id, so that 999 does not match 9991.png
	const match = entries.find((entry) => entry === attachment_id || entry.startsWith(`${attachment_id}.`));
	return match === undefined ? undefined : join(folder, match);
}

/** Builds the stored metadata for an attachment. `stored` says whether its bytes are on disk. */
export function DescribeAttachment(attachment: Attachment, stored: boolean): StoredAttachment {
	// null, not undefined: JSON.stringify drops undefined keys
	return {
		id: attachment.id,
		filename: attachment.filename,
		size: attachment.size,
		content_type: attachment.content_type ?? null,
		width: attachment.width ?? null,
		height: attachment.height ?? null,
		stored
	};
}

/**
 * Downloads an attachment and returns its stored metadata. Never throws: a file that is too large
 * or fails to download comes back with `stored: false`.
 *
 * Call it when the message is created. Discord's CDN links expire, and the file is purged once
 * the message is deleted.
 */
export async function SaveAttachment(message_id: bigint, attachment: Attachment): Promise<StoredAttachment> {
	if (!ShouldStoreAttachment(attachment)) return DescribeAttachment(attachment, false);

	try {
		const path = AttachmentPath(message_id, attachment.id, attachment.filename);

		const response = await fetch(attachment.url);
		if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

		// `attachment.size` is Discord's claim about a file we have not read yet.
		// Nitro users have a max file size of 500MB so we don't want to risk blindly saving giant files
		const length = Number(response.headers.get("content-length"));
		if (Number.isFinite(length) && length > MaxBytes) {
			throw new Error(`served ${length} bytes against a declared size of ${attachment.size}`);
		}

		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength > MaxBytes) throw new Error(`body ran to ${bytes.byteLength} bytes`);

		await fs.mkdir(dirname(path), { recursive: true });
		await fs.writeFile(path, bytes);

		return DescribeAttachment(attachment, true);
	} catch (error) {
		Log("ERROR", `Could not store attachment ${attachment.id} (${attachment.filename}):`, error);
		return DescribeAttachment(attachment, false);
	}
}

/** Reads an attachment's bytes, or undefined if they were never stored or have since been removed. */
export async function ReadAttachment(message_id: bigint, attachment: StoredAttachment): Promise<Buffer | undefined> {
	if (!attachment.stored) return undefined;

	const path = await Resolve(message_id, attachment.id);
	if (path === undefined) return undefined;

	try {
		return await fs.readFile(path);
	} catch {
		// A missing file is expected once the retention sweep has run
		return undefined;
	}
}

/** Deletes one attachment's file and returns whether there was one. */
export async function DeleteAttachment(message_id: bigint, attachment_id: string): Promise<boolean> {
	const path = await Resolve(message_id, attachment_id);
	if (path === undefined) return false;

	try {
		await fs.rm(path, { force: true });
		return true;
	} catch (error) {
		Log("ERROR", `Could not delete attachment ${attachment_id} of message ${message_id}:`, error);
		return false;
	}
}

/**
 * Deletes the files in a message's folder that are not in `keep`, and returns how many it removed.
 * The folder itself stays; use {@link DeleteMessageAttachments} when the message is deleted.
 */
export async function SyncMessageAttachments(message_id: bigint, keep: StoredAttachment[]): Promise<number> {
	const folder = MessageFolder(message_id);

	let entries: string[];
	try {
		entries = await fs.readdir(folder);
	} catch {
		return 0;
	}

	const kept = new Set(keep.map((attachment) => attachment.id));

	let removed = 0;
	for (const entry of entries) {
		if (kept.has(EntryId(entry))) continue;

		try {
			await fs.rm(join(folder, entry), { recursive: true, force: true });
			removed++;
		} catch (error) {
			Log("ERROR", `Could not remove stale attachment ${entry} of message ${message_id}:`, error);
		}
	}

	return removed;
}

/** Deletes a message's folder and returns how many files it held. */
export async function DeleteMessageAttachments(message_id: bigint): Promise<number> {
	const folder = MessageFolder(message_id);

	try {
		const files = await fs.readdir(folder);
		await fs.rm(folder, { recursive: true, force: true });
		return files.length;
	} catch {
		// No folder: the message had no stored attachments
		return 0;
	}
}