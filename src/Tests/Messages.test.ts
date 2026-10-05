import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "../Database.js";
import { SimpleMessage, StoredAttachment } from "../Types/SimpleTypes.js";
import { DeleteMessage, GetMessage, SaveMessage, SaveMessageBulk } from "../CRUD/Messages.js";
import { AttachmentPath, ReadAttachment } from "../CRUD/Attachments.js";

// The module cache has no reset, so each test uses its own message_id
let NextId = 1n;
function FreshId(): bigint {
	return NextId++;
}

function FreshSnowflake(): bigint {
	return ((1_700_000_000_000n - 1_420_070_400_000n) << 22n) + NextId++;
}

function MakeMessage(message_id: bigint, content: string): SimpleMessage {
	return {
		message_id,
		guild_id: 100n,
		channel_id: 200n,
		user_id: 300n,
		created_at: 1_700_000_000_000n,
		encryption_version: 0n,
		payload: { content, embeds: [], attachments: [] }
	};
}

const RawInsert = Database.prepare(
	`INSERT INTO Messages (message_id, guild_id, channel_id, user_id, created_at, encryption_version, payload)
	 VALUES (@message_id, 100, 200, 300, 1700000000000, @encryption_version, @payload)`
);
const RawDelete = Database.prepare("DELETE FROM Messages WHERE message_id = @message_id");
const RawSelect = Database.prepare("SELECT payload FROM Messages WHERE message_id = @message_id");

describe("Messages CRUD", () => {
	it("should round-trip a message through Set and Get", () => {
		const id = FreshId();
		const message = MakeMessage(id, "hello");

		SaveMessage(message);
		const read = GetMessage(id);

		expect(read).toEqual(message);
		expect(read?.message_id).toBe(id);
		expect(read?.created_at).toBe(1_700_000_000_000n);
	});

	// Inserted behind the cache, or GetMessage would answer from it without decoding a row
	it("should hand back payload as an object, not the stored string", () => {
		const id = FreshId();
		RawInsert.run({
			message_id: id,
			encryption_version: 0n,
			payload: Buffer.from(JSON.stringify({ content: "from the table", embeds: [], attachments: [] }))
		});

		const read = GetMessage(id);
		expect(typeof read?.payload).toBe("object");
		expect(read?.payload.content).toBe("from the table");
	});

	it("should preserve embeds and attachments across the JSON round-trip", () => {
		const id = FreshId();
		const payload = {
			content: "look at this",
			embeds: [{ title: "An embed", description: "words", color: 0xff_00_00 }],
			attachments: [{
				id: "999",
				filename: "cat.png",
				size: 1024,
				content_type: "image/png",
				width: 64,
				height: 64,
				stored: true
			}]
		};

		RawInsert.run({ message_id: id, encryption_version: 0n, payload: Buffer.from(JSON.stringify(payload)) });

		expect(GetMessage(id)?.payload).toEqual(payload);
	});

	it("should return undefined for a message that was never stored", () => {
		expect(GetMessage(FreshId())).toBeUndefined();
	});

	it("should overwrite on a second Set rather than conflicting on the primary key", () => {
		const id = FreshId();

		SaveMessage(MakeMessage(id, "first"));
		expect(() => SaveMessage(MakeMessage(id, "second"))).not.toThrow();

		expect(GetMessage(id)?.payload.content).toBe("second");
		expect(JSON.parse((RawSelect.get({ message_id: id }) as { payload: Buffer }).payload.toString())).toEqual({
			content: "second",
			embeds: [],
			attachments: []
		});
	});

	it("should support the Get, mutate, Set update flow", () => {
		const id = FreshId();
		SaveMessage(MakeMessage(id, "before"));

		const message = GetMessage(id)!;
		message.payload.content = "after";
		SaveMessage(message);

		expect(JSON.parse((RawSelect.get({ message_id: id }) as { payload: Buffer }).payload.toString()).content).toBe("after");
	});

	it("should report whether Delete had a row to remove", async () => {
		const id = FreshId();
		SaveMessage(MakeMessage(id, "doomed"));

		expect(await DeleteMessage(id)).toBe(true);
		expect(await DeleteMessage(FreshId())).toBe(false);
	});

	it("should return undefined for a Get after a Delete", async () => {
		const id = FreshId();
		SaveMessage(MakeMessage(id, "doomed"));
		await DeleteMessage(id);

		expect(GetMessage(id)).toBeUndefined();
		expect(RawSelect.get({ message_id: id })).toBeUndefined();
	});

	it("should take a message's stored bytes with the row", async () => {
		const id = FreshSnowflake();
		const message = MakeMessage(id, "had a file");
		const attachment: StoredAttachment = {
			id: "999", filename: "cat.png", size: 1,
			content_type: "image/png", width: null, height: null, stored: true
		};

		message.payload.attachments = [attachment];
		SaveMessage(message);

		const path = AttachmentPath(id, attachment.id, attachment.filename);
		await fs.mkdir(dirname(path), { recursive: true });
		await fs.writeFile(path, Buffer.from([1]));

		await DeleteMessage(id);

		expect(await ReadAttachment(id, attachment)).toBeUndefined();
		expect(existsSync(path)).toBe(false);
	});

	it("should serve a cached message even after the row is gone from the table", () => {
		const id = FreshId();
		const message = MakeMessage(id, "outlives its row");

		SaveMessage(message);
		RawDelete.run({ message_id: id });

		expect(RawSelect.get({ message_id: id })).toBeUndefined();
		expect(GetMessage(id)).toEqual(message);
	});

	it("should keep serving a cached miss after the row appears out of band", () => {
		const id = FreshId();
		expect(GetMessage(id)).toBeUndefined();

		RawInsert.run({
			message_id: id,
			encryption_version: 0n,
			payload: Buffer.from(JSON.stringify({ content: "snuck in", embeds: [], attachments: [] }))
		});

		expect(GetMessage(id)).toBeUndefined();
	});

	it("should refuse to read a row stored at an unknown encryption version", () => {
		const id = FreshId();
		RawInsert.run({
			message_id: id,
			encryption_version: 1n,
			payload: Buffer.from(JSON.stringify({ content: "ciphertext, supposedly", embeds: [], attachments: [] }))
		});

		expect(() => GetMessage(id)).toThrow(/encryption version 1/);
	});

	it("should refuse to write a message at an unknown encryption version", () => {
		const id = FreshId();
		const message = MakeMessage(id, "too new");
		message.encryption_version = 2n;

		expect(() => SaveMessage(message)).toThrow(/encryption version 2/);
		expect(RawSelect.get({ message_id: id })).toBeUndefined();
	});

	it("should store a batch through SaveMessageBulk", () => {
		const messages = [MakeMessage(FreshId(), "one"), MakeMessage(FreshId(), "two")];

		SaveMessageBulk(messages);

		for (const message of messages) {
			expect(GetMessage(message.message_id)).toEqual(message);
		}
	});

	it("should accept an empty batch", () => {
		expect(() => SaveMessageBulk([])).not.toThrow();
	});

	it("should leave nothing cached when a batch fails partway", () => {
		const good = MakeMessage(FreshId(), "rolled back with the rest");
		const bad = MakeMessage(FreshId(), "unwritable");
		bad.encryption_version = 3n;

		expect(() => SaveMessageBulk([good, bad])).toThrow(/encryption version 3/);

		expect(RawSelect.get({ message_id: good.message_id })).toBeUndefined();
		expect(GetMessage(good.message_id)).toBeUndefined();
	});
});