import { ClientEventMap } from "simplyjs";

/** The events in each group. Config is stored per event; a group is the unit the `/config` panel exposes. */
export const GroupEvents = {
	messages: ["MessageUpdate", "MessageDelete", "MessageDeleteBulk"],

	// No UserUpdate: Discord only sends it for the bot's own account (simplyjs-findings.md #14)
	members: ["MemberCreate", "MemberUpdate", "MemberDelete"],

	mod: ["GuildBanAdd", "GuildBanRemove", "AuditLogEntryCreate", "AutoModerationActionExecution"],

	channels: ["ChannelCreate", "ChannelUpdate", "ChannelDelete", "ThreadCreate", "ThreadUpdate", "ThreadDelete"],

	roles: ["RoleCreate", "RoleUpdate", "RoleDelete"],

	assets: [
		"EmojiCreate", "EmojiDelete", "EmojiUpdate",
		"StickerCreate", "StickerDelete", "StickerUpdate",
		"SoundboardSoundCreate", "SoundboardSoundUpdate", "SoundboardSoundDelete",
	],

	server: [
		"GuildUpdate",
		"WebhooksUpdate"
	]
} as const satisfies Record<string, readonly (keyof ClientEventMap)[]>;

export type EventGroup = keyof typeof GroupEvents;

export const EventGroups = Object.keys(GroupEvents) as EventGroup[];

/** An event that can be routed to a log channel. Narrower than ClientEventMap: MessageCreate, for one, is stored but never logged. */
export type LoggedEvent = (typeof GroupEvents)[EventGroup][number];

/** Display text for the group picker. Descriptions are capped at 100 characters by Discord. */
export const GroupMetadata = {
	messages: {
		label: "Messages",
		description: "Edits, deletions, and bulk deletions"
	},
	members: {
		label: "Members",
		description: "Joins, leaves, kicks, nicknames, roles, timeouts, and boosts"
	},
	mod: {
		label: "Moderation",
		description: "Bans, unbans, automod actions, and audit log attribution"
	},
	channels: {
		label: "Channels",
		description: "Channels and threads created, renamed, or deleted"
	},
	roles: {
		label: "Roles",
		description: "Roles created, edited, or deleted"
	},
	assets: {
		label: "Assets",
		description: "Emojis, stickers, and soundboards"
	},
	server: {
		label: "Server",
		description: "Server settings and webhooks"
	}
} as const satisfies Record<EventGroup, { label: string; description: string }>;

/** Whether a string names a real group, for narrowing a customId argument. */
export function IsEventGroup(value: string): value is EventGroup {
	return Object.hasOwn(GroupEvents, value);
}

/**
 * Plain-English name and description for every logged event, shown by the `/config` explainer.
 * Leaving an event out is a compile error.
 */
export const EventDetails = {
	MessageUpdate: {
		label: "Message edited",
		description: "Someone changes a message they already sent. The log keeps the old wording next to the new one."
	},
	MessageDelete: {
		label: "Message deleted",
		description: "A message is removed, by whoever wrote it or by a moderator. Discord does not tell anyone what it said, so Dossier shows the copy it saved."
	},
	MessageDeleteBulk: {
		label: "Messages cleared in bulk",
		description: "A lot of messages go at once - a moderator purge, or the cleanup that happens when someone is banned."
	},

	MemberCreate: {
		label: "Someone joined",
		description: "A new member arrives, with how old their Discord account is. Invites are not tracked."
	},
	MemberUpdate: {
		label: "A member's server profile changed",
		description: "Nickname changes, roles given or taken away, timeouts starting or ending, server avatars and boosts - anything that applies to *just* this server"
	},
	MemberDelete: {
		label: "Someone left",
		description: "A member is no longer in the server. Leaving on their own, being kicked and being banned all look the same to Discord, so the log says which it was when it can tell."
	},

	GuildBanAdd: {
		label: "Someone was banned",
		description: "A member is banned, with the reason if one was given and who did it."
	},
	GuildBanRemove: {
		label: "A ban was lifted",
		description: "Someone previously banned is allowed back."
	},
	AuditLogEntryCreate: {
		label: "Who did it",
		description: "Discord's own record of staff actions. Dossier reads it to put a name to things it would otherwise only see happen - who deleted the message, who changed the role."
	},
	AutoModerationActionExecution: {
		label: "AutoMod stepped in",
		description: "Discord's built-in word and spam filters blocked a message, flagged it, or timed the sender out."
	},

	ChannelCreate: {
		label: "Channel created",
		description: "A new channel or category is added."
	},
	ChannelUpdate: {
		label: "Channel settings changed",
		description: "A channel is renamed or moved, or its topic, slowmode or permissions change."
	},
	ChannelDelete: {
		label: "Channel deleted",
		description: "A channel or category is removed, along with everything in it."
	},
	ThreadCreate: {
		label: "Thread started",
		description: "A thread or forum post is opened. Threads are the side conversations that branch off a channel."
	},
	ThreadUpdate: {
		label: "Thread changed",
		description: "A thread is renamed, archived, locked, or has its tags changed."
	},
	ThreadDelete: {
		label: "Thread deleted",
		description: "A thread or forum post is removed."
	},

	RoleCreate: {
		label: "Role created",
		description: "A new role is added. Roles are the labels that decide what members can do."
	},
	RoleUpdate: {
		label: "Role changed",
		description: "A role is renamed or recoloured, or the permissions it grants change - worth watching, since this is how someone quietly gains power."
	},
	RoleDelete: {
		label: "Role deleted",
		description: "A role is removed, which takes it off everyone who had it."
	},

	EmojiCreate: {
		label: "Emoji added",
		description: "A custom emoji is uploaded to the server."
	},
	EmojiUpdate: {
		label: "Emoji renamed",
		description: "A custom emoji's name changes, which breaks anything that typed it out the old way."
	},
	EmojiDelete: {
		label: "Emoji removed",
		description: "A custom emoji is deleted from the server."
	},
	StickerCreate: {
		label: "Sticker added",
		description: "A custom sticker is uploaded to the server."
	},
	StickerUpdate: {
		label: "Sticker changed",
		description: "A custom sticker's name or description changes."
	},
	StickerDelete: {
		label: "Sticker removed",
		description: "A custom sticker is deleted from the server."
	},
	SoundboardSoundCreate: {
		label: "Soundboard created",
		description: "A custom soundboard is added to the server."
	},
	SoundboardSoundUpdate: {
		label: "Soundboard updated",
		description: "A custom soundboard's name or emoji changes."
	},
	SoundboardSoundDelete: {
		label: "Soundboard removed",
		description: "A custom soundboard is deleted from the server."
	},

	GuildUpdate: {
		label: "Server settings changed",
		description: "The server's name, icon, banner, or its rules for who may join and post."
	},
	WebhooksUpdate: {
		label: "Webhook added, changed or removed",
		description: "A webhook is a private link that lets an outside app, site or bot post messages into one channel without joining the server. Anyone holding the link can post as whatever name and picture they like, so new ones are worth knowing about."
	}
} as const satisfies Record<LoggedEvent, { label: string; description: string }>;