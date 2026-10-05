import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CreatedDuring, DescribeMove, Moves, REORDER_CAP_MS, REORDER_QUIET_MS, ReorderQueue, SortByPosition } from "../Logs/ReorderBatch.js";
import { Ordinal } from "../Logs/Format.js";

function Moved(before: string, after: string): string {
	return Moves([...before], [...after]).moves.map((move) => move.id).join("");
}

describe("Moves", () => {
	it("should name the one entry dragged from bottom to top, and count the rest as shifted", () => {
		const { moves, shifted } = Moves([..."ABCDE"], [..."EABCD"]);

		expect(moves).toEqual([{ id: "E", from: 5, to: 1, above: null, below: "A" }]);
		expect(shifted).toBe(4);
	});

	it("should name the one entry dragged from top to bottom", () => {
		expect(Moved("ABCDE", "BCDEA")).toBe("A");
	});

	it("should find two independent drags", () => {
		expect(Moved("ABCDEFGH", "BACDEFHG")).toHaveLength(2);
		expect(Moved("ABCDEF", "FBCDEA")).toBe("FA");
	});

	it("should report one side of an adjacent swap", () => {
		expect(Moved("AB", "BA")).toHaveLength(1);
	});

	it("should report nothing when the order did not change", () => {
		expect(Moves([..."ABC"], [..."ABC"])).toEqual({ moves: [], shifted: 0 });
	});

	it("should ignore entries on only one side", () => {
		expect(Moves([..."ABXC"], [..."ABC"]).moves).toEqual([]);
		expect(Moves([..."ABC"], [..."NABC"]).moves).toEqual([]);
	});

	it("should rank within the full lists, including entries on only one side", () => {
		const [move] = Moves([..."XABC"], [..."CAB"]).moves;
		expect(move).toMatchObject({ id: "C", from: 4, to: 1 });
	});
});

describe("SortByPosition", () => {
	it("should order by position, then by id as a number rather than as text", () => {
		expect(SortByPosition([["30", 2], ["100", 1], ["9", 1]])).toEqual(["9", "100", "30"]);
	});
});

describe("DescribeMove", () => {
	it("should describe a move with both neighbours", () => {
		expect(DescribeMove({ id: "A", from: 5, to: 2, above: "B", below: "C" }, (id) => `#${id}`))
			.toEqual({ moved: "moved up from 5th to 2nd", now: "Now below #B, above #C" });
	});

	it("should describe a move to the top", () => {
		expect(DescribeMove({ id: "A", from: 1, to: 3, above: null, below: null }, (id) => id).now).toBe("Now at the top");
	});
});

describe("Ordinal", () => {
	it("should suffix ranks as they are read", () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(Ordinal))
			.toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
	});
});

describe("CreatedDuring", () => {
	it("should tell a role made just now from an old one", () => {
		const batch = { before: new Map(), openedAt: Date.now() };
		const now = ((BigInt(Date.now()) - 1420070400000n) << 22n).toString();

		expect(CreatedDuring(now, batch)).toBe(true);
		expect(CreatedDuring("80351110224678912", batch)).toBe(false);
	});
});

describe("ReorderQueue", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("should flush once, after the burst goes quiet", async () => {
		const queue = ReorderQueue<number>();
		const flush = vi.fn().mockResolvedValue(undefined);

		queue("1", "A", 1, flush);
		queue("1", "B", 2, flush);
		await vi.advanceTimersByTimeAsync(REORDER_QUIET_MS - 1);
		expect(flush).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1);
		expect(flush).toHaveBeenCalledOnce();
		expect([...flush.mock.calls[0][0].before]).toEqual([["A", 1], ["B", 2]]);
	});

	it("should keep the first `before` for an entry updated twice", async () => {
		const queue = ReorderQueue<number>();
		const flush = vi.fn().mockResolvedValue(undefined);

		queue("1", "A", 1, flush);
		queue("1", "A", 7, flush);
		await vi.runAllTimersAsync();

		expect(flush.mock.calls[0][0].before.get("A")).toBe(1);
	});

	it("should flush at the cap even while updates keep arriving", async () => {
		const queue = ReorderQueue<number>();
		const flush = vi.fn().mockResolvedValue(undefined);

		for (let elapsed = 0; elapsed < REORDER_CAP_MS; elapsed += REORDER_QUIET_MS / 2) {
			queue("1", `E${elapsed}`, 0, flush);
			await vi.advanceTimersByTimeAsync(REORDER_QUIET_MS / 2);
		}

		expect(flush).toHaveBeenCalledOnce();
	});

	it("should keep guilds apart", async () => {
		const queue = ReorderQueue<number>();
		const flush = vi.fn().mockResolvedValue(undefined);

		queue("1", "A", 1, flush);
		queue("2", "A", 1, flush);
		await vi.runAllTimersAsync();

		expect(flush).toHaveBeenCalledTimes(2);
	});
});
