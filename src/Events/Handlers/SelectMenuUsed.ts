import { ClientEvents } from "simplyjs";
import { EventHandler } from "../../Types/InternalTypes.js";
import { Log } from "../../Log.js";

export default {
	name: ClientEvents.SelectMenuUsed,
	async execute(client, interaction) {
		if (interaction.claimed) return;

		const args = interaction.customId.split(":");
		const customId = args.shift()!;

		const select = client.selects.get(customId);
		if (!select) {
			await interaction.reply(`Unknown select menu "${customId}" (args: ${args.join(', ')}`);
			return;
		}

		try {
			await select.execute(client, interaction, args);
		} catch (error) {
			Log('INFO', error);
			await interaction.reply("Something went wrong!");
		}
	}
} as EventHandler<typeof ClientEvents.SelectMenuUsed>;