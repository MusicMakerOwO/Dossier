import { describe, it, expect } from "vitest";
import {
	AuditLogEvents,
	Client,
	DiscordAuditLogEntry,
	DiscordGuildCreate,
	DiscordMember,
	DiscordMemberFlags,
	DiscordUser,
	ResolveComponentsV2Flags
} from "simplyjs";
import { COLOR } from "../Constants.js";
import { LogMessage } from "../Logs/Format.js";
import {
	BuildMemberJoinLog,
	BuildMemberLeaveLog,
	BuildMemberUpdateLog,
	BuildTimeoutEndLog,
	BuildTimeoutLog,
	DiffMember,
	SimpleMember,
	SimplifyMember,
	TimeoutChange
} from "../Logs/MemberLogs.js";

const GUILD = "100";
const NOW = Date.parse("2026-10-04T12:00:00.000Z");
const LATER = "2026-10-04T13:00:00.000Z";
const EARLIER = "2026-10-04T11:00:00.000Z";

function Member(fields: Partial<SimpleMember> = {}): SimpleMember {
	return {
		id: "700", guildId: GUILD, username: "fox", globalName: null, bot: false, avatarURL: "https://cdn.discordapp.com/embed/avatars/0.png",
		nick: null, roles: [], joinedAt: "2026-01-01T00:00:00.000Z", serverAvatar: null, premiumSince: null, timeoutUntil: null, flags: 0, ...fields
	};
}

function Entry(userId = "900", reason?: string): DiscordAuditLogEntry {
	return { id: "1", action_type: AuditLogEvents.MemberUpdate, target_id: "700", user_id: userId, ...(reason ? { reason } : {}) };
}

/** Returns everything the log says, as one string. */
function Text(log: LogMessage): string {
	return JSON.stringify(log.container.components);
}

/** Runs the library's send-path validation on the log. */
function Sendable(log: LogMessage): number | undefined {
	return ResolveComponentsV2Flags({ components: [log.container], attachments: log.attachments });
}

describe("SnapshotMember", () => {
	const client = new Client({ token: "test", intents: [] });
	const guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);
	const user = { id: "700", username: "fox", discriminator: "0", global_name: "Fox", avatar: null } as DiscordUser;

	it("should flatten a cached member", () => {
		const member = guild.members.upsert({
			user, nick: "foxy", roles: ["1", "2"], joined_at: EARLIER, deaf: false, mute: false, flags: 0, communication_disabled_until: LATER
		} as DiscordMember);

		expect(SimplifyMember(member)).toMatchObject({
			id: "700", guildId: GUILD, username: "fox", globalName: "Fox", bot: false,
			nick: "foxy", roles: ["1", "2"], joinedAt: EARLIER, timeoutUntil: LATER, serverAvatar: null, premiumSince: null
		});
	});

	it("should not share its role list with the cache", () => {
		const member = guild.members.upsert({ user, roles: ["1"], joined_at: EARLIER, deaf: false, mute: false, flags: 0 } as DiscordMember);
		const snapshot = SimplifyMember(member);

		member.roles.push("2");
		expect(snapshot.roles).toEqual(["1"]);
	});

	it("should show the server avatar over the account's", () => {
		const member = guild.members.upsert({ user, avatar: "abc", roles: [], joined_at: EARLIER, deaf: false, mute: false, flags: 0 } as DiscordMember);

		expect(SimplifyMember(member).avatarURL).toContain(`guilds/${GUILD}/users/700/avatars/abc`);
	});

	it("should mark an uncached member by its missing roles", () => {
		const snapshot = SimplifyMember({ id: "700", guildId: GUILD, user: client.users.upsert(user) });

		expect(snapshot.username).toBe("fox");
		expect(snapshot.roles).toBeNull();
		expect(snapshot.joinedAt).toBeNull();
	});
});

