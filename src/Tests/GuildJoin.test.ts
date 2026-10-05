import { describe, it, expect, vi } from "vitest";
import { DiscordAPIError, Guild, Message } from "simplyjs";
import { guildJoin as GuildJoin } from "../Events/Internal/GuildJoin.js";
import { BackfillGuild, StopBackfill } from "../Backfill.js";
import { FullClient } from "../Types/InternalTypes.js";
import { RETENTION_MS } from "../Constants.js";
import { GetMessage } from "../CRUD/Messages.js";
import { GetGuild, SaveGuild } from "../CRUD/Guilds.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

type ChannelFixture = {
	id: string;
	isTextChannel: () => boolean;
	isVoiceChannel: () => boolean;
	messages: { fetch: (options: { limit: number }) => Promise<Message[]> };
};

const Client = null as unknown as FullClient;

let NextGuild = 1n;
function FreshGuild(): string {
	return (NextGuild++).toString();
}

let NextId = 1_000n;
function FreshId(): string {
	return (NextId++).toString();
}

/** A message as `messages.fetch` returns it, without a guildId. */
function MakeMessage(overrides: { channelId: string; timestamp?: string; content?: string }): Message {
	return {
		id: FreshId(),
		channelId: overrides.channelId,
		user: { id: "300" },
		timestamp: overrides.timestamp ?? new Date().toISOString(),
		content: overrides.content ?? "hello",
		embeds: [],
		attachments: []
	} as unknown as Message;
}

function MakeChannel(messages: Message[], overrides: Partial<ChannelFixture> = {}): ChannelFixture {
	return {
		id: FreshId(),
		isTextChannel: () => true,
		isVoiceChannel: () => false,
		messages: { fetch: vi.fn().mockResolvedValue(messages) },
		...overrides
	};
}

function MakeGuild(channels: ChannelFixture[]): Guild {
	return {
		id: FreshGuild(),
		name: "Test Guild",
		channels: new Map(channels.map((channel) => [channel.id, channel])),
		members: { fetchGateway: vi.fn().mockResolvedValue([]) },
		webhooks: { fetchAll: vi.fn().mockResolvedValue([]), keys: () => [] }
	} as unknown as Guild;
}

