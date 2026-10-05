import { SelectHandler } from "../Types/InternalTypes.js";
import { BuildPanel } from "../Config/Panel.js";
import { IsEventGroup } from "../Config/Groups.js";
import { SetGroup } from "../CRUD/GuildEvents.js";

export default {
	customId: "config-channel",
	async execute(client, interaction, args) {
		const guild = interaction.guildId ? client.guilds.get(interaction.guildId) : undefined;
		if (!guild) {
			await interaction.reply({ content: "This panel only works in a server.", ephemeral: true });
			return;
		}

		const group = args[0];
		if (!group || !IsEventGroup(group)) {
			await interaction.reply({ content: `Unknown group "${group}".`, ephemeral: true });
			return;
		}

		const channelId = interaction.values[0];
		if (!channelId) {
			await interaction.reply({ content: "No channel was selected.", ephemeral: true });
			return;
		}

		SetGroup(BigInt(guild.id), group, BigInt(channelId), 1n);

		await interaction.update(BuildPanel(client, guild, group));
	}
} as SelectHandler;