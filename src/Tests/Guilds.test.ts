import { describe, it, expect } from "vitest";
import { Database } from "../Database.js";
import { DeleteGuild, GetGuild, MarkGuildBackfilled, SaveGuild } from "../CRUD/Guilds.js";

// The table is not cleared between tests, so each test uses its own guild_id
let NextGuild = 1n;
function FreshGuild(): bigint {
	return NextGuild++;
}

const RawSelect = Database.prepare(
	"SELECT guild_id, first_seen_at, backfilled_at FROM Guilds WHERE guild_id = @guild_id"
);

describe("Guilds", () => {
	it("should report the first insert as new and every one after as known", () => {
		const guild_id = FreshGuild();

		expect(SaveGuild(guild_id)).toBe(true);
		expect(SaveGuild(guild_id)).toBe(false);
		expect(SaveGuild(guild_id)).toBe(false);
	});

	it("should not disturb first_seen_at on a repeat insert", () => {
		const guild_id = FreshGuild();

		SaveGuild(guild_id);
		const first = GetGuild(guild_id)!.first_seen_at;

		SaveGuild(guild_id);

		expect(GetGuild(guild_id)!.first_seen_at).toBe(first);
	});

	it("should store a new guild as not yet backfilled", () => {
		const guild_id = FreshGuild();
		SaveGuild(guild_id);

		expect(GetGuild(guild_id)).toEqual({
			guild_id,
			first_seen_at: expect.any(BigInt),
			backfilled_at: null
		});
	});

	it("should stamp backfilled_at once the walk finishes", () => {
		const guild_id = FreshGuild();
		SaveGuild(guild_id);

		MarkGuildBackfilled(guild_id);

		const row = GetGuild(guild_id)!;
		expect(row.backfilled_at).toEqual(expect.any(BigInt));
		expect(row.backfilled_at! >= row.first_seen_at).toBe(true);
	});

	it("should return undefined for a guild it has never seen", () => {
		expect(GetGuild(FreshGuild())).toBeUndefined();
	});

	it("should report whether a delete removed a row", () => {
		const guild_id = FreshGuild();
		SaveGuild(guild_id);

		expect(DeleteGuild(guild_id)).toBe(true);
		expect(DeleteGuild(guild_id)).toBe(false);
		expect(RawSelect.get({ guild_id })).toBeUndefined();
	});

	it("should treat a re-added guild as new", () => {
		const guild_id = FreshGuild();

		SaveGuild(guild_id);
		DeleteGuild(guild_id);

		expect(SaveGuild(guild_id)).toBe(true);
	});

	it("should store ids as integers rather than text", () => {
		const guild_id = FreshGuild();
		SaveGuild(guild_id);

		expect(RawSelect.get({ guild_id })).toMatchObject({ guild_id });
	});
});