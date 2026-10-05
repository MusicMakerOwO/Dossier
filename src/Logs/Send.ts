import { Client, Container, FileAttachment } from "simplyjs";
import { GetGuildEvent } from "../CRUD/GuildEvents.js";
import { LoggedEvent } from "../Config/Groups.js";
import { Log } from "../Log.js";

/**
 * Posts a log container to the channel the guild routed `event` to, and returns whether it was
 * posted. Never throws. Await it before deleting any attachment file the log re-uploads.
 */
export async function SendLog(client: Client, guildId: string, event: LoggedEvent, container: Container, attachments?: FileAttachment[]): Promise<boolean> {
	const config = GetGuildEvent(BigInt(guildId), event);
	if (!config || config.enabled !== 1n) return false;

	const channelId = config.channel_id.toString();

	try {
		const guild = client.guilds.get(guildId);
		if (!guild) return false;

		const channel = guild.channels.get(channelId) ?? await guild.channels.fetch(channelId);

		if (!channel.isTextChannel() && !channel.isVoiceChannel() && !channel.isThreadChannel()) {
			Log('WARN', `Guild ${guildId} routes ${event} to channel ${channelId}, which cannot receive messages`);
			return false;
		}

		await channel.send({
			components: [container],
			...(attachments?.length ? { attachments } : {}),
			// Logs quote user content, so nothing in one may ping
			allowed_mentions: { parse: [] }
		});

		return true;
	} catch (error) {
		Log('ERROR', `Failed to post ${event} log to channel ${channelId} in guild ${guildId}:`, error);
		return false;
	}
}
