import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { dirname } from "node:path";
import { ContainerBuilder, DiscordAuditLogEntry, MessageFlags, ResolveComponentsV2Flags } from "simplyjs";
import { SimpleMessage, StoredAttachment } from "../Types/SimpleTypes.js";
import { AttachmentPath } from "../CRUD/Attachments.js";
import { BuildBulkDeleteLog, BuildDeleteLog, BuildEditLog, BuildUnstoredDeleteLog } from "../Logs/MessageLogs.js";
import { LogMessage } from "../Logs/Format.js";
import { COLOR } from "../Constants.js";

// A day no other test file uses, because the attachment root is shared across workers
const BaseMs = 1_550_000_000_000n;
let NextId = 1n;
function FreshId(): bigint {
	return ((BaseMs - 1_420_070_400_000n) << 22n) + NextId++;
}

function Message(payload: Partial<SimpleMessage["payload"]> = {}): SimpleMessage {
	return {
		message_id: FreshId(),
		guild_id: 100n,
		channel_id: 200n,
		user_id: 300n,
		created_at: BaseMs,
		encryption_version: 0n,
		payload: { content: "hello", embeds: [], attachments: [], edited_at: null, ...payload }
	};
}

function Attachment(id: string, filename: string, content_type: string | null, stored = true): StoredAttachment {
	return { id, filename, size: 3, content_type, width: null, height: null, stored };
}

async function Put(message_id: bigint, attachment: StoredAttachment, bytes = Buffer.from([1, 2, 3])): Promise<void> {
	const path = AttachmentPath(message_id, attachment.id, attachment.filename);
	await fs.mkdir(dirname(path), { recursive: true });
	await fs.writeFile(path, bytes);
}

/** Returns every text display in the container, joined. */
function Text(container: ContainerBuilder): string {
	return JSON.stringify(container.components.flatMap((child) => "content" in child ? [child.content] : []));
}

/** Runs the library's send-path validation on the log: v1/v2 mixing, the text and component limits, and `attachment://` references. */
function Sendable(log: LogMessage): number | undefined {
	return ResolveComponentsV2Flags({ components: [log.container], attachments: log.attachments });
}

describe("BuildDeleteLog", () => {
	it("should quote the content and name the moderator", async () => {
		const log = await BuildDeleteLog(Message({ content: "line one\nline two" }), "900");

		expect(log.container.accent_color).toBe(COLOR.LOG_DELETE);
		expect(Text(log.container)).toContain("<@900>");
		expect(Text(log.container)).toContain("> line one\\n> line two");
		expect(Sendable(log)! & MessageFlags.IS_COMPONENTS_V2).toBeTruthy();
	});

	it("should hedge the attribution when no audit entry paired", async () => {
		const log = await BuildDeleteLog(Message(), null);
		expect(Text(log.container)).toContain("no audit entry");
	});

	it("should re-upload stored images into a gallery and other files as file components", async () => {
		const message = Message();
		const image = Attachment("11", "cat pic.png", "image/png");
		const doc = Attachment("12", "notes.txt", "text/plain");
		message.payload.attachments = [image, doc];
		await Put(message.message_id, image);
		await Put(message.message_id, doc);

		const log = await BuildDeleteLog(message, null);

		expect(log.attachments.map((file) => file.name)).toEqual(["11-cat_pic.png", "12-notes.txt"]);
		expect(log.container.components).toContainEqual(expect.objectContaining({ items: [{ media: { url: "attachment://11-cat_pic.png" } }] }));
		expect(log.container.components).toContainEqual(expect.objectContaining({ file: { url: "attachment://12-notes.txt" } }));
		expect(() => Sendable(log)).not.toThrow();
	});

	it("should still name an attachment whose bytes were never saved", async () => {
		const message = Message({ attachments: [Attachment("13", "huge.mp4", "video/mp4", false)] });
		const log = await BuildDeleteLog(message, null);

		expect(log.attachments).toEqual([]);
		expect(Text(log.container)).toContain("huge.mp4");
		expect(Text(log.container)).toContain("not saved");
	});

	it("should name but not upload files past the upload budget", async () => {
		const message = Message();
		const big = Attachment("14", "big.bin", null);
		message.payload.attachments = [big];
		await Put(message.message_id, big, Buffer.alloc(10 * 1024 * 1024 + 1));

		const log = await BuildDeleteLog(message, null);

		expect(log.attachments).toEqual([]);
		expect(Text(log.container)).toContain("too large");
	});

	it("should stay within Discord's text budget for the longest possible message", async () => {
		const log = await BuildDeleteLog(Message({ content: "a\n".repeat(2000) }), null);
		expect(() => Sendable(log)).not.toThrow();
	});
});