describe("BackfillGuild", () => {
	it("should store the history it fetched, under the guild it was walking", async () => {
		const channel = MakeChannel([]);
		const message = MakeMessage({ channelId: channel.id, content: "backfill me" });
		channel.messages.fetch = vi.fn().mockResolvedValue([message]);

		const guild = MakeGuild([channel]);
		await BackfillGuild(guild);

		expect(GetMessage(BigInt(message.id))).toMatchObject({
			guild_id: BigInt(guild.id),
			channel_id: BigInt(channel.id),
			user_id: 300n,
			payload: { content: "backfill me", embeds: [], attachments: [] }
		});
	});

	it("should ask for a full page of 100", async () => {
		const channel = MakeChannel([]);
		await BackfillGuild(MakeGuild([channel]));

		expect(channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
	});

	it("should drop messages older than the retention window and keep newer ones", async () => {
		const channel = MakeChannel([]);

		const fresh = MakeMessage({ channelId: channel.id, timestamp: new Date(Date.now() - 1000).toISOString() });
		const aged = MakeMessage({
			channelId: channel.id,
			timestamp: new Date(Date.now() - RETENTION_MS - 86_400_000).toISOString()
		});

		channel.messages.fetch = vi.fn().mockResolvedValue([fresh, aged]);

		await BackfillGuild(MakeGuild([channel]));

		expect(GetMessage(BigInt(fresh.id))).toBeDefined();
		expect(GetMessage(BigInt(aged.id))).toBeUndefined();
	});

	it("should backfill text and voice channels, but skip channels that are neither", async () => {
		const text = MakeChannel([], { isTextChannel: () => true, isVoiceChannel: () => false });
		const voice = MakeChannel([], { isTextChannel: () => false, isVoiceChannel: () => true });
		const other = MakeChannel([], { isTextChannel: () => false, isVoiceChannel: () => false });

		await BackfillGuild(MakeGuild([text, voice, other]));

		expect(text.messages.fetch).toHaveBeenCalled();
		expect(voice.messages.fetch).toHaveBeenCalled();
		expect(other.messages.fetch).not.toHaveBeenCalled();
	});

	it("should carry on past a channel it cannot read", async () => {
		const denied = MakeChannel([]);
		denied.messages.fetch = vi.fn().mockRejectedValue(new DiscordAPIError("Missing Access", 403, 50001));

		const readable = MakeChannel([]);
		const message = MakeMessage({ channelId: readable.id });
		readable.messages.fetch = vi.fn().mockResolvedValue([message]);

		await BackfillGuild(MakeGuild([denied, readable]));

		expect(readable.messages.fetch).toHaveBeenCalled();
		expect(GetMessage(BigInt(message.id))).toBeDefined();
	});

	it("should never reject, whatever a channel throws", async () => {
		const broken = MakeChannel([]);
		broken.messages.fetch = vi.fn().mockRejectedValue(new Error("socket hang up"));

		await expect(BackfillGuild(MakeGuild([broken]))).resolves.toBeUndefined();
	});

	it("should stamp the guild as backfilled when it finishes", async () => {
		const guild = MakeGuild([MakeChannel([])]);
		SaveGuild(BigInt(guild.id));

		await BackfillGuild(guild);

		expect(GetGuild(BigInt(guild.id))!.backfilled_at).toEqual(expect.any(BigInt));
	});
});

describe("guildJoin", () => {
	it("should backfill a guild it has never seen", async () => {
		const channel = MakeChannel([]);
		const guild = MakeGuild([channel]);

		await GuildJoin.execute(Client, guild);

		// The backfill is detached, but its fetch is called before execute resolves
		expect(channel.messages.fetch).toHaveBeenCalled();
	});

	it("should ask the gateway for the guild's members", async () => {
		const guild = MakeGuild([]);
		await GuildJoin.execute(Client, guild);

		expect(guild.members.fetchGateway).toHaveBeenCalledOnce();
	});

	it("should list the guild's webhooks", async () => {
		const guild = MakeGuild([]);
		await GuildJoin.execute(Client, guild);

		expect(guild.webhooks.fetchAll).toHaveBeenCalledOnce();
	});

	it("should warm the caches again for a guild it has already recorded", async () => {
		const guild = MakeGuild([]);
		await GuildJoin.execute(Client, guild);
		await GuildJoin.execute(Client, guild);

		expect(guild.members.fetchGateway).toHaveBeenCalledTimes(2);
		await vi.waitFor(() => expect(guild.webhooks.fetchAll).toHaveBeenCalledTimes(2));
	});

	it("should log rather than throw when the member request fails", async () => {
		const guild = MakeGuild([]);
		const failure = new Error("no intent");
		vi.mocked(guild.members.fetchGateway).mockRejectedValue(failure);

		await expect(GuildJoin.execute(Client, guild)).resolves.toBeUndefined();
		await Promise.resolve();

		expect(Logged).toHaveBeenCalledWith('ERROR', failure);
	});

	it("should ignore a guild it has already recorded", async () => {
		const channel = MakeChannel([]);
		const guild = MakeGuild([channel]);

		await GuildJoin.execute(Client, guild);
		vi.mocked(channel.messages.fetch).mockClear();

		await GuildJoin.execute(Client, guild);

		expect(channel.messages.fetch).not.toHaveBeenCalled();
	});
});

// Must stay last: StopBackfill sets a flag that is never reset, and vitest runs tests in declaration order
describe("Stop", () => {
	it("should not resolve until a walk parked on a fetch has returned", async () => {
		let release!: (messages: Message[]) => void;
		const parked = MakeChannel([]);
		parked.messages.fetch = vi.fn(() => new Promise<Message[]>((resolve) => { release = resolve; }));
		const message = MakeMessage({ channelId: parked.id });

		const next = MakeChannel([]);
		const walk = BackfillGuild(MakeGuild([parked, next]));

		let drained = false;
		const stop = StopBackfill().then(() => { drained = true; });

		await Promise.resolve();
		expect(drained).toBe(false);

		release([message]);
		await stop;

		expect(GetMessage(BigInt(message.id))).toBeDefined();
		expect(next.messages.fetch).not.toHaveBeenCalled();
		await expect(walk).resolves.toBeUndefined();
	});

	it("should abandon the walk without stamping the guild as backfilled", async () => {
		const channel = MakeChannel([]);
		const guild = MakeGuild([channel]);
		SaveGuild(BigInt(guild.id));

		await StopBackfill();
		await BackfillGuild(guild);

		expect(channel.messages.fetch).not.toHaveBeenCalled();
		expect(GetGuild(BigInt(guild.id))!.backfilled_at).toBeNull();
	});
});