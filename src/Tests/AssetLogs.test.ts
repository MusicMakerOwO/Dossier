import { describe, it, expect } from "vitest";
import {
	Client,
	ContainerBuilder,
	AuditLogEvents,
	DiscordAuditLogEntry,
	DiscordGuildCreate,
	DiscordSticker,
	DiscordStickerFormatTypes,
	DiscordStickerTypes,
	MAX_V2_CONTENT_LENGTH,
	ResolveComponentsV2Flags,
	SummarizeComponents
} from "simplyjs";
import { COLOR } from "../Constants.js";
import { LogMessage } from "../Logs/Format.js";
import {
	BuildAssetCreateLog,
	BuildAssetDeleteLog,
	BuildAssetUpdateLog,
	DiffAsset,
	EmojiSnapshot,
	SnapshotEmoji,
	SnapshotSound,
	SnapshotSticker,
	SoundSnapshot,
	StickerSnapshot
} from "../Logs/AssetLogs.js";

const GUILD = "100";

function Emoji(fields: Partial<EmojiSnapshot> = {}): EmojiSnapshot {
	return { kind: "emoji", id: "10", name: "frog", available: true, roles: [], creatorId: null, imageURL: "https://cdn.discordapp.com/emojis/10.png", ...fields };
}

function Sticker(fields: Partial<StickerSnapshot> = {}): StickerSnapshot {
	return { kind: "sticker", id: "20", name: "wave", description: null, tags: "👋", available: true, creatorId: null, imageURL: "https://cdn.discordapp.com/stickers/20.png", ...fields };
}

function Sound(fields: Partial<SoundSnapshot> = {}): SoundSnapshot {
	return { kind: "sound", id: "30", name: "airhorn", volume: 1, emojiId: null, emojiName: "📯", available: true, creatorId: null, imageURL: null, ...fields };
}

function Entry(userId = "900"): DiscordAuditLogEntry {
	return { id: "1", action_type: AuditLogEvents.EmojiUpdate, target_id: "10", user_id: userId };
}

/** Returns every text display in the container, including those inside a thumbnail section. */
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

describe("Snapshot", () => {
	const client = new Client({ token: "test", intents: [] });
	const guild = client.guilds.upsert({ id: GUILD, name: "g", roles: [], emojis: [], features: [] } as unknown as DiscordGuildCreate);

	function Raw(fields: Partial<DiscordSticker>): DiscordSticker {
		return {
			id: "20", name: "wave", description: "hi", tags: "👋", type: DiscordStickerTypes.GUILD, format_type: DiscordStickerFormatTypes.PNG,
			available: true, guild_id: GUILD, user: { id: "900", username: "u", discriminator: "0", global_name: null, avatar: null }, ...fields
		};
	}

	it("should read a cached sticker, uploader included", () => {
		expect(SnapshotSticker(guild.stickers.upsert(Raw({})))).toMatchObject({ kind: "sticker", id: "20", description: "hi", creatorId: "900" });
	});

	it("should take the image from the library, and none for a Lottie sticker", () => {
		expect(SnapshotEmoji(guild.emojis.upsert({ id: "10", name: "frog", animated: true, available: true })).imageURL).toBe("https://cdn.discordapp.com/emojis/10.gif");
		expect(SnapshotSticker(guild.stickers.upsert(Raw({ id: "21", format_type: DiscordStickerFormatTypes.LOTTIE }))).imageURL).toBeNull();
	});

	it("should read an uncached sound's bare id with everything else unknown", () => {
		expect(SnapshotSound({ soundId: "30", guildId: GUILD })).toMatchObject({ kind: "sound", id: "30", name: null, volume: null, imageURL: null });
	});
});

