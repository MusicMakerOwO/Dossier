import { ClientEventMap } from "simplyjs";
import { Database } from "../Database.js";
import { EventGroup, GroupEvents } from "../Config/Groups.js";
import { DB_GuildEvent } from "../Types/DatabaseTypes.js";
import { GroupConfig } from "../Types/SimpleTypes.js";

/**
 * Each guild's event configuration, keyed by event name. A guild with no rows is cached as an
 * empty map; a guild missing from the cache has not been loaded yet.
 */
const Cache = new Map<bigint, Map<string, DB_GuildEvent>>();

const SelectGuild = Database.prepare(
	`SELECT guild_id, event_name, channel_id, enabled
	 FROM GuildEvents
	 WHERE guild_id = @guild_id`
);

const UpsertEvent = Database.prepare(
	`INSERT INTO GuildEvents (guild_id, event_name, channel_id, enabled)
	 VALUES (@guild_id, @event_name, @channel_id, @enabled)
	 ON CONFLICT (guild_id, event_name) DO UPDATE SET
		channel_id = excluded.channel_id,
		enabled    = excluded.enabled`
);

const UpdateEnabled = Database.prepare(
	`UPDATE GuildEvents
	 SET enabled = @enabled
	 WHERE guild_id = @guild_id AND event_name = @event_name`
);

const DeleteGuildRows = Database.prepare("DELETE FROM GuildEvents WHERE guild_id = @guild_id");

/**
 * Returns the guild's event configuration, loading it on first access. The map is the cached one,
 * so treat it as read-only.
 */
export function GetAllGuildEvents(guild_id: bigint): Map<string, DB_GuildEvent> {
	const cached = Cache.get(guild_id);
	if (cached !== undefined) return cached;

	const rows = SelectGuild.all({ guild_id }) as DB_GuildEvent[];

	const events = new Map<string, DB_GuildEvent>();
	for (const row of rows) events.set(row.event_name, row);

	Cache.set(guild_id, events);
	return events;
}

/** Returns the configuration for one event, or undefined if it was never configured. */
export function GetGuildEvent(guild_id: bigint, event_name: keyof ClientEventMap): DB_GuildEvent | undefined {
	return GetAllGuildEvents(guild_id).get(event_name);
}

/**
 * Collapses a group's per-event rows into a single on/off/partial state and channel. A group with
 * no rows is off with no channel.
 */
export function GetEventGroupConfig(guild_id: bigint, group: EventGroup): GroupConfig {
	const events = GetAllGuildEvents(guild_id);
	const names = GroupEvents[group];

	const rows: DB_GuildEvent[] = [];
	for (const name of names) {
		const row = events.get(name);
		if (row !== undefined) rows.push(row);
	}

	if (rows.length === 0) return { state: "off", channel_id: null };

	const enabled = rows.filter((row) => row.enabled === 1n);

	const channel_id = (enabled[0] ?? rows[0]).channel_id;

	const state = enabled.length === 0
		? "off"
		: (enabled.length === names.length ? "on" : "partial");

	return { state, channel_id };
}

/** Writes one event's row, creating it or overwriting it. */
export function SetGuildEvent(guild_id: bigint, event_name: keyof ClientEventMap, channel_id: bigint, enabled: 0n | 1n): void {
	UpsertEvent.run({ guild_id, event_name, channel_id, enabled });
	Cache.delete(guild_id);
}

/** Points every event in a group at a channel and sets its enabled state, in one transaction. */
export const SetGroup = Database.transaction((guild_id: bigint, group: EventGroup, channel_id: bigint, enabled: 0n | 1n): void => {
	for (const event_name of GroupEvents[group]) {
		UpsertEvent.run({ guild_id, event_name, channel_id, enabled });
	}
	Cache.delete(guild_id);
}) as (guild_id: bigint, group: EventGroup, channel_id: bigint, enabled: 0n | 1n) => void;

/**
 * Sets the enabled state of a group's existing rows and leaves their channel alone. Returns the
 * number of rows changed, which is 0 for a group that was never configured.
 */
export const SetEventGroupEnabled = Database.transaction((guild_id: bigint, group: EventGroup, enabled: 0n | 1n): number => {
	let changed = 0;
	for (const event_name of GroupEvents[group]) {
		changed += UpdateEnabled.run({ guild_id, event_name, enabled }).changes;
	}
	Cache.delete(guild_id);
	return changed;
}) as (guild_id: bigint, group: EventGroup, enabled: 0n | 1n) => number;

/** Deletes every row for a guild. */
export function DeleteGuildEvents(guild_id: bigint): number {
	const changes = DeleteGuildRows.run({ guild_id }).changes;
	Cache.delete(guild_id);
	return changes;
}