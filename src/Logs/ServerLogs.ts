import {
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordDefaultMessageNotificationLevels,
	DiscordExplicitContentFilterLevels,
	DiscordLocaleByLanguage,
	DiscordMFALevels,
	DiscordSystemChannelFlags,
	DiscordVerificationLevels,
	DiscordWebhookType,
	Guild,
	MediaGalleryBuilder,
	MediaGalleryItem,
	SectionBuilder,
	SeparatorBuilder,
	TextDisplayBuilder,
	ThumbnailBuilder,
	Webhook
} from "simplyjs";

import { COLOR } from "../Constants.js";
import { ActorLine, LogMessage, Name, SetDiff, TitleCase, Truncate } from "./Format.js";

/**
 * The fields a server log reads, copied before the handler's first await because the library
 * patches the cached guild in place. Unset fields are `null`. Boost count and member counts are
 * left out, since they change without anyone touching a setting.
 */
export type GuildSnapshot = {
	id: string;
	name: string;
	description: string | null;
	/** Image URLs, `null` when unset. A new image always gets a new URL, so these are compared directly. */
	iconURL: string | null;
	bannerURL: string | null;
	splashURL: string | null;
	discoverySplashURL: string | null;
	vanityUrlCode: string | null;
	preferredLocale: string;
	ownerId: string;
	verificationLevel: number;
	explicitContentFilter: number;
	mfaLevel: number;
	defaultMessageNotifications: number;
	invitesDisabledUntil: string | null;
	dmsDisabledUntil: string | null;
	raidDetectedAt: string | null;
	dmSpamDetectedAt: string | null;
	systemChannelId: string | null;
	systemChannelFlags: number;
	rulesChannelId: string | null;
	publicUpdatesChannelId: string | null;
	safetyAlertsChannelId: string | null;
	afkChannelId: string | null;
	afkTimeout: number;
	widgetEnabled: boolean;
	widgetChannelId: string | null;
	features: string[];
	premiumTier: number;
	premiumProgressBarEnabled: boolean;
};

export function SnapshotGuild(source: Guild): GuildSnapshot {
	return {
		id: source.id,
		name: source.name,
		description: source.description ?? null,
		iconURL: source.iconURL(),
		bannerURL: source.bannerURL(),
		splashURL: source.splashURL(),
		discoverySplashURL: source.discoverySplashURL(),
		vanityUrlCode: source.vanityUrlCode ?? null,
		preferredLocale: source.preferredLocale,
		ownerId: source.ownerId,
		verificationLevel: source.verificationLevel,
		explicitContentFilter: source.explicitContentFilter,
		mfaLevel: source.mfaLevel,
		defaultMessageNotifications: source.defaultMessageNotifications,
		invitesDisabledUntil: source.incidentsData?.invites_disabled_until ?? null,
		dmsDisabledUntil: source.incidentsData?.dms_disabled_until ?? null,
		raidDetectedAt: source.incidentsData?.raid_detected_at ?? null,
		dmSpamDetectedAt: source.incidentsData?.dm_spam_detected_at ?? null,
		systemChannelId: source.systemChannelId ?? null,
		systemChannelFlags: source.systemChannelFlags ?? 0,
		rulesChannelId: source.rulesChannelId ?? null,
		publicUpdatesChannelId: source.publicUpdatesChannelId ?? null,
		safetyAlertsChannelId: source.safetyAlertsChannelId ?? null,
		afkChannelId: source.afkChannelId ?? null,
		afkTimeout: source.afkTimeout,
		widgetEnabled: source.widgetEnabled ?? false,
		widgetChannelId: source.widgetChannelId ?? null,
		// Copied, so the snapshot does not share the guild's array
		features: [...(source.features ?? [])],
		premiumTier: source.premiumTier,
		premiumProgressBarEnabled: source.premiumProgressBarEnabled ?? false
	};
}

/** Character budget for all changed fields together, within Discord's 4,000 per v2 message. */
const FieldsLimit = 3000;
const DescriptionLimit = 300;

