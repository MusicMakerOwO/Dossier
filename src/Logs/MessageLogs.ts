import {
	ContainerBuilder,
	ContainerChild,
	DiscordAuditLogEntry,
	FileAttachment,
	FileBuilder,
	MediaGalleryBuilder,
	MediaGalleryItem,
	SeparatorBuilder,
	TextDisplayBuilder
} from "simplyjs";

import { COLOR } from "../Constants.js";
import { ReadAttachment } from "../CRUD/Attachments.js";
import { SimpleMessage, StoredAttachment } from "../Types/SimpleTypes.js";
import { ActorLine, LogMessage, Quote, Truncate } from "./Format.js";

/** Character budgets per section. Discord caps the text of a v2 message at 4,000 characters and rejects anything over. */
const DeletedContentLimit = 2000;
const EditedContentLimit = 1000;
const EmbedDiffLimit = 400;
const FilenameLimit = 50;

/** Bytes re-uploaded per log, the upload limit of an unboosted guild. Files past the budget are named but not attached. */
const UploadBudget = 10 * 1024 * 1024;

/** Builds the log for a deleted message that was stored. `moderatorId` is whoever the audit log names. */
export async function BuildDeleteLog(message: SimpleMessage, moderatorId: string | null): Promise<LogMessage> {
	const { content, embeds, attachments } = message.payload;

	// Discord does not audit a user deleting their own message, but a late entry looks the same
	const deletedBy = moderatorId
		? `<@${moderatorId}>`
		: `<@${message.user_id}> *(no audit entry, most likely themselves)*`;

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_DELETE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				"### 🗑️ Message deleted\n" +
				`**Author** <@${message.user_id}> · **Channel** <#${message.channel_id}>\n` +
				`**Deleted by** ${deletedBy}`
			),
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Quote(content, DeletedContentLimit) + EmbedNote(embeds.length))
		);

	const files = await AttachmentSection(container, message.message_id, attachments, "Attachments");

	container.addComponents(Footer(message));
	return { container, attachments: files };
}

/** Builds the log for a deleted message that was never stored, from its id and channel alone. */
export function BuildUnstoredDeleteLog(message_id: string, channel_id: string): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_DELETE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				"### 🗑️ Message deleted\n" +
				`**Channel** <#${channel_id}>\n` +
				"-# Dossier has no copy of this message - it was sent before Dossier joined, or is older than 14 days."
			),
			new TextDisplayBuilder().setContent(`-# Message ${message_id}`)
		);

	return { container, attachments: [] };
}

/**
 * Builds the log for an edit. `before` is undefined when the earlier version was never stored.
 * `removed` are the attachments the edit took away, which are re-uploaded here.
 */
export async function BuildEditLog(before: SimpleMessage | undefined, after: SimpleMessage, embedChanges: string[], removed: StoredAttachment[]): Promise<LogMessage> {
	const jump = `https://discord.com/channels/${after.guild_id}/${after.channel_id}/${after.message_id}`;

	const earlier = before
		? Quote(before.payload.content, EditedContentLimit)
		: "-# *No earlier version stored - sent before Dossier joined, or older than 14 days.*";

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				`### ✏️ Message edited · [Jump](${jump})\n` +
				`**Author** <@${after.user_id}> · **Channel** <#${after.channel_id}>`
			),
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(`**Before**\n${earlier}`),
			new TextDisplayBuilder().setContent(`**After**\n${Quote(after.payload.content, EditedContentLimit)}`)
		);

	if (embedChanges.length > 0) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(`**Embeds**\n${Truncate(embedChanges.map((line) => `- ${line}`).join("\n"), EmbedDiffLimit)}`)
		);
	}

	const files = await AttachmentSection(container, after.message_id, removed, "Removed attachments");

	container.addComponents(Footer(after));
	return { container, attachments: files };
}

/** Authors listed in a bulk log before the rest collapse into a count. */
const BulkAuthorLimit = 15;

/**
 * Builds the log for a bulk delete: a summary plus a plain-text transcript file. `messages` are the
 * stored ones, oldest first, and `total` is how many Discord reported. Attachments are named in the
 * transcript but not re-uploaded. `names` maps author ids to usernames; anyone missing is shown by id.
 */
