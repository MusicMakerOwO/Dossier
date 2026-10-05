import { AuditLogEvents, ClientEvents, Guild } from "simplyjs";
import { EventHandler, FullClient } from "../../Types/InternalTypes.js";
import { Log } from "../../Log.js";
import { AwaitAuditEntry } from "../../Logs/Attribution.js";
import { SendLog } from "../../Logs/Send.js";
import { SyncChannelWebhooks, WebhookChange } from "../../Logs/WebhookSync.js";
import {
	BuildGuildUpdateLog,
	BuildWebhookCreateLog,
	BuildWebhookDeleteLog,
	BuildWebhooksChangedLog,
	BuildWebhookUpdateLog,
	DiffGuild,
	DiffWebhook,
	SnapshotGuild
} from "../../Logs/ServerLogs.js";

/**
 * Logs what changed in the server's settings. When the diff is empty it posts nothing and does not
 * wait on the audit log, which is most updates: every boost fires this event.
 */
export const guildUpdate = {
	name: ClientEvents.GuildUpdate,
	async execute(client, old, now) {
		try {
			// Snapshot before the first await: `now` is the cached guild and can change during the audit wait
			const after = SnapshotGuild(now);
			const before = old ? SnapshotGuild(old) : undefined;

			const fields = before ? DiffGuild(before, after) : [];
			if (before && fields.length === 0) return;

			const entry = await AwaitAuditEntry(client, after.id, AuditLogEvents.GuildUpdate, after.id);
			await SendLog(client, after.id, "GuildUpdate", BuildGuildUpdateLog(before, after, fields, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.GuildUpdate>;

/**
 * Syncs the channel's webhooks and logs each change. The sync runs even when the log is off,
 * because it is also what keeps the webhook cache current.
 */
export const webhooksUpdate = {
	name: ClientEvents.WebhooksUpdate,
	async execute(client, { guild, channel }) {
		try {
			// An uncached guild has no webhook list to compare against
			if (!(guild instanceof Guild)) return;

			const result = await SyncChannelWebhooks(guild, channel.id);

			if ("blind" in result) {
				await SendLog(client, guild.id, "WebhooksUpdate", BuildWebhooksChangedLog(channel.id, result.blind).container);
				return;
			}

			await Promise.all(result.changes.map((change) => LogWebhookChange(client, guild.id, change)));
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.WebhooksUpdate>;

/** Logs one webhook change with whoever made it. */
async function LogWebhookChange(client: FullClient, guildId: string, change: WebhookChange): Promise<void> {
	if (change.kind === "create") {
		const entry = await AwaitAuditEntry(client, guildId, AuditLogEvents.WebhookCreate, change.after.id);
		await SendLog(client, guildId, "WebhooksUpdate", BuildWebhookCreateLog(change.after, entry).container);
		return;
	}

	if (change.kind === "delete") {
		const entry = await AwaitAuditEntry(client, guildId, AuditLogEvents.WebhookDelete, change.before.id);
		await SendLog(client, guildId, "WebhooksUpdate", BuildWebhookDeleteLog(change.before, entry).container);
		return;
	}

	const entry = await AwaitAuditEntry(client, guildId, AuditLogEvents.WebhookUpdate, change.after.id);
	const fields = DiffWebhook(change.before, change.after);
	await SendLog(client, guildId, "WebhooksUpdate", BuildWebhookUpdateLog(change.after, fields, entry).container);
}
