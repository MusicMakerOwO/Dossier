import { ButtonHandler } from "../Types/InternalTypes.js";
import { EventDetails, EventGroup, GroupEvents, GroupMetadata, IsEventGroup } from "../Config/Groups.js";
import { ContainerBuilder, InteractionCallbackMessages, SeparatorBuilder, TextDisplayBuilder } from "simplyjs";
import { COLOR } from "../Constants.js";

export function BuildExplainer(group: EventGroup): InteractionCallbackMessages {
	const { label } = GroupMetadata[group];

	const lines = GroupEvents[group].map((event) => {
		const { label: name, description } = EventDetails[event];
		return `**${name}**\n-# ${description}`;
	});

	const container = new ContainerBuilder()
	.setAccentColor(COLOR.PRIMARY)
	.addComponents(
		new TextDisplayBuilder().setContent(
			`## ${label}\nDossier watches for all of the following, and writes each one to the channel you pick for this group.`
		),
		new SeparatorBuilder().setDivider(),
		new TextDisplayBuilder().setContent(lines.join("\n\n")),
		new SeparatorBuilder().setDivider(),
		new TextDisplayBuilder().setContent(
			"-# The group is switched on or off as a whole - one channel for everything above. Only you can see this message."
		)
	);

	return { components: [container] };
}


export default {
	customId: "config-explain",
	async execute(client, interaction, args) {
		const [group] = args;
		if (!group || !IsEventGroup(group)) {
			await interaction.reply({ content: `Unknown group "${group}".`, ephemeral: true });
			return;
		}
		await interaction.reply({ ...BuildExplainer(group), ephemeral: true });
	}
} as ButtonHandler;