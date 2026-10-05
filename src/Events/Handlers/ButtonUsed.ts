import { ClientEvents } from "simplyjs";
import { EventHandler } from "../../Types/InternalTypes.js";
import { Log } from "../../Log.js";

export default {
	name: ClientEvents.ButtonUsed,
	async execute(client, interaction) {
		if (interaction.claimed) return;

		const args = interaction.customId.split(":");
		const customId = args.shift()!;

		const button = client.buttons.get(customId);
		if (!button) {
			await interaction.reply(`Unknown button "${customId}" (args: ${args.join(', ')}`);
			return;
		}

		try {
			await button.execute(client, interaction, args);
		} catch (error) {
			Log('ERROR', error);
			await interaction.reply("Something went wrong!");
		}
	}
} as EventHandler<typeof ClientEvents.ButtonUsed>;