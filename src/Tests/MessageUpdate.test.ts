import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { Message } from "simplyjs";
import { SimpleMessage, StoredAttachment } from "../Types/SimpleTypes.js";
import { FullClient } from "../Types/InternalTypes.js";
import { AttachmentPath, ReadAttachment } from "../CRUD/Attachments.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const { messageUpdate: MessageUpdate } = await import("../Events/Logs/Messages.js");
const Messages = await import("../CRUD/Messages.js");

type MessageFixture = {
	id: string;
	guildId?: string | null;
	channelId: string;
	user: { id: string };
	timestamp: string;
	editedTimestamp: string | null;
	content: string;
	embeds: Message["embeds"];
	attachments: Message["attachments"];
};

const Client = null as unknown as FullClient;

// A day no other test file uses, because the attachment root is shared across workers
const BaseMs = 1_650_000_000_000n;
let NextId = 1n;
function FreshId(): string {
	return (((BaseMs - 1_420_070_400_000n) << 22n) + NextId++).toString();
}

const Edited = "2022-04-15T05:30:00.000Z";

function Store(id: string, payload: Partial<SimpleMessage["payload"]> = {}): SimpleMessage {
	const message: SimpleMessage = {
		message_id: BigInt(id),
		guild_id: 100n,
		channel_id: 200n,
		user_id: 300n,
		created_at: BaseMs,
		encryption_version: 0n,
		payload: { content: "original", embeds: [], attachments: [], edited_at: null, ...payload }
	};

	Messages.SaveMessage(message);
	return message;
}

function Update(id: string, overrides: Partial<MessageFixture> = {}): MessageFixture {
	return {
		id,
		guildId: "100",
		channelId: "200",
		user: { id: "300" },
		timestamp: "2022-04-15T05:20:00.000Z",
		editedTimestamp: Edited,
		content: "original",
		embeds: [],
		attachments: [],
		...overrides
	};
}

function Handle(message: MessageFixture): Promise<void> {
	return MessageUpdate.execute(Client, message as unknown as Message);
}

function Updates(): unknown[][] {
	return Logged.mock.calls.filter((call) => call[0] === "UPDATE");
}

beforeEach(() => {
	Logged.mockClear();
	Sent.mockReset().mockResolvedValue(true);
});