/** Returns one line per changed setting, most consequential first. */
export function DiffGuild(before: GuildSnapshot, after: GuildSnapshot): string[] {
	const lines: string[] = [];

	if (before.ownerId !== after.ownerId) lines.push(`**Owner** <@${before.ownerId}> → <@${after.ownerId}>`);
	if (before.name !== after.name) lines.push(`**Name** ${Name(before.name)} → ${Name(after.name)}`);

	if (before.verificationLevel !== after.verificationLevel) {
		lines.push(`**Verification level** ${Level(DiscordVerificationLevels, before.verificationLevel)} → ${Level(DiscordVerificationLevels, after.verificationLevel)}`);
	}

	if (before.explicitContentFilter !== after.explicitContentFilter) {
		lines.push(`**Media content filter** ${Level(DiscordExplicitContentFilterLevels, before.explicitContentFilter)} → ${Level(DiscordExplicitContentFilterLevels, after.explicitContentFilter)}`);
	}

	if (before.mfaLevel !== after.mfaLevel) {
		lines.push(`**2FA required for moderation** ${after.mfaLevel === DiscordMFALevels.ELEVATED ? "turned on" : "turned off"}`);
	}

	if (before.invitesDisabledUntil !== after.invitesDisabledUntil) {
		lines.push(after.invitesDisabledUntil ? `**Invites paused** until ${Timestamp(after.invitesDisabledUntil)}` : "**Invites resumed**");
	}

	if (before.dmsDisabledUntil !== after.dmsDisabledUntil) {
		lines.push(after.dmsDisabledUntil ? `**DMs between members paused** until ${Timestamp(after.dmsDisabledUntil)}` : "**DMs between members resumed**");
	}

	if (before.raidDetectedAt !== after.raidDetectedAt) {
		lines.push(after.raidDetectedAt ? `**Raid detected** by Discord at ${Timestamp(after.raidDetectedAt)}` : "**Raid alert cleared**");
	}

	if (before.dmSpamDetectedAt !== after.dmSpamDetectedAt) {
		lines.push(after.dmSpamDetectedAt ? `**DM spam detected** by Discord at ${Timestamp(after.dmSpamDetectedAt)}` : "**DM spam alert cleared**");
	}

	if (before.vanityUrlCode !== after.vanityUrlCode) lines.push(`**Vanity invite** ${Optional(before.vanityUrlCode)} → ${Optional(after.vanityUrlCode)}`);

	if (before.description !== after.description) {
		lines.push(`**Description** ${Optional(before.description, DescriptionLimit)} → ${Optional(after.description, DescriptionLimit)}`);
	}

	for (const [label, key] of ImageFields) {
		if (before[key] !== after[key]) lines.push(`**${label}** ${ImageChange(before[key], after[key])}`);
	}

	if (before.defaultMessageNotifications !== after.defaultMessageNotifications) {
		lines.push(`**Default notifications** ${Level(DiscordDefaultMessageNotificationLevels, before.defaultMessageNotifications)} → ${Level(DiscordDefaultMessageNotificationLevels, after.defaultMessageNotifications)}`);
	}

	for (const [label, key] of ChannelFields) {
		if (before[key] !== after[key]) lines.push(`**${label}** ${Channel(before[key])} → ${Channel(after[key])}`);
	}

	if (before.systemChannelFlags !== after.systemChannelFlags) {
		lines.push(`**System messages** ${SystemMessageMoves(before.systemChannelFlags, after.systemChannelFlags)}`);
	}

	if (before.afkTimeout !== after.afkTimeout) lines.push(`**Inactive timeout** ${Duration(before.afkTimeout)} → ${Duration(after.afkTimeout)}`);
	if (before.widgetEnabled !== after.widgetEnabled) lines.push(`**Server widget** ${after.widgetEnabled ? "turned on" : "turned off"}`);
	if (before.preferredLocale !== after.preferredLocale) lines.push(`**Primary language** ${Locale(before.preferredLocale)} → ${Locale(after.preferredLocale)}`);

	const [gained, lost] = SetDiff(before.features, after.features);
	if (gained.length > 0) lines.push(`**Features gained** ${gained.map(TitleCase).join(", ")}`);
	if (lost.length > 0) lines.push(`**Features lost** ${lost.map(TitleCase).join(", ")}`);

	if (before.premiumTier !== after.premiumTier) lines.push(`**Boost level** ${before.premiumTier} → ${after.premiumTier}`);

	if (before.premiumProgressBarEnabled !== after.premiumProgressBarEnabled) {
		lines.push(`**Boost progress bar** ${after.premiumProgressBarEnabled ? "turned on" : "turned off"}`);
	}

	return lines;
}

/** Builds the log for changed server settings. `before` is undefined when no earlier version is known, and the log says so. */
export function BuildGuildUpdateLog(before: GuildSnapshot | undefined, after: GuildSnapshot, fields: string[], entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(new TextDisplayBuilder().setContent(`### ✏️ Server settings changed\n**Server** ${Name(after.name)}\n${GuildActor(before, after, entry)}`));

	if (!before) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent("-# *No earlier version cached, so Dossier cannot tell what changed.*")
		);
	}

	if (fields.length > 0) {
		container.addComponents(
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Truncate(fields.join("\n"), FieldsLimit))
		);
	}

	const images = before ? NewImages(before, after) : [];
	if (images.length > 0) container.addComponents(new MediaGalleryBuilder().setItems(images));

	container.addComponents(new TextDisplayBuilder().setContent(`-# Server ${after.id}`));
	return { container, attachments: [] };
}

