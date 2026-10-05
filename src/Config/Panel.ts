import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyles,
	ChannelSelectBuilder,
	Client,
	ContainerBuilder,
	DiscordChannelTypes,
	Guild,
	InteractionCallbackMessages,
	SeparatorBuilder,
	StringSelectBuilder,
	TextDisplayBuilder
} from "simplyjs";

import { EventDetails, EventGroup, EventGroups, GroupEvents, GroupMetadata } from "./Groups.js";
import { GroupConfig } from "../Types/SimpleTypes.js";
import { COLOR } from "../Constants.js";
import { GetEventGroupConfig } from "../CRUD/GuildEvents.js";
import { BotHasPermission } from "./Preflight.js";

const StateGlyph = {
	on: "🟢",
	off: "⚫",
	partial: "🟡"
} as const satisfies Record<GroupConfig["state"], string>;

/** Channel kinds Dossier can actually post a log into. */
const LoggableChannelTypes = [
	DiscordChannelTypes.GUILD_TEXT,
	DiscordChannelTypes.GUILD_ANNOUNCEMENT,
	DiscordChannelTypes.GUILD_VOICE,
	DiscordChannelTypes.GUILD_STAGE_VOICE,
] as const;

/**
 * Whether the bot can post in the channel. Returns true when that cannot be determined, so the
 * panel never warns about a setup that works.
 */
function CanPostIn(client: Client, guild: Guild, channelId: bigint): boolean {
	const member = guild.members.get(client.id);
	const channel = guild.channels.get(String(channelId));
	if (!member || !channel) return true;

	return member.permissionsIn(channel).has("VIEW_CHANNEL", "SEND_MESSAGES");
}

/** One line of the at-a-glance readout, e.g. "🟢 **Messages** > 3 events | #mod-logs". */
function StatusLine(group: EventGroup, config: GroupConfig): string {
	const { label } = GroupMetadata[group];
	const count = GroupEvents[group].length;

	const destination = config.state === "off" || config.channel_id === null
		? "not logging"
		: `<#${config.channel_id}>`;

	return `${StateGlyph[config.state]} **${label}** > ${count} events | ${destination}`;
}

/**
 * Builds the whole `/config` panel for a guild from the database, optionally focused on one group.
 * Every config handler responds with this.
 */
export function BuildPanel(client: Client, guild: Guild, selectedGroup?: EventGroup): InteractionCallbackMessages {
	const configs = new Map<EventGroup, GroupConfig>();
	for (const group of EventGroups) {
		configs.set(group, GetEventGroupConfig(BigInt(guild.id), group));
	}

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.PRIMARY)
		.addComponents(
			new TextDisplayBuilder().setContent(
				"## Dossier - Logging Setup\nPick a group, then choose where it should log."
			),
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(
				EventGroups.map((group) => StatusLine(group, configs.get(group)!)).join("\n")
			),
			new SeparatorBuilder().setDivider()
		);

	if (!BotHasPermission(client, guild, "VIEW_AUDIT_LOG")) {
		container.addComponents(
			new TextDisplayBuilder().setContent(
				"⚠️ I don't have **View Audit Log** in this server - logs can't say who did something until I do."
			),
			new SeparatorBuilder().setDivider()
		);
	}

	const groupSelect = new StringSelectBuilder()
		.setCustomId("config-group")
		.setPlaceholder("Choose a group to configure");

	for (const group of EventGroups) {
		const { label, description } = GroupMetadata[group];
		groupSelect.addOption(label, group, {
			description,
			default: group === selectedGroup
		});
	}

	container.addComponents(new ActionRowBuilder().addComponents(groupSelect));

	if (selectedGroup !== undefined) {
		const config = configs.get(selectedGroup)!;
		const { label } = GroupMetadata[selectedGroup];

		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(DetailText(client, guild, selectedGroup, config, label))
		);

		const channelSelect = new ChannelSelectBuilder()
			.setCustomId(`config-channel:${selectedGroup}`)
			.setPlaceholder(`Where should ${label.toLowerCase()} go?`)
			.setChannelTypes(...LoggableChannelTypes);

		if (config.channel_id !== null) channelSelect.addDefaultChannels(String(config.channel_id));

		container.addComponents(
			new ActionRowBuilder().addComponents(channelSelect),
			new ActionRowBuilder().addComponents(
				new ButtonBuilder(ButtonStyles.SUCCESS)
					.setCustomId(`config-toggle:${selectedGroup}:on`)
					.setLabel("Enable")
					.setDisabled(config.channel_id === null || config.state === "on"),
				new ButtonBuilder(ButtonStyles.DANGER)
					.setCustomId(`config-toggle:${selectedGroup}:off`)
					.setLabel("Disable")
					.setDisabled(config.state === "off"),
				new ButtonBuilder(ButtonStyles.SECONDARY)
					.setCustomId(`config-explain:${selectedGroup}`)
					.setLabel("What gets logged?")
			)
		);
	}

	return { components: [container] };
}

/** The focused group's detail block: what it is doing now, and anything wrong with that. */
function DetailText(client: Client, guild: Guild, group: EventGroup, config: GroupConfig, label: string): string {
	const events = GroupEvents[group];
	const lines = [`### ${label}`, `-# ${events.map((event) => EventDetails[event].label).join(" \u{00B7} ")}`];

	const warnings: string[] = [];
	if (group === "server" && !BotHasPermission(client, guild, "MANAGE_WEBHOOKS")) {
		warnings.push("⚠️ I don't have **Manage Webhooks** in this server - a webhook change will only log as \"something changed in this channel\".");
	}

	if (config.channel_id === null) {
		lines.push("Pick a channel below to start logging this group.", ...warnings);
		return lines.join("\n");
	}

	lines.push(
		config.state === "on"
			? `Logging to <#${config.channel_id}>.`
			: config.state === "partial"
				// Only reachable once per-event overrides ship, later update
				? `Partly on - some events in this group are switched off individually. Logging to <#${config.channel_id}>.`
				: `Switched off. Will log to <#${config.channel_id}> when re-enabled.`
	);

	if (!CanPostIn(client, guild, config.channel_id)) {
		warnings.push(`⚠️ I can't post in <#${config.channel_id}> - I need **View Channel** and **Send Messages** there.`);
	}

	lines.push(...warnings);

	return lines.join("\n");
}