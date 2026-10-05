import { ClientEvents } from "simplyjs";
import { EventHandler } from "../../Types/InternalTypes.js";
import { BackfillGuild } from "../../Backfill.js";
import { SaveGuild } from "../../CRUD/Guilds.js";
import { Log } from "../../Log.js";
import { WarmWebhooks } from "../../Logs/WebhookSync.js";

const errorLog = Log.bind(null, "ERROR");

export const guildJoin = {
	name: ClientEvents.GuildCreate,
	async execute(_client, guild) {
		// warm member cache in case of MemberRemove/MemberUpdate
		void guild.members.fetchGateway().catch(errorLog);
		void WarmWebhooks(guild).catch(errorLog);

		const inserted = SaveGuild(BigInt(guild.id))
		if (inserted) void BackfillGuild(guild).catch(errorLog);
	}
} as EventHandler<typeof ClientEvents.GuildCreate>;