describe("DiffAsset", () => {
	it("should report nothing when nothing reported changed", () => {
		expect(DiffAsset(Emoji(), Emoji())).toEqual([]);
	});

	it("should report a rename", () => {
		expect(DiffAsset(Emoji(), Emoji({ name: "toad" }))).toEqual(["**Name** `frog` → `toad`"]);
	});

	it("should report a new role restriction, then changes to it", () => {
		expect(DiffAsset(Emoji(), Emoji({ roles: ["5"] }))).toEqual(["**Restricted to** <@&5>"]);
		expect(DiffAsset(Emoji({ roles: ["5"] }), Emoji({ roles: ["6"] }))).toEqual(["**Roles allowed** <@&6>", "**Roles no longer allowed** <@&5>"]);
	});

	it("should report dropping every role as the restriction lifted", () => {
		expect(DiffAsset(Emoji({ roles: ["5", "6"] }), Emoji())).toEqual(["**Role restriction lifted**, anyone can use it now"]);
	});

	it("should report a sticker's description and related emoji", () => {
		expect(DiffAsset(Sticker(), Sticker({ description: "hello", tags: "🙂" }))).toEqual([
			"**Description** *none* → `hello`",
			"**Related emoji** `👋` → `🙂`"
		]);
	});

	it("should report a sound's volume as a percentage and its icon as it renders", () => {
		expect(DiffAsset(Sound(), Sound({ volume: 0.5, emojiName: null, emojiId: "77" }))).toEqual([
			"**Volume** 100% → 50%",
			"**Icon** 📯 → <:emoji:77>"
		]);
	});

	it("should report an item going out of use", () => {
		expect(DiffAsset(Sticker(), Sticker({ available: false }))).toEqual(["**No longer usable**"]);
	});
});

describe("BuildAssetCreateLog", () => {
	it("should fall back to the uploader when no audit entry arrived", () => {
		const { container } = BuildAssetCreateLog(Emoji({ creatorId: "901" }), null);

		expect(container.accent_color).toBe(COLOR.LOG_CREATE);
		expect(Text(container)).toContain("**By** <@901>");
		expect(HasThumbnail(container)).toBe(true);
	});

	it("should prefer the audit entry over the uploader", () => {
		expect(Text(BuildAssetCreateLog(Emoji({ creatorId: "901" }), Entry("900")).container)).toContain("**By** <@900>");
	});

	it("should show no thumbnail for a Lottie sticker", () => {
		const log = BuildAssetCreateLog(Sticker({ imageURL: null }), null);
		expect(HasThumbnail(log.container)).toBe(false);
		expect(Sendable(log)).toBeTruthy();
	});
});

describe("BuildAssetUpdateLog", () => {
	it("should hedge an unattributed availability change as a Boost change", () => {
		const before = Emoji();
		const after = Emoji({ available: false });
		const { container } = BuildAssetUpdateLog(before, after, DiffAsset(before, after), null);

		expect(container.accent_color).toBe(COLOR.LOG_UPDATE);
		expect(Text(container)).toContain("most likely a Server Boost change");
	});

	it("should not hedge when a person is on record", () => {
		const before = Emoji();
		const after = Emoji({ available: false });
		expect(Text(BuildAssetUpdateLog(before, after, DiffAsset(before, after), Entry()).container)).toContain("**By** <@900>");
	});

	it("should say so when there is no earlier version", () => {
		expect(Text(BuildAssetUpdateLog(undefined, Sound(), [], null).container)).toContain("No earlier version cached");
	});

	it("should stay within Discord's text limit at the worst case", () => {
		const roles = Array.from({ length: 250 }, (_, index) => `${10n ** 18n + BigInt(index)}`);
		const before = Emoji({ name: "x".repeat(32), roles: [] });
		const after = Emoji({ name: "y".repeat(32), roles });
		const log = BuildAssetUpdateLog(before, after, DiffAsset(before, after), Entry());

		expect(SummarizeComponents([log.container]).contentLength).toBeLessThanOrEqual(MAX_V2_CONTENT_LENGTH);
		expect(Sendable(log)).toBeTruthy();
	});
});

describe("BuildAssetDeleteLog", () => {
	it("should name an uncached sound as unknown and still be sendable", () => {
		const log = BuildAssetDeleteLog(SnapshotSound({ soundId: "30", guildId: GUILD }), null);

		expect(log.container.accent_color).toBe(COLOR.LOG_DELETE);
		expect(Text(log.container)).toContain("name unknown");
		expect(Text(log.container)).toContain("Soundboard sound 30");
		expect(Sendable(log)).toBeTruthy();
	});

	it("should keep a thumbnail of a deleted emoji", () => {
		expect(HasThumbnail(BuildAssetDeleteLog(Emoji(), Entry()).container)).toBe(true);
	});
});
