import { DiscordAPIError, Guild } from "simplyjs";
import { Log } from "../Log.js";
import { DiffWebhook, SnapshotWebhook, WebhookBlindReason, WebhookSnapshot } from "./ServerLogs.js";

// WEBHOOKS_UPDATE only names a channel, so changes are found by re-listing it and diffing against the cache.

export type WebhookChange =
	| { kind: "create"; after: WebhookSnapshot }
	| { kind: "update"; before: WebhookSnapshot; after: WebhookSnapshot }
	| { kind: "delete"; before: WebhookSnapshot };

/** What a sync found, or why it could not look. */
export type WebhookSyncResult = { changes: WebhookChange[] } | { blind: WebhookBlindReason };

// Guilds whose webhook cache holds a full list. Without one, every existing webhook would look newly created
const warmed = new Set<string>();

// One sync at a time per guild, because moving a webhook changes two channels
const queues = new Map<string, Promise<unknown>>();

function Enqueue<T>(guildId: string, task: () => Promise<T>): Promise<T> {
	const run = (queues.get(guildId) ?? Promise.resolve()).then(task, task);

	// The stored tail never rejects, so one failed sync does not fail the ones queued behind it
	const tail = run.catch(() => {}).finally(() => {
		if (queues.get(guildId) === tail) queues.delete(guildId);
	});
	queues.set(guildId, tail);

	return run;
}

/** Whether the error is a 404. */
function IsGone(error: unknown): boolean {
	return error instanceof DiscordAPIError && error.status === 404;
}

/**
 * Lists every webhook in the guild so later changes have something to diff against, and returns
 * whether it could. Changes made while the bot was offline are not logged.
 */
export function WarmWebhooks(guild: Guild): Promise<boolean> {
	return Enqueue(guild.id, () => Warm(guild));
}

async function Warm(guild: Guild): Promise<boolean> {
	try {
		await guild.webhooks.fetchAll();
		warmed.add(guild.id);
		return true;
	} catch (error) {
		warmed.delete(guild.id);
		Log('WARN', `Could not list the webhooks of guild ${guild.id}:`, error);
		return false;
	}
}

/**
 * Re-lists a channel's webhooks and returns what changed. A guild that was never listed is listed
 * now and reported as blind.
 */
export function SyncChannelWebhooks(guild: Guild, channelId: string): Promise<WebhookSyncResult> {
	return Enqueue(guild.id, () => Sync(guild, channelId));
}

async function Sync(guild: Guild, channelId: string): Promise<WebhookSyncResult> {
	if (!warmed.has(guild.id)) {
		return { blind: await Warm(guild) ? "unsynced" : "unreadable" };
	}

	// Snapshot by value before the fetch: the cache patches webhooks in place
	const before = new Map([...guild.webhooks.values()].map((webhook) => [webhook.id, SnapshotWebhook(webhook)]));

	let listed: WebhookSnapshot[];
	try {
		listed = (await guild.webhooks.fetchChannel(channelId)).map(SnapshotWebhook);
	} catch (error) {
		// The channel was deleted along with its webhooks, which its own delete log covers
		if (IsGone(error)) {
			for (const old of before.values()) {
				if (old.channelId === channelId) guild.webhooks.delete(old.id);
			}
			return { changes: [] };
		}

		// Most likely Manage Webhooks was revoked. Unwarming makes the next sync re-list the guild
		warmed.delete(guild.id);
		Log('WARN', `Could not list the webhooks of channel ${channelId} in guild ${guild.id}:`, error);
		return { blind: "unreadable" };
	}

	const changes: WebhookChange[] = [];
	const present = new Set<string>();

	for (const after of listed) {
		present.add(after.id);

		const old = before.get(after.id);
		if (!old) changes.push({ kind: "create", after });
		else if (DiffWebhook(old, after).length > 0) changes.push({ kind: "update", before: old, after });
	}

	for (const old of before.values()) {
		if (old.channelId !== channelId || present.has(old.id)) continue;

		// Missing here means deleted or moved to another channel. Fetching the webhook tells which
		try {
			const after = SnapshotWebhook(await guild.webhooks.fetch(old.id));
			if (DiffWebhook(old, after).length > 0) changes.push({ kind: "update", before: old, after });
		} catch (error) {
			if (!IsGone(error)) {
				// fetchChannel already evicted it, so only a full re-list can bring it back
				warmed.delete(guild.id);
				Log('WARN', `Could not check on webhook ${old.id} in guild ${guild.id}:`, error);
				continue;
			}

			changes.push({ kind: "delete", before: old });
		}
	}

	return { changes };
}
