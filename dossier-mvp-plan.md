# Dossier - MVP Plan

A Discord logging bot with a built-in config wizard. Owned by Fox Tech
Industries LLC.

*Library facts in this document were checked against SimplyJS `1.4.0-alpha`
on 2026-09-15. Where a claim is about SimplyJS specifically, it came from the
author and has been verified against the library source - treat it as given,
not as something to re-derive.*

---

## 0. Why this project exists

### Read this first if you are unfamiliar with SimplyJS

**SimplyJS is not discord.js.** It is a from-scratch TypeScript Discord
library, MIT licensed, currently in alpha, written by the same author as this
bot. It is a full ergonomic wrapper - not a thin API mirror - but it is *not*
API-compatible with discord.js and does not share its class names, method
signatures, or conventions. Do not assume parity. Do not suggest discord.js
patterns, snippets, or idioms as solutions here.

Conventions you will actually encounter:

- **Naming: `camelCase` on everything you touch.** Properties, method and
  constructor parameters, option objects, event payloads. `Id` suffix, never
  `ID` - `guildId`, `channelId`, `setCustomId()`.
- **`snake_case` means raw Discord wire format.** If a type has snake_case
  fields, it mirrors Discord's REST/gateway JSON field-for-field and is meant
  to be diffed against Discord's own API reference. Everything else is
  camelCase. If you find a stray snake_case property on a library surface
  that isn't a raw payload type, treat it as a bug and flag it rather than
  matching it.
- **There is no built-in message cache and this is deliberate.** See section 2.
  Do not propose adding one to the library as a fix for anything in this plan.
- Protocol constants ship as `as const` object maps rather than `enum`s, so
  they're importable values with unions derived from them.
- **Intents are named by their library key, not Discord's wire name.**
  `Guilds`, `GuildMessages`, `MessageContent`, `GuildMembers`,
  `GuildModeration`, `AutoModerationExecution`, `GuildWebhooks`,
  `GuildInvites`, `GuildExpressions`, `GuildVoiceStates`. `ResolveIntents`
  throws on an unknown key, so a wire-format name (`GUILD_MESSAGES`) is a
  startup crash, not a silent no-op. Section 3 lists them in the correct form.
- **Every builder *is* its wire payload.** There is no `toJSON()` - a builder
  can be sent, logged, cloned, or inspected as-is, and nested builders need no
  conversion. Fields on a builder are stored under their snake_case wire names
  (`custom_id`, `min_values`), which is consistent with the rule above rather
  than an exception to it.
- `SlashCommandBuilder` is fluent (`setName().setDescription()
  .addStringOption(name, description, config)`), with per-option settings
  passed as a config object. `addSubcommand()` / `addSubcommandGroup()` take
  either a prebuilt builder or a callback.
- **Temporary listeners are collectors, not sessions.** The primitives are
  `createCollector(emitter, event, options)` and `awaitEvent(...)`, bounded by
  `time` / `idle` / `max`. There is no session abstraction; the wizard builds
  whatever state it needs on top of collectors.

**Treat the type declarations as the source of truth, and do not reason about
internals.** SimplyJS is consumed here as a published npm package -
`npm install simplyjs`, currently `1.3.0-alpha`, dual ESM/CJS with bundled
declarations, `ws` its only dependency, Node >= 20. Bundled output plus
declarations: there is no source tree, no file layout, and no
notion of which module owns what. That is by design: the library is meant to
feel natural to build against without thinking about what happens
underneath.

Practically, for the model reading this:

- If something isn't in the public types, do not infer it from how
  discord.js does it, from how you'd implement it, or from anything in this
  document. Ask.
- Do not guess at method names or option shapes. Check the declarations.
- Do not speculate in code comments about internal behavior (caching
  strategy, dispatch order, request batching). If a behavior matters to
  Dossier's correctness, it needs to be confirmed by the author, not assumed.
- The author will supply additional library context as needed. Absence of a
  detail here means it hasn't been covered yet, not that it doesn't exist.

### The dual mandate

Dossier has two jobs, and they are held in that order when they conflict:

**1. Technical - it is the pre-beta stress test for SimplyJS.**

SimplyJS is approaching a beta push. Before that happens the author wants
real, sustained, non-synthetic pressure on the library, applied by a
consumer rather than by its own test suite. A log bot was chosen over the
alternatives (multiple small bots, porting an existing dungeon crawler)
because a single long-running bot exercises the widest surface:

- **Gateway breadth.** Logging means subscribing to most event types, so
  dispatch, payload parsing, and cache patching all get hit continuously
  rather than in isolated unit tests.
