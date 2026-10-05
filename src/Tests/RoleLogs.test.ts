import { describe, it, expect } from "vitest";
import {
	AuditLogEvents,
	Client,
	ContainerBuilder,
	DiscordAuditLogEntry,
	DiscordGuildCreate,
	DiscordPermissions,
	MAX_V2_CONTENT_LENGTH,
	ResolveComponentsV2Flags,
	SummarizeComponents
} from "simplyjs";
import { COLOR } from "../Constants.js";
import { LogMessage } from "../Logs/Format.js";
import { BuildRoleCreateLog, BuildRoleDeleteLog, BuildRoleUpdateLog, DiffRole, RoleSnapshot, SnapshotRole } from "../Logs/RoleLogs.js";

const GUILD = "100";

function Role(fields: Partial<RoleSnapshot> = {}): RoleSnapshot {
	return {
		id: "10", guildId: GUILD, name: "mods", colors: { primary: 0, secondary: null, tertiary: null },
		hoist: false, mentionable: false, managed: false, icon: null, unicodeEmoji: null, permissions: 0n, botId: null, position: 1, ...fields
	};
}

function Entry(userId = "900"): DiscordAuditLogEntry {
	return { id: "1", action_type: AuditLogEvents.RoleUpdate, target_id: "10", user_id: userId };
}

function Text(container: ContainerBuilder): string {
	return container.components.flatMap((child) => "content" in child ? [child.content] : []).join("\n");
}

/** Runs the library's send-path validation on the log. */
function Sendable(log: LogMessage): number | undefined {
	return ResolveComponentsV2Flags({ components: [log.container], attachments: log.attachments });
}

describe("SnapshotRole", () => {
	const client = new Client({ token: "test", intents: [] });
	const guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

	it("should read a cached role, bot tag included", () => {
		const role = guild.roles.upsert({
			id: "10", name: "Dossier", color: 0, colors: { primary_color: 0xff7700, secondary_color: null, tertiary_color: null },
			hoist: true, position: 1, permissions: DiscordPermissions.VIEW_AUDIT_LOG.toString(), managed: true, mentionable: false,
			tags: { bot_id: "555" }, flags: 0
		});

		expect(SnapshotRole(role)).toMatchObject({
			id: "10", guildId: GUILD, name: "Dossier", hoist: true, managed: true, botId: "555",
			colors: { primary: 0xff7700, secondary: null, tertiary: null }, permissions: DiscordPermissions.VIEW_AUDIT_LOG
		});
	});

	it("should read an uncached role's bare ids with everything else unknown", () => {
		expect(SnapshotRole({ id: "11", guildId: GUILD })).toMatchObject({ id: "11", name: null, permissions: null, colors: null });
	});
});

describe("DiffRole", () => {
	it("should report nothing when nothing reported changed", () => {
		expect(DiffRole(Role(), Role())).toEqual([]);
	});

	it("should report a rename", () => {
		expect(DiffRole(Role(), Role({ name: "admins" }))).toEqual(["**Name** `mods` → `admins`"]);
	});

	it("should name each permission granted and revoked", () => {
		const before = Role({ permissions: DiscordPermissions.KICK_MEMBERS });
		const after = Role({ permissions: DiscordPermissions.MANAGE_MESSAGES | DiscordPermissions.MANAGE_GUILD });

		expect(DiffRole(before, after)).toEqual(["**Permissions** ✅ Manage Server, Manage Messages · ❌ Kick Members"]);
	});

	it("should report a solid color becoming a gradient, and no color as default", () => {
		expect(DiffRole(Role(), Role({ colors: { primary: 0xff0000, secondary: null, tertiary: null } }))).toEqual(["**Color** *default* → `#ff0000`"]);
		expect(DiffRole(
			Role({ colors: { primary: 0xff0000, secondary: null, tertiary: null } }),
			Role({ colors: { primary: 0xff0000, secondary: 0x0000ff, tertiary: null } })
		)).toEqual(["**Color** `#ff0000` → gradient `#ff0000` / `#0000ff`"]);
	});

	it("should report the hoist and mentionable toggles", () => {
		expect(DiffRole(Role(), Role({ hoist: true, mentionable: true }))).toEqual([
			"**Shown separately in the member list** turned on",
			"**Anyone can @mention it** turned on"
		]);
	});

	it("should report an icon change without pretending two images are the same", () => {
		expect(DiffRole(Role(), Role({ unicodeEmoji: "🛡️" }))).toEqual(["**Icon** *none* → 🛡️"]);
		expect(DiffRole(Role({ icon: "a" }), Role({ icon: "b" }))).toEqual(["**Icon** custom image replaced"]);
	});
});

describe("builders", () => {
	it("should list a new role's starting permissions, in green", () => {
		const log = BuildRoleCreateLog(Role({ permissions: DiscordPermissions.BAN_MEMBERS }), Entry());

		expect(log.container.accent_color).toBe(COLOR.LOG_CREATE);
		expect(Text(log.container)).toContain("**Permissions** Ban Members");
		expect(Text(log.container)).toContain("**By** <@900>");
		expect(Sendable(log)).toBeTruthy();
	});

	it("should credit an integration role to its bot when no entry arrives", () => {
		const log = BuildRoleCreateLog(Role({ managed: true, botId: "555" }), null);
		expect(Text(log.container)).toContain("*(integration role for <@555>)*");
	});

	it("should render @everyone as text rather than a broken mention", () => {
		const log = BuildRoleUpdateLog(Role({ id: GUILD }), Role({ id: GUILD, permissions: DiscordPermissions.SEND_MESSAGES }), ["x"], Entry());

		expect(log.container.accent_color).toBe(COLOR.LOG_UPDATE);
		expect(Text(log.container)).toContain("**Role** @everyone");
		expect(Text(log.container)).not.toContain(`<@&${GUILD}>`);
	});

	it("should say so when there is no earlier version", () => {
		expect(Text(BuildRoleUpdateLog(undefined, Role(), [], null).container)).toContain("No earlier version cached");
	});

	it("should print a deleted role's name as text, in red", () => {
		const log = BuildRoleDeleteLog(Role({ name: "gone" }), null);

		expect(log.container.accent_color).toBe(COLOR.LOG_DELETE);
		expect(Text(log.container)).toContain("**Role** `gone`");
		expect(Text(log.container)).not.toContain("<@&10>");
	});

	it("should stay sendable when a role gains every permission at once", () => {
		const all = Object.values(DiscordPermissions).reduce((sum, bit) => sum | bit, 0n);
		const log = BuildRoleUpdateLog(Role(), Role({ permissions: all }), DiffRole(Role(), Role({ permissions: all })), Entry());

		expect(Sendable(log)).toBeTruthy();
		expect(SummarizeComponents([log.container]).contentLength).toBeLessThanOrEqual(MAX_V2_CONTENT_LENGTH);
	});
});
