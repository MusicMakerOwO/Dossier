import { describe, it, expect } from "vitest";
import {
	Client,
	ComponentTypes,
	ContainerBuilder,
	Guild,
	MAX_V2_COMPONENTS,
	MAX_V2_CONTENT_LENGTH,
	SummarizeComponents
} from "simplyjs";

import { BuildPanel } from "../Config/Panel.js";
import { EventDetails, EventGroups, GroupEvents } from "../Config/Groups.js";
import { BuildExplainer } from "../Buttons/ConfigExplain.js";
import { SetEventGroupEnabled, SetGroup } from "../CRUD/GuildEvents.js";

/** A stub guild with only what BuildPanel reads: `id`, `members` and `channels`. */
function StubGuild(id: bigint): Guild {
	return { id: String(id), members: new Map(), channels: new Map() } as unknown as Guild;
}

const StubClient = { id: "999" } as unknown as Client;

/** A stub guild whose bot member holds exactly the given guild-level permissions. */
function StubGuildWithBot(id: bigint, ...held: string[]): Guild {
	const bot = { hasPermission: (...wanted: string[]) => wanted.every((permission) => held.includes(permission)) };
	return { id: String(id), members: new Map([[StubClient.id, bot]]), channels: new Map() } as unknown as Guild;
}

/** An interactive component as it sits on the wire, which is what a builder already is. */
type RenderedComponent = {
	type: number;
	custom_id?: string;
	disabled?: boolean;
	options?: { value: string; default?: boolean }[];
	components?: RenderedComponent[];
};

/** Finds a component by customId anywhere in the panel. */
function FindComponent(payload: ReturnType<typeof BuildPanel>, customId: string): RenderedComponent {
	const stack = [...(payload.components ?? [])] as unknown as RenderedComponent[];

	while (stack.length > 0) {
		const component = stack.pop()!;
		if (component.custom_id === customId) return component;
		if (component.components) stack.push(...component.components);
	}

	throw new Error(`No component with customId "${customId}" in the rendered panel`);
}

let NextGuild = 10_000n;
function FreshGuild(): bigint {
	return NextGuild++;
}

/** Runs the payload through the library's validation: each builder's `validate()` and the whole-message limits. */
function ExpectValidPanel(payload: ReturnType<typeof BuildPanel> | ReturnType<typeof BuildExplainer>): void {
	const components = payload.components ?? [];
	expect(components).toHaveLength(1);

	const container = components[0];
	expect(container.type).toBe(ComponentTypes.CONTAINER);
	expect(() => ContainerBuilder.validate(container as never)).not.toThrow();

	const summary = SummarizeComponents(components);
	expect(summary.usesV2).toBe(true);
	expect(summary.count).toBeLessThanOrEqual(MAX_V2_COMPONENTS);
	expect(summary.contentLength).toBeLessThanOrEqual(MAX_V2_CONTENT_LENGTH);
}

