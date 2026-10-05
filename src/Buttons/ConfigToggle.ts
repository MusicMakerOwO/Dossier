import { ButtonHandler } from "../Types/InternalTypes.js";
import { BuildPanel } from "../Config/Panel.js";
import { IsEventGroup } from "../Config/Groups.js";
import { SetEventGroupEnabled } from "../CRUD/GuildEvents.js";

export default {
	customId: "config-toggle",
	async execute(client, interaction, args) {
		const guild = interaction.guildId ? client.guilds.get(interaction.guildId) : undefined;
		if (!guild) {
			await interaction.reply({ content: "This panel only works in a server.", ephemeral: true });
			return;
		}

		const [group, state] = args;
		if (!group || !IsEventGroup(group)) {
			await interaction.reply({ content: `Unknown group "${group}".`, ephemeral: true });
			return;
		}

		if (state !== "on" && state !== "off") {
			await interaction.reply({ content: `Unknown toggle state "${state}".`, ephemeral: true });
			return;
		}

		SetEventGroupEnabled(BigInt(guild.id), group, state === "on" ? 1n : 0n);

		await interaction.update(BuildPanel(client, guild, group));
	}
} as ButtonHandler;