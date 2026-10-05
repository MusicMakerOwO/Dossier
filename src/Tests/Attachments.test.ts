import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Attachment } from "simplyjs";
import { StoredAttachment } from "../Types/SimpleTypes.js";

const { Logged } = vi.hoisted(() => ({ Logged: vi.fn() }));
vi.mock("../Log.js", () => ({ Log: Logged }));

const {
	AttachmentPath,
	DescribeAttachment,
	SaveAttachment,
	ReadAttachment,
	DeleteAttachment,
	SyncMessageAttachments,
	DeleteMessageAttachments
} = await import("../CRUD/Attachments.js");

const Root = process.env.ATTACHMENT_DIR!;

const DiscordEpoch = 1_420_070_400_000n;

// A day no other test file uses: the store root is shared across workers, and the day folder keeps their files apart
const BaseMs = 1_600_000_000_000n;
const Day = "2020-09-13";
const LaterMs = BaseMs + 172_800_000n;
const LaterDay = "2020-09-15";

/** The module's size limit, duplicated here to test the boundary. */
const MaxBytes = 10 * 1024 * 1024;

// Each test uses its own message id, because folders on the shared disk are not cleaned up between tests
let NextId = 1n;
function IdAt(ms: bigint): bigint {
	return ((ms - DiscordEpoch) << 22n) + NextId++;
}
function FreshId(): bigint {
	return IdAt(BaseMs);
}

/** Returns the folder holding one message's files. */
function MessageFolder(message_id: bigint): string {
	return dirname(AttachmentPath(message_id, "0", ""));
}

async function WriteEntry(message_id: bigint, name: string, bytes: Buffer = Buffer.from([1])): Promise<string> {
	const path = join(MessageFolder(message_id), name);
	await fs.mkdir(MessageFolder(message_id), { recursive: true });
	await fs.writeFile(path, bytes);
	return path;
}

async function Entries(message_id: bigint): Promise<string[]> {
	return (await fs.readdir(MessageFolder(message_id))).sort();
}

function MakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
	return {
		id: (NextId++).toString(),
		filename: "cat.png",
		size: 3,
		content_type: "image/png",
		url: "https://cdn.example/cat.png",
		proxy_url: "https://proxy.example/cat.png",
		width: 64,
		height: 64,
		...overrides
	};
}

function Stored(id: string, overrides: Partial<StoredAttachment> = {}): StoredAttachment {
	return {
		id,
		filename: "cat.png",
		size: 1,
		content_type: "image/png",
		width: null,
		height: null,
		stored: true,
		...overrides
	};
}

const Fetch = vi.spyOn(globalThis, "fetch");

type FetchResult = {
	ok?: boolean;
	status?: number;
	statusText?: string;
	body?: Buffer;
	contentLength?: string | null;
};

/** A fake Response with only what SaveAttachment reads. Unlike a real one, its `content-length` can disagree with the body. */
function MockFetch(result: FetchResult = {}): Buffer {
	const body = result.body ?? Buffer.from([1, 2, 3]);
	const length = result.contentLength === undefined ? body.byteLength.toString() : result.contentLength;

	Fetch.mockResolvedValue({
		ok: result.ok ?? true,
		status: result.status ?? 200,
		statusText: result.statusText ?? "OK",
		headers: new Headers(length === null ? {} : { "content-length": length }),
		arrayBuffer: async () => new Uint8Array(body).buffer
	} as unknown as Response);

	return body;
}

beforeEach(() => {
	Logged.mockClear();

	// Throws by default, so a test that reaches the network unmocked fails instead of passing as a failed download
	Fetch.mockReset();
	Fetch.mockImplementation(() => Promise.reject(new Error("fetch was not stubbed for this test")));
});

afterAll(async () => {
	Fetch.mockRestore();

	// Only the day folders this file writes. Other workers share the root
	await fs.rm(join(Root, Day), { recursive: true, force: true });
	await fs.rm(join(Root, LaterDay), { recursive: true, force: true });
});

