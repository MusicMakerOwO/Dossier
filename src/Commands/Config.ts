import { DiscordPermissions, InteractionContextTypes, SlashCommandBuilder } from "simplyjs";
import { CommandHandler } from "../Types/InternalTypes.js";
import { BuildPanel } from "../Config/Panel.js";

export default {
	data: new SlashCommandBuilder()
		.setName("config")
		.setDescription("Choose what Dossier logs, and where it logs to")
		.setDefaultMemberPermissions(DiscordPermissions.MANAGE_GUILD)
		.setContexts(InteractionContextTypes.GUILD),

	async execute(client, interaction) {
		const guild = interaction.guildId ? client.guilds.get(interaction.guildId) : undefined;
		if (!guild) {
			await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
			return;
		}

		await interaction.reply({ ...BuildPanel(client, guild), ephemeral: true });
	}
} as CommandHandler;