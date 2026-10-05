import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { dirname } from "node:path";
import { MessageDeleteBulkPayload } from "simplyjs";
import { SimpleMessage, StoredAttachment } from "../Types/SimpleTypes.js";
import { FullClient } from "../Types/InternalTypes.js";
import { AttachmentPath, ReadAttachment } from "../CRUD/Attachments.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited } = vi.hoisted(() => ({ Awaited: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const { messageDeleteBulk: MessageDeleteBulk } = await import("../Events/Logs/Messages.js");
const Messages = await import("../CRUD/Messages.js");
const { SetGuildEvent } = await import("../CRUD/GuildEvents.js");

const Members = new Map([["300", { user: { username: "fox" } }]]);
const Client = {
	guilds: { get: (id: string) => (id === "100" ? { members: Members } : undefined) }
} as unknown as FullClient;

// A day no other test file uses, because the attachment root is shared across workers
const BaseMs = 1_560_000_000_000n;
let NextId = 1n;
function FreshId(): string {
	return (((BaseMs - 1_420_070_400_000n) << 22n) + NextId++).toString();
}

function Store(id: string, content: string, user_id = 300n): SimpleMessage {
	const message: SimpleMessage = {
		message_id: BigInt(id),
		guild_id: 100n,
		channel_id: 200n,
		user_id,
		created_at: BaseMs,
		encryption_version: 0n,
		payload: { content, embeds: [], attachments: [] }
	};

	Messages.SaveMessage(message);
	return message;
}

function Handle(ids: string[], guildId: string | null = "100"): Promise<void> {
	return MessageDeleteBulk.execute(Client, { ids, channelId: "200", guildId } as MessageDeleteBulkPayload);
}

beforeEach(() => {
	Logged.mockClear();
	Awaited.mockReset().mockResolvedValue(null);
	Sent.mockReset().mockResolvedValue(true);
	SetGuildEvent(100n, "MessageDeleteBulk", 500n, 1n);
});

describe("MessageDeleteBulk", () => {
	it("should post one log carrying a transcript of the stored messages", async () => {
		const ids = [FreshId(), FreshId()];
		Store(ids[0], "first to go");
		Store(ids[1], "second to go", 301n);

		await Handle(ids);

		expect(Sent).toHaveBeenCalledOnce();
		expect(Sent).toHaveBeenCalledWith(Client, "100", "MessageDeleteBulk", expect.objectContaining({ type: 17 }), [expect.objectContaining({ name: `bulk-delete-200-${ids[0]}.txt` })]);

		const transcript = Sent.mock.calls[0][4][0].data as string;
		expect(transcript).toContain("first to go");
		expect(transcript).toContain("second to go");
		expect(transcript).toContain("fox (300)");
		expect(transcript).toContain("] 301 - message");
	});

	it("should put the transcript in age order whatever order the payload came in", async () => {
		const ids = [FreshId(), FreshId()];
		Store(ids[0], "older");
		Store(ids[1], "newer");

		await Handle([ids[1], ids[0]]);

		const transcript = Sent.mock.calls[0][4][0].data as string;
		expect(transcript.indexOf("older")).toBeLessThan(transcript.indexOf("newer"));
	});

	it("should look for the audit entry on the channel", async () => {
		const id = FreshId();
		Store(id, "purged");
		Awaited.mockResolvedValue({ id: "1", action_type: 73, target_id: "200", user_id: "900" });

		await Handle([id]);

		expect(Awaited).toHaveBeenCalledWith(Client, "100", 73, "200");
		expect(JSON.stringify(Sent.mock.calls[0][3])).toContain("<@900>");
	});

	it("should count the messages it never stored", async () => {
		const id = FreshId();
		Store(id, "the only one kept");

		await Handle([id, FreshId(), FreshId()]);

		expect(JSON.stringify(Sent.mock.calls[0][3])).toContain("2 of 3 had no stored copy");
	});

	it("should post a bare log with no file when nothing was stored", async () => {
		await Handle([FreshId(), FreshId()]);

		expect(Sent).toHaveBeenCalledWith(Client, "100", "MessageDeleteBulk", expect.objectContaining({ type: 17 }), []);
		expect(JSON.stringify(Sent.mock.calls[0][3])).toContain("2 messages deleted in bulk");
	});

	it("should neither wait for attribution nor post when the guild is not logging purges", async () => {
		SetGuildEvent(100n, "MessageDeleteBulk", 500n, 0n);
		const id = FreshId();
		Store(id, "unlogged");

		await Handle([id]);

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
		expect(Messages.GetMessage(BigInt(id))).toEqual(undefined);
	});

	it("should remove every message afterwards", async () => {
		const ids = [FreshId(), FreshId(), FreshId()];
		for (const id of ids) Store(id, "does not outlive the purge");

		await Handle(ids);

		for (const id of ids) expect(Messages.GetMessage(BigInt(id))).toEqual(undefined);
	});

	it("should take the stored attachments with it, and not upload them", async () => {
		const id = FreshId();
		const message = Store(id, "came with a file");
		const attachment: StoredAttachment = {
			id: "997", filename: "cat.png", size: 1,
			content_type: "image/png", width: null, height: null, stored: true
		};
		message.payload.attachments = [attachment];
		Messages.SaveMessage(message);

		const path = AttachmentPath(BigInt(id), attachment.id, attachment.filename);
		await fs.mkdir(dirname(path), { recursive: true });
		await fs.writeFile(path, Buffer.from([1]));

		await Handle([id]);

		expect(Sent.mock.calls[0][4]).toHaveLength(1);
		expect(Sent.mock.calls[0][4][0].data).toContain("attachment: cat.png");
		expect(await ReadAttachment(BigInt(id), attachment)).toBeUndefined();
	});

	it("should ignore a bulk delete outside a guild", async () => {
		const id = FreshId();
		Store(id, "not a guild's business");

		await Handle([id], null);

		expect(Sent).not.toHaveBeenCalled();
		expect(Messages.GetMessage(BigInt(id))).toBeDefined();
	});
});
