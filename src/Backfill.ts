import { Guild } from "simplyjs";
import { RETENTION_MS } from "./Constants.js";
import { Log } from "./Log.js";
import { MarkGuildBackfilled } from "./CRUD/Guilds.js";
import { SimplifyMessage, SaveMessageBulk } from "./CRUD/Messages.js";

/** Messages fetched per channel. This is Discord's maximum for one request, and the backfill makes one request per channel. */
const PageSize = 100;

/** Set by {@link StopBackfill} and checked between channels. */
let Stopped = false;

/** Backfills that have not finished yet, so shutdown can wait for them. */
const InFlight = new Set<Promise<void>>();

/**
 * Stops every backfill and resolves once none of them can write to the database anymore. Await it
 * before closing the database.
 */
export async function StopBackfill(): Promise<void> {
	Stopped = true;
	await Promise.allSettled(InFlight);
}

/**
 * Stores the recent messages of every text and voice channel in a guild, one channel at a time, so
 * deletes can be logged right after the bot joins. Never throws.
 */
export function BackfillGuild(guild: Guild): Promise<void> {
	const walk = Walk(guild).finally(() => InFlight.delete(walk));
	InFlight.add(walk);
	return walk;
}

/** Fetches one page per channel and stores the messages still inside the retention window. */
async function Walk(guild: Guild): Promise<void> {
	const guild_id = BigInt(guild.id);

	const cutoff = BigInt(Date.now() - RETENTION_MS);

	let stored = 0;

	for (const channel of guild.channels.values()) {
		if (Stopped) break;
		if (!channel.isTextChannel() && !channel.isVoiceChannel()) continue;

		try {
			const page = await channel.messages.fetch({ limit: PageSize });

			const rows = page
				.map((message) => SimplifyMessage(message, guild_id))
				.filter((row) => row.created_at >= cutoff);

			SaveMessageBulk(rows);
			stored += rows.length;
		} catch (error) {
			Log('ERROR', error);
		}
	}

	if (Stopped) {
		Log('DEBUG', `Backfill of guild ${guild.id} stopped early after ${stored} message(s)`);
		return;
	}

	MarkGuildBackfilled(guild_id);
	Log('INFO', `Backfilled ${stored} message(s) from guild ${guild.name} (${guild.id})`);
}