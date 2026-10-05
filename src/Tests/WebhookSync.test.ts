import { describe, it, expect, vi, beforeEach } from "vitest";
import { Client, DiscordAPIError, DiscordGuildCreate, DiscordWebhook, DiscordWebhookType, Guild } from "simplyjs";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { SyncChannelWebhooks, WarmWebhooks } = await import("../Logs/WebhookSync.js");

const client = new Client({ token: "test", intents: [] });

// The warmed set has no reset, so each test uses its own guild
let NextGuild = 100n;
function FreshGuild(): Guild {
	return client.guilds.upsert({ id: (NextGuild++).toString(), name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);
}

const CHANNEL = "200";
const OTHER = "201";

function Hook(id: string, fields: Partial<DiscordWebhook> = {}): DiscordWebhook {
	return { id, type: DiscordWebhookType.Incoming, channel_id: CHANNEL, name: "deploys", avatar: null, application_id: null, ...fields };
}

const NotFound = (): DiscordAPIError => new DiscordAPIError("Not Found", 404, 10015);
const Forbidden = (): DiscordAPIError => new DiscordAPIError("Missing Permissions", 403, 50013);

/** A stub of Discord's webhook routes, served from `world`. An Error in place of the list is thrown for every route, like a missing permission. */
let world: DiscordWebhook[] | Error = [];
const Get = vi.spyOn(client.rest, "get");

beforeEach(() => {
	Logged.mockClear();
	world = [];
	Get.mockReset().mockImplementation(async (path: string) => {
		if (world instanceof Error) throw world;

		const channel = /^\/channels\/(\d+)\/webhooks$/.exec(path);
		if (channel) return world.filter((webhook) => webhook.channel_id === channel[1]);

		const single = /^\/webhooks\/(\d+)$/.exec(path);
		if (single) {
			const found = world.find((webhook) => webhook.id === single[1]);
			if (!found) throw NotFound();
			return found;
		}

		return world;
	});
});

/** A guild that has been listed with `initial` in it. */
async function Warmed(initial: DiscordWebhook[]): Promise<Guild> {
	const guild = FreshGuild();
	world = initial;
	expect(await WarmWebhooks(guild)).toBe(true);
	return guild;
}

describe("WarmWebhooks", () => {
	it("should fill the cache from the guild's list", async () => {
		const guild = await Warmed([Hook("1"), Hook("2", { channel_id: OTHER })]);

		expect([...guild.webhooks.keys()]).toEqual(["1", "2"]);
	});

	it("should take out what a second listing no longer has", async () => {
		const guild = await Warmed([Hook("1"), Hook("2")]);

		world = [Hook("2")];
		await WarmWebhooks(guild);

		expect([...guild.webhooks.keys()]).toEqual(["2"]);
	});

	it("should report failure rather than throw when Discord refuses", async () => {
		world = Forbidden();

		expect(await WarmWebhooks(FreshGuild())).toBe(false);
		expect(Logged).toHaveBeenCalledWith('WARN', expect.any(String), expect.any(DiscordAPIError));
	});
});

describe("SyncChannelWebhooks", () => {
	it("should report a webhook the cache has not seen as created", async () => {
		const guild = await Warmed([Hook("1")]);

		world = [Hook("1"), Hook("2", { name: "alerts" })];
		const result = await SyncChannelWebhooks(guild, CHANNEL);

		expect(result).toEqual({ changes: [{ kind: "create", after: expect.objectContaining({ id: "2", name: "alerts" }) }] });
	});

	it("should report a rename with the name from before the fetch", async () => {
		const guild = await Warmed([Hook("1")]);

		world = [Hook("1", { name: "releases" })];
		const result = await SyncChannelWebhooks(guild, CHANNEL);

		expect(result).toEqual({
			changes: [{ kind: "update", before: expect.objectContaining({ name: "deploys" }), after: expect.objectContaining({ name: "releases" }) }]
		});
	});

	it("should report nothing when the list matches the cache", async () => {
		const guild = await Warmed([Hook("1")]);

		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ changes: [] });
	});

	it("should report a missing webhook as deleted, and take it out of the cache", async () => {
		const guild = await Warmed([Hook("1"), Hook("2")]);

		world = [Hook("2")];
		const result = await SyncChannelWebhooks(guild, CHANNEL);

		expect(result).toEqual({ changes: [{ kind: "delete", before: expect.objectContaining({ id: "1" }) }] });
		expect(guild.webhooks.has("1")).toBe(false);

		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ changes: [] });
	});

	it("should leave another channel's webhooks alone", async () => {
		const guild = await Warmed([Hook("1"), Hook("2", { channel_id: OTHER })]);

		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ changes: [] });
		expect(guild.webhooks.has("2")).toBe(true);
	});

	it("should report a move once, when the old channel's event comes first", async () => {
		const guild = await Warmed([Hook("1")]);

		world = [Hook("1", { channel_id: OTHER })];
		const left = await SyncChannelWebhooks(guild, CHANNEL);
		const arrived = await SyncChannelWebhooks(guild, OTHER);

		expect(left).toEqual({
			changes: [{ kind: "update", before: expect.objectContaining({ channelId: CHANNEL }), after: expect.objectContaining({ channelId: OTHER }) }]
		});
		expect(arrived).toEqual({ changes: [] });
		expect(guild.webhooks.has("1")).toBe(true);
	});

	it("should report a move once, when the new channel's event comes first", async () => {
		const guild = await Warmed([Hook("1")]);

		world = [Hook("1", { channel_id: OTHER })];
		const arrived = await SyncChannelWebhooks(guild, OTHER);
		const left = await SyncChannelWebhooks(guild, CHANNEL);

		expect(arrived).toEqual({
			changes: [{ kind: "update", before: expect.objectContaining({ channelId: CHANNEL }), after: expect.objectContaining({ channelId: OTHER }) }]
		});
		expect(left).toEqual({ changes: [] });
	});

	it("should report a move once when both events are handled at the same time", async () => {
		const guild = await Warmed([Hook("1")]);

		world = [Hook("1", { channel_id: OTHER })];
		const results = await Promise.all([SyncChannelWebhooks(guild, CHANNEL), SyncChannelWebhooks(guild, OTHER)]);

		expect(results.flatMap((result) => "changes" in result ? result.changes : [])).toHaveLength(1);
	});

	it("should drop a deleted channel's webhooks without reporting them", async () => {
		const guild = await Warmed([Hook("1"), Hook("2", { channel_id: OTHER })]);

		Get.mockImplementationOnce(async () => { throw new DiscordAPIError("Unknown Channel", 404, 10003); });
		const result = await SyncChannelWebhooks(guild, CHANNEL);

		expect(result).toEqual({ changes: [] });
		expect([...guild.webhooks.keys()]).toEqual(["2"]);
	});

	it("should list the guild and report blind for a guild it never listed", async () => {
		const guild = FreshGuild();
		world = [Hook("1")];

		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ blind: "unsynced" });
		expect(guild.webhooks.has("1")).toBe(true);

		world = [Hook("1"), Hook("2")];
		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ changes: [{ kind: "create", after: expect.objectContaining({ id: "2" }) }] });
	});

	it("should report blind when Discord refuses the list", async () => {
		const guild = FreshGuild();
		world = Forbidden();

		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ blind: "unreadable" });
	});

	it("should fall back to blind, then re-list, when the permission is taken away and given back", async () => {
		const guild = await Warmed([Hook("1")]);

		world = Forbidden();
		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ blind: "unreadable" });

		world = [Hook("1"), Hook("2")];
		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ blind: "unsynced" });
		expect(await SyncChannelWebhooks(guild, CHANNEL)).toEqual({ changes: [] });
	});

	it("should not call a webhook deleted when checking on it fails for another reason", async () => {
		const guild = await Warmed([Hook("1")]);

		Get.mockImplementationOnce(async () => []).mockImplementationOnce(async () => { throw Forbidden(); });
		const result = await SyncChannelWebhooks(guild, CHANNEL);

		expect(result).toEqual({ changes: [] });
		expect(guild.webhooks.has("1")).toBe(true);
	});
});
