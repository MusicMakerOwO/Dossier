import { describe, it, expect, vi } from "vitest";
import { Message } from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";
import { GetMessage } from "../CRUD/Messages.js";
import { messageCreate } from "../Events/index.js";

type MessageFixture = {
	id: string;
	guildId?: string | null;
	channelId: string;
	user: { id: string };
	timestamp: string;
	content: string;
	embeds: Message["embeds"];
	attachments: Message["attachments"];
};

const Client = null as unknown as FullClient;

let NextId = 1n;
function FreshId(): string {
	return (NextId++).toString();
}

function MakeMessage(overrides: Partial<MessageFixture> = {}): MessageFixture {
	return {
		id: FreshId(),
		guildId: "100",
		channelId: "200",
		user: { id: "300" },
		timestamp: "2025-05-25T22:13:20.000Z", // 1700000000000
		content: "hello",
		embeds: [],
		attachments: [],
		...overrides
	};
}

function Handle(message: MessageFixture): Promise<void> {
	return messageCreate.execute(Client, message as unknown as Message);
}

describe("MessageCreate", () => {
	it("should store the message it was handed", async () => {
		const message = MakeMessage({ content: "store me" });
		await Handle(message);

		expect(GetMessage(BigInt(message.id))).toEqual({
			message_id: BigInt(message.id),
			guild_id: 100n,
			channel_id: 200n,
			user_id: 300n,
			created_at: BigInt( new Date(message.timestamp).getTime() ),
			encryption_version: 0n,
			payload: { content: "store me", embeds: [], attachments: [], edited_at: null }
		});
	});

	it("should keep embeds and narrow attachments to the stored metadata fields", async () => {
		const message = MakeMessage({
			embeds: [{ title: "An embed", description: "words" }],
			attachments: [{
				id: "999",
				filename: "cat.png",
				size: 1024,
				content_type: "image/png",
				height: 64,
				width: 64,
				url: "https://cdn.example/cat.png",
				proxy_url: "https://proxy.example/cat.png"
			}]
		});

		await Handle(message);

		expect(GetMessage(BigInt(message.id))?.payload).toEqual({
			content: "hello",
			embeds: [{ title: "An embed", description: "words" }],
			attachments: [{
				id: "999",
				filename: "cat.png",
				size: 1024,
				content_type: "image/png",
				width: 64,
				height: 64,
				stored: false
			}],
			edited_at: null
		});
	});

	it("should not download attachments for a guild with the messages group off", async () => {
		const fetched = vi.spyOn(globalThis, "fetch");
		const message = MakeMessage({
			attachments: [{
				id: "1000",
				filename: "cat.png",
				size: 10,
				content_type: "image/png",
				url: "https://cdn.example/cat.png",
				proxy_url: "https://proxy.example/cat.png"
			}]
		});

		await Handle(message);

		expect(fetched).not.toHaveBeenCalled();
		expect(GetMessage(BigInt(message.id))?.payload.attachments[0].stored).toBe(false);
		fetched.mockRestore();
	});

	it("should skip a message with no guild", async () => {
		const withNull = MakeMessage({ guildId: null });
		const withoutField = MakeMessage();
		delete withoutField.guildId;

		await Handle(withNull);
		await Handle(withoutField);

		expect(GetMessage(BigInt(withNull.id))).toBeUndefined();
		expect(GetMessage(BigInt(withoutField.id))).toBeUndefined();
	});

	it("should store a later edit of the same id over the first copy", async () => {
		const id = FreshId();

		await Handle(MakeMessage({ id, content: "first" }));
		await Handle(MakeMessage({ id, content: "second" }));

		expect(GetMessage(BigInt(id))?.payload.content).toBe("second");
	});

	it("should swallow a message it cannot store", async () => {
		await expect(Handle(MakeMessage({ id: "not a snowflake" }))).resolves.toBeUndefined();
	});
});