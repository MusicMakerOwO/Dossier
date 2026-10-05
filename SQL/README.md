# Schema migrations

The schema is a chain of numbered SQL files. `src/Database.ts` replays them in order on
startup and records how far it got in `PRAGMA user_version`. A fresh database starts at
version 0 and runs every file; an existing one runs only what it has not seen yet.

There is no separate "initial schema" file to keep in sync — `001-initial.sql` *is* the
first patch. One code path, so the baseline can never drift from the chain that follows it.

## Adding a migration

Create the next number in sequence:

```
SQL/002-add-guild-settings.sql
```

The filename is `<version>-<description>.sql`. Only the leading number is load-bearing;
the description is for whoever reads the directory listing next. Numbers must be
contiguous starting at 1 — a gap or a duplicate is a hard startup error, because either
one silently skips or double-applies a patch.

Rules for the file contents:

- **No transaction control.** The runner wraps each file in its own transaction, so a
  `BEGIN`/`COMMIT` inside the file will conflict with it. (Trigger bodies are fine;
  `BEGIN ... END` inside `CREATE TRIGGER` is not transaction control.)
- **Never edit a released file.** Once a migration has shipped, somebody's database has
  already run it and will never run it again. Fix it with a new migration.
- **Write it to run exactly once.** `IF NOT EXISTS` is still worth using as a safety net,
  but do not rely on re-runnability — the runner guarantees each file applies once.

## Pinning to a version

Set `DB_TARGET_VERSION` in `.env` to stop at a specific migration:

```
DB_TARGET_VERSION=3
```

The database migrates up to 3 and stops. The remaining files stay on disk and apply on
the next start once the pin is raised or removed. Useful for holding a production
database steady while newer patches are still being validated.

Leave it unset to always migrate to the newest file on disk.

Migrations only move forward. Pinning *below* the database's current version is an error,
not a downgrade — restore a backup to go back.

## Inspecting state

`PRAGMA user_version` is the authority on where a database sits. The `SchemaHistory`
table is the readable log of which file ran when:

```sql
SELECT * FROM SchemaHistory ORDER BY version;
```

`SchemaHistory` is created and owned by the runner, so it is never part of the numbered
chain.
