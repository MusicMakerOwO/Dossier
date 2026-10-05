import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	AuditLogEvents,
	Client,
	ClientEventMap,
	ClientEvents,
	DiscordChannel,
	DiscordChannelTypes,
	DiscordGuildCreate,
	DiscordPermissions,
	Guild,
	ThreadCreate
} from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";
import { Snapshot } from "../Logs/ChannelLogs.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited } = vi.hoisted(() => ({ Awaited: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const Events = await import("../Events/Logs/Channels.js");

const GUILD = "100";

const client = new Client({ token: "test", intents: [] }) as FullClient;
const guild: Guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

let NextId = 1000n;
function FreshId(): string {
	return (NextId++).toString();
}

function Text(id: string, fields: Partial<DiscordChannel> = {}): DiscordChannel {
	return { id, type: DiscordChannelTypes.GUILD_TEXT, guild_id: GUILD, name: "general", position: 0, permission_overwrites: [], ...fields };
}

function Thread(id: string, fields: Partial<DiscordChannel> = {}): DiscordChannel {
	return {
		id, type: DiscordChannelTypes.PUBLIC_THREAD, guild_id: GUILD, name: "question", parent_id: "1", owner_id: "901",
		thread_metadata: { archived: false, auto_archive_duration: 1440, archive_timestamp: "2026-01-01T00:00:00Z", locked: false },
		...fields
	};
}

/** Upserts `before`, then `after` over it, and returns the arguments the library's update event would carry. */
function Update(before: DiscordChannel, after: DiscordChannel) {
	const old = guild.channels.upsert(before).clone();
	return [guild, old, guild.channels.upsert(after)] as const;
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

describe("channelUpdate", () => {
	it("should wait on CHANNEL_UPDATE for a rename", async () => {
		const id = FreshId();
		await Events.channelUpdate.execute(client, ...Update(Text(id), Text(id, { name: "chat" })));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.ChannelUpdate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "ChannelUpdate", expect.anything());
	});

	it("should wait on the override action when only overrides changed", async () => {
		const id = FreshId();
		const overwrite = { id: "5", type: 0 as const, allow: DiscordPermissions.SEND_MESSAGES.toString(), deny: "0" };
		await Events.channelUpdate.execute(client, ...Update(Text(id), Text(id, { permission_overwrites: [overwrite] })));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.ChannelOverwriteCreate, id);
		expect(Sent).toHaveBeenCalledOnce();
	});

	it("should still post when the earlier version was never cached", async () => {
		const id = FreshId();
		await Events.channelUpdate.execute(client, guild, undefined, guild.channels.upsert(Text(id)));

		expect(Sent).toHaveBeenCalledOnce();
	});
});

