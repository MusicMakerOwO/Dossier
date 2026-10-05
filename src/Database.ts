import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import BetterSqlite3 from "better-sqlite3";
import * as dotenv from "dotenv";
import { Log } from "./Log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Loaded here because this module reads its env vars during import, before index.ts calls dotenv.config()
dotenv.config({ path: `${__dirname}/../.env`, quiet: true });

const SQLDirectory = `${__dirname}/../SQL`;

// DB_FILE overrides the location. The test suite sets it to ":memory:"
const DatabaseFile = process.env.DB_FILE ?? `${__dirname}/../dossier.sqlite`;

/** A single migration file waiting on disk. */
type Migration = {
	version: number;
	fileName: string;
};

/**
 * Returns the migrations in a directory in version order. Files are named
 * `<version>-<description>.sql`, e.g. `001-initial.sql`.
 *
 * @throws {Error} When the versions are not contiguous from 1.
 */
function LoadMigrations(directory: string): Migration[] {
	const migrations: Migration[] = [];

	for (const fileName of fs.readdirSync(directory)) {
		const match = /^(\d+)-.+\.sql$/.exec(fileName);
		if (!match) continue;

		migrations.push({ version: Number(match[1]), fileName });
	}

	migrations.sort((a, b) => a.version - b.version);

	for (const [index, migration] of migrations.entries()) {
		const expected = index + 1;
		if (migration.version !== expected) {
			throw new Error(
				`Broken migration chain in ${directory}: expected version ${expected} but found ${migration.version} ("${migration.fileName}").`
			);
		}
	}

	return migrations;
}

/** Returns the version to migrate to: the newest on disk, or DB_TARGET_VERSION when it is set. */
function ResolveTarget(latest: number, current: number): number {
	const raw = process.env.DB_TARGET_VERSION;
	if (raw === undefined || raw.trim() === "") return latest;

	const target = Number(raw);
	if (!Number.isInteger(target) || target < 0) {
		throw new Error(`DB_TARGET_VERSION must be a non-negative integer, got "${raw}".`);
	}

	if (target > latest) {
		throw new Error(`DB_TARGET_VERSION is ${target} but the newest migration on disk is ${latest}.`);
	}

	if (target < current) {
		throw new Error(
			`DB_TARGET_VERSION is ${target} but the database is already at ${current}. Migrations only move forward; restore a backup to go back.`
		);
	}

	return target;
}

const Database = new BetterSqlite3(DatabaseFile);

Database.pragma("journal_mode = WAL");
Database.pragma("cache_size = 10000");  // ~40MB cache
Database.pragma("temp_store = MEMORY"); // Use memory for temporary tables
Database.pragma("mmap_size = 268435456"); // 256MB memory map

// This may seem pretty small but it's a massive architectural decision.
// Discord IDs are around 17-20 digits these days, that's 17-20 bytes for each stored ID (keep in mind guilds, channels, users, roles, etc.)
// These can be converted to a bigint however and safely stay within 64 bits (8 bytes)
// This lower memory churn also helps the database indexes run more efficiently
Database.defaultSafeIntegers(true); // all integers are returned as bigint

// A readable history of applied migrations. `user_version` is what decides the schema version
Database.exec(`
	CREATE TABLE IF NOT EXISTS SchemaHistory (
		version    INTEGER NOT NULL PRIMARY KEY,
		file_name  TEXT    NOT NULL,
		applied_at INTEGER NOT NULL -- unix ms
	) STRICT;
`);

const migrations = LoadMigrations(SQLDirectory);
const latest = migrations.length > 0 ? migrations[migrations.length - 1].version : 0;
const current = Number(Database.pragma("user_version", { simple: true }));

if (current > latest) {
	throw new Error(
		`The database is at schema version ${current} but the newest migration on disk is ${latest}. This build is older than the database it was pointed at.`
	);
}

const target = ResolveTarget(latest, current);
const pending = migrations.filter((migration) => migration.version > current && migration.version <= target);

if (pending.length > 0) {
	// Foreign keys are off while migrating, which SQLite's table rebuild needs, and are checked
	// once at the end. The pragma has no effect inside a transaction.
	Database.pragma("foreign_keys = OFF");

	const recordMigration = Database.prepare(
		"INSERT INTO SchemaHistory (version, file_name, applied_at) VALUES (?, ?, ?)"
	);

	for (const migration of pending) {
		const sql = fs.readFileSync(`${SQLDirectory}/${migration.fileName}`, "utf8");

		// One transaction per file, so `user_version` always matches what was applied
		const apply = Database.transaction(() => {
			Database.exec(sql);
			recordMigration.run(BigInt(migration.version), migration.fileName, BigInt(Date.now()));
			Database.pragma(`user_version = ${migration.version}`);
		});

		try {
			apply();
		} catch (error) {
			throw new Error(`Migration "${migration.fileName}" failed; the database is still at version ${Database.pragma("user_version", { simple: true })}.`, { cause: error });
		}

		Log('DEBUG', `Applied migration ${migration.version}: ${migration.fileName}`);
	}

	const violations = Database.pragma("foreign_key_check") as unknown[];
	Database.pragma("foreign_keys = ON");

	if (violations.length > 0) {
		throw new Error(`Migrations left ${violations.length} foreign key violation(s) behind: ${JSON.stringify(violations, (_key, value) => (typeof value === "bigint" ? value.toString() : value))}`);
	}
} else {
	Database.pragma("foreign_keys = ON");
}

if (target < latest) {
	Log('TRACE', `Schema pinned at version ${target} by DB_TARGET_VERSION; ${latest - target} migration(s) still pending.`);
}

export { Database }