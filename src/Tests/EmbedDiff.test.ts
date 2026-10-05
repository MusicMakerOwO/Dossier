import { describe, it, expect } from "vitest";
import { DiffEmbeds } from "../Logs/EmbedDiff.js";

describe("DiffEmbeds", () => {
	it("should report nothing for identical embeds", () => {
		const embed = { type: "rich" as const, title: "Same", fields: [{ name: "a", value: "b" }] };
		expect(DiffEmbeds([embed], [structuredClone(embed)])).toEqual([]);
	});

	it("should ignore link previews entirely", () => {
		expect(DiffEmbeds([], [{ type: "link", title: "Example Domain" }])).toEqual([]);
		expect(DiffEmbeds([{ type: "image", url: "a" }], [])).toEqual([]);
	});

	it("should treat an embed with no type as rich", () => {
		expect(DiffEmbeds([{ title: "Old" }], [{ title: "New" }])).toEqual(["Embed 1 · title: Old → New"]);
	});

	it("should report added and removed embeds by position", () => {
		expect(DiffEmbeds([], [{ title: "x" }])).toEqual(["Embed 1: added"]);
		expect(DiffEmbeds([{ title: "x" }, { title: "y" }], [{ title: "x" }])).toEqual(["Embed 2: removed"]);
	});

	it("should report fields gained, lost and changed", () => {
		const lines = DiffEmbeds(
			[{ title: "t", color: 0xff0000, fields: [{ name: "Score", value: "1" }] }],
			[{ title: "t", color: 0x00ff00, fields: [{ name: "Score", value: "2" }], footer: { text: "now" } }]
		);

		expect(lines).toEqual([
			"Embed 1 · color: #ff0000 → #00ff00",
			"Embed 1 · field 1 value: 1 → 2",
			"Embed 1 · footer: (none) → now"
		]);
	});

	it("should ignore media metadata that is not what a reader sees", () => {
		expect(DiffEmbeds(
			[{ title: "t", image: { url: "a", width: 10, height: 10 } }],
			[{ title: "t", image: { url: "a", width: 20, height: 20, proxy_url: "p" } }]
		)).toEqual([]);
	});
});