describe("Config panel", () => {
	it("should render a valid panel for a guild with no configuration", () => {
		ExpectValidPanel(BuildPanel(StubClient, StubGuild(FreshGuild())));
	});

	it("should render a valid panel focused on each group", () => {
		for (const group of EventGroups) {
			const guild = FreshGuild();
			SetGroup(guild, group, 555n, 1n);

			ExpectValidPanel(BuildPanel(StubClient, StubGuild(guild), group));
		}
	});

	it("should render a valid panel for a group that is switched off", () => {
		const guild = FreshGuild();
		SetGroup(guild, "messages", 555n, 1n);
		SetEventGroupEnabled(guild, "messages", 0n);

		ExpectValidPanel(BuildPanel(StubClient, StubGuild(guild), "messages"));
	});

	it("should carry its text in components rather than content or embeds", () => {
		const payload = BuildPanel(StubClient, StubGuild(FreshGuild()), "roles");

		expect(payload.content).toBeUndefined();
		expect(payload.embeds).toBeUndefined();
	});

	it("should leave the components-v2 flag to the library", () => {
		expect(BuildPanel(StubClient, StubGuild(FreshGuild())).flags).toBeUndefined();
	});

	it("should mark the focused group as the selected option", () => {
		const payload = BuildPanel(StubClient, StubGuild(FreshGuild()), "mod");
		const select = FindComponent(payload, "config-group");

		expect(select.options!.filter((option) => option.default)).toEqual([
			expect.objectContaining({ value: "mod" })
		]);
	});

	it("should carry the focused group in the channel picker and toggle ids", () => {
		const payload = BuildPanel(StubClient, StubGuild(FreshGuild()), "mod");

		expect(FindComponent(payload, "config-channel:mod")).toBeDefined();
		expect(FindComponent(payload, "config-toggle:mod:on")).toBeDefined();
		expect(FindComponent(payload, "config-toggle:mod:off")).toBeDefined();
	});

	it("should disable Enable until the group has a channel", () => {
		const unconfigured = BuildPanel(StubClient, StubGuild(FreshGuild()), "roles");
		expect(FindComponent(unconfigured, "config-toggle:roles:on").disabled).toBe(true);

		const guild = FreshGuild();
		SetGroup(guild, "roles", 555n, 0n);

		const configured = BuildPanel(StubClient, StubGuild(guild), "roles");
		expect(FindComponent(configured, "config-toggle:roles:on").disabled).toBe(false);
	});

	it("should offer the explainer even for an unconfigured group", () => {
		const payload = BuildPanel(StubClient, StubGuild(FreshGuild()), "server");

		expect(FindComponent(payload, "config-explain:server").disabled).toBeUndefined();
	});

	it("should warn when the bot cannot view the audit log", () => {
		const payload = BuildPanel(StubClient, StubGuildWithBot(FreshGuild(), "MANAGE_WEBHOOKS"));

		ExpectValidPanel(payload);
		expect(JSON.stringify(payload)).toContain("View Audit Log");
	});

	it("should warn about webhooks only on the server group", () => {
		const guild = StubGuildWithBot(FreshGuild(), "VIEW_AUDIT_LOG");
		const server = BuildPanel(StubClient, guild, "server");

		ExpectValidPanel(server);
		expect(JSON.stringify(server)).toContain("Manage Webhooks");
		expect(JSON.stringify(BuildPanel(StubClient, guild, "roles"))).not.toContain("Manage Webhooks");
		expect(JSON.stringify(BuildPanel(StubClient, guild))).not.toContain("Manage Webhooks");
	});

	it("should keep the webhook warning once the server group has a channel", () => {
		const id = FreshGuild();
		SetGroup(id, "server", 555n, 1n);

		expect(JSON.stringify(BuildPanel(StubClient, StubGuildWithBot(id), "server"))).toContain("Manage Webhooks");
	});

	it("should not warn when the bot holds both permissions", () => {
		const guild = StubGuildWithBot(FreshGuild(), "VIEW_AUDIT_LOG", "MANAGE_WEBHOOKS");
		const rendered = JSON.stringify(BuildPanel(StubClient, guild, "server"));

		expect(rendered).not.toContain("View Audit Log");
		expect(rendered).not.toContain("Manage Webhooks");
	});

	it("should not warn when the bot's own member is not cached", () => {
		const rendered = JSON.stringify(BuildPanel(StubClient, StubGuild(FreshGuild()), "server"));

		expect(rendered).not.toContain("View Audit Log");
		expect(rendered).not.toContain("Manage Webhooks");
	});

	it("should name events in plain language rather than gateway names", () => {
		for (const group of EventGroups) {
			const rendered = JSON.stringify(BuildPanel(StubClient, StubGuild(FreshGuild()), group));

			for (const event of GroupEvents[group]) {
				expect(rendered).not.toContain(event);
				expect(rendered).toContain(EventDetails[event].label);
			}
		}
	});
});

describe("Group explainer", () => {
	it("should render a valid message for every group", () => {
		for (const group of EventGroups) {
			ExpectValidPanel(BuildExplainer(group));
		}
	});

	it("should describe every event in the group", () => {
		for (const group of EventGroups) {
			const rendered = JSON.stringify(BuildExplainer(group));

			for (const event of GroupEvents[group]) {
				expect(rendered).toContain(EventDetails[event].label);
				expect(rendered).toContain(EventDetails[event].description);
				expect(rendered).not.toContain(event);
			}
		}
	});
});