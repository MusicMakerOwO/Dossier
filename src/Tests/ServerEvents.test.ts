import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	AuditLogEvents,
	Client,
	ClientEventMap,
	ClientEvents,
	DiscordGuild,
	DiscordGuildCreate,
	DiscordWebhookType,
	Guild,
	GuildUpdate
} from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";
import { WebhookSnapshot } from "../Logs/ServerLogs.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited } = vi.hoisted(() => ({ Awaited: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const { Synced } = vi.hoisted(() => ({ Synced: vi.fn() }));
vi.mock("../Logs/WebhookSync.js", () => ({ SyncChannelWebhooks: Synced }));

const Events = await import("../Events/Logs/Server.js");

const client = new Client({ token: "test", intents: [] }) as FullClient;

let NextGuild = 100n;
function Raw(fields: Partial<DiscordGuild> = {}): DiscordGuildCreate {
	return { id: (NextGuild++).toString(), name: "den", owner_id: "1", roles: [], emojis: [], features: [], ...fields } as unknown as DiscordGuildCreate;
}

/** Upserts `before`, then `changes` over it, and returns the arguments the library's update event would carry. */
function Update(changes: Partial<DiscordGuild>, before: DiscordGuildCreate = Raw()) {
	const old = client.guilds.upsert(before).clone();
	return [old, client.guilds.upsert({ ...before, ...changes } as DiscordGuildCreate)] as const;
}

/** The container a call to SendLog carried, as the text a mod would read. */
function Posted(call = 0): string {
	const container = Sent.mock.calls[call][3] as { components: unknown[] };
	return JSON.stringify(container.components);
}

function Hook(fields: Partial<WebhookSnapshot> = {}): WebhookSnapshot {
	return { id: "50", type: DiscordWebhookType.Incoming, channelId: "200", name: "deploys", avatar: null, avatarURL: null, ownerId: null, source: null, ...fields };
}

beforeEach(() => {
	Logged.mockClear();
	Awaited.mockReset().mockResolvedValue(null);
	Sent.mockReset().mockResolvedValue(true);
	Synced.mockReset().mockResolvedValue({ changes: [] });
});

describe("guildUpdate", () => {
	it("should wait on GUILD_UPDATE for the guild's own id", async () => {
		const [old, now] = Update({ name: "burrow" });
		await Events.guildUpdate.execute(client, old, now);

		expect(Awaited).toHaveBeenCalledWith(client, now.id, AuditLogEvents.GuildUpdate, now.id);
		expect(Sent).toHaveBeenCalledWith(client, now.id, "GuildUpdate", expect.anything());
		expect(Posted()).toContain("burrow");
	});

	it("should post nothing, and wait on nothing, for a boost count change", async () => {
		await Events.guildUpdate.execute(client, ...Update({ premium_subscription_count: 3 }));

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should still post when the earlier version was never cached", async () => {
		await Events.guildUpdate.execute(client, undefined, client.guilds.upsert(Raw()));

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("No earlier version cached");
	});

	it("should diff against the state at the time of the event, not after the audit wait", async () => {
		const before = Raw();
		const [old, now] = Update({ name: "burrow" }, before);

		Awaited.mockImplementationOnce(async () => {
			client.guilds.upsert({ ...before, name: "warren" } as DiscordGuildCreate);
			return null;
		});
		await Events.guildUpdate.execute(client, old, now);

		expect(Posted()).toContain("burrow");
		expect(Posted()).not.toContain("warren");
	});

	// Dispatched through the library, so its own before/after cloning is what gets tested
	it("should diff an update delivered by the library's own handler", async () => {
		const raw = Raw({ features: ["NEWS"] });
		client.guilds.upsert(raw);

		const pending: Promise<void>[] = [];
		const listener = (...args: ClientEventMap[typeof ClientEvents.GuildUpdate]): void => {
			pending.push(Events.guildUpdate.execute(client, ...args));
		};

		client.on(ClientEvents.GuildUpdate, listener);
		await GuildUpdate.handler(client, { ...raw, verification_level: 4, features: ["NEWS", "COMMUNITY"] } as unknown as DiscordGuild);
		client.off(ClientEvents.GuildUpdate, listener);
		await Promise.all(pending);

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("Very High");
		expect(Posted()).toContain("**Features gained** Community");
		expect(Posted()).not.toContain("No earlier version cached");
	});

	it("should log rather than throw when posting fails", async () => {
		Sent.mockRejectedValueOnce(new Error("boom"));

		await expect(Events.guildUpdate.execute(client, ...Update({ name: "burrow" }))).resolves.toBeUndefined();
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});

describe("webhooksUpdate", () => {
	const guild: Guild = client.guilds.upsert(Raw());
	const channel = { id: "200" };

	it("should wait on WEBHOOK_CREATE for a created webhook", async () => {
		Synced.mockResolvedValue({ changes: [{ kind: "create", after: Hook() }] });
		await Events.webhooksUpdate.execute(client, { guild, channel });

		expect(Synced).toHaveBeenCalledWith(guild, "200");
		expect(Awaited).toHaveBeenCalledWith(client, guild.id, AuditLogEvents.WebhookCreate, "50");
		expect(Sent).toHaveBeenCalledWith(client, guild.id, "WebhooksUpdate", expect.anything());
		expect(Posted()).toContain("Webhook created");
	});

	it("should wait on WEBHOOK_UPDATE for a changed webhook and list what changed", async () => {
		Synced.mockResolvedValue({ changes: [{ kind: "update", before: Hook(), after: Hook({ name: "releases" }) }] });
		await Events.webhooksUpdate.execute(client, { guild, channel });

		expect(Awaited).toHaveBeenCalledWith(client, guild.id, AuditLogEvents.WebhookUpdate, "50");
		expect(Posted()).toContain("Webhook changed");
		expect(Posted()).toContain("`deploys` → `releases`");
	});

	it("should wait on WEBHOOK_DELETE for a deleted webhook", async () => {
		Synced.mockResolvedValue({ changes: [{ kind: "delete", before: Hook() }] });
		await Events.webhooksUpdate.execute(client, { guild, channel });

		expect(Awaited).toHaveBeenCalledWith(client, guild.id, AuditLogEvents.WebhookDelete, "50");
		expect(Posted()).toContain("Webhook deleted");
	});

	it("should post one log per change", async () => {
		Synced.mockResolvedValue({ changes: [{ kind: "create", after: Hook({ id: "51" }) }, { kind: "delete", before: Hook({ id: "52" }) }] });
		await Events.webhooksUpdate.execute(client, { guild, channel });

		expect(Sent).toHaveBeenCalledTimes(2);
	});

	it("should post nothing when the sync found nothing", async () => {
		await Events.webhooksUpdate.execute(client, { guild, channel });

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should post the bare log, with no audit wait, when the sync was blind", async () => {
		Synced.mockResolvedValue({ blind: "unreadable" });
		await Events.webhooksUpdate.execute(client, { guild, channel });

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("Webhooks changed");
		expect(Posted()).toContain("<#200>");
		expect(Posted()).toContain("Manage Webhooks");
	});

	it("should do nothing for a guild the cache does not hold", async () => {
		await Events.webhooksUpdate.execute(client, { guild: { id: "999" }, channel });

		expect(Synced).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should log rather than throw when the sync fails", async () => {
		Synced.mockRejectedValueOnce(new Error("boom"));

		await expect(Events.webhooksUpdate.execute(client, { guild, channel })).resolves.toBeUndefined();
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});