export function BuildBulkDeleteLog(channelId: string, total: number, messages: SimpleMessage[], entry: DiscordAuditLogEntry | null, names: Map<bigint, string>): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_DELETE)
		.addComponents(
			new TextDisplayBuilder().setContent(
				`### 🗑️ ${total} message${total === 1 ? "" : "s"} deleted in bulk\n` +
				`**Channel** <#${channelId}>\n` +
				ActorLine(entry)
			)
		);

	const missing = total - messages.length;
	const unstored = `-# ${messages.length === 0 ? "Dossier has no copy of these messages" : `${missing} of ${total} had no stored copy`}` +
		" - sent before Dossier joined, or older than 14 days.";

	if (messages.length === 0) {
		container.addComponents(
			new TextDisplayBuilder().setContent(unstored),
			new TextDisplayBuilder().setContent(`-# Channel ${channelId}`)
		);
		return { container, attachments: [] };
	}

	const counts = new Map<bigint, number>();
	for (const message of messages) counts.set(message.user_id, (counts.get(message.user_id) ?? 0) + 1);

	const authors = [...counts].sort((a, b) => b[1] - a[1]);
	const lines = authors.slice(0, BulkAuthorLimit).map(([user_id, count]) => `- <@${user_id}> × ${count}`);
	if (authors.length > BulkAuthorLimit) lines.push(`- *and ${authors.length - BulkAuthorLimit} more*`);

	container.addComponents(
		new SeparatorBuilder().setDivider(),
		new TextDisplayBuilder().setContent(`**Authors**\n${lines.join("\n")}`)
	);
	if (missing > 0) container.addComponents(new TextDisplayBuilder().setContent(unstored));

	const first = messages[0].message_id;
	const last = messages[messages.length - 1].message_id;

	const upload = `bulk-delete-${channelId}-${first}.txt`;

	container.addComponents(
		new FileBuilder().setFile(`attachment://${upload}`),
		new TextDisplayBuilder().setContent(`-# Channel ${channelId} · Messages ${first} to ${last}`)
	);

	return { container, attachments: [{ name: upload, data: Transcript(channelId, total, messages, names) }] };
}

function Transcript(channelId: string, total: number, messages: SimpleMessage[], names: Map<bigint, string>): string {
	const blocks = messages.map((message) => {
		const { content, embeds, attachments } = message.payload;

		const sent = new Date(Number(message.created_at)).toISOString().slice(0, 19).replace("T", " ");
		const name = names.get(message.user_id);
		const author = name === undefined ? message.user_id.toString() : `${name} (${message.user_id})`;

		const lines = [`[${sent} UTC] ${author} - message ${message.message_id}`];
		if (content !== "") lines.push(content);
		for (const attachment of attachments) lines.push(`  attachment: ${attachment.filename} (${FormatBytes(attachment.size)})`);
		if (embeds.length > 0) lines.push(`  embeds: ${embeds.length}`);

		return lines.join("\n");
	});

	return `Bulk delete in channel ${channelId} - ${messages.length} of ${total} messages recovered\n\n${blocks.join("\n\n")}\n`;
}

/**
 * Adds a section listing every attachment by name. Returns the files to send with the log: the
 * ones that are stored on disk and fit the upload budget.
 */
async function AttachmentSection(container: ContainerBuilder, message_id: bigint, attachments: StoredAttachment[], heading: string): Promise<FileAttachment[]> {
	if (attachments.length === 0) return [];

	const files: FileAttachment[] = [];
	const gallery: MediaGalleryItem[] = [];
	const others: FileBuilder[] = [];
	const lines: string[] = [];
	let budget = UploadBudget;

	for (const attachment of attachments) {
		const name = Truncate(attachment.filename.replaceAll("`", "'"), FilenameLimit);
		const size = FormatBytes(attachment.size);

		const bytes = await ReadAttachment(message_id, attachment);
		if (bytes === undefined) {
			lines.push(`- \`${name}\` (${size}) - not saved`);
			continue;
		}
		if (bytes.length > budget) {
			lines.push(`- \`${name}\` (${size}) - saved, too large to re-upload here`);
			continue;
		}

		budget -= bytes.length;
		lines.push(`- \`${name}\` (${size})`);

		// Prefixed with the id and sanitised, or the `attachment://` reference may not resolve
		const upload = `${attachment.id}-${attachment.filename.replaceAll(/[^\w.-]/g, "_")}`;
		files.push({ name: upload, data: bytes });

		if (attachment.content_type?.startsWith("image/")) gallery.push({ media: { url: `attachment://${upload}` } });
		else others.push(new FileBuilder().setFile(`attachment://${upload}`));
	}

	const children: ContainerChild[] = [
		new SeparatorBuilder().setDivider(),
		new TextDisplayBuilder().setContent(`**${heading}**\n${lines.join("\n")}`)
	];
	if (gallery.length > 0) children.push(new MediaGalleryBuilder().setItems(gallery));
	children.push(...others);

	container.addComponents(...children);
	return files;
}

/** Returns the footer: the ids a mod can search by, and when the message was sent. */
function Footer(message: SimpleMessage): TextDisplayBuilder {
	const sent = message.created_at / 1000n;
	return new TextDisplayBuilder().setContent(`-# Message ${message.message_id} · User ${message.user_id} · Sent <t:${sent}:f>`);
}

/** Returns a note on how many embeds the message had, or "" for none. */
function EmbedNote(count: number): string {
	return count === 0 ? "" : `\n-# Also carried ${count} embed${count === 1 ? "" : "s"}`;
}

/** Formats a byte count as B, KB or MB. */
function FormatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
