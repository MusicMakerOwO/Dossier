import { describe, it, expect } from "vitest";
import {
	AuditLogEvents,
	Client,
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordGuildCreate,
	DiscordSystemChannelFlags,
	DiscordVerificationLevels,
	DiscordWebhook,
	DiscordWebhookType,
	MAX_V2_CONTENT_LENGTH,
	ResolveComponentsV2Flags,
	SummarizeComponents
} from "simplyjs";
import { COLOR } from "../Constants.js";
import { LogMessage } from "../Logs/Format.js";
import {
	BuildGuildUpdateLog,
	BuildWebhookCreateLog,
	BuildWebhookDeleteLog,
	BuildWebhooksChangedLog,
	BuildWebhookUpdateLog,
	DiffGuild,
	DiffWebhook,
	GuildSnapshot,
	SnapshotGuild,
	SnapshotWebhook,
	WebhookSnapshot
} from "../Logs/ServerLogs.js";

const GUILD = "100";

function Server(fields: Partial<GuildSnapshot> = {}): GuildSnapshot {
	return {
		id: GUILD, name: "den", description: null, icon: null, banner: null, splash: null, discoverySplash: null,
		vanityUrlCode: null, preferredLocale: "en-US", ownerId: "1", verificationLevel: 0, explicitContentFilter: 0,
		mfaLevel: 0, defaultMessageNotifications: 0, invitesDisabledUntil: null, dmsDisabledUntil: null,
		raidDetectedAt: null, dmSpamDetectedAt: null, systemChannelId: null, systemChannelFlags: 0, rulesChannelId: null,
		publicUpdatesChannelId: null, safetyAlertsChannelId: null, afkChannelId: null, afkTimeout: 300,
		widgetEnabled: false, widgetChannelId: null, features: [], premiumTier: 0, premiumProgressBarEnabled: false, ...fields
	};
}

function Hook(fields: Partial<WebhookSnapshot> = {}): WebhookSnapshot {
	return { id: "50", type: DiscordWebhookType.Incoming, channelId: "200", name: "deploys", avatar: null, avatarURL: null, ownerId: null, source: null, ...fields };
}

function Entry(action: DiscordAuditLogEntry["action_type"], userId = "900"): DiscordAuditLogEntry {
	return { id: "1", action_type: action, target_id: "50", user_id: userId };
}

/** Every line of text in the container, including text that sits beside a thumbnail. */
function Text(container: ContainerBuilder): string {
	return container.components.flatMap((child) => {
		if ("content" in child) return [child.content];
		if ("accessory" in child) return child.components.map((text) => text.content);
		return [];
	}).join("\n");
}

function HasThumbnail(container: ContainerBuilder): boolean {
	return container.components.some((child) => "accessory" in child);
}

/** Runs the library's send-path validation on the log. */
function Sendable(log: LogMessage): number | undefined {
	return ResolveComponentsV2Flags({ components: [log.container], attachments: log.attachments });
}

