import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	AuditLogEvents,
	Client,
	ClientEventMap,
	ClientEvents,
	DiscordGuildCreate,
	DiscordPermissions,
	DiscordRole,
	Guild,
	RoleDelete,
	RoleUpdate
} from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";
import { REORDER_QUIET_MS } from "../Logs/ReorderBatch.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited } = vi.hoisted(() => ({ Awaited: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const Events = await import("../Events/Logs/Roles.js");

const GUILD = "100";

const client = new Client({ token: "test", intents: [] }) as FullClient;
const guild: Guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

let NextId = 1000n;
function FreshId(): string {
	return (NextId++).toString();
}

function Role(id: string, fields: Partial<DiscordRole> = {}): DiscordRole {
	return {
		id, name: "mods", color: 0, colors: { primary_color: 0, secondary_color: null, tertiary_color: null },
		hoist: false, position: 1, permissions: "0", managed: false, mentionable: false, flags: 0, ...fields
	};
}

/** Upserts `before`, then `after` over it, and returns the arguments the library's update event would carry. */
function Update(before: DiscordRole, after: DiscordRole) {
	const old = guild.roles.upsert(before).clone();
	return [guild, old, guild.roles.upsert(after)] as const;
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

describe("roleCreate", () => {
	it("should wait on ROLE_CREATE for the role's id", async () => {
		const id = FreshId();
		await Events.roleCreate.execute(client, guild, guild.roles.upsert(Role(id)));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.RoleCreate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "RoleCreate", expect.anything());
	});
});

describe("roleUpdate", () => {
	it("should wait on ROLE_UPDATE for a rename", async () => {
		const id = FreshId();
		await Events.roleUpdate.execute(client, ...Update(Role(id), Role(id, { name: "admins" })));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.RoleUpdate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "RoleUpdate", expect.anything());
	});

	it("should still post when the earlier version was never cached", async () => {
		await Events.roleUpdate.execute(client, guild, undefined, guild.roles.upsert(Role(FreshId())));

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("No earlier version cached");
	});

	// Dispatched through the library, so its own before/after cloning is what gets tested
	it("should diff a permission grant delivered by the library's own handler", async () => {
		const id = FreshId();
		guild.roles.upsert(Role(id));

		const pending: Promise<void>[] = [];
		const listener = (...args: ClientEventMap[typeof ClientEvents.RoleUpdate]): void => {
			pending.push(Events.roleUpdate.execute(client, ...args));
		};

		client.on(ClientEvents.RoleUpdate, listener);
		await RoleUpdate.handler(client, { guild_id: GUILD, role: Role(id, { permissions: DiscordPermissions.ADMINISTRATOR.toString() }) });
		client.off(ClientEvents.RoleUpdate, listener);
		await Promise.all(pending);

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("✅ Administrator");
		expect(Posted()).not.toContain("No earlier version cached");
	});
});

// Each test uses its own guild, because a batch reads the guild's whole role list
describe("role reorder", () => {
	let NextGuild = 500n;

	function FreshGuild(): Guild {
		return client.guilds.upsert({ id: (NextGuild++).toString(), name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);
	}

	/** Roles at positions 1..n, bottom first. */
	function Ladder(target: Guild, count: number): string[] {
		return Array.from({ length: count }, (_, index) => {
			const id = FreshId();
			target.roles.upsert(Role(id, { name: `r${index}`, position: index + 1 }));
			return id;
		});
	}

	/** The update the library would emit for `id` landing on `position`. */
	async function Shift(target: Guild, id: string, position: number, fields: Partial<DiscordRole> = {}): Promise<void> {
		const old = target.roles.get(id)!.clone();
		const now = target.roles.upsert(Role(id, { name: old.name, position, ...fields }));
		await Events.roleUpdate.execute(client, target, old, now);
	}

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should post nothing at the time of a position-only change", async () => {
		const target = FreshGuild();
		const [id] = Ladder(target, 2);

		await Shift(target, id, 3);

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should post one log naming only the role that was dragged", async () => {
		const target = FreshGuild();
		const ids = Ladder(target, 5);

		for (const [index, id] of ids.entries()) await Shift(target, id, index === 0 ? 5 : index);
		expect(Sent).not.toHaveBeenCalled();

		await vi.runAllTimersAsync();

		expect(Sent).toHaveBeenCalledOnce();
		expect(Sent).toHaveBeenCalledWith(client, target.id, "RoleUpdate", expect.anything());
		expect(Posted()).toContain(`<@&${ids[0]}> \`r0\` moved up from 5th to 1st`);
		expect(Posted()).toContain(`above <@&${ids[4]}>`);
		expect(Posted()).toContain("4 other roles shifted to make room");
		for (const id of ids.slice(1)) expect(Posted()).not.toContain(`<@&${id}> \``);
	});

	it("should keep the burst open while updates keep arriving", async () => {
		const target = FreshGuild();
		const ids = Ladder(target, 3);

		await Shift(target, ids[0], 3);
		await vi.advanceTimersByTimeAsync(REORDER_QUIET_MS - 50);
		await Shift(target, ids[1], 1);
		await vi.advanceTimersByTimeAsync(REORDER_QUIET_MS - 50);
		await Shift(target, ids[2], 2);

		expect(Sent).not.toHaveBeenCalled();
		await vi.runAllTimersAsync();
		expect(Sent).toHaveBeenCalledOnce();
	});

	it("should post nothing for the renumbering around a new role", async () => {
		const target = FreshGuild();
		const ids = Ladder(target, 2);

		const created = ((BigInt(Date.now()) - 1420070400000n) << 22n).toString();
		target.roles.upsert(Role(created, { position: 1 }));
		await Shift(target, ids[0], 2);
		await Shift(target, ids[1], 3);

		await vi.runAllTimersAsync();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should still log a rename made in the same edit straight away", async () => {
		const target = FreshGuild();
		const [id] = Ladder(target, 2);

		await Shift(target, id, 3, { name: "renamed" });
		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("`renamed`");

		await vi.runAllTimersAsync();
		expect(Sent).toHaveBeenCalledTimes(2);
		expect(Posted(1)).toContain("Roles reordered");
	});
});

describe("roleDelete", () => {
	it("should log an uncached role from its bare id", async () => {
		const id = FreshId();
		await Events.roleDelete.execute(client, guild, { id, guildId: GUILD });

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.RoleDelete, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "RoleDelete", expect.anything());
		expect(Posted()).toContain("name unknown");
	});

	it("should name a cached role deleted through the library's own handler", async () => {
		const id = FreshId();
		guild.roles.upsert(Role(id, { name: "gone" }));

		const pending: Promise<void>[] = [];
		const listener = (...args: ClientEventMap[typeof ClientEvents.RoleDelete]): void => {
			pending.push(Events.roleDelete.execute(client, ...args));
		};

		client.on(ClientEvents.RoleDelete, listener);
		await RoleDelete.handler(client, { guild_id: GUILD, role_id: id });
		client.off(ClientEvents.RoleDelete, listener);
		await Promise.all(pending);

		expect(guild.roles.get(id)).toBeUndefined();
		expect(Posted()).toContain("`gone`");
	});

	it("should not throw when sending fails", async () => {
		Sent.mockRejectedValueOnce(new Error("boom"));
		await expect(Events.roleDelete.execute(client, guild, guild.roles.upsert(Role(FreshId())))).resolves.toBeUndefined();
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});
