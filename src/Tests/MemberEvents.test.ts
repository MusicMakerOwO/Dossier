import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	AuditLogEvents,
	Client,
	ClientEventMap,
	ClientEvents,
	DiscordAuditLogEntry,
	DiscordGuildCreate,
	DiscordMember,
	DiscordUser,
	Guild,
	MemberDelete,
	MemberUpdate
} from "simplyjs";
import { FullClient } from "../Types/InternalTypes.js";
import { AuditAction } from "../Logs/Attribution.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const { Awaited, Observed } = vi.hoisted(() => ({ Awaited: vi.fn(), Observed: vi.fn() }));
vi.mock("../Logs/Attribution.js", () => ({ AwaitAuditEntry: Awaited, ObserveAuditEntry: Observed }));

const { Sent } = vi.hoisted(() => ({ Sent: vi.fn() }));
vi.mock("../Logs/Send.js", () => ({ SendLog: Sent }));

const Events = await import("../Events/Logs/Members.js");

const GUILD = "100";
const LATER = new Date(Date.now() + 3_600_000).toISOString();

const client = new Client({ token: "test", intents: [] }) as FullClient;
const guild: Guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

let NextId = 1000n;
function FreshId(): string {
	return (NextId++).toString();
}

function User(id: string, fields: Partial<DiscordUser> = {}): DiscordUser {
	return { id, username: "fox", discriminator: "0", global_name: null, avatar: null, ...fields } as DiscordUser;
}

function Member(id: string, fields: Partial<DiscordMember> = {}): DiscordMember {
	return { user: User(id), roles: [], joined_at: "2026-01-01T00:00:00.000Z", deaf: false, mute: false, flags: 0, ...fields };
}

/** Upserts `before`, then `after` over it, and returns the arguments the library's update event would carry. */
function Update(before: DiscordMember, after: DiscordMember) {
	const old = guild.members.upsert(before).clone();
	return [guild, old, guild.members.upsert(after)] as const;
}

function Entry(action: AuditAction, targetId: string, userId = "900"): DiscordAuditLogEntry {
	return { id: FreshId(), action_type: action, target_id: targetId, user_id: userId };
}

/** Makes the audit wait find an entry for `action` and nothing for anything else. */
function Audited(action: AuditAction, userId = "900"): void {
	Awaited.mockImplementation(async (_client, _guildId, asked: AuditAction, targetId: string) => asked === action ? Entry(action, targetId, userId) : null);
}

/** The container a call to SendLog carried, as the text a mod would read. */
function Posted(call = 0): string {
	const container = Sent.mock.calls[call][3] as { components: unknown[] };
	return JSON.stringify(container.components);
}

beforeEach(() => {
	Logged.mockClear();
	Awaited.mockReset().mockResolvedValue(null);
	Observed.mockReset().mockResolvedValue(null);
	Sent.mockReset().mockResolvedValue(true);
});

describe("memberCreate", () => {
	it("should post a human join without waiting on the audit log", async () => {
		await Events.memberCreate.execute(client, guild, guild.members.upsert(Member(FreshId())));

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "MemberCreate", expect.anything());
		expect(Posted()).toContain("Member joined");
	});

	it("should wait on BOT_ADD for a bot", async () => {
		const id = FreshId();
		Audited(AuditLogEvents.BotAdd, "901");
		await Events.memberCreate.execute(client, guild, guild.members.upsert(Member(id, { user: User(id, { bot: true }) })));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.BotAdd, id);
		expect(Posted()).toContain("**Added by** <@901>");
	});
});

