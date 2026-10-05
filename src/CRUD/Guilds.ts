import { Database } from "../Database.js";
import { DB_Guild } from "../Types/DatabaseTypes.js";

const SelectGuild = Database.prepare(
	`SELECT guild_id, first_seen_at, backfilled_at
	 FROM Guilds
	 WHERE guild_id = @guild_id`
);

// DO NOTHING, so a later GUILD_CREATE does not move first_seen_at
const InsertGuild = Database.prepare(
	`INSERT INTO Guilds (guild_id, first_seen_at, backfilled_at)
	 VALUES (@guild_id, @first_seen_at, NULL)
	 ON CONFLICT (guild_id) DO NOTHING`
);

const UpdateBackfilled = Database.prepare(
	"UPDATE Guilds SET backfilled_at = @backfilled_at WHERE guild_id = @guild_id"
);

const DeleteGuildRow = Database.prepare("DELETE FROM Guilds WHERE guild_id = @guild_id");

/** Returns the guild's row, or undefined if the bot has never seen it. */
export function GetGuild(guild_id: bigint): DB_Guild | undefined {
	return SelectGuild.get({ guild_id }) as DB_Guild | undefined;
}

/**
 * Records the guild as seen and returns whether it was new. SimplyJS emits `GuildCreate` for
 * every guild on every boot, so `false` means this is not a join.
 */
export function SaveGuild(guild_id: bigint): boolean {
	return InsertGuild.run({ guild_id, first_seen_at: BigInt(Date.now()) }).changes > 0;
}

/** Stamps the backfill as finished. A guild with this still NULL was interrupted partway. */
export function MarkGuildBackfilled(guild_id: bigint): void {
	UpdateBackfilled.run({ guild_id, backfilled_at: BigInt(Date.now()) });
}

/** Deletes the guild's row and returns whether there was one. */
export function DeleteGuild(guild_id: bigint): boolean {
	return DeleteGuildRow.run({ guild_id }).changes > 0;
}