describe("SnapshotGuild", () => {
	const client = new Client({ token: "test", intents: [] });

	it("should read unset optional fields as null rather than undefined", () => {
		const guild = client.guilds.upsert({ id: "101", name: "g", owner_id: "1", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

		expect(SnapshotGuild(guild)).toMatchObject({
			id: "101", name: "g", ownerId: "1", icon: null, description: null, systemChannelId: null,
			invitesDisabledUntil: null, widgetEnabled: false, systemChannelFlags: 0
		});
	});

	it("should not share the features list with the live guild", () => {
		const guild = client.guilds.upsert({ id: "102", name: "g", roles: [], emojis: [], features: ["COMMUNITY"] } as unknown as DiscordGuildCreate);
		const snapshot = SnapshotGuild(guild);

		guild.features.push("DISCOVERABLE");

		expect(snapshot.features).toEqual(["COMMUNITY"]);
	});

	it("should flatten the incident data", () => {
		const guild = client.guilds.upsert({
			id: "103", name: "g", roles: [], emojis: [], features: [],
			incidents_data: { invites_disabled_until: "2026-10-05T00:00:00.000Z", raid_detected_at: null }
		} as unknown as DiscordGuildCreate);

		expect(SnapshotGuild(guild)).toMatchObject({ invitesDisabledUntil: "2026-10-05T00:00:00.000Z", raidDetectedAt: null, dmsDisabledUntil: null });
	});
});

describe("DiffGuild", () => {
	it("should report nothing for two identical snapshots", () => {
		expect(DiffGuild(Server(), Server())).toEqual([]);
	});

	it("should put an owner transfer ahead of everything else", () => {
		const lines = DiffGuild(Server(), Server({ name: "burrow", ownerId: "2" }));

		expect(lines).toEqual(["**Owner** <@1> → <@2>", "**Name** `den` → `burrow`"]);
	});

	it("should name levels by their constant, not their number", () => {
		const lines = DiffGuild(Server(), Server({
			verificationLevel: DiscordVerificationLevels.VERY_HIGH, explicitContentFilter: 1, mfaLevel: 1, defaultMessageNotifications: 1
		}));

		expect(lines).toEqual([
			"**Verification level** None → Very High",
			"**Media content filter** Disabled → Members Without Roles",
			"**2FA required for moderation** turned on",
			"**Default notifications** All Messages → Only Mentions"
		]);
	});

	it("should fall back to the number for a level the library does not know", () => {
		expect(DiffGuild(Server(), Server({ verificationLevel: 9 }))).toEqual(["**Verification level** None → level 9"]);
	});

	it("should report images by which way they changed, never by hash", () => {
		const lines = DiffGuild(Server({ banner: "aaa", splash: "bbb" }), Server({ icon: "ccc", banner: "ddd" }));

		expect(lines).toEqual(["**Icon** set", "**Banner** replaced", "**Invite background** removed"]);
	});

	it("should report a paused and a resumed invite window", () => {
		const until = "2026-10-05T00:00:00.000Z";

		expect(DiffGuild(Server(), Server({ invitesDisabledUntil: until }))).toEqual([`**Invites paused** until <t:${Date.parse(until) / 1000}:f>`]);
		expect(DiffGuild(Server({ invitesDisabledUntil: until }), Server())).toEqual(["**Invites resumed**"]);
	});

	it("should report channels as mentions, and an unset one as none", () => {
		const lines = DiffGuild(Server({ rulesChannelId: "7" }), Server({ systemChannelId: "5" }));

		expect(lines).toEqual(["**System messages channel** *none* → <#5>", "**Rules channel** <#7> → *none*"]);
	});

	it("should read a suppress flag being set as the message being turned off", () => {
		const lines = DiffGuild(
			Server({ systemChannelFlags: DiscordSystemChannelFlags.SUPPRESS_PREMIUM_SUBSCRIPTIONS }),
			Server({ systemChannelFlags: DiscordSystemChannelFlags.SUPPRESS_JOIN_NOTIFICATIONS })
		);

		expect(lines).toEqual(["**System messages** ✅ Premium Subscriptions · ❌ Join Notifications"]);
	});

	it("should report features gained and lost", () => {
		const lines = DiffGuild(Server({ features: ["COMMUNITY", "NEWS"] }), Server({ features: ["NEWS", "INVITES_DISABLED"] }));

		expect(lines).toEqual(["**Features gained** Invites Disabled", "**Features lost** Community"]);
	});

	it("should report the rest of the settings page", () => {
		const lines = DiffGuild(
			Server({ description: "old" }),
			Server({ vanityUrlCode: "foxes", afkTimeout: 3600, widgetEnabled: true, preferredLocale: "de", premiumTier: 2, premiumProgressBarEnabled: true })
		);

		expect(lines).toEqual([
			"**Vanity invite** *none* → `foxes`",
			"**Description** `old` → *none*",
			"**Inactive timeout** 5 minutes → 1 hour",
			"**Server widget** turned on",
			"**Primary language** English US → German",
			"**Boost level** 0 → 2",
			"**Boost progress bar** turned on"
		]);
	});
});

describe("BuildGuildUpdateLog", () => {
	it("should be an amber log naming the server and the actor", () => {
		const log = BuildGuildUpdateLog(Server(), Server({ name: "burrow" }), ["**Name** `den` → `burrow`"], Entry(AuditLogEvents.GuildUpdate));

		expect(log.container.accent_color).toBe(COLOR.LOG_UPDATE);
		expect(Text(log.container)).toContain("Server settings changed");
		expect(Text(log.container)).toContain("**Server** `burrow`");
		expect(Text(log.container)).toContain("**By** <@900>");
		expect(Text(log.container)).toContain(`-# Server ${GUILD}`);
		expect(Sendable(log)).toBeDefined();
	});

	it("should say so when there was no earlier version", () => {
		expect(Text(BuildGuildUpdateLog(undefined, Server(), [], null).container)).toContain("No earlier version cached");
	});

	it("should hedge a boost level change that nobody is on record for", () => {
		const log = BuildGuildUpdateLog(Server(), Server({ premiumTier: 1 }), ["**Boost level** 0 → 1"], null);

		expect(Text(log.container)).toContain("most likely a Server Boost change");
	});

	it("should hedge Discord's own raid detection", () => {
		const log = BuildGuildUpdateLog(Server(), Server({ raidDetectedAt: "2026-10-05T00:00:00.000Z" }), ["**Raid detected**"], null);

		expect(Text(log.container)).toContain("most likely Discord's own detection");
	});

	it("should not hedge when the audit log names someone", () => {
		const log = BuildGuildUpdateLog(Server(), Server({ premiumTier: 1 }), ["**Boost level** 0 → 1"], Entry(AuditLogEvents.GuildUpdate));

		expect(Text(log.container)).toContain("**By** <@900>");
	});

	it("should stay inside the v2 content limit when everything changed at once", () => {
		const fields = Array.from({ length: 200 }, (_, index) => `**Field ${index}** ${"x".repeat(40)}`);
		const log = BuildGuildUpdateLog(Server(), Server(), fields, null);

		expect(SummarizeComponents([log.container]).contentLength).toBeLessThanOrEqual(MAX_V2_CONTENT_LENGTH);
	});
});

describe("SnapshotWebhook", () => {
	const client = new Client({ token: "test", intents: [] });
	const guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

	function Raw(fields: Partial<DiscordWebhook> = {}): DiscordWebhook {
		return { id: "50", type: DiscordWebhookType.Incoming, guild_id: GUILD, channel_id: "200", name: "deploys", avatar: null, application_id: null, ...fields };
	}

	it("should never carry the token or the execute url", () => {
		const webhook = guild.webhooks.upsert(Raw({ token: "s3cret", url: "https://discord.com/api/webhooks/50/s3cret" }));

		expect(JSON.stringify(SnapshotWebhook(webhook))).not.toContain("s3cret");
	});

	it("should read the owner and the avatar", () => {
		const webhook = guild.webhooks.upsert(Raw({
			id: "51", avatar: "abc", user: { id: "900", username: "u", discriminator: "0", global_name: null, avatar: null }
		}));

		expect(SnapshotWebhook(webhook)).toMatchObject({ id: "51", avatar: "abc", ownerId: "900", source: null });
		expect(SnapshotWebhook(webhook).avatarURL).toContain("abc");
	});

	it("should read what a follower webhook relays", () => {
		const webhook = guild.webhooks.upsert(Raw({
			id: "52", type: DiscordWebhookType.ChannelFollower, source_guild: { id: "9", name: "News HQ" }, source_channel: { id: "8", name: "updates" }
		}));

		expect(SnapshotWebhook(webhook).source).toEqual({ guildName: "News HQ", channelName: "updates" });
	});
});

describe("DiffWebhook", () => {
	it("should report nothing for two identical snapshots", () => {
		expect(DiffWebhook(Hook(), Hook())).toEqual([]);
	});

	it("should report a move, a rename and an avatar change", () => {
		const lines = DiffWebhook(Hook(), Hook({ channelId: "201", name: "releases", avatar: "abc" }));

		expect(lines).toEqual(["**Channel** <#200> → <#201>", "**Name** `deploys` → `releases`", "**Avatar** set"]);
	});
});

describe("webhook logs", () => {
	it("should be green for a create, and fall back to the webhook's owner", () => {
		const log = BuildWebhookCreateLog(Hook({ ownerId: "777" }), null);

		expect(log.container.accent_color).toBe(COLOR.LOG_CREATE);
		expect(Text(log.container)).toContain("Webhook created");
		expect(Text(log.container)).toContain("**Webhook** `deploys` in <#200>");
		expect(Text(log.container)).toContain("**By** <@777>");
		expect(Text(log.container)).toContain("-# Webhook 50");
		expect(Sendable(log)).toBeDefined();
	});

	it("should prefer the audit entry over the owner", () => {
		const log = BuildWebhookCreateLog(Hook({ ownerId: "777" }), Entry(AuditLogEvents.WebhookCreate));

		expect(Text(log.container)).toContain("**By** <@900>");
	});

	it("should call a follower webhook a followed channel, and say what it relays", () => {
		const log = BuildWebhookCreateLog(Hook({ type: DiscordWebhookType.ChannelFollower, source: { guildName: "News HQ", channelName: "updates" } }), null);

		expect(Text(log.container)).toContain("Followed channel created");
		expect(Text(log.container)).toContain("**Relays** `updates` from `News HQ`");
	});

	it("should be amber for a change and list the fields", () => {
		const log = BuildWebhookUpdateLog(Hook({ name: "releases" }), ["**Name** `deploys` → `releases`"], Entry(AuditLogEvents.WebhookUpdate));

		expect(log.container.accent_color).toBe(COLOR.LOG_UPDATE);
		expect(Text(log.container)).toContain("Webhook changed");
		expect(Text(log.container)).toContain("**Name** `deploys` → `releases`");
		expect(Sendable(log)).toBeDefined();
	});

	it("should be red for a delete", () => {
		const log = BuildWebhookDeleteLog(Hook(), Entry(AuditLogEvents.WebhookDelete));

		expect(log.container.accent_color).toBe(COLOR.LOG_DELETE);
		expect(Text(log.container)).toContain("Webhook deleted");
		expect(Text(log.container)).toContain("**By** <@900>");
		expect(Sendable(log)).toBeDefined();
	});

	it("should show the avatar as a thumbnail only when there is one", () => {
		expect(HasThumbnail(BuildWebhookDeleteLog(Hook(), null).container)).toBe(false);

		const log = BuildWebhookDeleteLog(Hook({ avatar: "abc", avatarURL: "https://cdn.discordapp.com/avatars/50/abc.png" }), null);
		expect(HasThumbnail(log.container)).toBe(true);
		expect(Sendable(log)).toBeDefined();
	});

	it("should be blue when Dossier cannot tell what changed, and say why", () => {
		const unsynced = BuildWebhooksChangedLog("200", "unsynced");
		const unreadable = BuildWebhooksChangedLog("200", "unreadable");

		expect(unsynced.container.accent_color).toBe(COLOR.LOG_INFO);
		expect(Text(unsynced.container)).toContain("**Channel** <#200>");
		expect(Text(unsynced.container)).toContain("The next change will be reported in full");
		expect(Text(unreadable.container)).toContain("Manage Webhooks");
		expect(Sendable(unsynced)).toBeDefined();
	});
});
