# Dossier

Classic Discord log bot, made completely in-house.

Built on [SimplyJS](https://github.com/MusicMakerOwO/SimplyJS), which is not discord.js and shares
none of its conventions. Library problems found along the way are written up in
[`simplyjs-findings.md`](simplyjs-findings.md).

## Status

Pre-release, MVP in progress. [`dossier-mvp-plan.md`](dossier-mvp-plan.md) is the spec and
[`TODO.md`](TODO.md) tracks what is left.

| Group      | Logs                                                 | State       |
|------------|------------------------------------------------------|-------------|
| `messages` | Edits, deletes, bulk deletes                         | Built       |
| `members`  | Joins, leaves, kicks, nicknames, roles, timeouts     | Built       |
| `mod`      | Bans, unbans, AutoMod actions, audit log attribution | Built       |
| `channels` | Channels and threads created, changed, deleted       | Built       |
| `roles`    | Roles created, changed, deleted                      | Built       |
| `assets`   | Emojis, stickers, soundboard sounds                  | Built       |
| `server`   | Server settings and webhooks                         | Built       |
| `voice`    | Joins, leaves, moves, mutes                          | Coming soon |

Still open:

- The 14-day retention sweep for stored messages and attachments is not written yet.
- Bulk deletes and webhook changes have not had a live pass on a test guild.
- The multi-hour coverage run has not been done.

## Setup

Requires Node 22 or newer.

```bash
npm install
```

Create a `.env` in the repo root:

```bash
TOKEN=your-bot-token
```

| Variable            | Required | Purpose                                                |
|---------------------|----------|--------------------------------------------------------|
| `TOKEN`             | Yes      | Bot token                                              |
| `DB_FILE`           | No       | SQLite file path. The test suite sets it to `:memory:` |
| `DB_TARGET_VERSION` | No       | Pins the schema to a migration number                  |

In the Discord Developer Portal, turn on the **Server Members** and **Message Content** privileged
intents. Dossier checks for both at startup and refuses to log in without them.

In a server, the bot needs `VIEW_AUDIT_LOG` to say who did something, and `MANAGE_WEBHOOKS` to say
what changed about a webhook. `/config` warns when either is missing.

```bash
npm run build      # lint, typecheck, compile to build/
npm run register   # push slash commands to Discord
npm start
```

Then run `/config` in a server, pick a group, and pick a channel for it. Picking a channel is what
turns a group on.

## Development

```bash
npm run check      # eslint + tsgo --noEmit; run before considering work done
npm test           # vitest run
npx vitest run src/Tests/Messages.test.ts
npx vitest run -t "should round-trip a message"
```

Typechecking uses `tsgo` (`@typescript/native-preview`), not `tsc`. Run `npm run register` again
after changing a command's `data`.

Tests run against the real schema: each test file gets its own in-memory database that replays the
full migration chain.

## Layout

| Path                                 | Contents                                                                 |
|--------------------------------------|--------------------------------------------------------------------------|
| `src/index.ts`                       | Entry point. Registers every handler exported from the directories below |
| `src/Commands`, `Buttons`, `Selects` | Interaction handlers, routed by the first segment of the `customId`      |
| `src/Events`                         | Gateway event handlers and the interaction dispatchers                   |
| `src/Config`                         | Group to event mapping, the `/config` panel, startup pre-flight          |
| `src/CRUD`                           | Database and attachment store access                                     |
| `src/Logs`                           | Log formatting, audit attribution, diffing, sending                      |
| `src/Tests`                          | Vitest suites                                                            |
| `SQL`                                | Migration chain. Read [`SQL/README.md`](SQL/README.md) before adding one |

Adding a handler means writing the file and exporting it from that directory's `index.ts`.

[`CLAUDE.md`](CLAUDE.md) covers the architecture and code conventions in more depth.

## License

Apache 2.0. See [`LICENSE`](LICENSE). Owned by Fox Tech Industries LLC.