describe("memberUpdate", () => {
	it("should wait on MEMBER_UPDATE alone for a nickname", async () => {
		const id = FreshId();
		Audited(AuditLogEvents.MemberUpdate);
		await Events.memberUpdate.execute(client, ...Update(Member(id), Member(id, { nick: "foxy" })));

		expect(Awaited).toHaveBeenCalledOnce();
		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.MemberUpdate, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "MemberUpdate", expect.anything());
		expect(Posted()).toContain("**By** <@900>");
	});

	it("should wait on MEMBER_ROLE_UPDATE alone for a role change", async () => {
		const id = FreshId();
		await Events.memberUpdate.execute(client, ...Update(Member(id), Member(id, { roles: ["5"] })));

		expect(Awaited).toHaveBeenCalledOnce();
		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.MemberRoleUpdate, id);
		expect(Posted()).toContain("**Roles added** <@&5>");
	});

	it("should not wait at all for a change the member made themselves", async () => {
		const id = FreshId();
		await Events.memberUpdate.execute(client, ...Update(Member(id), Member(id, { avatar: "abc" })));

		expect(Awaited).not.toHaveBeenCalled();
		expect(Posted()).toContain("**Server avatar** set");
	});

	it("should post nothing for an account change", async () => {
		const id = FreshId();
		await Events.memberUpdate.execute(client, ...Update(Member(id), Member(id, { user: User(id, { username: "wolf" }) })));

		expect(Awaited).not.toHaveBeenCalled();
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should post a timeout as its own log", async () => {
		const id = FreshId();
		Audited(AuditLogEvents.MemberUpdate);
		await Events.memberUpdate.execute(client, ...Update(Member(id), Member(id, { communication_disabled_until: LATER })));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.MemberUpdate, id);
		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("Member timed out");
	});

	it("should post a removed timeout", async () => {
		const id = FreshId();
		await Events.memberUpdate.execute(client, ...Update(Member(id, { communication_disabled_until: LATER }), Member(id, { communication_disabled_until: null })));

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("Timeout removed");
	});

	it("should not put the timeout's moderator on an unrelated change", async () => {
		const id = FreshId();
		Audited(AuditLogEvents.MemberUpdate);
		await Events.memberUpdate.execute(client, ...Update(Member(id), Member(id, { communication_disabled_until: LATER, premium_since: LATER })));

		expect(Sent).toHaveBeenCalledTimes(2);
		expect(Posted(0)).toContain("Member timed out");
		expect(Posted(0)).toContain("**By** <@900>");
		expect(Posted(1)).toContain("Started boosting");
		expect(Posted(1)).toContain("no audit entry");
	});

	it("should stay silent for an uncached member with no audit entry", async () => {
		const id = FreshId();
		await Events.memberUpdate.execute(client, guild, undefined, guild.members.upsert(Member(id)));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.MemberRoleUpdate, id);
		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.MemberUpdate, id);
		expect(Sent).not.toHaveBeenCalled();
	});

	it("should post for an uncached member when the audit log names someone", async () => {
		Audited(AuditLogEvents.MemberRoleUpdate);
		await Events.memberUpdate.execute(client, guild, undefined, guild.members.upsert(Member(FreshId())));

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("No earlier version cached");
		expect(Posted()).toContain("**By** <@900>");
	});

	// Dispatched through the library, so its own before/after cloning is what gets tested
	it("should diff a role grant delivered by the library's own handler", async () => {
		const id = FreshId();
		guild.members.upsert(Member(id, { roles: ["1"] }));

		const pending: Promise<void>[] = [];
		const listener = (...args: ClientEventMap[typeof ClientEvents.MemberUpdate]): void => {
			pending.push(Events.memberUpdate.execute(client, ...args));
		};

		client.on(ClientEvents.MemberUpdate, listener);
		await MemberUpdate.handler(client, { ...Member(id, { roles: ["1", "2"] }), guild_id: GUILD });
		client.off(ClientEvents.MemberUpdate, listener);
		await Promise.all(pending);

		expect(Sent).toHaveBeenCalledOnce();
		expect(Posted()).toContain("**Roles added** <@&2>");
		expect(Posted()).not.toContain("<@&1>");
	});
});

describe("memberDelete", () => {
	it("should log a leave when neither entry turns up", async () => {
		const id = FreshId();
		await Events.memberDelete.execute(client, guild, guild.members.upsert(Member(id)));

		expect(Awaited).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.MemberKick, id);
		expect(Observed).toHaveBeenCalledWith(client, GUILD, AuditLogEvents.GuildBanAdd, id);
		expect(Sent).toHaveBeenCalledWith(client, GUILD, "MemberDelete", expect.anything());
		expect(Posted()).toContain("Member left");
		expect(Posted()).not.toContain("**By**");
	});

	it("should log a kick with its moderator", async () => {
		Audited(AuditLogEvents.MemberKick, "901");
		await Events.memberDelete.execute(client, guild, guild.members.upsert(Member(FreshId())));

		expect(Posted()).toContain("Member kicked");
		expect(Posted()).toContain("**By** <@901>");
	});

	it("should log a ban from the entry it shares with the ban log", async () => {
		const id = FreshId();
		Observed.mockResolvedValue(Entry(AuditLogEvents.GuildBanAdd, id, "902"));
		await Events.memberDelete.execute(client, guild, guild.members.upsert(Member(id)));

		expect(Awaited).not.toHaveBeenCalledWith(client, GUILD, AuditLogEvents.GuildBanAdd, id);
		expect(Posted()).toContain("Member left (banned)");
		expect(Posted()).toContain("**By** <@902>");
	});

	it("should log an uncached member from the bare user", async () => {
		const id = FreshId();
		await Events.memberDelete.execute(client, guild, { id, guildId: GUILD, user: client.users.upsert(User(id, { username: "stranger" })) });

		expect(Posted()).toContain("`stranger`");
		expect(Posted()).toContain("Was not cached");
	});

	it("should list the roles of a cached member removed through the library's own handler", async () => {
		const id = FreshId();
		guild.members.upsert(Member(id, { roles: ["7"] }));

		const pending: Promise<void>[] = [];
		const listener = (...args: ClientEventMap[typeof ClientEvents.MemberDelete]): void => {
			pending.push(Events.memberDelete.execute(client, ...args));
		};

		client.on(ClientEvents.MemberDelete, listener);
		await MemberDelete.handler(client, { guild_id: GUILD, user: User(id) });
		client.off(ClientEvents.MemberDelete, listener);
		await Promise.all(pending);

		expect(guild.members.get(id)).toBeUndefined();
		expect(Posted()).toContain("**Roles** <@&7>");
	});

	it("should not throw when sending fails", async () => {
		Sent.mockRejectedValueOnce(new Error("boom"));
		await expect(Events.memberDelete.execute(client, guild, guild.members.upsert(Member(FreshId())))).resolves.toBeUndefined();
		expect(Logged).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});