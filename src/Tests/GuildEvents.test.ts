import { describe, it, expect } from "vitest";
import { ClientEvents } from "simplyjs";
import { Database } from "../Database.js";
import { EventGroups, GroupEvents } from "../Config/Groups.js";
import {
	DeleteGuildEvents,
	GetEventGroupConfig,
	GetGuildEvent,
	SetEventGroupEnabled,
	SetGroup,
	SetGuildEvent
} from "../CRUD/GuildEvents.js";

// The module cache has no reset, so each test uses its own guild_id
let NextGuild = 1n;
function FreshGuild(): bigint {
	return NextGuild++;
}

const Channel = 555n;
const OtherChannel = 666n;

const RawSelect = Database.prepare(
	"SELECT event_name, channel_id, enabled FROM GuildEvents WHERE guild_id = @guild_id ORDER BY event_name"
);
const RawInsert = Database.prepare(
	"INSERT INTO GuildEvents (guild_id, event_name, channel_id, enabled) VALUES (@guild_id, @event_name, @channel_id, @enabled)"
);

describe("Groups map", () => {
	it("should only name events that exist on ClientEvents", () => {
		const known = new Set<string>(Object.values(ClientEvents));

		for (const group of EventGroups) {
			for (const event of GroupEvents[group]) {
				expect(known, `${group} -> ${event}`).toContain(event);
			}
		}
	});

	it("should not repeat an event across groups", () => {
		const owner = new Map<string, string>();

		for (const group of EventGroups) {
			for (const event of GroupEvents[group]) {
				expect(owner.get(event), `${event} is in both ${owner.get(event)} and ${group}`).toBeUndefined();
				owner.set(event, group);
			}
		}
	});

	it("should not expose MessageCreate as a toggleable event", () => {
		for (const group of EventGroups) {
			expect(GroupEvents[group]).not.toContain("MessageCreate");
		}
	});
});

describe("GuildEvents CRUD", () => {
	it("should write one row per event when a group is set", () => {
		const guild = FreshGuild();
		SetGroup(guild, "messages", Channel, 1n);

		const rows = RawSelect.all({ guild_id: guild }) as { event_name: string; channel_id: bigint; enabled: bigint }[];

		expect(rows.map((row) => row.event_name).sort()).toEqual([...GroupEvents.messages].sort());
		expect(rows.every((row) => row.channel_id === Channel)).toBe(true);
		expect(rows.every((row) => row.enabled === 1n)).toBe(true);
	});

	it("should report a fully written group as on", () => {
		const guild = FreshGuild();
		SetGroup(guild, "roles", Channel, 1n);

		expect(GetEventGroupConfig(guild, "roles")).toEqual({ state: "on", channel_id: Channel });
	});

	it("should report an unconfigured group as off with no destination", () => {
		expect(GetEventGroupConfig(FreshGuild(), "roles")).toEqual({ state: "off", channel_id: null });
	});

	it("should keep the destination when a group is switched off", () => {
		const guild = FreshGuild();
		SetGroup(guild, "roles", Channel, 1n);
		SetEventGroupEnabled(guild, "roles", 0n);

		expect(GetEventGroupConfig(guild, "roles")).toEqual({ state: "off", channel_id: Channel });
	});

	it("should switch a group back on without being given a channel again", () => {
		const guild = FreshGuild();
		SetGroup(guild, "roles", Channel, 1n);
		SetEventGroupEnabled(guild, "roles", 0n);
		SetEventGroupEnabled(guild, "roles", 1n);

		expect(GetEventGroupConfig(guild, "roles")).toEqual({ state: "on", channel_id: Channel });
	});

	it("should change nothing when enabling a group that was never configured", () => {
		const guild = FreshGuild();

		expect(SetEventGroupEnabled(guild, "roles", 1n)).toBe(0);
		expect(RawSelect.all({ guild_id: guild })).toHaveLength(0);
	});

	it("should report a group as partial when one of its events is off", () => {
		const guild = FreshGuild();
		SetGroup(guild, "roles", Channel, 1n);
		SetGuildEvent(guild, "RoleDelete", Channel, 0n);

		expect(GetEventGroupConfig(guild, "roles")).toEqual({ state: "partial", channel_id: Channel });
	});

	it("should prefer an enabled event's destination when a group's rows disagree", () => {
		const guild = FreshGuild();
		SetGroup(guild, "roles", Channel, 0n);
		SetGuildEvent(guild, "RoleDelete", OtherChannel, 1n);

		expect(GetEventGroupConfig(guild, "roles")).toEqual({ state: "partial", channel_id: OtherChannel });
	});

	it("should hand back a single event's row through Get", () => {
		const guild = FreshGuild();
		SetGroup(guild, "messages", Channel, 1n);

		expect(GetGuildEvent(guild, "MessageDelete")).toEqual({
			guild_id: guild,
			event_name: "MessageDelete",
			channel_id: Channel,
			enabled: 1n
		});

		expect(GetGuildEvent(guild, "RoleDelete")).toBeUndefined();
	});

	it("should keep guilds independent", () => {
		const first = FreshGuild();
		const second = FreshGuild();

		SetGroup(first, "roles", Channel, 1n);

		expect(GetEventGroupConfig(second, "roles")).toEqual({ state: "off", channel_id: null });
		expect(GetEventGroupConfig(first, "roles")).toEqual({ state: "on", channel_id: Channel });
	});

	it("should drop a guild's rows and forget it", () => {
		const guild = FreshGuild();
		SetGroup(guild, "roles", Channel, 1n);

		// Read first, so the cache is populated and the delete has something to invalidate
		expect(GetEventGroupConfig(guild, "roles").state).toBe("on");

		expect(DeleteGuildEvents(guild)).toBe(GroupEvents.roles.length);
		expect(GetEventGroupConfig(guild, "roles")).toEqual({ state: "off", channel_id: null });
		expect(RawSelect.all({ guild_id: guild })).toHaveLength(0);
	});
});

describe("GuildEvents cache", () => {
	it("should reflect a write made after the guild was cached", () => {
		const guild = FreshGuild();

		expect(GetEventGroupConfig(guild, "roles").state).toBe("off");
		SetGroup(guild, "roles", Channel, 1n);

		expect(GetEventGroupConfig(guild, "roles")).toEqual({ state: "on", channel_id: Channel });
	});

	it("should keep serving a cached guild after a row appears out of band", () => {
		const guild = FreshGuild();
		expect(GetEventGroupConfig(guild, "roles").state).toBe("off");

		RawInsert.run({ guild_id: guild, event_name: "RoleCreate", channel_id: Channel, enabled: 1n });

		expect(GetEventGroupConfig(guild, "roles").state).toBe("off");
	});
});

describe("GuildEvents transactions", () => {
	it("should leave no rows behind when a group write fails partway through", () => {
		const guild = FreshGuild();

		Database.exec(`
			CREATE TRIGGER TestBlockStickerDelete BEFORE INSERT ON GuildEvents
			WHEN NEW.event_name = 'StickerDelete'
			BEGIN SELECT RAISE(ABORT, 'blocked by test'); END;
		`);

		try {
			expect(() => SetGroup(guild, "assets", Channel, 1n)).toThrow(/blocked by test/);
		} finally {
			Database.exec("DROP TRIGGER TestBlockStickerDelete");
		}

		expect(RawSelect.all({ guild_id: guild })).toHaveLength(0);
		expect(GetEventGroupConfig(guild, "assets")).toEqual({ state: "off", channel_id: null });
	});
});