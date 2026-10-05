import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { dirname } from "node:path";
import { MessageDeletePayload } from "simplyjs";
import { SimpleMessage, StoredAttachment } from "../Types/SimpleTypes.js";
import { FullClient } from "../Types/InternalTypes.js";
import { AttachmentPath, ReadAttachment } from "../CRUD/Attachments.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited } = vi.hoisted(() => ({ Awaited: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const { messageDelete: MessageDelete } = await import("../Events/Logs/Messages.js");
const Messages = await import("../CRUD/Messages.js");

const Client = null as unknown as FullClient;

let NextId = 1n;
function FreshId(): string {
	return (NextId++).toString();
}

function FreshSnowflakeId(): string {
	return (((1_700_000_000_000n - 1_420_070_400_000n) << 22n) + NextId++).toString();
}

function Store(id: string, content: string): SimpleMessage {
	const message: SimpleMessage = {
		message_id: BigInt(id),
		guild_id: 100n,
		channel_id: 200n,
		user_id: 300n,
		created_at: 1_700_000_000_000n,
		encryption_version: 0n,
		payload: { content, embeds: [], attachments: [] }
	};

	Messages.SaveMessage(message);
	return message;
}

function Handle(id: string): Promise<void> {
	return MessageDelete.execute(Client, { id, channelId: "200", guildId: "100" } as MessageDeletePayload);
}

beforeEach(() => {
	Logged.mockClear();
	Awaited.mockReset().mockResolvedValue(null);
	Sent.mockReset().mockResolvedValue(true);
});

describe("MessageDelete", () => {
	it("should log the stored message", async () => {
		const id = FreshId();
		const message = Store(id, "deleted words");

		await Handle(id);

		expect(Logged).toHaveBeenCalledTimes(1);
		expect(Logged).toHaveBeenCalledWith('DELETE', expect.stringContaining(id), message);
	});

	it("should name the moderator when an audit entry pairs", async () => {
		const id = FreshId();
		const message = Store(id, "removed by a mod");
		Awaited.mockResolvedValue({ id: "1", action_type: 72, target_id: "300", user_id: "900" });

		await Handle(id);

		expect(Awaited).toHaveBeenCalledWith(Client, "100", 72, "300");
		expect(Logged).toHaveBeenCalledWith('DELETE', expect.stringContaining("by 900"), message);
	});

	it("should log a miss for a message it never stored", async () => {
		await Handle(FreshId());

		expect(Logged).toHaveBeenCalledTimes(1);
		expect(Logged.mock.calls[0][0]).toBe('DELETE');
		expect(Logged.mock.calls[0][1]).toMatch(/nothing is stored/);
	});

	it("should not wait for attribution on a miss", async () => {
		await Handle(FreshId());

		expect(Awaited).not.toHaveBeenCalled();
	});

	it("should remove the message afterwards", async () => {
		const id = FreshId();
		Store(id, "does not outlive the delete");

		await Handle(id);

		expect(Messages.GetMessage(BigInt(id))).toEqual(undefined);
	});

	it("should take the stored attachments with it, without being asked to", async () => {
		const id = FreshSnowflakeId();
		const message = Store(id, "came with a file");
		const attachment: StoredAttachment = {
			id: "999", filename: "cat.png", size: 1,
			content_type: "image/png", width: null, height: null, stored: true
		};

		message.payload.attachments = [attachment];
		Messages.SaveMessage(message);

		const path = AttachmentPath(BigInt(id), attachment.id, attachment.filename);
		await fs.mkdir(dirname(path), { recursive: true });
		await fs.writeFile(path, Buffer.from([1]));

		await Handle(id);

		expect(await ReadAttachment(BigInt(id), attachment)).toBeUndefined();
	});

	it("should post the log to the stored message's guild", async () => {
		const id = FreshId();
		Store(id, "deleted words");

		await Handle(id);

		expect(Sent).toHaveBeenCalledOnce();
		expect(Sent).toHaveBeenCalledWith(Client, "100", "MessageDelete", expect.objectContaining({ type: 17 }), []);
		expect(JSON.stringify(Sent.mock.calls[0][3])).toContain("deleted words");
	});

	it("should post a bare log for a message it never stored", async () => {
		const id = FreshId();
		await Handle(id);

		expect(Sent).toHaveBeenCalledWith(Client, "100", "MessageDelete", expect.objectContaining({ type: 17 }));
		expect(JSON.stringify(Sent.mock.calls[0][3])).toContain(id);
	});

	it("should hand the stored bytes to the log before deleting them", async () => {
		const id = FreshSnowflakeId();
		const message = Store(id, "came with a file");
		const attachment: StoredAttachment = {
			id: "998", filename: "dog.png", size: 1,
			content_type: "image/png", width: null, height: null, stored: true
		};
		message.payload.attachments = [attachment];
		Messages.SaveMessage(message);

		const path = AttachmentPath(BigInt(id), attachment.id, attachment.filename);
		await fs.mkdir(dirname(path), { recursive: true });
		await fs.writeFile(path, Buffer.from([7]));

		await Handle(id);

		expect(Sent.mock.calls[0][4]).toEqual([{ name: "998-dog.png", data: Buffer.from([7]) }]);
		expect(await ReadAttachment(BigInt(id), attachment)).toBeUndefined();
	});
});