import { describe, it, expect } from "vitest";
import { Client, ContainerBuilder, DiscordAuditLogEntry, DiscordAuditLogEvent, DiscordChannel, DiscordChannelTypes, DiscordGuildCreate, DiscordOverwrite, DiscordPermissions, ResolveComponentsV2Flags } from "simplyjs";
import { COLOR } from "../Constants.js";
import { LogMessage } from "../Logs/Format.js";
import {
	BuildChannelCreateLog,
	BuildChannelDeleteLog,
	BuildChannelUpdateLog,
	BuildThreadCreateLog,
	ChannelSnapshot,
	DiffChannel,
	DiffOverwrites,
	Snapshot
} from "../Logs/ChannelLogs.js";

const GUILD = "100";

function Channel(fields: Partial<ChannelSnapshot> = {}): ChannelSnapshot {
	return {
		id: "200", guildId: GUILD, type: DiscordChannelTypes.GUILD_TEXT, name: "general",
		topic: null, nsfw: false, slowmode: 0, parentId: null,
		bitrate: null, userLimit: null, rtcRegion: null,
		overwrites: [], availableTags: [], appliedTags: [], ownerId: null,
		archived: null, locked: null, invitable: null, autoArchiveMinutes: null, position: 0,
		...fields
	};
}

function Overwrite(id: string, allow: bigint, deny: bigint, type: 0 | 1 = 0): DiscordOverwrite {
	return { id, type, allow: allow.toString(), deny: deny.toString() };
}

function Entry(userId = "900", reason?: string): DiscordAuditLogEntry {
	return { id: "1", action_type: DiscordAuditLogEvent.CHANNEL_UPDATE, target_id: "200", user_id: userId, ...(reason ? { reason } : {}) };
}

/** Returns every text display in the container, joined. */
function Text(container: ContainerBuilder): string {
	return container.components.flatMap((child) => "content" in child ? [child.content] : []).join("\n");
}

/** Runs the library's send-path validation on the log. */
function Sendable(log: LogMessage): number | undefined {
	return ResolveComponentsV2Flags({ components: [log.container], attachments: log.attachments });
}

const ALL = Object.values(DiscordPermissions).reduce((all, bit) => all | bit, 0n);

describe("Snapshot", () => {
	it("should read a cached channel and its raw payload into the same shape", () => {
		const raw: DiscordChannel = {
			id: "200", type: DiscordChannelTypes.GUILD_TEXT, guild_id: GUILD, name: "general", topic: "hi",
			nsfw: true, rate_limit_per_user: 10, parent_id: "300", position: 4,
			permission_overwrites: [Overwrite(GUILD, 0n, DiscordPermissions.VIEW_CHANNEL)]
		};

		const client = new Client({ token: "test", intents: [] });
		const guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

		expect(Snapshot(guild.channels.upsert(raw))).toEqual(Snapshot(raw));
	});

	it("should keep a cloned channel's overwrites and thread metadata apart from later patches", () => {
		const client = new Client({ token: "test", intents: [] });
		const guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);
		const metadata = (archived: boolean) => ({ archived, auto_archive_duration: 60, archive_timestamp: "2026-01-01T00:00:00Z", locked: false });

		const channel = guild.channels.upsert({ id: "200", type: DiscordChannelTypes.GUILD_TEXT, guild_id: GUILD, permission_overwrites: [Overwrite("5", 0n, 1n)] });
		const thread = guild.channels.upsert({ id: "201", type: DiscordChannelTypes.PUBLIC_THREAD, guild_id: GUILD, thread_metadata: metadata(false) });
		const oldChannel = Snapshot(channel.clone());
		const oldThread = Snapshot(thread.clone());

		guild.channels.upsert({ id: "200", type: DiscordChannelTypes.GUILD_TEXT, guild_id: GUILD, permission_overwrites: [Overwrite("5", 1n, 0n)] });
		guild.channels.upsert({ id: "201", type: DiscordChannelTypes.PUBLIC_THREAD, guild_id: GUILD, thread_metadata: metadata(true) });

		expect(DiffOverwrites(oldChannel.overwrites, Snapshot(channel).overwrites, GUILD)).toHaveLength(1);
		expect(DiffChannel(oldThread, Snapshot(thread))).toEqual(["**Archived**"]);
	});
});

describe("DiffChannel", () => {
	it("should report nothing for a position-only change", () => {
		expect(DiffChannel(Channel(), Channel())).toEqual([]);
	});

	it("should report each changed field once", () => {
		const lines = DiffChannel(
			Channel({ name: "general", slowmode: 0, parentId: null, nsfw: false }),
			Channel({ name: "chat", slowmode: 30, parentId: "300", nsfw: true })
		);

		expect(lines).toEqual([
			"**Name** `general` → `chat`",
			"**Age-restricted** turned on",
			"**Slowmode** off → 30s",
			"**Category** *none* → <#300>"
		]);
	});

	it("should name applied thread tags from the parent forum", () => {
		const lines = DiffChannel(Channel({ appliedTags: ["1"] }), Channel({ appliedTags: ["2"] }), new Map([["1", "bug"], ["2", "fixed"]]));
		expect(lines).toEqual(["**Tagged** `fixed`", "**Untagged** `bug`"]);
	});

	it("should keep markdown in a name from rendering", () => {
		expect(DiffChannel(Channel({ name: "a" }), Channel({ name: "`**b**`" }))[0]).toBe("**Name** `a` → `'**b**'`");
	});
});