describe("AttachmentPath", () => {
	it("should place a file under its message, under the day its snowflake was created", () => {
		const id = FreshId();

		expect(AttachmentPath(id, "999", "cat.png")).toBe(join(Root, Day, id.toString(), "999.png"));
	});

	it("should build paths inside ATTACHMENT_DIR", () => {
		const path = AttachmentPath(FreshId(), "999", "cat.png");

		expect(path.startsWith(join(Root))).toBe(true);
		expect(path).toContain(".attachments-test");
	});

	it("should shard by day, sharing a directory within one and splitting across two", () => {
		const morning = FreshId();
		const evening = FreshId();
		const later = IdAt(LaterMs);

		expect(dirname(MessageFolder(morning))).toBe(dirname(MessageFolder(evening)));
		expect(dirname(MessageFolder(later))).toBe(join(Root, LaterDay));
	});

	it("should name the file after the id, keeping an extension only when the filename plausibly has one", () => {
		const cases: [string, string][] = [
			["cat.png", "999.png"],
			["archive.tar.gz", "999.gz"], // Last dot wins; the rest of the name is display metadata.
			["CAT.PNG", "999.PNG"],
			["README", "999"],
			[".env", "999"], // A leading dot is the whole name, not an extension.
			["cat.", "999"],
			["cat.wayTooLongToBeAnExt", "999"], // Past 16 characters it stops being an extension.
			["cat.p g", "999"],
			["cat.pñg", "999"],
			["cat.png/../../escape", "999"]
		];

		for (const [filename, expected] of cases) {
			expect(basename(AttachmentPath(FreshId(), "999", filename))).toBe(expected);
		}
	});

	it("should refuse an attachment id that is not a snowflake", () => {
		const id = FreshId();

		for (const bad of ["../../etc/passwd", "abc", "", "12a", "1.2", "9/9", " 999", "0x99"]) {
			expect(() => AttachmentPath(id, bad, "cat.png")).toThrow(/Refusing to build an attachment path/);
		}

		expect(() => AttachmentPath(id, "../../etc/passwd", "cat.png")).toThrow(/etc\/passwd/);
	});

	it("should still resolve a day for the largest snowflake Discord could issue", () => {
		const path = AttachmentPath(2n ** 64n - 1n, "999", "cat.png");

		expect(path).toMatch(/2154-\d{2}-\d{2}/);
	});
});

describe("DescribeAttachment", () => {
	it("should carry across the metadata worth keeping and the stored flag it was given", () => {
		const attachment = MakeAttachment({ id: "999", filename: "cat.png", size: 2048 });

		expect(DescribeAttachment(attachment, true)).toEqual({
			id: "999",
			filename: "cat.png",
			size: 2048,
			content_type: "image/png",
			width: 64,
			height: 64,
			stored: true
		});

		expect(DescribeAttachment(attachment, false).stored).toBe(false);
	});

	it("should survive a JSON round-trip with its optional fields intact", () => {
		const attachment = MakeAttachment();
		delete attachment.content_type;
		delete attachment.width;
		delete attachment.height;

		const described = DescribeAttachment(attachment, false);

		expect(described.content_type).toBeNull();
		expect(described.width).toBeNull();
		expect(described.height).toBeNull();
		expect(JSON.parse(JSON.stringify(described))).toEqual(described);
	});

	it("should treat an explicitly null dimension the same as a missing one", () => {
		expect(DescribeAttachment(MakeAttachment({ width: null, height: null }), false)).toMatchObject({
			width: null,
			height: null
		});
	});

	it("should not keep the CDN urls", () => {
		expect(DescribeAttachment(MakeAttachment(), true)).not.toHaveProperty("url");
		expect(DescribeAttachment(MakeAttachment(), true)).not.toHaveProperty("proxy_url");
	});
});