- **Interaction depth.** The config wizard needs slash commands, select
  menus, buttons, modals, and collectors - the whole interaction layer driven
  by a real flow instead of an example snippet. That layer landed in
  `1.2.0-alpha`, but `1.3.0-alpha` added Components V2, split the
  reply/edit payload types, and made `ephemeral` valid only on the callbacks
  that send a new message. The 1.3 surface is the newest and least exercised,
  so weight the wizard toward it where there's a choice.
- **Uptime.** Reconnects, RESUMED handling, cache drift, and memory behavior
  only surface over hours, not over a test run.
- **Coverage.** Run under `NODE_V8_COVERAGE`, exercise for a few hours,
  shut down cleanly, and fold the output into a zero-hit list. Each unhit
  branch gets triaged: *should Dossier have reached this?* Yes means a
  missing bot feature. No means a documented gap for the beta notes. This is
  pragmatic coverage, not an exhaustiveness target.

Rare events that Dossier will never see in normal traffic are covered by
synthesized fixture payloads instead. That is why the excluded-events list in
section 3 costs nothing on the coverage plan.

**2. User-facing - it has to be a bot someone would actually install.**

A stress test that nobody would use produces unrealistic pressure. Dossier is
intended to ship as a real product: useful to moderators, configurable
without reading documentation, and pleasant to set up. The setup wizard is
not a demo - it is the main user-facing surface, and its quality is a project
goal in its own right, not just a vehicle for exercising component code.

Concretely that means:
- A moderator can install it and be logging within a couple of minutes.
- Log output is scannable at speed in a busy channel (see the color split in
  section 1).
- Every log line answers *what happened, to whom, and by whom* - which is
  why audit log attribution is MVP rather than stretch.

### Working constraints

These are the author's standing preferences and they apply to this project.

- **Own code over dependencies.** Dependencies get used for genuinely complex
  needs (canvas, encryption, large systems); anything else is written
  in-house for control, security, and scope. Do not reach for a package as a
  first answer.
- **TypeScript.** Rust and SQL also in play. Python is not used.
- **Scope discipline is a hard requirement.** A prior project by the same
  author was shut down because of scope creep, and the lesson was internalized
  as strict MVP boundaries with a disciplined update cadence. Section 5 lists
  known-good ideas that are deliberately *not* in the MVP. Do not promote them
  into it. When suggesting features, say plainly whether something is MVP or
  post-MVP.
- **The author makes the architectural calls.** Explain tradeoffs and
  disagree where warranted, but do not decide unilaterally or quietly expand
  a design.

---

## 1. Identity

**Name:** Dossier

Sits beside FBI as a sibling rather than repeating the backronym gag. Short,
pronounceable, unambiguously about records. No known naming collision in the
Discord bot space (unlike Papertrail, which is a SolarWinds product).

**Color:** Fox orange, but split by surface.

| Surface | Color | Reason |
| --- | --- | --- |
| Wizard, `/config`, help, about, errors, avatar, docs | Fox orange | Brand impressions form during setup. This is where the signature lives. |
| Log embeds | Semantic palette | Embed color is the fastest signal a mod has while scrolling. Spending it on a logo costs readability. |

Suggested semantic ramp (tune against Discord dark theme at 4px strip width):

```
destructive   -> red        (delete, bulk delete, role/channel delete)
additive      -> green      (join, create, invite create)
mutative      -> amber      (edit, update, rename)
moderation    -> deep red   (ban, kick, timeout, automod)
neutral/info  -> blue       (voice, webhook, misc server)
```

Do not encode six things in six shades of one hue. Subtle differences vanish
at the width the strip actually renders.

---

## 2. Core design decisions

### Group toggles, not per-event toggles

The wizard exposes **groups**, not individual events. This kills the sub-menu
tree entirely.

**The group is also the routing unit.** A group is both "is this on" and
"where does it go," so the wizard is one screen per group instead of a toggle
pass plus a separate destination pass.

**Store per-event, expose per-group.** Config rows are keyed by event name
(or a bitfield). The group is a UI construct layered on top. When someone
asks for "everything except member_update," that ships later as a flat
command (`/config event <name> off`) - a UI change, not a migration.

### High-volume events get their own groups

`members` and `voice` are split out specifically because they're noisy.
`GUILD_MEMBER_UPDATE` fires on every role and nickname change;
`VOICE_STATE_UPDATE` fires on every join, leave, move, mute, deafen, and
stream toggle, each as its own dispatch. Giving them dedicated groups means
"too noisy" has an off switch without sub-menus.

### Audit log attribution is MVP, not stretch

