import { Client, DiscordApplication, DiscordApplicationFlags, Guild, PermissionResolvable } from "simplyjs";

/**
 * The privileged intents Dossier identifies with, and the application flags that say each one is
 * switched on. Either flag will do: the plain one is set for verified bots, `_LIMITED` for bots
 * under 100 servers.
 */
const PRIVILEGED_INTENTS = {
	"Server Members": DiscordApplicationFlags.GATEWAY_GUILD_MEMBERS | DiscordApplicationFlags.GATEWAY_GUILD_MEMBERS_LIMITED,
	"Message Content": DiscordApplicationFlags.GATEWAY_MESSAGE_CONTENT | DiscordApplicationFlags.GATEWAY_MESSAGE_CONTENT_LIMITED
} as const;

/** Names the privileged intents an application's flags do not grant, as the Developer Portal labels them. */
export function MissingPrivilegedIntents(flags: number): string[] {
	return Object.entries(PRIVILEGED_INTENTS)
		.filter(([, granted]) => (flags & granted) === 0)
		.map(([name]) => name);
}

/** Fetches the bot's own application and returns its missing privileged intents. Works before login, and throws if the request fails. */
export async function CheckPrivilegedIntents(client: Client): Promise<string[]> {
	const application = await client.rest.get<DiscordApplication>("/applications/@me");
	return MissingPrivilegedIntents(application.flags ?? 0);
}

/**
 * Whether the bot holds every given guild-level permission. Returns true when that cannot be
 * determined, so the panel never warns about a setup that works.
 */
export function BotHasPermission(client: Client, guild: Guild, ...permissions: PermissionResolvable): boolean {
	const member = guild.members.get(client.id);
	if (!member) return true;

	return member.hasPermission(...permissions);
}
