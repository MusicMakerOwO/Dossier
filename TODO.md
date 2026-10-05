# TODO

Build order and scope follow `dossier-mvp-plan.md`. Everything under `# TODO` is MVP; everything
under `# BACKLOG` is deliberately post-MVP (plan section 5) and stays there.

## Messages (build step 2)
- [ ] Retention sweep: delete rows older than 14 days on a timer #messages
  - [ ] Call `PruneAttachments` from it, so rows and folders expire together
  - [ ] Clear the sweep timer in the SIGINT shutdown path
- [ ] messages: live pass on a bulk delete. Purge a channel with a bot, and ban someone with message cleanup on #messages
  - [ ] Is the `MESSAGE_BULK_DELETE` audit entry's `target_id` the channel? `messageDeleteBulk` keys attribution on it; if not, every purge reads "no audit entry"
  - [ ] Does a ban with message cleanup fire `MESSAGE_DELETE_BULK` at all? The `/config` explainer says it does, unverified
- [ ] Write up what the `MESSAGE_UPDATE` merge actually costs: does SimplyJS want a store hook? #simplyjs

## Remaining groups (build step 4)
- [ ] members: a prune logs each member as a plain leave. `MEMBER_PRUNE` has no `target_id`, so `RecordAuditEntry` drops it #members
- [ ] server: live pass on a test guild. Create, rename, move and delete a webhook, follow an announcement channel, change the name, icon and verification level #server
  - [ ] Does deleting a channel that has webhooks fire `WEBHOOKS_UPDATE`? `WebhookSync` handles both answers, but which one is true is not known
  - [ ] Does moving a webhook fire it for one channel or both? Same: handled either way, unverified

## Plan drift (`Groups.ts` vs plan section 3)
- [ ] Soundboard: plan lists `SOUNDBOARD_*` as out of scope, but `assets` routes all three events. Update the plan or cut them #assets
- [ ] voice: `VOICE_STATE_UPDATE` is still blocked on SimplyJS. Pick library handler, cut from MVP, or raw-socket shim #voice #simplyjs

## Coverage run (build step 5)
- [ ] Run under `NODE_V8_COVERAGE` for a few hours, then SIGINT #coverage
- [ ] Fold the output into a zero-hit list and triage each entry: missing bot feature or documented beta gap #coverage

# BACKLOG
- [ ] Per-event override command (`/config event <name> off`) #post-mvp
- [ ] Ignore lists: channels, roles, users #post-mvp
- [ ] `GUILD_SCHEDULED_EVENT_*` logging #post-mvp

# DONE
- [x] Config store and group model: per-event rows, group mapping, a channel per group #config
- [x] Migration chain with `PRAGMA user_version` #database
- [x] Clean shutdown path with no `process.exit()` #coverage
- [x] Message store with LRU cache, including cached misses #messages
- [x] Attachment storage on disk, with the row and folder owned together by `DeleteMessage` #messages
- [x] Join-time message backfill, gated on first sight of a guild #messages
- [x] Audit log attribution for message deletes #mod
- [x] `/config` panel: group select, channel select, toggle and explain buttons #wizard
- [x] SimplyJS findings 1 to 5 written up in `simplyjs-findings.md` #simplyjs
- [x] SimplyJS findings 6 to 8: no guild on `Role`/`Member`, `RoleDelete` type mismatch, `newly_created` missing #simplyjs
- [x] SimplyJS finding 9: whether cache `fetch(id)` writes back is undocumented #simplyjs
- [x] mod: bans and unbans with audit attribution, AutoMod actions merged into one log per trigger #mod
- [x] channels: channel and thread create/update/delete, with audit attribution and permission-override diffs #channels
- [x] assets: emoji, sticker and soundboard create/update/delete, with audit attribution, diffs and CDN thumbnails #assets
- [x] SimplyJS findings 10 to 12: soundboard update docs contradict `clone()`, expressions disagree on guild id and delete fallback, no expression CDN URLs #simplyjs
- [x] roles: role create/update/delete, with audit attribution, permission and color diffs, and a silent position cascade #roles
- [x] SimplyJS finding 13: `Role` has an icon hash but no CDN URL #simplyjs
- [x] members: joins, leaves and member updates, with kick and ban told apart by audit attribution, timeouts as their own log, and a member cache warmed on startup. A ban posts in both `mod` and `members`, by decision #members
- [x] `UserUpdate` cut from the MVP: Discord only sends it for the bot's own account #members
- [x] SimplyJS findings 14 to 16: `USER_UPDATE` docs, no `Member` avatar URL, account changes diff in one guild only #simplyjs
- [x] server: server settings diffed over a mod-facing field set, and webhooks created, changed, moved and deleted, told apart by diffing the webhook cache against a fresh listing. Falls back to a bare log without `MANAGE_WEBHOOKS` #server
- [x] Invites cut from the MVP: a dedicated invite tracker bot already covers them #server
- [x] Plan section 3 matched to `Groups.ts`: emojis and stickers moved out of `server` into `assets` #assets
- [x] SimplyJS finding 17: `WebhookCache` never evicts a deleted webhook #simplyjs
- [x] Message logs posted through `SendLog`: edits and deletes, with removed attachments re-uploaded #messages
- [x] messages: bulk deletes as one log with per-author counts and a full transcript file, attributed by the channel's audit entry. Attachments are named, not re-uploaded #messages
- [x] Privileged intent pre-flight: startup reads the application's flags and refuses to log in, naming the intent, when `GuildMembers` or `MessageContent` is off #wizard
- [x] `/config` warns when the bot lacks `VIEW_AUDIT_LOG` (panel-wide) or `MANAGE_WEBHOOKS` (on the server group) #wizard #server
