import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	Client,
	ClientEventMap,
	AuditLogEvents,
	ClientEvents,
	DiscordEmoji,
	DiscordGuildCreate,
	DiscordSoundboardSound,
	DiscordSticker,
	DiscordStickerFormatTypes,
	DiscordStickerTypes,
	EmojisUpdate,
	Guild,
	SoundboardSoundUpdate
} from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited } = vi.hoisted(() => ({ Awaited: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const Events = await import("../Events/Logs/Assets.js");

const GUILD = "100";

const client = new Client({ token: "test", intents: [] }) as FullClient;
const guild: Guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], stickers: [], features: [] } as unknown as DiscordGuildCreate);

let NextId = 1000n;
function FreshId(): string {
	return (NextId++).toString();
}

function Emoji(id: string, fields: Partial<DiscordEmoji> = {}): DiscordEmoji {
	return { id, name: "frog", animated: false, available: true, roles: [], ...fields };
}

function Sticker(id: string, fields: Partial<DiscordSticker> = {}): DiscordSticker {
	return { id, name: "wave", tags: "👋", type: DiscordStickerTypes.GUILD, format_type: DiscordStickerFormatTypes.PNG, guild_id: GUILD, ...fields };
}

function Sound(id: string, fields: Partial<DiscordSoundboardSound> = {}): DiscordSoundboardSound & { guild_id: string } {
	return { sound_id: id, name: "airhorn", volume: 1, emoji_id: null, emoji_name: "📯", available: true, guild_id: GUILD, ...fields };
}

/** The container a call to SendLog carried, as the text a mod would read. */
function Posted(call = 0): string {
	const container = Sent.mock.calls[call][3] as { components: unknown[] };
	return JSON.stringify(container.components);
}

beforeEach(() => {
	Logged.mockClear();
	Awaited.mockReset().mockResolvedValue(null);
	Sent.mockReset().mockResolvedValue(true);
});

describe("create", () => {
	it("should wait on EMOJI_CREATE for the emoji's id", async () => {
		const id = FreshId();
		await Events.emojiCreate.execute(client, guild, guild.emojis.upsert(Emoji(id)));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.EmojiCreate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "EmojiCreate", expect.anything());
	});

	it("should wait on STICKER_CREATE", async () => {
		const id = FreshId();
		await Events.stickerCreate.execute(client, guild, guild.stickers.upsert(Sticker(id)));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.StickerCreate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "StickerCreate", expect.anything());
	});

	it("should wait on SOUNDBOARD_SOUND_CREATE for the sound id", async () => {
		const id = FreshId();
		await Events.soundboardSoundCreate.execute(client, guild, guild.soundboardSounds.upsert(Sound(id)));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.SoundboardSoundCreate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "SoundboardSoundCreate", expect.anything());
	});
});

describe("update", () => {
	it("should wait on EMOJI_UPDATE for a rename", async () => {
		const id = FreshId();
		const old = guild.emojis.upsert(Emoji(id)).clone();
		await Events.emojiUpdate.execute(client, guild, old, guild.emojis.upsert(Emoji(id, { name: "toad" })));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.EmojiUpdate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "EmojiUpdate", expect.anything());
	});

	it("should post nothing when no reported field changed", async () => {
		const id = FreshId();
		const old = guild.stickers.upsert(Sticker(id)).clone();
		await Events.stickerUpdate.execute(client, guild, old, guild.stickers.upsert(Sticker(id, { sort_value: 3 })));

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should still post when the earlier version was never cached", async () => {
		await Events.soundboardSoundUpdate.execute(client, guild, undefined, guild.soundboardSounds.upsert(Sound(FreshId())));

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("No earlier version cached");
	});

	// Dispatched through the library, so its own before/after cloning is what gets tested
	it("should diff a sound rename delivered by the library's own handler", async () => {
		const id = FreshId();
		guild.soundboardSounds.upsert(Sound(id));

		const pending: Promise<void>[] = [];
		const listener = (...args: ClientEventMap[typeof ClientEvents.SoundboardSoundUpdate]): void => {
			pending.push(Events.soundboardSoundUpdate.execute(client, ...args));
		};

		client.on(ClientEvents.SoundboardSoundUpdate, listener);
		await SoundboardSoundUpdate.handler(client, Sound(id, { name: "foghorn" }));
		client.off(ClientEvents.SoundboardSoundUpdate, listener);
		await Promise.all(pending);

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("`airhorn` → `foghorn`");
		expect(Posted()).not.toContain("No earlier version cached");
	});
});

describe("delete", () => {
	it("should log an uncached sound from its bare id", async () => {
		const id = FreshId();
		await Events.soundboardSoundDelete.execute(client, guild, { soundId: id, guildId: GUILD });

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.SoundboardSoundDelete, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "SoundboardSoundDelete", expect.anything());
		expect(Posted()).toContain("name unknown");
	});

	it("should wait on EMOJI_DELETE and name the emoji", async () => {
		const id = FreshId();
		await Events.emojiDelete.execute(client, guild, guild.emojis.upsert(Emoji(id, { name: "gone" })));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.EmojiDelete, id);
		expect(Posted()).toContain("`gone`");
	});

	it("should wait on STICKER_DELETE", async () => {
		const id = FreshId();
		await Events.stickerDelete.execute(client, guild, guild.stickers.upsert(Sticker(id)));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.StickerDelete, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "StickerDelete", expect.anything());
	});

	it("should not throw when sending fails", async () => {
		Sent.mockRejectedValueOnce(new Error("boom"));
		await expect(Events.emojiDelete.execute(client, guild, guild.emojis.upsert(Emoji(FreshId())))).resolves.toBeUndefined();
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});

describe("cache seeding", () => {
	it("should fill the expression caches from GUILD_CREATE", () => {
		const seeded = client.guilds.upsert({
			id: "101", name: "g", roles: [], features: [],
			emojis: [Emoji("1")],
			stickers: [Sticker("2")],
			soundboard_sounds: [Sound("3")]
		} as unknown as DiscordGuildCreate);

		expect([seeded.emojis.size, seeded.stickers.size, seeded.soundboardSounds.size]).toEqual([1, 1, 1]);
	});

	it("should report no new emoji when a sync carries only what GUILD_CREATE had", async () => {
		const created = vi.fn();
		client.guilds.upsert({ id: "102", name: "g", roles: [], features: [], emojis: [Emoji("4")] } as unknown as DiscordGuildCreate);

		client.on(ClientEvents.EmojiCreate, created);
		await EmojisUpdate.handler(client, { guild_id: "102", emojis: [Emoji("4")] });
		client.off(ClientEvents.EmojiCreate, created);

		expect(created).not.toHaveBeenCalled();
	});
});