describe("TimeoutChange", () => {
	it("should report a new timeout", () => {
		expect(TimeoutChange(Member(), Member({ timeoutUntil: LATER }), NOW)).toBe("started");
	});

	it("should report an extension as a start", () => {
		expect(TimeoutChange(Member({ timeoutUntil: LATER }), Member({ timeoutUntil: "2026-10-05T12:00:00.000Z" }), NOW)).toBe("started");
	});

	it("should report a removal", () => {
		expect(TimeoutChange(Member({ timeoutUntil: LATER }), Member(), NOW)).toBe("ended");
	});

	it("should ignore an unchanged timeout", () => {
		expect(TimeoutChange(Member({ timeoutUntil: LATER }), Member({ timeoutUntil: LATER }), NOW)).toBeNull();
	});

	it("should ignore an expired timeout being cleared", () => {
		expect(TimeoutChange(Member({ timeoutUntil: EARLIER }), Member(), NOW)).toBeNull();
		expect(TimeoutChange(Member({ timeoutUntil: EARLIER }), Member({ timeoutUntil: EARLIER }), NOW)).toBeNull();
	});
});

describe("DiffMember", () => {
	it("should report nothing for identical members", () => {
		expect(DiffMember(Member(), Member())).toEqual([]);
	});

	it("should report nothing for an account change", () => {
		expect(DiffMember(Member(), Member({ username: "wolf", globalName: "Wolf", avatarURL: "https://example.com/a.png" }))).toEqual([]);
	});

	it("should report nothing for a timeout, which has its own log", () => {
		expect(DiffMember(Member(), Member({ timeoutUntil: LATER }))).toEqual([]);
	});

	it("should report a nickname set, changed and cleared", () => {
		expect(DiffMember(Member(), Member({ nick: "foxy" }))).toEqual(["**Nickname** *none* → `foxy`"]);
		expect(DiffMember(Member({ nick: "foxy" }), Member({ nick: "vixen" }))).toEqual(["**Nickname** `foxy` → `vixen`"]);
		expect(DiffMember(Member({ nick: "foxy" }), Member())).toEqual(["**Nickname** `foxy` → *none*"]);
	});

	it("should report roles added and removed", () => {
		expect(DiffMember(Member({ roles: ["1", "2"] }), Member({ roles: ["2", "3"] }))).toEqual([
			"**Roles added** <@&3>",
			"**Roles removed** <@&1>"
		]);
	});

	it("should report a server avatar set, replaced and removed", () => {
		expect(DiffMember(Member(), Member({ serverAvatar: "a" }))).toEqual(["**Server avatar** set"]);
		expect(DiffMember(Member({ serverAvatar: "a" }), Member({ serverAvatar: "b" }))).toEqual(["**Server avatar** replaced"]);
		expect(DiffMember(Member({ serverAvatar: "a" }), Member())).toEqual(["**Server avatar** removed"]);
	});

	it("should report a boost starting and stopping", () => {
		expect(DiffMember(Member(), Member({ premiumSince: EARLIER }))).toEqual(["**Started boosting the server**"]);
		expect(DiffMember(Member({ premiumSince: EARLIER }), Member())).toEqual(["**Stopped boosting the server**"]);
	});

	it("should report an AutoMod quarantine set and lifted", () => {
		const quarantined = Member({ flags: DiscordMemberFlags.AUTOMOD_QUARANTINED_USERNAME });

		expect(DiffMember(Member(), quarantined)[0]).toContain("**AutoMod quarantined** their name");
		expect(DiffMember(quarantined, Member())[0]).toContain("**AutoMod quarantine lifted** for their name");
		expect(DiffMember(Member(), Member({ flags: DiscordMemberFlags.AUTOMOD_QUARANTINED_GUILD_TAG }))[0]).toContain("server tag");
	});

	it("should ignore flags the log does not report", () => {
		expect(DiffMember(Member(), Member({ flags: DiscordMemberFlags.COMPLETED_ONBOARDING }))).toEqual([]);
	});
});

describe("BuildMemberJoinLog", () => {
	it("should show the account's age from its id", () => {
		const id = ((1767225600000n - 1420070400000n) << 22n).toString();
		const log = BuildMemberJoinLog(Member({ id }), null);

		expect(log.container.accent_color).toBe(COLOR.LOG_CREATE);
		expect(Text(log)).toContain("Member joined");
		expect(Text(log)).toContain("**Account created** <t:1767225600:R>");
		expect(Text(log)).not.toContain("Added by");
		expect(Sendable(log)).toBeDefined();
	});

	it("should say when the member has been here before", () => {
		expect(Text(BuildMemberJoinLog(Member({ flags: DiscordMemberFlags.DID_REJOIN }), null))).toContain("Has been in this server before");
		expect(Text(BuildMemberJoinLog(Member(), null))).not.toContain("Has been in this server before");
	});

	it("should name who added a bot", () => {
		const log = BuildMemberJoinLog(Member({ bot: true }), Entry("900"));

		expect(Text(log)).toContain("Bot added");
		expect(Text(log)).toContain("**Added by** <@900>");
		expect(Text(BuildMemberJoinLog(Member({ bot: true }), null))).toContain("**Added by** *(no audit entry)*");
	});
});

