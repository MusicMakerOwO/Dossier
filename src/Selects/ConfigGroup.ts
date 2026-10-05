import { SelectHandler } from "../Types/InternalTypes.js";
import { BuildPanel } from "../Config/Panel.js";
import { IsEventGroup } from "../Config/Groups.js";

export default {
	customId: "config-group",
	async execute(client, interaction) {
		const guild = interaction.guildId ? client.guilds.get(interaction.guildId) : undefined;
		if (!guild) {
			await interaction.reply({ content: "This panel only works in a server.", ephemeral: true });
			return;
		}

		const group = interaction.values[0];
		if (!group || !IsEventGroup(group)) {
			await interaction.reply({ content: `Unknown group "${group}".`, ephemeral: true });
			return;
		}

		await interaction.update(BuildPanel(client, guild, group));
	}
} as SelectHandler;