// Each test uses its own guild, because a batch reads every channel in the guild
describe("channel reorder", () => {
	let NextGuild = 500n;

	function FreshGuild(): Guild {
		return client.guilds.upsert({ id: (NextGuild++).toString(), name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);
	}

	function Add(target: Guild, fields: Partial<DiscordChannel>): string {
		const id = FreshId();
		target.channels.upsert(Text(id, { guild_id: target.id, ...fields }));
		return id;
	}

	/** The update the library would emit for `id` landing on `fields`. */
	async function Shift(target: Guild, id: string, fields: Partial<DiscordChannel>): Promise<void> {
		const old = target.channels.get(id)!.clone();
		const snapshot = Snapshot(old);
		const now = target.channels.upsert(Text(id, {
			guild_id: target.id, type: snapshot.type, name: snapshot.name ?? "general", position: snapshot.position ?? 0,
			...(snapshot.parentId ? { parent_id: snapshot.parentId } : {}), ...fields
		}));
		await Events.channelUpdate.execute(client, target, old, now);
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should post nothing at the time of a position-only change", async () => {
		const target = FreshGuild();
		const id = Add(target, { position: 0 });

		await Shift(target, id, { position: 1 });

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should post one log naming only the channel that was dragged, within its category", async () => {
		const target = FreshGuild();
		const category = Add(target, { type: DiscordChannelTypes.GUILD_CATEGORY, name: "info", position: 0 });
		const ids = [0, 1, 2, 3].map((position) => Add(target, { name: `c${position}`, parent_id: category, position }));

		for (const [index, id] of ids.entries()) await Shift(target, id, { position: index === 3 ? 0 : index + 1 });
		await vi.runAllTimersAsync();

		expect(Sent).toHaveBeenCalledOnce();
		expect(Sent).toHaveBeenCalledWith(client, target.id, "ChannelUpdate", expect.anything());
		expect(Posted()).toContain(`<#${ids[3]}> \`c3\` moved up from 4th to 1st in <#${category}>`);
		expect(Posted()).toContain("3 other channels shifted to make room");
	});

	it("should rank voice channels apart from text channels", async () => {
		const target = FreshGuild();
		const text = Add(target, { name: "chat", position: 0 });
		const voice = Add(target, { type: DiscordChannelTypes.GUILD_VOICE, name: "talk", position: 1 });

		await Shift(target, voice, { position: 0 });
		await Shift(target, text, { position: 1 });
		await vi.runAllTimersAsync();

		expect(Sent).not.toHaveBeenCalled();
	});

	it("should leave a channel moved to another category to the update log", async () => {
		const target = FreshGuild();
		const first = Add(target, { type: DiscordChannelTypes.GUILD_CATEGORY, name: "a", position: 0 });
		const second = Add(target, { type: DiscordChannelTypes.GUILD_CATEGORY, name: "b", position: 1 });
		const [moved, left] = [0, 1].map((position) => Add(target, { parent_id: first, position }));
		const [stayed] = [0].map((position) => Add(target, { parent_id: second, position }));

		await Shift(target, moved, { parent_id: second, position: 0 });
		await Shift(target, stayed, { position: 1 });
		await Shift(target, left, { position: 0 });

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("**Category**");

		await vi.runAllTimersAsync();
		expect(Sent).toHaveBeenCalledOnce();
	});
});

describe("channelDelete", () => {
	it("should log an uncached channel from the raw payload", async () => {
		const id = FreshId();
		await Events.channelDelete.execute(client, guild, Text(id, { name: "gone" }));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.ChannelDelete, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "ChannelDelete", expect.anything());
	});

	it("should not throw when sending fails", async () => {
		Sent.mockRejectedValueOnce(new Error("boom"));
		await expect(Events.channelDelete.execute(client, guild, Text(FreshId()))).resolves.toBeUndefined();
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});

describe("threadCreate", () => {
	it("should log a thread created just now, without an audit wait", async () => {
		await Events.threadCreate.execute(client, guild, guild.channels.upsert(Thread(FreshId())), true);

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "ThreadCreate", expect.anything());
	});

	it("should skip a thread the bot was only just added to", async () => {
		await Events.threadCreate.execute(client, guild, guild.channels.upsert(Thread(FreshId())), false);
		expect(Sent).not.toHaveBeenCalled();
	});

	// Dispatched through the library, so `newly_created` is read off the wire payload
	it("should tell a creation from being added, as the library's own handler delivers them", async () => {
		const pending: Promise<void>[] = [];
		const listener = (...args: ClientEventMap[typeof ClientEvents.ThreadCreate]): void => {
			pending.push(Events.threadCreate.execute(client, ...args));
		};

		client.on(ClientEvents.ThreadCreate, listener);
		await ThreadCreate.handler(client, { ...Thread(FreshId()), newly_created: true });
		await ThreadCreate.handler(client, Thread(FreshId()));
		client.off(ClientEvents.ThreadCreate, listener);
		await Promise.all(pending);

		expect(Sent).toHaveBeenCalledOnce();
	});
});

describe("threadUpdate", () => {
	it("should wait on THREAD_UPDATE for an archive", async () => {
		const id = FreshId();
		const archived = Thread(id);
		archived.thread_metadata = { ...archived.thread_metadata!, archived: true };

		await Events.threadUpdate.execute(client, ...Update(Thread(id), archived));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.ThreadUpdate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "ThreadUpdate", expect.anything());
	});
});

describe("threadDelete", () => {
	it("should wait on THREAD_DELETE", async () => {
		const id = FreshId();
		await Events.threadDelete.execute(client, guild, { id, type: DiscordChannelTypes.PUBLIC_THREAD, guild_id: GUILD, parent_id: "1" });

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.ThreadDelete, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "ThreadDelete", expect.anything());
	});
});
