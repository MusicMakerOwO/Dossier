import { Embed } from "simplyjs";

/**
 * Returns one line per changed field across the rich embeds of an edit. Link previews are ignored:
 * Discord generates them from the content, which is diffed separately.
 */
export function DiffEmbeds(before: Embed[], after: Embed[]): string[] {
	const old = before.filter(IsRich);
	const now = after.filter(IsRich);

	const lines: string[] = [];
	for (let i = 0; i < Math.max(old.length, now.length); i++) {
		const label = `Embed ${i + 1}`;

		if (old[i] === undefined) lines.push(`${label}: added`);
		else if (now[i] === undefined) lines.push(`${label}: removed`);
		else for (const [key, from, to] of DiffOne(old[i], now[i])) lines.push(`${label} · ${key}: ${from} → ${to}`);
	}

	return lines;
}

/** Whether the embed came from a bot or webhook. A missing `type` counts as rich, which is Discord's default. */
function IsRich(embed: Embed): boolean {
	return embed.type === undefined || embed.type === "rich";
}

/**
 * Returns the embed's visible fields by name. Media metadata such as `proxy_url` and dimensions is
 * left out, because Discord changes it without an edit.
 */
function Readable(embed: Embed): Map<string, string> {
	const fields = new Map<string, string>();
	const add = (key: string, value: unknown) => {
		if (value !== undefined && value !== null) fields.set(key, String(value));
	};

	add("title", embed.title);
	add("description", embed.description);
	add("url", embed.url);
	add("color", embed.color === undefined ? undefined : `#${embed.color.toString(16).padStart(6, "0")}`);
	add("author", embed.author?.name);
	add("footer", embed.footer?.text);
	add("image", embed.image?.url);
	add("thumbnail", embed.thumbnail?.url);
	add("timestamp", embed.timestamp);
	for (const [i, field] of (embed.fields ?? []).entries()) {
		add(`field ${i + 1} name`, field.name);
		add(`field ${i + 1} value`, field.value);
	}

	return fields;
}

function DiffOne(before: Embed, after: Embed): [key: string, from: string, to: string][] {
	const old = Readable(before);
	const now = Readable(after);

	const changes: [string, string, string][] = [];
	for (const key of new Set([...old.keys(), ...now.keys()])) {
		const from = old.get(key) ?? "(none)";
		const to = now.get(key) ?? "(none)";
		if (from !== to) changes.push([key, from, to]);
	}

	return changes;
}