/**
 * Returns the actor line. Without an entry it says so with a hint where Discord changes the setting
 * itself and does not audit it: the boost level, and raid and DM spam detection.
 */
function GuildActor(before: GuildSnapshot | undefined, after: GuildSnapshot, entry: DiscordAuditLogEntry | null): string {
	if (entry?.user_id || !before) return ActorLine(entry);

	if (before.raidDetectedAt !== after.raidDetectedAt || before.dmSpamDetectedAt !== after.dmSpamDetectedAt) {
		return "**By** *(no audit entry, most likely Discord's own detection)*";
	}

	if (before.premiumTier !== after.premiumTier) return "**By** *(no audit entry, most likely a Server Boost change)*";
	return ActorLine(entry);
}

const ImageFields = [
	["Icon", "iconURL"],
	["Banner", "bannerURL"],
	["Invite background", "splashURL"],
	["Discovery background", "discoverySplashURL"]
] as const satisfies readonly (readonly [string, keyof GuildSnapshot])[];

const ChannelFields = [
	["System messages channel", "systemChannelId"],
	["Rules channel", "rulesChannelId"],
	["Community updates channel", "publicUpdatesChannelId"],
	["Safety alerts channel", "safetyAlertsChannelId"],
	["Inactive channel", "afkChannelId"],
	["Widget invite channel", "widgetChannelId"]
] as const satisfies readonly (readonly [string, keyof GuildSnapshot])[];

/** Returns a gallery item for each image that was set or replaced, captioned with which one it is. */
function NewImages(before: GuildSnapshot, after: GuildSnapshot): MediaGalleryItem[] {
	return ImageFields.flatMap(([label, key]) => {
		const url = after[key];
		return url !== null && url !== before[key] ? [{ media: { url }, description: `New ${label.toLowerCase()}` }] : [];
	});
}

/** Describes an image change as set, removed or replaced. */
function ImageChange(before: string | null, after: string | null): string {
	if (before === null) return "set";
	return after === null ? "removed" : "replaced";
}

/** `2` -> "Medium", by the constant's key. An unknown level prints as its number. */
function Level(levels: Record<string, number>, value: number): string {
	const key = Object.keys(levels).find((name) => levels[name] === value);
	return key ? TitleCase(key) : `level ${value}`;
}

/** Returns which system messages were switched on or off. Every flag is a `SUPPRESS_`, so a set bit means off. */
function SystemMessageMoves(before: number, after: number): string {
	const on: string[] = [];
	const off: string[] = [];

	for (const [key, bit] of Object.entries(DiscordSystemChannelFlags)) {
		const was = (before & bit) !== 0;
		const is = (after & bit) !== 0;
		if (was === is) continue;

		(is ? off : on).push(TitleCase(key.replace("SUPPRESS_", "")));
	}

	const parts: string[] = [];
	if (on.length > 0) parts.push(`✅ ${on.join(", ")}`);
	if (off.length > 0) parts.push(`❌ ${off.join(", ")}`);
	return parts.join(" · ");
}

function Channel(id: string | null): string {
	return id === null ? "*none*" : `<#${id}>`;
}

function Optional(text: string | null, limit?: number): string {
	if (!text) return "*none*";
	return Name(limit === undefined ? text : Truncate(text, limit));
}

/** Formats an ISO timestamp as Discord date markup. */
function Timestamp(iso: string): string {
	return `<t:${Math.floor(Date.parse(iso) / 1000)}:f>`;
}

function Duration(seconds: number): string {
	if (seconds < 60) return `${seconds} seconds`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
	const hours = Math.round(minutes / 60);
	return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** `en-US` -> "English US". An unknown locale prints as its code. */
function Locale(code: string): string {
	const languages: Record<string, string> = DiscordLocaleByLanguage;
	const key = Object.keys(languages).find((name) => languages[name] === code);
	return key ? key.replaceAll("_", " ") : Name(code);
}

/** The fields a webhook log reads. Never includes `token` or `url`, either of which lets anyone post as the webhook. */
export type WebhookSnapshot = {
	id: string;
	type: number;
	channelId: string | null;
	name: string | null;
	/** The avatar's hash, for comparing. `avatarURL` is what the log shows. */
	avatar: string | null;
	avatarURL: string | null;
	/** Whoever created it, when Discord sent one. */
	ownerId: string | null;
	/** What a follower webhook relays from. `null` for every other type. */
	source: { guildName: string | null; channelName: string | null } | null;
};

export function SnapshotWebhook(source: Webhook): WebhookSnapshot {
	const followed = source.sourceGuild || source.sourceChannel;

	return {
		id: source.id,
		type: source.type,
		channelId: source.channelId,
		name: source.name,
		avatar: source.avatar,
		avatarURL: source.avatarURL(),
		ownerId: source.owner?.id ?? null,
		source: followed ? { guildName: source.sourceGuild?.name ?? null, channelName: source.sourceChannel?.name ?? null } : null
	};
}

/** Returns one line per changed field, a channel move first. */
export function DiffWebhook(before: WebhookSnapshot, after: WebhookSnapshot): string[] {
	const lines: string[] = [];

	if (before.channelId !== after.channelId) lines.push(`**Channel** ${Channel(before.channelId)} → ${Channel(after.channelId)}`);
	if (before.name !== after.name) lines.push(`**Name** ${Name(before.name)} → ${Name(after.name)}`);
	if (before.avatar !== after.avatar) lines.push(`**Avatar** ${ImageChange(before.avatar, after.avatar)}`);

	return lines;
}

/** Builds the log for a new webhook. Without an audit entry, the owner on the webhook is named instead. */
export function BuildWebhookCreateLog(webhook: WebhookSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const actor = !entry?.user_id && webhook.ownerId ? `**By** <@${webhook.ownerId}>` : ActorLine(entry);

	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_CREATE)
		.addComponents(
			WebhookHeader(webhook, `### ➕ ${WebhookKind(webhook)} created\n${WebhookSubject(webhook)}\n${actor}`),
			WebhookFooter(webhook)
		);

	return { container, attachments: [] };
}

