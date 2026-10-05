# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Dossier is a Discord logging bot with a `/config` wizard, owned by Fox Tech Industries LLC.
`dossier-mvp-plan.md` is the authoritative spec — read it before proposing features. It defines
the MVP boundary, the event groups, and a list of ideas that are deliberately **out** of scope
(section 5). Do not promote post-MVP items into the MVP; when suggesting a feature, say plainly
which side of that line it falls on. The author makes the architectural calls.

Dossier has a second purpose that shapes it: it is the pre-beta stress test for **SimplyJS**, the
Discord library it is built on. When Dossier hits a wall in the library, that is a finding to
report, not a bug to route around (see `voice` in plan section 3).

## SimplyJS is not discord.js

`simplyjs` (currently `1.4.0-alpha`) is a from-scratch library by the same author. It shares no
class names, signatures, or conventions with discord.js — do not suggest discord.js patterns.

- It is consumed as a published npm package: bundled `dist/` plus declarations, no source tree.
  **The declarations in `node_modules/simplyjs/dist/index.d.ts` are the source of truth.** If
  something is not in the public types, ask — do not infer it, and do not write comments
  speculating about library internals.
- `camelCase` everywhere, with an `Id` suffix (`guildId`, never `guildID`). `snake_case` on a
  library surface means raw Discord wire format; a stray snake_case property on a non-payload
  type is a library bug worth flagging.
- Builders **are** their wire payload — no `toJSON()`. They store fields under snake_case wire
  names (`custom_id`), which is why tests can assert against a builder as if it were JSON.
- Intents are named by library key (`GuildMessages`), not Discord's wire name.
- Protocol constants are `as const` object maps, not `enum`s.
- There is no message cache and no session abstraction — by design. Collectors
  (`createCollector`, `awaitEvent`) are the temporary-listener primitive.

## Commands

```bash
npm run check      # eslint + tsgo --noEmit; run before considering work done
npm run build      # check, then wipe build/ and compile to build/
npm test           # vitest run
npm start          # node ./build/index.js  (requires a build)
npm run register   # push slash commands to Discord; run after changing a command's `data`
```

Single test file / single test:

```bash
npx vitest run src/Tests/Messages.test.ts
npx vitest run -t "should round-trip a message"
```

Typechecking uses `tsgo` (`@typescript/native-preview`), not `tsc`.

## Architecture

**Handler registration is convention-driven.** `src/index.ts` imports `Commands/`, `Buttons/`,
`Selects/` and `Events/` as namespace objects and walks `Object.values()` into maps on the client,
throwing on duplicate names/customIds. Adding a handler means writing the file and exporting it
from that directory's `index.ts` — nothing else. `InternalTypes.d.ts` defines the four handler shapes;
`FullClient` is `Client` plus those maps.

**Interaction routing is two-layer.** `Events/SlashCommandUsed.ts`, `ButtonUsed.ts` and
`SelectMenuUsed.ts` are dispatchers: they split `customId` on `:`, look the first segment up in
the client map, and pass the remaining segments as `args`. So a button's `customId` is
`config-toggle` while its wire customId is `config-toggle:<group>:<on|off>` — all per-interaction
state rides in the customId, and no session state is held anywhere.

**Config is stored per event, exposed per group.** `Config/Groups.ts` holds the group → event
mapping (`satisfies Record<string, readonly (keyof ClientEventMap)[]>`, so a bad event name is a
compile error). `GuildEvents` rows are keyed by single event name; a group is a UI construct that
collapses its rows into `on`/`off`/`partial` via `CRUD/GuildEvents.GetEventGroupConfig`. This is what makes a
future per-event override command a UI change rather than a migration — keep it that way.

**The panel has exactly one definition.** Every config handler re-renders through
`Config/Panel.BuildPanel(client, guild, focusedGroup?)` rather than patching the message it was
handed, so the panel always reflects the database. Components V2 throughout. Picking a channel
*is* the enable action (`channel_id` is NOT NULL, so a group cannot be on without a destination).

**Message store, not cache.** `MESSAGE_CREATE` is consumed to populate SQLite and never logged;
`MESSAGE_DELETE`/`_BULK` arrive as IDs only, so the store is the only place the content exists.
`CRUD/Messages.ts` is the sole owner of the `payload` encode/decode and the only place that knows
`encryption_version` semantics (0 = plaintext JSON). Its `LRUCache` distinguishes `undefined`
(not cached) from `null` (cached miss) — misses are cached on purpose, since deletes of
aged-out messages would otherwise query forever. Cached objects are returned **by reference**;
mutating one without calling `Set` silently desynchronises cache from table.
`CRUD/GuildEvents.ts` uses a plain `Map` instead, because guilds are a bounded set with nothing
to evict; its writes invalidate the guild's entry rather than patching it.

