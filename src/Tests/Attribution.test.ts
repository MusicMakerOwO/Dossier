import { describe, it, expect, vi, afterEach } from "vitest";
import { Client, ClientEvents, DiscordAuditLogEntry, DiscordAuditLogEvent, Guild } from "simplyjs";
import { AwaitAuditEntry, ObserveAuditEntry, RecordAuditEntry, ATTRIBUTION_WINDOW_MS, AuditAction } from "../Logs/Attribution.js";
import { auditLogEntryCreate } from "../Events/Internal/AuditLog.js";
import { FullClient } from "../Types/InternalTypes.js";

const client = new Client({ token: "test", intents: [] }) as FullClient;
client.on(auditLogEntryCreate.name, (...args) => void auditLogEntryCreate.execute(client, ...args));

let NextId = 1n;
function FreshId(): string {
	return (NextId++).toString();
}

function MakeEntry(action: AuditAction, targetId: string, userId = "900"): DiscordAuditLogEntry {
	return { id: FreshId(), action_type: action, target_id: targetId, user_id: userId };
}

function Emit(guildId: string, entry: DiscordAuditLogEntry): void {
	client.emit(ClientEvents.AuditLogEntryCreate, { id: guildId } as Guild, entry);
}

const KICK = DiscordAuditLogEvent.MEMBER_KICK;

afterEach(() => {
	vi.useRealTimers();
});

describe("AwaitAuditEntry", () => {
	it("should pair an entry that arrives after the event", async () => {
		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(KICK, target);

		const pending = AwaitAuditEntry(client, guild, KICK, target);
		Emit(guild, entry);

		expect(await pending).toBe(entry);
	});

	it("should pair an entry that arrives before the event", async () => {
		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(KICK, target);

		Emit(guild, entry);

		expect(await AwaitAuditEntry(client, guild, KICK, target)).toBe(entry);
	});

	it("should resolve null when no entry arrives in the window", async () => {
		vi.useFakeTimers();

		const pending = AwaitAuditEntry(client, FreshId(), KICK, FreshId());
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		expect(await pending).toBeNull();
	});

	it("should not cross-attribute back-to-back actions on different targets", async () => {
		const guild = FreshId();
		const first = FreshId();
		const second = FreshId();
		const firstEntry = MakeEntry(KICK, first, "901");
		const secondEntry = MakeEntry(KICK, second, "902");

		const pendingFirst = AwaitAuditEntry(client, guild, KICK, first);
		const pendingSecond = AwaitAuditEntry(client, guild, KICK, second);
		Emit(guild, secondEntry);
		Emit(guild, firstEntry);

		expect(await pendingFirst).toBe(firstEntry);
		expect(await pendingSecond).toBe(secondEntry);
	});

	it("should not match another guild or action type", async () => {
		vi.useFakeTimers();

		const guild = FreshId();
		const target = FreshId();

		const pending = AwaitAuditEntry(client, guild, KICK, target);
		Emit(FreshId(), MakeEntry(KICK, target));
		Emit(guild, MakeEntry(DiscordAuditLogEvent.MEMBER_BAN_ADD, target));
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		expect(await pending).toBeNull();
	});

	it("should hand an entry to exactly one event", async () => {
		vi.useFakeTimers();

		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(DiscordAuditLogEvent.MESSAGE_DELETE, target);

		const modDelete = AwaitAuditEntry(client, guild, DiscordAuditLogEvent.MESSAGE_DELETE, target);
		Emit(guild, entry);
		expect(await modDelete).toBe(entry);

		const selfDelete = AwaitAuditEntry(client, guild, DiscordAuditLogEvent.MESSAGE_DELETE, target);
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		expect(await selfDelete).toBeNull();
	});

	it("should not consume an early entry twice", async () => {
		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(KICK, target);

		RecordAuditEntry(guild, entry);
		expect(await AwaitAuditEntry(client, guild, KICK, target)).toBe(entry);

		vi.useFakeTimers();
		const again = AwaitAuditEntry(client, guild, KICK, target);
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		expect(await again).toBeNull();
	});

	it("should drop an early entry once it is older than the window", async () => {
		vi.useFakeTimers();

		const guild = FreshId();
		const target = FreshId();

		RecordAuditEntry(guild, MakeEntry(KICK, target));
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		const pending = AwaitAuditEntry(client, guild, KICK, target);
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		expect(await pending).toBeNull();
	});
});

describe("ObserveAuditEntry", () => {
	const BAN = DiscordAuditLogEvent.MEMBER_BAN_ADD;

	it("should see an early entry the claimer has already taken", async () => {
		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(BAN, target);

		Emit(guild, entry);
		expect(await AwaitAuditEntry(client, guild, BAN, target)).toBe(entry);
		expect(await ObserveAuditEntry(client, guild, BAN, target)).toBe(entry);
	});

	it("should see an entry that went straight to a waiting claimer", async () => {
		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(BAN, target);

		const claimed = AwaitAuditEntry(client, guild, BAN, target);
		Emit(guild, entry);

		expect(await ObserveAuditEntry(client, guild, BAN, target)).toBe(entry);
		expect(await claimed).toBe(entry);
	});

	it("should pair an entry that arrives after both events", async () => {
		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(BAN, target);

		const claimed = AwaitAuditEntry(client, guild, BAN, target);
		const observed = ObserveAuditEntry(client, guild, BAN, target);
		Emit(guild, entry);

		expect(await claimed).toBe(entry);
		expect(await observed).toBe(entry);
	});

	it("should leave the entry for the claimer when it observes first", async () => {
		const guild = FreshId();
		const target = FreshId();
		const entry = MakeEntry(BAN, target);

		const observed = ObserveAuditEntry(client, guild, BAN, target);
		Emit(guild, entry);

		expect(await observed).toBe(entry);
		expect(await AwaitAuditEntry(client, guild, BAN, target)).toBe(entry);
	});

	it("should resolve null when no entry arrives in the window", async () => {
		vi.useFakeTimers();

		const pending = ObserveAuditEntry(client, FreshId(), BAN, FreshId());
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		expect(await pending).toBeNull();
	});

	it("should drop an entry once it is older than the window", async () => {
		vi.useFakeTimers();

		const guild = FreshId();
		const target = FreshId();

		RecordAuditEntry(guild, MakeEntry(BAN, target));
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		const pending = ObserveAuditEntry(client, guild, BAN, target);
		await vi.advanceTimersByTimeAsync(ATTRIBUTION_WINDOW_MS);

		expect(await pending).toBeNull();
	});
});
