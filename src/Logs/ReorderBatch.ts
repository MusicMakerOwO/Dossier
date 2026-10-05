import { Ordinal } from "./Format.js";

/**
 * How long a reorder batch waits for more updates, and the longest it stays open in total. One
 * drag makes Discord send an update for every entry whose position shifted.
 */
export const REORDER_QUIET_MS = 250;
export const REORDER_CAP_MS = 2000;

/** One burst of reorders in one guild: each moved entry's state from before its first update. */
export type Reorder<T> = {
	before: ReadonlyMap<string, T>;
	openedAt: number;
};

type Open<T> = {
	before: Map<string, T>;
	openedAt: number;
	timer: ReturnType<typeof setTimeout> | undefined;
	flush: (batch: Reorder<T>) => Promise<void>;
};

/**
 * Creates a reorder queue with one open batch per guild. Only the first `before` of each entry is
 * kept. `flush` receives the batch once the updates stop; the timer is unref'd, so a batch still
 * open at shutdown is dropped.
 */
export function ReorderQueue<T>(): (guildId: string, id: string, before: T, flush: (batch: Reorder<T>) => Promise<void>) => void {
	const pending = new Map<string, Open<T>>();

	function Arm(guildId: string, batch: Open<T>): void {
		clearTimeout(batch.timer);
		const wait = Math.max(0, Math.min(REORDER_QUIET_MS, batch.openedAt + REORDER_CAP_MS - Date.now()));

		batch.timer = setTimeout(() => {
			pending.delete(guildId);
			void batch.flush({ before: batch.before, openedAt: batch.openedAt });
		}, wait).unref();
	}

	return (guildId, id, before, flush) => {
		let batch = pending.get(guildId);
		if (!batch) {
			batch = { before: new Map(), openedAt: Date.now(), timer: undefined, flush };
			pending.set(guildId, batch);
		}

		if (!batch.before.has(id)) batch.before.set(id, before);
		Arm(guildId, batch);
	};
}

const DiscordEpoch = 1420070400000n;

/**
 * Whether an entry was created during the batch, judged by its snowflake. Such an entry has no
 * earlier position and has to be left out of the comparison.
 */
export function CreatedDuring(id: string, batch: Reorder<unknown>): boolean {
	const created = Number((BigInt(id) >> 22n) + DiscordEpoch);
	return created >= batch.openedAt - REORDER_CAP_MS;
}

/** Returns ids ordered by position, then id, lowest first. This is Discord's sort for roles and channels. */
export function SortByPosition(entries: Iterable<readonly [id: string, position: number]>): string[] {
	return [...entries]
		.toSorted(([a, x], [b, y]) => x - y || (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0))
		.map(([id]) => id);
}

/** An entry that was moved, as ranks counted from 1 at the top, and what it now sits between. */
export type Move = {
	id: string;
	from: number;
	to: number;
	/** The entry now directly above it, if any. */
	above: string | null;
	/** The entry now directly below it, if any. */
	below: string | null;
};

/**
 * Returns the entries that were moved, as opposed to shifted to make room, and how many shifted.
 * Both lists run top to bottom. The shifted entries are the longest set that kept its relative
 * order, so one drag across 200 roles is 1 move and 199 shifts. Entries missing from either list
 * are ignored.
 */
export function Moves(before: readonly string[], after: readonly string[]): { moves: Move[]; shifted: number } {
	const inAfter = new Set(after);
	const common = before.filter((id) => inAfter.has(id));
	const oldRank = new Map(common.map((id, index) => [id, index]));
	const order = after.filter((id) => oldRank.has(id));

	const kept = new Set(LongestIncreasing(order.map((id) => oldRank.get(id)!)).map((index) => order[index]));

	const moves: Move[] = [];
	let shifted = 0;

	for (const [index, id] of after.entries()) {
		const from = before.indexOf(id);
		if (from === -1) continue;

		if (!kept.has(id)) {
			moves.push({ id, from: from + 1, to: index + 1, above: after[index - 1] ?? null, below: after[index + 1] ?? null });
		} else if (from !== index) {
			shifted++;
		}
	}

	return { moves, shifted };
}

/**
 * Describes a move as text, e.g. "moved up from 12th to 3rd" and "Now below X, above Y". `ref`
 * renders each neighbour.
 */
export function DescribeMove(move: Move, ref: (id: string) => string): { moved: string; now: string } {
	// Same rank with new neighbours, which happens when several entries move at once
	const moved = move.to === move.from
		? `moved, still ${Ordinal(move.to)}`
		: `moved ${move.to < move.from ? "up" : "down"} from ${Ordinal(move.from)} to ${Ordinal(move.to)}`;

	const neighbours = [move.above ? `below ${ref(move.above)}` : "at the top"];
	if (move.below) neighbours.push(`above ${ref(move.below)}`);

	return { moved, now: `Now ${neighbours.join(", ")}` };
}

/** Returns the indices of one longest strictly increasing subsequence of `values`. Patience sorting, O(n log n). */
function LongestIncreasing(values: readonly number[]): number[] {
	// tails[k] is the index of the smallest value ending an increasing run of length k + 1.
	const tails: number[] = [];
	const previous: number[] = Array.from({ length: values.length }, () => -1);

	for (const [index, value] of values.entries()) {
		let low = 0;
		let high = tails.length;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (values[tails[middle]] < value) low = middle + 1;
			else high = middle;
		}

		if (low > 0) previous[index] = tails[low - 1];
		tails[low] = index;
	}

	const run: number[] = [];
	for (let index = tails.at(-1) ?? -1; index !== -1; index = previous[index]) run.push(index);
	return run.toReversed();
}
