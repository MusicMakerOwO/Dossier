import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContainerBuilder, TextDisplayBuilder } from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";
import { SetGuildEvent } from "../CRUD/GuildEvents.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { SendLog } = await import("../Logs/Send.js");

// The GuildEvents cache has no reset, so each test uses its own guild
let NextGuild = 1n;
function FreshGuild(): string {
	return (NextGuild++).toString();
}

const CHANNEL_ID = 500n;
const LOG = new ContainerBuilder().addComponents(new TextDisplayBuilder().setContent("Message deleted"));

type FakeChannel = {
	isTextChannel: () => boolean;
	isVoiceChannel: () => boolean;
	isThreadChannel: () => boolean;
	send: ReturnType<typeof vi.fn>;
};

function FakeChannel(messageable = true): FakeChannel {
	return {
		isTextChannel: () => messageable,
		isVoiceChannel: () => false,
		isThreadChannel: () => false,
		send: vi.fn().mockResolvedValue({})
	};
}

/** A client holding one guild whose channel cache contains `cached`, and whose fetch resolves `fetched`. */
function FakeClient(guildId: string, cached: FakeChannel | undefined, fetched?: FakeChannel | Error) {
	const channels = {
		get: vi.fn().mockReturnValue(cached),
		fetch: fetched instanceof Error ? vi.fn().mockRejectedValue(fetched) : vi.fn().mockResolvedValue(fetched)
	};
	const client = { guilds: new Map([[guildId, { channels }]]) } as unknown as FullClient;
	return { client, channels };
}

beforeEach(() => {
	Logged.mockClear();
});

describe("SendLog", () => {
	it("should post nothing for an event the guild never configured", async () => {
		const guild = FreshGuild();
		const channel = FakeChannel();
		const { client } = FakeClient(guild, channel);

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(false);
		expect(channel.send).not.toHaveBeenCalled();
	});

	it("should post nothing for a disabled event", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageDelete", CHANNEL_ID, 0n);
		const channel = FakeChannel();
		const { client } = FakeClient(guild, channel);

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(false);
		expect(channel.send).not.toHaveBeenCalled();
	});

	it("should post to a cached channel with mentions suppressed", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageDelete", CHANNEL_ID, 1n);
		const channel = FakeChannel();
		const { client, channels } = FakeClient(guild, channel);

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(true);
		expect(channels.get).toHaveBeenCalledWith(CHANNEL_ID.toString());
		expect(channels.fetch).not.toHaveBeenCalled();
		expect(channel.send).toHaveBeenCalledWith({ components: [LOG], allowed_mentions: { parse: [] } });
	});

	it("should pass attachments through untouched", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageUpdate", CHANNEL_ID, 1n);
		const channel = FakeChannel();
		const { client } = FakeClient(guild, channel);
		const attachments = [{ name: "a.png", data: Buffer.from("bytes") }];

		expect(await SendLog(client, guild, "MessageUpdate", LOG, attachments)).toBe(true);
		expect(channel.send).toHaveBeenCalledWith({ components: [LOG], attachments, allowed_mentions: { parse: [] } });
	});

	it("should leave attachments off the payload when there are none", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageUpdate", CHANNEL_ID, 1n);
		const channel = FakeChannel();
		const { client } = FakeClient(guild, channel);

		await SendLog(client, guild, "MessageUpdate", LOG, []);
		expect(channel.send.mock.calls[0][0]).not.toHaveProperty("attachments");
	});

	it("should fetch a channel the cache does not hold", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageDelete", CHANNEL_ID, 1n);
		const channel = FakeChannel();
		const { client, channels } = FakeClient(guild, undefined, channel);

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(true);
		expect(channels.fetch).toHaveBeenCalledWith(CHANNEL_ID.toString());
		expect(channel.send).toHaveBeenCalledOnce();
	});

	it("should swallow a failed fetch and log it", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageDelete", CHANNEL_ID, 1n);
		const { client } = FakeClient(guild, undefined, new Error("Unknown Channel"));

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(false);
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(String), expect.any(Error));
	});

	it("should swallow a failed send and log it", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageDelete", CHANNEL_ID, 1n);
		const channel = FakeChannel();
		channel.send.mockRejectedValue(new Error("Missing Permissions"));
		const { client } = FakeClient(guild, channel);

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(false);
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(String), expect.any(Error));
	});

	it("should refuse a channel that cannot receive messages", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageDelete", CHANNEL_ID, 1n);
		const channel = FakeChannel(false);
		const { client } = FakeClient(guild, channel);

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(false);
		expect(channel.send).not.toHaveBeenCalled();
		expect(Logged).toHaveBeenCalledWith('WARN', expect.any(String));
	});

	it("should post nothing for a guild the client does not hold", async () => {
		const guild = FreshGuild();
		SetGuildEvent(BigInt(guild), "MessageDelete", CHANNEL_ID, 1n);
		const { client } = FakeClient(FreshGuild(), FakeChannel());

		expect(await SendLog(client, guild, "MessageDelete", LOG)).toBe(false);
	});
});