describe("BuildEditLog", () => {
	it("should show both versions and link to the message", async () => {
		const before = Message({ content: "old" });
		const after = { ...before, payload: { ...before.payload, content: "new" } };

		const log = await BuildEditLog(before, after, [], []);

		expect(log.container.accent_color).toBe(COLOR.LOG_UPDATE);
		expect(Text(log.container)).toContain("> old");
		expect(Text(log.container)).toContain("> new");
		expect(Text(log.container)).toContain(`https://discord.com/channels/100/200/${after.message_id}`);
		expect(() => Sendable(log)).not.toThrow();
	});

	it("should say so when no earlier version is stored", async () => {
		const log = await BuildEditLog(undefined, Message(), [], []);
		expect(Text(log.container)).toContain("No earlier version stored");
	});

	it("should list embed changes", async () => {
		const message = Message();
		const log = await BuildEditLog(message, message, ["Embed 1 · title: Old → New"], []);
		expect(Text(log.container)).toContain("Embed 1 · title: Old → New");
	});

	it("should re-upload removed attachments", async () => {
		const message = Message();
		const dropped = Attachment("21", "drop.png", "image/png");
		await Put(message.message_id, dropped);

		const log = await BuildEditLog(message, message, [], [dropped]);

		expect(Text(log.container)).toContain("Removed attachments");
		expect(log.attachments).toHaveLength(1);
		expect(() => Sendable(log)).not.toThrow();
	});

	it("should stay within Discord's text budget with every section at its longest", async () => {
		const before = Message({ content: "x".repeat(4000) });
		const after = { ...before, payload: { ...before.payload, content: "y\n".repeat(2000) } };
		const embeds = Array.from({ length: 10 }, (_, i) => `Embed ${i} · description: ${"z".repeat(4000)}`);
		const removed = Array.from({ length: 10 }, (_, i) => Attachment(`3${i}`, `${"f".repeat(200)}.png`, "image/png", false));

		const log = await BuildEditLog(before, after, embeds, removed);
		expect(() => Sendable(log)).not.toThrow();
	});
});

describe("BuildUnstoredDeleteLog", () => {
	it("should name the channel and the message", () => {
		const log = BuildUnstoredDeleteLog("555", "200");

		expect(Text(log.container)).toContain("<#200>");
		expect(Text(log.container)).toContain("555");
		expect(() => Sendable(log)).not.toThrow();
	});
});

describe("BuildBulkDeleteLog", () => {
	/** The transcript as a mod would open it. */
	function File(log: LogMessage): string {
		return log.attachments[0].data as string;
	}

	it("should count the purge and each author's share of it", () => {
		const messages = [Message(), Message(), { ...Message(), user_id: 301n }];
		const log = BuildBulkDeleteLog("200", 3, messages, null, new Map());

		expect(log.container.accent_color).toBe(COLOR.LOG_DELETE);
		expect(Text(log.container)).toContain("3 messages deleted in bulk");
		expect(Text(log.container)).toContain("<#200>");
		expect(Text(log.container)).toContain("<@300> × 2");
		expect(Text(log.container)).toContain("<@301> × 1");
		expect(Text(log.container)).toContain("no audit entry");
		expect(Sendable(log)! & MessageFlags.IS_COMPONENTS_V2).toBeTruthy();
	});

	it("should name the moderator and their reason", () => {
		const entry = { id: "1", action_type: 73, target_id: "200", user_id: "900", reason: "raid cleanup" } as DiscordAuditLogEntry;
		const log = BuildBulkDeleteLog("200", 1, [Message()], entry, new Map());

		expect(Text(log.container)).toContain("<@900>");
		expect(Text(log.container)).toContain("raid cleanup");
	});

	it("should say how many messages had no stored copy", () => {
		const log = BuildBulkDeleteLog("200", 5, [Message(), Message()], null, new Map());
		expect(Text(log.container)).toContain("3 of 5 had no stored copy");
	});

	it("should write every stored message into the transcript, in the order given", () => {
		const first = Message({ content: "first words" });
		const second = { ...Message({ content: "second words" }), user_id: 301n };
		const log = BuildBulkDeleteLog("200", 2, [first, second], null, new Map([[300n, "fox"]]));

		const file = File(log);
		expect(log.attachments[0].name).toBe(`bulk-delete-200-${first.message_id}.txt`);
		expect(log.container.components).toContainEqual(expect.objectContaining({ file: { url: `attachment://${log.attachments[0].name}` } }));
		expect(file).toContain("2 of 2 messages recovered");
		expect(file.indexOf("first words")).toBeLessThan(file.indexOf("second words"));
		expect(file).toContain(`[2019-02-12 19:33:20 UTC] fox (300) - message ${first.message_id}`);
		expect(file).toContain(`UTC] 301 - message ${second.message_id}`);
	});

	it("should name attachments and embeds in the transcript without uploading them", async () => {
		const message = Message();
		const image = Attachment("41", "cat.png", "image/png");
		message.payload.attachments = [image];
		message.payload.embeds = [{}] as SimpleMessage["payload"]["embeds"];
		await Put(message.message_id, image);

		const log = BuildBulkDeleteLog("200", 1, [message], null, new Map());

		expect(log.attachments).toHaveLength(1);
		expect(File(log)).toContain("attachment: cat.png (3 B)");
		expect(File(log)).toContain("embeds: 1");
	});

	it("should post a bare log with no file when nothing was stored", () => {
		const log = BuildBulkDeleteLog("200", 40, [], null, new Map());

		expect(log.attachments).toEqual([]);
		expect(Text(log.container)).toContain("40 messages deleted in bulk");
		expect(Text(log.container)).toContain("no copy of these messages");
		expect(() => Sendable(log)).not.toThrow();
	});

	it("should stay within Discord's text budget for a full purge of long messages by different authors", () => {
		const messages = Array.from({ length: 100 }, (_, i) => ({ ...Message({ content: "x".repeat(4000) }), user_id: BigInt(1000 + i) }));
		const log = BuildBulkDeleteLog("200", 100, messages, null, new Map());

		expect(Text(log.container)).toContain("and 85 more");
		expect(() => Sendable(log)).not.toThrow();
	});
});