describe("SaveAttachment", () => {
	it("should write the bytes it downloaded where ReadAttachment will find them", async () => {
		const id = FreshId();
		const attachment = MakeAttachment({ id: "999" });
		const body = MockFetch();

		const described = await SaveAttachment(id, attachment);

		expect(described.stored).toBe(true);
		expect(Fetch).toHaveBeenCalledWith(attachment.url);
		expect(await fs.readFile(AttachmentPath(id, "999", "cat.png"))).toEqual(body);
		expect(await ReadAttachment(id, described)).toEqual(body);
	});

	it("should not download a file whose declared size is over the limit", async () => {
		const described = await SaveAttachment(FreshId(), MakeAttachment({ size: MaxBytes + 1 }));

		expect(described.stored).toBe(false);
		expect(Fetch).not.toHaveBeenCalled();
	});

	it("should not download a file Discord gave no content type for", async () => {
		const attachment = MakeAttachment();
		delete attachment.content_type;

		const described = await SaveAttachment(FreshId(), attachment);

		expect(described.stored).toBe(false);
		expect(Fetch).not.toHaveBeenCalled();
	});

	it("should store a file declared at exactly the limit", async () => {
		MockFetch();

		expect((await SaveAttachment(FreshId(), MakeAttachment({ size: MaxBytes }))).stored).toBe(true);
	});

	it("should abandon a download the response says is too big before reading the body", async () => {
		const id = FreshId();
		MockFetch({ contentLength: (MaxBytes + 1).toString() });

		const described = await SaveAttachment(id, MakeAttachment({ id: "999" }));

		expect(described.stored).toBe(false);
		expect(existsSync(AttachmentPath(id, "999", "cat.png"))).toBe(false);
		expect(Logged).toHaveBeenCalledWith("ERROR", expect.stringContaining("999"), expect.anything());
	});

	it("should refuse a body that runs past the limit however small the file claimed to be", async () => {
		const id = FreshId();
		MockFetch({ body: Buffer.alloc(MaxBytes + 1), contentLength: null });

		const described = await SaveAttachment(id, MakeAttachment({ id: "999", size: 12 }));

		expect(described.stored).toBe(false);
		expect(existsSync(AttachmentPath(id, "999", "cat.png"))).toBe(false);
	});

	it("should store a small file when the response gives no usable content length", async () => {
		for (const contentLength of [null, "not a number", ""]) {
			const body = MockFetch({ contentLength });

			const id = FreshId();
			const described = await SaveAttachment(id, MakeAttachment({ id: "999" }));

			expect(described.stored).toBe(true);
			expect(await ReadAttachment(id, described)).toEqual(body);
		}
	});

	it("should report a failed request as unstored rather than throwing", async () => {
		const id = FreshId();
		MockFetch({ ok: false, status: 404, statusText: "Not Found" });

		const described = await SaveAttachment(id, MakeAttachment({ id: "999" }));

		expect(described.stored).toBe(false);
		expect(existsSync(MessageFolder(id))).toBe(false);
		expect(Logged).toHaveBeenCalledWith("ERROR", expect.any(String), expect.anything());
	});

	it("should survive the network failing outright", async () => {
		Fetch.mockRejectedValue(new Error("ECONNRESET"));

		await expect(SaveAttachment(FreshId(), MakeAttachment())).resolves.toMatchObject({ stored: false });
	});

	it("should turn a refused path into an unstored file rather than an exception", async () => {
		MockFetch();

		await expect(SaveAttachment(FreshId(), MakeAttachment({ id: "../escape" }))).resolves.toMatchObject({
			stored: false
		});
		expect(Fetch).not.toHaveBeenCalled();
	});

	it("should still describe a file it could not store", async () => {
		MockFetch({ ok: false, status: 500, statusText: "Internal Server Error" });

		const attachment = MakeAttachment({ id: "999", filename: "evidence.png", size: 4096 });

		expect(await SaveAttachment(FreshId(), attachment)).toEqual({
			id: "999",
			filename: "evidence.png",
			size: 4096,
			content_type: "image/png",
			width: 64,
			height: 64,
			stored: false
		});
	});
});

describe("ReadAttachment", () => {
	it("should read back the bytes stored for an attachment", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png", Buffer.from("the file itself"));

		expect(await ReadAttachment(id, Stored("999"))).toEqual(Buffer.from("the file itself"));
	});

	it("should not read a file for an attachment recorded as unstored", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");

		expect(await ReadAttachment(id, Stored("999", { stored: false }))).toBeUndefined();
	});

	it("should find the bytes even when the caller's filename no longer matches", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png", Buffer.from("still here"));

		const renamed = Stored("999", { filename: "dog.jpeg", content_type: "image/jpeg" });
		expect(await ReadAttachment(id, renamed)).toEqual(Buffer.from("still here"));
	});

	it("should find a file stored without an extension", async () => {
		const id = FreshId();
		await WriteEntry(id, "999", Buffer.from("no suffix"));

		expect(await ReadAttachment(id, Stored("999", { filename: "README" }))).toEqual(Buffer.from("no suffix"));
	});

	it("should not mistake a longer id for the one it was asked about", async () => {
		const id = FreshId();
		await WriteEntry(id, "9991.png");

		expect(await ReadAttachment(id, Stored("999"))).toBeUndefined();
		expect(await ReadAttachment(id, Stored("9991"))).toBeDefined();
	});

	it("should return nothing for a message that never had bytes kept", async () => {
		expect(await ReadAttachment(FreshId(), Stored("999"))).toBeUndefined();
	});

	it("should return nothing for an id no file in the folder belongs to", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");

		expect(await ReadAttachment(id, Stored("1000"))).toBeUndefined();
	});

	it("should treat a malformed id as a miss rather than an error", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");

		expect(await ReadAttachment(id, Stored("../999"))).toBeUndefined();
	});

	it("should say nothing when the row still names a file the disk no longer has", async () => {
		const id = FreshId();
		const path = await WriteEntry(id, "999.png");
		await fs.rm(path);

		expect(await ReadAttachment(id, Stored("999"))).toBeUndefined();
		expect(Logged).not.toHaveBeenCalled();
	});
});