describe("BuildMemberUpdateLog", () => {
	it("should list the changed fields under the actor", () => {
		const log = BuildMemberUpdateLog(Member(), Member({ nick: "foxy" }), ["**Nickname** *none* → `foxy`"], Entry());

		expect(log.container.accent_color).toBe(COLOR.LOG_UPDATE);
		expect(Text(log)).toContain("**Member** <@700> `fox`");
		expect(Text(log)).toContain("**By** <@900>");
		expect(Text(log)).toContain("`foxy`");
		expect(Text(log)).toContain("-# User 700");
		expect(Sendable(log)).toBeDefined();
	});

	it("should say when there was no earlier version", () => {
		expect(Text(BuildMemberUpdateLog(undefined, Member(), [], Entry()))).toContain("No earlier version cached");
	});

	it("should show the display name beside the username", () => {
		expect(Text(BuildMemberUpdateLog(Member(), Member({ globalName: "Fox" }), ["x"], null))).toContain("`fox` (`Fox`)");
	});
});

describe("timeout logs", () => {
	it("should show when a timeout ends, in the moderation color", () => {
		const log = BuildTimeoutLog(Member({ timeoutUntil: LATER }), Entry("900", "spam"));
		const seconds = Date.parse(LATER) / 1000;

		expect(log.container.accent_color).toBe(COLOR.LOG_MODERATION);
		expect(Text(log)).toContain("Member timed out");
		expect(Text(log)).toContain(`**Until** <t:${seconds}:f> (<t:${seconds}:R>)`);
		expect(Text(log)).toContain("**Reason** spam");
		expect(Sendable(log)).toBeDefined();
	});

	it("should point at AutoMod when nobody is named", () => {
		expect(Text(BuildTimeoutLog(Member({ timeoutUntil: LATER }), null))).toContain("most likely AutoMod");
	});

	it("should log a removal in green", () => {
		const log = BuildTimeoutEndLog(Member(), Entry());

		expect(log.container.accent_color).toBe(COLOR.LOG_CREATE);
		expect(Text(log)).toContain("Timeout removed");
		expect(Text(log)).toContain("**By** <@900>");
	});
});

describe("BuildMemberLeaveLog", () => {
	it("should log a plain leave without an actor line", () => {
		const log = BuildMemberLeaveLog(Member({ roles: ["1", "2"] }), "left", null);

		expect(log.container.accent_color).toBe(COLOR.LOG_DELETE);
		expect(Text(log)).toContain("Member left");
		expect(Text(log)).not.toContain("**By**");
		expect(Text(log)).toContain("**Joined** <t:1767225600:R>");
		expect(Text(log)).toContain("**Roles** <@&1>, <@&2>");
		expect(Sendable(log)).toBeDefined();
	});

	it("should name who kicked, and why", () => {
		const log = BuildMemberLeaveLog(Member(), "kicked", Entry("900", "rule 3"));

		expect(log.container.accent_color).toBe(COLOR.LOG_MODERATION);
		expect(Text(log)).toContain("Member kicked");
		expect(Text(log)).toContain("**By** <@900>");
		expect(Text(log)).toContain("**Reason** rule 3");
	});

	it("should mark a ban", () => {
		const log = BuildMemberLeaveLog(Member(), "banned", Entry());

		expect(log.container.accent_color).toBe(COLOR.LOG_MODERATION);
		expect(Text(log)).toContain("Member left (banned)");
	});

	it("should say when the member was never cached", () => {
		const log = BuildMemberLeaveLog(Member({ roles: null, joinedAt: null }), "left", null);

		expect(Text(log)).toContain("Was not cached");
		expect(Text(log)).not.toContain("**Joined**");
	});

	it("should stay sendable for a member holding a great many roles", () => {
		const roles = Array.from({ length: 250 }, (_, index) => (10n ** 18n + BigInt(index)).toString());
		expect(Sendable(BuildMemberLeaveLog(Member({ roles }), "left", null))).toBeDefined();
	});
});