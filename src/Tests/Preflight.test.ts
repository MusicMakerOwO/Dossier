import { describe, it, expect } from "vitest";
import { Client, DiscordApplicationFlags } from "simplyjs";

import { CheckPrivilegedIntents, MissingPrivilegedIntents } from "../Config/Preflight.js";

/** A stub client whose only REST route answers with the given application flags. */
function StubClient(flags: number | undefined): Client {
	return { rest: { get: async () => ({ flags }) } } as unknown as Client;
}

describe("Privileged intent pre-flight", () => {
	it("should report both intents when neither flag is set", () => {
		expect(MissingPrivilegedIntents(0)).toEqual(["Server Members", "Message Content"]);
	});

	it("should accept the limited flags of an unverified bot", () => {
		const flags = DiscordApplicationFlags.GATEWAY_GUILD_MEMBERS_LIMITED | DiscordApplicationFlags.GATEWAY_MESSAGE_CONTENT_LIMITED;

		expect(MissingPrivilegedIntents(flags)).toEqual([]);
	});

	it("should accept the full flags of a verified bot", () => {
		const flags = DiscordApplicationFlags.GATEWAY_GUILD_MEMBERS | DiscordApplicationFlags.GATEWAY_MESSAGE_CONTENT;

		expect(MissingPrivilegedIntents(flags)).toEqual([]);
	});

	it("should name only the intent that is off", () => {
		expect(MissingPrivilegedIntents(DiscordApplicationFlags.GATEWAY_GUILD_MEMBERS_LIMITED)).toEqual(["Message Content"]);
		expect(MissingPrivilegedIntents(DiscordApplicationFlags.GATEWAY_MESSAGE_CONTENT_LIMITED)).toEqual(["Server Members"]);
	});

	it("should ignore the presence intent, which Dossier does not use", () => {
		expect(MissingPrivilegedIntents(DiscordApplicationFlags.GATEWAY_PRESENCE_LIMITED)).toHaveLength(2);
	});

	it("should read the flags off the bot's own application", async () => {
		const flags = DiscordApplicationFlags.GATEWAY_GUILD_MEMBERS_LIMITED | DiscordApplicationFlags.GATEWAY_MESSAGE_CONTENT_LIMITED;

		expect(await CheckPrivilegedIntents(StubClient(flags))).toEqual([]);
	});

	it("should treat an application without flags as having none", async () => {
		expect(await CheckPrivilegedIntents(StubClient(undefined))).toHaveLength(2);
	});
});