describe("DeleteAttachment", () => {
	it("should remove the file and report that there was one", async () => {
		const id = FreshId();
		const path = await WriteEntry(id, "999.png");

		expect(await DeleteAttachment(id, "999")).toBe(true);
		expect(existsSync(path)).toBe(false);
	});

	it("should leave the message's other files alone", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");
		await WriteEntry(id, "1000.png");

		await DeleteAttachment(id, "999");

		expect(await Entries(id)).toEqual(["1000.png"]);
	});

	it("should find the file by id when the extension is not the one a caller would guess", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.webp");

		expect(await DeleteAttachment(id, "999")).toBe(true);
		expect(await Entries(id)).toEqual([]);
	});

	it("should report nothing removed for a missing file, a missing folder, or a malformed id", async () => {
		const populated = FreshId();
		await WriteEntry(populated, "999.png");

		expect(await DeleteAttachment(populated, "1000")).toBe(false);
		expect(await DeleteAttachment(FreshId(), "999")).toBe(false);
		expect(await DeleteAttachment(populated, "../999")).toBe(false);
	});

	it("should report nothing removed the second time", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");

		expect(await DeleteAttachment(id, "999")).toBe(true);
		expect(await DeleteAttachment(id, "999")).toBe(false);
	});

	it("should report and swallow a removal it could not perform", async () => {
		const id = FreshId();
		await fs.mkdir(join(MessageFolder(id), "999.png"), { recursive: true });

		expect(await DeleteAttachment(id, "999")).toBe(false);
		expect(Logged).toHaveBeenCalledWith("ERROR", expect.stringContaining("999"), expect.anything());
	});
});

describe("SyncMessageAttachments", () => {
	it("should do nothing for a message with nothing stored", async () => {
		expect(await SyncMessageAttachments(FreshId(), [Stored("999")])).toBe(0);
	});

	it("should remove the files the payload no longer mentions and keep the rest", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");
		await WriteEntry(id, "1000.png");
		await WriteEntry(id, "1001.png");

		expect(await SyncMessageAttachments(id, [Stored("1000")])).toBe(2);
		expect(await Entries(id)).toEqual(["1000.png"]);
	});

	it("should keep a file whose id is in the list even if its filename is not", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");

		expect(await SyncMessageAttachments(id, [Stored("999", { filename: "renamed.jpeg" })])).toBe(0);
		expect(await Entries(id)).toEqual(["999.png"]);
	});

	it("should keep a file stored without an extension", async () => {
		const id = FreshId();
		await WriteEntry(id, "999");
		await WriteEntry(id, "1000.png");

		expect(await SyncMessageAttachments(id, [Stored("999")])).toBe(1);
		expect(await Entries(id)).toEqual(["999"]);
	});

	it("should empty the folder but not remove it when nothing is kept", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");
		await WriteEntry(id, "1000.png");

		expect(await SyncMessageAttachments(id, [])).toBe(2);
		expect(await Entries(id)).toEqual([]);
		expect(existsSync(MessageFolder(id))).toBe(true);
	});

	it("should not count ids it was asked to keep but has no files for", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");

		expect(await SyncMessageAttachments(id, [Stored("999"), Stored("1000"), Stored("1001")])).toBe(0);
		expect(await Entries(id)).toEqual(["999.png"]);
	});

	it("should have nothing left to do on a second run", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");
		await WriteEntry(id, "1000.png");

		expect(await SyncMessageAttachments(id, [Stored("999")])).toBe(1);
		expect(await SyncMessageAttachments(id, [Stored("999")])).toBe(0);
	});
});

describe("DeleteMessageAttachments", () => {
	it("should take the folder and report how many files were in it", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");
		await WriteEntry(id, "1000.png");

		expect(await DeleteMessageAttachments(id)).toBe(2);
		expect(existsSync(MessageFolder(id))).toBe(false);
	});

	it("should report nothing for a message that never had bytes kept", async () => {
		expect(await DeleteMessageAttachments(FreshId())).toBe(0);
	});

	it("should leave the day directory and its other messages alone", async () => {
		const doomed = FreshId();
		const neighbour = FreshId();
		await WriteEntry(doomed, "999.png");
		await WriteEntry(neighbour, "999.png");

		await DeleteMessageAttachments(doomed);

		expect(existsSync(dirname(MessageFolder(doomed)))).toBe(true);
		expect(await Entries(neighbour)).toEqual(["999.png"]);
	});

	it("should report nothing the second time", async () => {
		const id = FreshId();
		await WriteEntry(id, "999.png");

		expect(await DeleteMessageAttachments(id)).toBe(1);
		expect(await DeleteMessageAttachments(id)).toBe(0);
	});

	it("should leave a saved attachment unreadable afterwards", async () => {
		const id = FreshId();
		MockFetch();

		const described = await SaveAttachment(id, MakeAttachment({ id: "999" }));
		expect(await DeleteMessageAttachments(id)).toBe(1);

		expect(await ReadAttachment(id, described)).toBeUndefined();
	});
});