**A message is a row and a folder, and `DeleteMessage` owns both.** Attachment bytes live on disk
under `CRUD/Attachments.ts` (`<day>/<message_id>/<attachment_id><ext>`) — the store's only index
is the path, so a dropped row with its files left behind is a leak nothing can find. That is why
`DeleteMessage` is async: it deletes the row *and* calls `DeleteMessageAttachments`, so no caller
gets to do only half. Within a message folder the **id is the key and the extension is
decoration** — resolve by id, never by rebuilding the name from `filename`, which is display
metadata off a payload Discord may send partially. `SaveMessage` is the one deliberate exception:
it does not reconcile bytes, so a caller that shrinks an attachment list runs
`SyncMessageAttachments` itself. The 14-day sweep does not exist yet; `PruneAttachments` is its
filesystem half, waiting on a caller.

**An audit entry is claimed once, or observed.** `Logs/Attribution.AwaitAuditEntry` hands an entry
to exactly one caller, so two events on one key are never both attributed to the same moderator.
`ObserveAuditEntry` reads without claiming and exists for the one entry two events share: a ban,
which fires `GuildBanAdd` (claims, `mod`) and `MemberDelete` (observes, `members`). Reach for
`AwaitAuditEntry` unless another handler already claims the same action and target.

**A webhook change is a diff Dossier makes itself.** `WEBHOOKS_UPDATE` names a channel and nothing
else, so `Logs/WebhookSync.ts` snapshots `guild.webhooks`, re-lists the channel, and reports what is
different. The library's cache only ever grows (`simplyjs-findings.md`, finding 17), so the sync is
also what evicts deleted webhooks. Skip it and the same delete is reported on every later event.
Syncs are queued per guild, because a move touches two channels. A guild that was never listed, or
that has not granted `MANAGE_WEBHOOKS`, gets the bare "something changed here" log instead of a
guess. A webhook snapshot never reads `token` or `url`.

**All integers are bigint.** `Database.defaultSafeIntegers(true)` — Discord snowflakes are stored
as 64-bit integers, not text. Every ID crossing into the database is `BigInt(...)`, every row
field comes back as `bigint`, and `enabled` is `0n`/`1n`.

**Schema is a migration chain.** `src/Database.ts` replays `SQL/NNN-*.sql` in order on module
evaluation and records progress in `PRAGMA user_version`. `SQL/README.md` is the full contract —
read it before adding a migration. Key rules: numbers contiguous from 1 (a gap is a startup
error), no `BEGIN`/`COMMIT` inside a file (the runner wraps each), never edit a released file.

## Conventions

- **Own code over dependencies.** Dependencies are for genuinely complex needs (canvas, crypto).
  Do not reach for a package as a first answer. TypeScript, Rust and SQL; no Python.
- Tabs. `PascalCase` for exported functions (`BuildPanel`, `LoadMigrations`, `GetGroup`),
  `#private` class fields, `SCREAMING_CASE` const maps.
- All embed colors come from `COLOR` in `src/Constants.ts`. Brand orange is for setup surfaces
  only; log embeds use the semantic ramp, because the strip is a mod's fastest scanning signal.
- Console output goes through `Log()` in `src/Log.ts`, which self-suppresses under vitest unless
  `LOG_VERBOSE=1`.
- **Never call `process.exit()`.** V8 only flushes `NODE_V8_COVERAGE` on a clean exit, and the
  coverage run is a project deliverable. Shutdown is `await client.destroy()`, close the SQLite
  handle, clear timers, then set `process.exitCode`. (`unicorn/no-process-exit` enforces this.)
- **Comments are brief and written for developers.** Every function gets a JSDoc of one to three
  sentences saying what it does and what a caller must know. No design history, no rejected
  alternatives. Inside a function body, a comment is the exception: one plain sentence, and only
  where reordering or simplifying the code under it would cause a bug. Prefer a named local or a
  small helper over a comment. A workaround for a logged library finding gets one line naming it,
  e.g. `(simplyjs-findings.md #17)`. Tests carry almost no comments; the test name states the
  intent. Never use `--` as punctuation.

## Environment

`.env` next to the repo root: `TOKEN` (required), `DB_TARGET_VERSION` (optional schema pin),
`DB_FILE` (optional; `vitest.config.ts` sets it to `:memory:` for the whole suite, because
`Database.ts` opens its connection during module evaluation — before any test body can run).
Each test file gets its own worker and therefore its own in-memory database that still replays
the real migration chain, so tests run against the real schema rather than a fixture.