export function BuildWebhookUpdateLog(webhook: WebhookSnapshot, fields: string[], entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_UPDATE)
		.addComponents(
			WebhookHeader(webhook, `### ✏️ ${WebhookKind(webhook)} changed\n${WebhookSubject(webhook)}\n${ActorLine(entry)}`),
			new SeparatorBuilder().setDivider(),
			new TextDisplayBuilder().setContent(Truncate(fields.join("\n"), FieldsLimit)),
			WebhookFooter(webhook)
		);

	return { container, attachments: [] };
}

/** Builds the log for a deleted webhook, from the last version Dossier saw. */
export function BuildWebhookDeleteLog(webhook: WebhookSnapshot, entry: DiscordAuditLogEntry | null): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_DELETE)
		.addComponents(
			WebhookHeader(webhook, `### 🗑️ ${WebhookKind(webhook)} deleted\n${WebhookSubject(webhook)}\n${ActorLine(entry)}`),
			WebhookFooter(webhook)
		);

	return { container, attachments: [] };
}

/**
 * Why a webhook change is logged without saying what changed. `unsynced`: there was no list to
 * compare against yet. `unreadable`: Discord refused the list, usually for lack of Manage Webhooks.
 */
export type WebhookBlindReason = "unsynced" | "unreadable";

const BlindNotes = {
	unsynced: "Dossier had not listed this server's webhooks yet, so it cannot tell what changed. The next change will be reported in full.",
	unreadable: "Dossier could not list this channel's webhooks, so it cannot tell what changed. It needs the Manage Webhooks permission."
} as const satisfies Record<WebhookBlindReason, string>;

/** Builds the log for a webhook change that could not be identified. Uses the info color, since the kind of change is unknown. */
export function BuildWebhooksChangedLog(channelId: string, reason: WebhookBlindReason): LogMessage {
	const container = new ContainerBuilder()
		.setAccentColor(COLOR.LOG_INFO)
		.addComponents(
			new TextDisplayBuilder().setContent(`### 🔗 Webhooks changed\n**Channel** <#${channelId}>\nA webhook was created, changed or deleted here.`),
			new TextDisplayBuilder().setContent(`-# *${BlindNotes[reason]}*`)
		);

	return { container, attachments: [] };
}

/** Returns the header text, beside the webhook's avatar when it has one. */
function WebhookHeader(webhook: WebhookSnapshot, content: string): TextDisplayBuilder | SectionBuilder {
	const text = new TextDisplayBuilder().setContent(content);
	if (!webhook.avatarURL) return text;

	const thumbnail = new ThumbnailBuilder().setMedia(webhook.avatarURL);
	if (webhook.name) thumbnail.setDescription(webhook.name);
	return new SectionBuilder().addComponents(text).setAccessory(thumbnail);
}

/** Returns the webhook's type as Discord's UI names it. */
function WebhookKind(webhook: WebhookSnapshot): string {
	return webhook.type === DiscordWebhookType.ChannelFollower ? "Followed channel" : "Webhook";
}

function WebhookSubject(webhook: WebhookSnapshot): string {
	const subject = `**Webhook** ${Name(webhook.name)} in ${Channel(webhook.channelId)}`;
	if (!webhook.source) return subject;

	return `${subject}\n**Relays** ${Name(webhook.source.channelName)} from ${Name(webhook.source.guildName)}`;
}

function WebhookFooter(webhook: WebhookSnapshot): TextDisplayBuilder {
	return new TextDisplayBuilder().setContent(`-# Webhook ${webhook.id}`);
}
