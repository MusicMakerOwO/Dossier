import { ClientEvents } from "simplyjs";
import { EventHandler } from "../../Types/InternalTypes.js";
import { Log } from "../../Log.js";

export default {
	name: ClientEvents.SlashCommandUsed,
	async execute(client, interaction) {
		if (interaction.claimed) return;

		const command = client.commands.get(interaction.commandName);
		if (!command) {
			await interaction.reply(`Unknown command "${interaction.commandName}"`);
			return;
		}

		try {
			await command.execute(client, interaction);
		} catch (error) {
			Log('ERROR', error);
			await interaction.reply("Something went wrong!");
		}
	}
} as EventHandler<typeof ClientEvents.SlashCommandUsed>;