describe("MessageUpdate", () => {
	it("should log an edit with the stored content as before", async () => {
		const id = FreshId();
		Store(id, { content: "typo" });

		await Handle(Update(id, { content: "fixed" }));

		expect(Updates()).toHaveLength(1);
		expect(Updates()[0][2]).toMatchObject({ before: "typo", after: "fixed" });
		expect(Messages.GetMessage(BigInt(id))?.payload).toMatchObject({ content: "fixed", edited_at: Edited });
	});

	it("should store an unfurl without logging it", async () => {
		const id = FreshId();
		Store(id, { content: "https://example.com" });

		const preview = { type: "link" as const, title: "Example Domain", url: "https://example.com" };
		await Handle(Update(id, { content: "https://example.com", editedTimestamp: null, embeds: [preview] }));

		expect(Updates()).toHaveLength(0);
		expect(Messages.GetMessage(BigInt(id))?.payload.embeds).toEqual([preview]);
	});

	it("should treat a second update carrying the same edit timestamp as no edit", async () => {
		const id = FreshId();
		Store(id, { content: "edited once", edited_at: Edited });

		await Handle(Update(id, { content: "edited once" }));

		expect(Updates()).toHaveLength(0);
	});

	it("should read a row without edited_at as never edited", async () => {
		const id = FreshId();
		const message = Store(id);
		delete message.payload.edited_at;
		Messages.SaveMessage(message);

		await Handle(Update(id, { editedTimestamp: null }));
		expect(Updates()).toHaveLength(0);

		await Handle(Update(id, { content: "now edited" }));
		expect(Updates()).toHaveLength(1);
	});

	it("should log an edit to a message it never stored, and start storing it", async () => {
		const id = FreshId();

		await Handle(Update(id, { content: "from before the bot joined" }));

		expect(Updates()).toHaveLength(1);
		expect(Updates()[0][1]).toMatch(/no earlier version/);
		expect(Messages.GetMessage(BigInt(id))?.payload.content).toBe("from before the bot joined");
	});

	it("should report changed rich embed fields", async () => {
		const id = FreshId();
		Store(id, { embeds: [{ type: "rich", title: "Old", description: "same" }] });

		await Handle(Update(id, { embeds: [{ type: "rich", title: "New", description: "same" }] }));

		expect(Updates()[0][2]).toMatchObject({ embeds: ["Embed 1 · title: Old → New"] });
	});

	it("should log a removed attachment before deleting its bytes", async () => {
		const id = FreshId();
		const kept: StoredAttachment = { id: "1", filename: "keep.png", size: 1, content_type: "image/png", width: null, height: null, stored: true };
		const dropped: StoredAttachment = { ...kept, id: "2", filename: "drop.png" };
		Store(id, { attachments: [kept, dropped] });

		for (const attachment of [kept, dropped]) {
			const path = AttachmentPath(BigInt(id), attachment.id, attachment.filename);
			await fs.mkdir(dirname(path), { recursive: true });
			await fs.writeFile(path, Buffer.from([1]));
		}

		const droppedPath = AttachmentPath(BigInt(id), dropped.id, dropped.filename);
		let presentAtLogTime = false;
		Logged.mockImplementation((type: string) => {
			if (type === "UPDATE") presentAtLogTime = existsSync(droppedPath);
		});

		await Handle(Update(id, {
			attachments: [{ id: "1", filename: "keep.png", size: 1, content_type: "image/png", url: "", proxy_url: "" }]
		}));
		Logged.mockReset();

		expect(presentAtLogTime).toBe(true);
		expect(await ReadAttachment(BigInt(id), dropped)).toBeUndefined();
		expect(await ReadAttachment(BigInt(id), kept)).toBeDefined();
		expect(Messages.GetMessage(BigInt(id))?.payload.attachments).toEqual([kept]);
	});

	it("should skip a message with no guild", async () => {
		const id = FreshId();
		await Handle(Update(id, { guildId: null }));

		expect(Messages.GetMessage(BigInt(id))).toBeUndefined();
	});

	it("should swallow a message it cannot store", async () => {
		await expect(Handle(Update("not a snowflake"))).resolves.toBeUndefined();
	});

	it("should post an edit to the guild it happened in", async () => {
		const id = FreshId();
		Store(id, { content: "typo" });

		await Handle(Update(id, { content: "fixed" }));

		expect(Sent).toHaveBeenCalledOnce();
		expect(Sent).toHaveBeenCalledWith(Client, "100", "MessageUpdate", expect.objectContaining({ type: 17 }), []);
		const text = JSON.stringify(Sent.mock.calls[0][3]);
		expect(text).toContain("typo");
		expect(text).toContain("fixed");
	});

	it("should not post an update that was not an edit", async () => {
		const id = FreshId();
		Store(id, { edited_at: Edited });

		await Handle(Update(id));

		expect(Sent).not.toHaveBeenCalled();
	});

	it("should post a removed attachment's bytes before deleting them", async () => {
		const id = FreshId();
		const kept: StoredAttachment = { id: "3", filename: "keep.png", size: 1, content_type: "image/png", width: null, height: null, stored: true };
		const dropped: StoredAttachment = { ...kept, id: "4", filename: "drop.png" };
		Store(id, { attachments: [kept, dropped] });

		for (const attachment of [kept, dropped]) {
			const path = AttachmentPath(BigInt(id), attachment.id, attachment.filename);
			await fs.mkdir(dirname(path), { recursive: true });
			await fs.writeFile(path, Buffer.from([9]));
		}

		await Handle(Update(id, {
			attachments: [{ id: "3", filename: "keep.png", size: 1, content_type: "image/png", url: "", proxy_url: "" }]
		}));

		expect(Sent.mock.calls[0][4]).toEqual([{ name: "4-drop.png", data: Buffer.from([9]) }]);
		expect(await ReadAttachment(BigInt(id), dropped)).toBeUndefined();
	});
});