`GUILD_AUDIT_LOG_ENTRY_CREATE` is the only source of *who did it*. Without
it, `GUILD_MEMBER_REMOVE` can't distinguish a kick from someone leaving, and
half the log lines are useless to a moderator. Requires the `VIEW_AUDIT_LOG`
permission and the `GuildModeration` intent.

The client event is `AuditLogEntryCreate` - no `Guild` prefix, unlike the
gateway event name. `guild.fetchAuditLogs()` exists as a backfill path if the
live event turns out to race the event it's attributing.

### Message store is the bot's job, not SimplyJS's

SimplyJS deliberately ships no message cache. Guilds/channels/roles are a
bounded set delivered up front with deltas afterward; messages are an
unbounded append-only stream with no initial sync. That's a database, not a
cache, and the eviction policy belongs to the consumer.

(Mechanically the bounded set arrives in `GUILD_CREATE` after READY, not in
the READY payload itself - READY carries unavailable stubs. The client's
`Ready` event fires once those initial guilds have landed, so the caches are
populated by the time Dossier sees `Ready`. Don't time anything off the raw
READY payload.)

Dossier writes its own store, the way a user would:

- SQLite, one table
- 14-day sweep (matches the bulk-delete window, and is about as far back as a
  mod ever looks - note that Discord's own audit log retention is 45 days, so
  the two windows don't line up)
- No per-channel cap
- `MESSAGE_CREATE` is consumed to populate the store, **not** logged

**This is also an experiment.** If the handler code comes out clean, SimplyJS
needs no store hook. If the same three lines of lookup-and-merge appear at
the top of every message handler, that's the interface asking to exist - and
the async cost of a store hook gets evaluated then, not now.

---

## 3. Supported events (MVP)

### messages
Intents: `GuildMessages`, `MessageContent` (privileged)

```
MESSAGE_UPDATE         edits
MESSAGE_DELETE         ID-only, requires the store for content
MESSAGE_DELETE_BULK    ID-only, requires the store for content
```

`MESSAGE_CREATE` is listened to but never logged - it feeds the store.

`MESSAGE_DELETE` / `MESSAGE_DELETE_BULK` surface as plain id payloads
(`id`/`ids`, `channelId`, `guildId`), which is why the store exists.

`MESSAGE_UPDATE` is different and needs care: SimplyJS builds a fresh
`Message` from whatever Discord sent, with no old/new pair and no merge
against a previous copy. Discord's update payload can be partial - an embed
unfurl is the common case - so an absent field reads as missing, not as
unchanged. The store supplies "before"; assume it may also have to supply
parts of "after". **This is the first real test of the section 2 experiment,
so log what the merge actually costs here rather than just making it work.**

### members
Intents: `GuildMembers` (privileged)

```
GUILD_MEMBER_ADD       joins
GUILD_MEMBER_REMOVE    leave / kick / ban (ambiguous without audit log)
GUILD_MEMBER_UPDATE    nickname, roles, timeout - HIGH VOLUME
```

`USER_UPDATE` was in this group and has been cut. Discord only sends it for
the bot's own account, so account-level changes (username, avatar) are not
logged in the MVP. See `simplyjs-findings.md`, findings 14 and 16.

### mod
Intents: `GuildModeration`, `AutoModerationExecution`, `Guilds`

```
GUILD_BAN_ADD
GUILD_BAN_REMOVE
GUILD_AUDIT_LOG_ENTRY_CREATE      attribution - needs VIEW_AUDIT_LOG
AUTO_MODERATION_ACTION_EXECUTION
```

### channels
Intents: `Guilds`

```
CHANNEL_CREATE
CHANNEL_UPDATE
CHANNEL_DELETE
THREAD_CREATE
THREAD_UPDATE
THREAD_DELETE
```

### roles
Intents: `Guilds`

```
GUILD_ROLE_CREATE
GUILD_ROLE_UPDATE
GUILD_ROLE_DELETE
```

### assets
Intents: `GuildExpressions`

```
GUILD_EMOJIS_UPDATE
GUILD_STICKERS_UPDATE
```

Split out of `server` when it was built: SimplyJS turns each of these into per-entity
create/update/delete events, which made it a group of its own rather than two lines in another.

### server
Intents: `Guilds`, `GuildWebhooks`

```
GUILD_UPDATE
WEBHOOKS_UPDATE        no detail in payload, only "something changed here"
```

`WEBHOOKS_UPDATE` carries a channel and nothing else, so Dossier lists the channel's webhooks and
diffs them against the list from before to say what was created, changed or deleted. That needs
the `MANAGE_WEBHOOKS` permission; without it the log falls back to "something changed here".

`INVITE_CREATE` / `INVITE_DELETE` were in this group and have been cut. The author already runs a
dedicated invite tracker bot, and folding it into Dossier would be merging two products rather
than finishing one.

### voice
Intents: `GuildVoiceStates`

```
VOICE_STATE_UPDATE     join / leave / move / mute - HIGH VOLUME
```

> **BLOCKED ON THE LIBRARY - read before starting this group.**
> SimplyJS `1.3.0-alpha` has no `VOICE_STATE_UPDATE` handler, no voice state
> structure, and no client event for it. Only the constants exist
> (`GatewayIntents.GuildVoiceStates`, `GatewayEvents.VoiceStateUpdate`), so a
> live dispatch is swallowed by the dispatcher with an
> `Unhandled event: "VOICE_STATE_UPDATE"` warning on the console.
>
> This is the stress test working as intended - it is a library gap Dossier
> found, not a bot bug, and it is the author's call how to resolve it. Do not
> pick one of these unilaterally:
>
> 1. Add the handler to SimplyJS first (correct fix, widens scope into the
>    library before the bot ships).
> 2. Cut `voice` from the MVP and note it as a library-blocked group.
> 3. Drive the group off the raw socket event as a temporary shim.
>
> Build the other six groups first either way - nothing else depends on this
> one, and option 1 is a better decision once routing and formatting exist.

### Explicitly out of scope

```
TYPING_START              no moderation value
PRESENCE_UPDATE           privileged intent, no moderation value, huge volume
SUBSCRIPTION_*            not moderation
ENTITLEMENT_*             not moderation
SOUNDBOARD_*              rare, low value
INVITE_*                  covered by a dedicated invite tracker bot
STAGE_INSTANCE_*          rare
GUILD_SCHEDULED_EVENT_*   borderline, defer to post-MVP
THREAD_MEMBERS_UPDATE     high volume, low value
```

These are covered by synthesized fixture payloads for SimplyJS coverage
purposes, not by live traffic. Excluding them from Dossier costs nothing on
the coverage plan.

### Privileged intents required

`GuildMembers` and `MessageContent`. Both are toggles in the dev portal
under 100 servers. Worth surfacing in the wizard as a pre-flight check so
setup fails loudly rather than silently logging nothing.

---

## 4. Build order

1. **Config store + group model.** Per-event rows, group mapping table,
   channel destination per group. Dumb persistence - the moment it needs
   migrations, it's testing the wrong thing.
2. **One group end to end.** `messages`, because it's the hardest: needs the
   SQLite store, the 14-day sweep, and ID-only payload enrichment. If the
   architecture survives this group it survives the rest.
3. **The wizard.** Slash command entry, select menus for groups, channel
   pickers, buttons, modals. This is the interaction-layer stress test -
   collectors, component handling, live state reads.
4. **Remaining groups.** Mostly formatter work once dispatch and routing
   exist.
5. **Coverage run.** `NODE_V8_COVERAGE=./coverage`, exercise for a few hours,
   SIGINT with a clean shutdown path. Fold the JSON into a zero-hit list.
   For each entry ask: *should Dossier have hit this?* Yes -> missing bot
   feature. No -> documented gap for beta notes.

   **Build the clean shutdown path in step 1, not here.** V8 only flushes the
   coverage profile on a clean exit, so `process.exit()` anywhere in Dossier
   silently truncates the data this whole step depends on, and any timer or
   handle holding the event loop open stalls the shutdown. This is a
   functional requirement of the stress-test goal, not a style preference -
   and it's invisible until it costs a multi-hour run.

   The library holds up its end here: it never calls `process.exit()` and
   unrefs its own timers, so `await client.destroy()` followed by setting
   `process.exitCode` is the whole shutdown path on the SimplyJS side. Dossier
   owns the rest - the SQLite handle, the sweep timer, anything else it opened.

---

## 5. Open questions

- How `voice` gets unblocked - library handler, cut from MVP, or raw-socket
  shim. Author's call, and it doesn't need making until the other six groups
  are done. See section 3.
- Does SimplyJS want a message store hook? Answered by step 2, not before.
  `MESSAGE_UPDATE`'s partial payloads are part of that answer, not a separate
  question.
- Fox orange exact hex - a few points toward burnt/amber reads as archival
  rather than notification badge. Needs a side-by-side on a real dark-theme
  member list.
- Per-event override command (`/config event <name> off`) - post-MVP, but
  the storage model must not preclude it.
- Ignore lists (channels, roles, users) - almost certainly needed in
  practice, but not MVP. Same storage caveat applies.