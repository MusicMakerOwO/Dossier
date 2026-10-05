import { AuditLogEvents, Client, ClientEvents, createCollector, DiscordAuditLogEntry, ObjectValues } from "simplyjs";

export type AuditAction = ObjectValues<typeof AuditLogEvents>;

/**
 * How long an event waits for its audit entry, and how long an unclaimed entry is kept. An event
 * with no entry is delayed by this much before it logs.
 */
export const ATTRIBUTION_WINDOW_MS = 500;

type Buffered = { entry: DiscordAuditLogEntry; receivedAt: number };

// Entries that arrived before their event asked for them, oldest first
const early = new Map<string, Buffered>();

// How many events are waiting on each key. An entry for one of these goes straight to the waiter and is not buffered
const waiting = new Map<string, number>();

// Every entry inside the window, claimed or not, for ObserveAuditEntry
const recent = new Map<string, Buffered>();

function Key(guildId: string, action: AuditAction, targetId: string): string {
	return `${guildId}:${action}:${targetId}`;
}

function Prune(now: number): void {
	for (const [key, { receivedAt }] of early) {
		if (now - receivedAt < ATTRIBUTION_WINDOW_MS) break;
		early.delete(key);
	}

	for (const [key, { receivedAt }] of recent) {
		if (now - receivedAt < ATTRIBUTION_WINDOW_MS) break;
		recent.delete(key);
	}
}

/** Stores an audit entry for the event it belongs to. Called for every `AuditLogEntryCreate`. */
export function RecordAuditEntry(guildId: string, entry: DiscordAuditLogEntry): void {
	const now = Date.now();
	Prune(now);

	if (entry.target_id === null) return;

	const key = Key(guildId, entry.action_type, entry.target_id);

	// Must come before the waiting check: an entry that is about to be claimed still has to be observable
	recent.delete(key);
	recent.set(key, { entry, receivedAt: now });

	if (waiting.has(key)) return;

	early.delete(key);
	early.set(key, { entry, receivedAt: now });
}

/**
 * Returns the audit entry for an action on a target, or `null` if none arrives within the window.
 * The entry is claimed, so no other caller gets it. `null` usually means the user acted themselves.
 *
 * The buffer check and the collector are set up without an await between them, so an entry cannot
 * arrive in between and be missed by both.
 */
export function AwaitAuditEntry(client: Client, guildId: string, action: AuditAction, targetId: string): Promise<DiscordAuditLogEntry | null> {
	Prune(Date.now());

	const key = Key(guildId, action, targetId);
	const buffered = early.get(key);
	if (buffered) {
		early.delete(key);
		return Promise.resolve(buffered.entry);
	}

	waiting.set(key, (waiting.get(key) ?? 0) + 1);

	const collector = createCollector(client, ClientEvents.AuditLogEntryCreate, {
		filter: (guild, entry) => guild.id === guildId && entry.action_type === action && entry.target_id === targetId,
		time: ATTRIBUTION_WINDOW_MS,
		max: 1
	});

	return new Promise((resolve) => {
		collector.once("end", (collected) => {
			const count = (waiting.get(key) ?? 1) - 1;
			if (count === 0) waiting.delete(key);
			else waiting.set(key, count);

			resolve(collected[0]?.[1] ?? null);
		});
	});
}

/**
 * Returns the audit entry for an action without claiming it, or `null`. For an event that shares
 * its entry with another: a ban fires GuildBanAdd, which claims the entry, and MemberDelete, which
 * observes it.
 */
export function ObserveAuditEntry(client: Client, guildId: string, action: AuditAction, targetId: string): Promise<DiscordAuditLogEntry | null> {
	Prune(Date.now());

	const seen = recent.get(Key(guildId, action, targetId));
	if (seen) return Promise.resolve(seen.entry);

	// Not counted in `waiting`, or RecordAuditEntry would stop buffering the entry for the event that claims it
	const collector = createCollector(client, ClientEvents.AuditLogEntryCreate, {
		filter: (guild, entry) => guild.id === guildId && entry.action_type === action && entry.target_id === targetId,
		time: ATTRIBUTION_WINDOW_MS,
		max: 1
	});

	return new Promise((resolve) => {
		collector.once("end", (collected) => resolve(collected[0]?.[1] ?? null));
	});
}