describe("DiffOverwrites", () => {
	it("should name the permissions that moved, in each direction", () => {
		const [change] = DiffOverwrites(
			[Overwrite("5", DiscordPermissions.SEND_MESSAGES, DiscordPermissions.ATTACH_FILES)],
			[Overwrite("5", DiscordPermissions.MANAGE_MESSAGES, DiscordPermissions.SEND_MESSAGES)],
			GUILD
		);

		expect(change.action).toBe(DiscordAuditLogEvent.CHANNEL_OVERWRITE_UPDATE);
		expect(change.line).toBe("<@&5> override changed: ✅ Manage Messages · ❌ Send Messages · ➖ Attach Files");
	});

	it("should file additions and removals under their own audit actions", () => {
		const changes = DiffOverwrites([Overwrite("5", 0n, 0n)], [Overwrite("6", 0n, 0n, 1)], GUILD);

		expect(changes.map((change) => change.action)).toEqual([
			DiscordAuditLogEvent.CHANNEL_OVERWRITE_CREATE,
			DiscordAuditLogEvent.CHANNEL_OVERWRITE_DELETE
		]);
		expect(changes[0].line).toBe("<@6> override added");
	});

	it("should call the guild-id role @everyone", () => {
		const [change] = DiffOverwrites([], [Overwrite(GUILD, 0n, DiscordPermissions.VIEW_CHANNEL)], GUILD);
		expect(change.line).toBe("@everyone override added: ❌ View Channel");
	});

	it("should ignore an override that did not change", () => {
		expect(DiffOverwrites([Overwrite("5", 1n, 2n)], [Overwrite("5", 1n, 2n)], GUILD)).toEqual([]);
	});
});

describe("BuildChannelCreateLog", () => {
	it("should list the starting overrides of a private channel", () => {
		const log = BuildChannelCreateLog(Channel({ overwrites: [Overwrite(GUILD, 0n, DiscordPermissions.VIEW_CHANNEL)] }), Entry());

		expect(log.container.accent_color).toBe(COLOR.LOG_CREATE);
		expect(Text(log.container)).toContain("<@900>");
		expect(Text(log.container)).toContain("@everyone override added: ❌ View Channel");
		expect(Sendable(log)).toBeTruthy();
	});
});

describe("BuildThreadCreateLog", () => {
	it("should credit the owner without an audit entry", () => {
		const log = BuildThreadCreateLog(Channel({ type: DiscordChannelTypes.PUBLIC_THREAD, ownerId: "901", parentId: "200" }));

		expect(Text(log.container)).toContain("**Started by** <@901>");
		expect(Text(log.container)).toContain("in <#200>");
	});
});

describe("BuildChannelUpdateLog", () => {
	it("should carry the reason from the audit entry", () => {
		const before = Channel();
		const after = Channel({ name: "chat" });
		const log = BuildChannelUpdateLog(before, after, DiffChannel(before, after), [], Entry("900", "cleanup"));

		expect(log.container.accent_color).toBe(COLOR.LOG_UPDATE);
		expect(Text(log.container)).toContain("**Reason** cleanup");
	});

	it("should hedge an unattributed archive as inactivity", () => {
		const before = Channel({ type: DiscordChannelTypes.PUBLIC_THREAD, archived: false });
		const after = Channel({ type: DiscordChannelTypes.PUBLIC_THREAD, archived: true });
		const log = BuildChannelUpdateLog(before, after, DiffChannel(before, after), [], null);

		expect(Text(log.container)).toContain("most likely hidden after inactivity");
	});

	it("should say so when there is no earlier version to diff", () => {
		const log = BuildChannelUpdateLog(undefined, Channel(), [], [], null);
		expect(Text(log.container)).toContain("No earlier version cached");
	});

	it("should stay sendable when every permission flips on fifty overrides", () => {
		const before = Array.from({ length: 50 }, (_, i) => Overwrite(`${1000 + i}`, ALL, 0n));
		const after = Array.from({ length: 50 }, (_, i) => Overwrite(`${1000 + i}`, 0n, ALL));
		const long = "x".repeat(1024);
		const old = Channel({ topic: long, name: "a".repeat(100) });
		const now = Channel({ topic: `${long}y`, name: "b".repeat(100) });

		const log = BuildChannelUpdateLog(old, now, DiffChannel(old, now), DiffOverwrites(before, after, GUILD), Entry("900", "r".repeat(512)));

		expect(Text(log.container).length).toBeLessThanOrEqual(4000);
		expect(Sendable(log)).toBeTruthy();
	});
});

describe("BuildChannelDeleteLog", () => {
	it("should print the name as text rather than a dead mention", () => {
		const log = BuildChannelDeleteLog(Snapshot({ id: "200", type: DiscordChannelTypes.GUILD_VOICE, guild_id: GUILD, name: "lounge" }), null);

		expect(log.container.accent_color).toBe(COLOR.LOG_DELETE);
		expect(Text(log.container)).toContain("Voice channel deleted");
		expect(Text(log.container)).toContain("`lounge`");
		expect(Text(log.container)).not.toContain("<#200>");
	});
});
