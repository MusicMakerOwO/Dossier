import { AuditLogEvents, AutoModerationRuleCache, ClientEvents } from "simplyjs";
import { EventHandler, FullClient } from "../../Types/InternalTypes.js";
import { GetGuildEvent } from "../../CRUD/GuildEvents.js";
import { Log } from "../../Log.js";
import { AwaitAuditEntry } from "../../Logs/Attribution.js";
import { AutoModHit, QueueAutoModAction } from "../../Logs/AutoModBatch.js";
import { BuildAutoModLog, BuildBanLog, BuildUnbanLog } from "../../Logs/ModLogs.js";
import { SendLog } from "../../Logs/Send.js";

export const guildBanAdd = {
	name: ClientEvents.GuildBanAdd,
	async execute(client, guild, user) {
		try {
			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.GuildBanAdd, user.id);
			await SendLog(client, guild.id, "GuildBanAdd", BuildBanLog(user, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.GuildBanAdd>;

export const guildBanRemove = {
	name: ClientEvents.GuildBanRemove,
	async execute(client, guild, user) {
		try {
			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.GuildBanRemove, user.id);
			await SendLog(client, guild.id, "GuildBanRemove", BuildUnbanLog(user, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.GuildBanRemove>;

/** Queues an AutoMod action for the batched AutoMod log. */
export const autoModerationActionExecution = {
	name: ClientEvents.AutoModerationActionExecution,
	async execute(client, payload) {
		QueueAutoModAction(payload, (hit) => LogAutoMod(client, hit));
	}
} as EventHandler<typeof ClientEvents.AutoModerationActionExecution>;

async function LogAutoMod(client: FullClient, hit: AutoModHit): Promise<void> {
	try {
		// SendLog checks this too. Checking here skips the rule name request for a log nobody gets
		const logging = GetGuildEvent(BigInt(hit.guildId), "AutoModerationActionExecution")?.enabled === 1n;
		if (!logging) return;

		const guild = client.guilds.get(hit.guildId);
		if (!guild) return;

		const ruleName = await RuleName(guild.autoModerationRules, hit.ruleId);
		await SendLog(client, hit.guildId, "AutoModerationActionExecution", BuildAutoModLog(hit, ruleName).container);
	} catch (error) {
		Log('ERROR', error);
	}
}

/** Returns the rule's name, or `null` when it cannot be fetched (that needs MANAGE_GUILD). */
async function RuleName(rules: AutoModerationRuleCache, ruleId: string): Promise<string | null> {
	const cached = rules.get(ruleId);
	if (cached) return cached.name;

	try {
		return (await rules.fetch(ruleId)).name;
	} catch (error) {
		Log('TRACE', `Could not fetch AutoMod rule ${ruleId}:`, error);
		return null;
	}
}