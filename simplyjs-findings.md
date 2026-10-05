# SimplyJS findings

Walls Dossier hits in SimplyJS, kept here rather than worked around silently. Dossier is the
library's pre-beta stress test, so a finding is a deliverable, not a bug to route around.

## What counts

- **Behaviour contradicts the types or docs:** a union branch the handler can never emit, or a
  comment the code does not follow.
- **Something Dossier needs is missing from the public surface:** a field Discord sends that the
  library drops, or context a structure should carry.
- **A library convention is broken:** a stray snake_case property on a non-payload type, or the same
  question answered three different ways across similar structures.
- **An ergonomics papercut that every consumer would re-solve,** even when Dossier has a workaround.

Out of scope: anything not visible in `node_modules/simplyjs/dist/index.d.ts` or the bundled source,
and guesses about library internals. If the public types don't say, the finding is that they don't say.

## How to write one

Add a numbered `## N. Title` section that states the problem, then cover:

1. **Found:** what Dossier was building when it hit the wall, with the file.
2. **Evidence:** the relevant declaration or handler, quoted, with `index.d.ts` / `index.js` line
   references and the library version.
3. **What would fix it:** the smallest change that would, plus any design caveat.
4. **Dossier's position:** the workaround and where it lives, or that the work is blocked. Point the
   workaround's code comment back here (`simplyjs-findings.md, finding N`) so it gets removed once
   the fix lands.

When a release fixes a finding, verify it against the declarations and the handler source, migrate
Dossier off the workaround, then remove the entry.

---

## 13. `Role` has an icon hash but no CDN URL

`Emoji.imageURL()` and `Sticker.imageURL()` build their own CDN URLs, which was the finding 12 fix.
`Role` carries `icon` (a hash) but has nothing to turn it into a URL, so a consumer has to build the
`role-icons/` path by hand.

1. **Found:** writing the `roles` group (`src/Logs/RoleLogs.ts`). The asset logs show a thumbnail
   of the changed item, and a role icon change was supposed to work the same way.
2. **Evidence:** `1.4.0-alpha`, `index.d.ts:2801-2802`:
   ```ts
   /** Role icon hash, mutually exclusive with `unicodeEmoji` */
   icon?: string | null;
   ```
   `Role` (`index.d.ts:2785-2865`) declares no URL method. The only `imageURL` declarations are
   `Emoji` (`:2491`) and `Sticker` (`:3486`). The bundle builds CDN paths for `avatars`, `embed`,
   `emojis`, `soundboard-sounds` and `stickers`, but not for `role-icons`. The same gap applies to
   guild `icons`/`banners`/`splashes`, which the `server` group will run into on `GuildUpdate`.
3. **What would fix it:** add `Role.iconURL(): string | null`, returning `null` when there is no
   custom icon, next to the existing expression helpers.
4. **Dossier's position:** it logs icon changes as text ("custom image replaced", or the unicode
   emoji), with no thumbnail. `RoleSnapshot.icon` in `src/Logs/RoleLogs.ts` points back here.

## 14. `USER_UPDATE` is documented as firing for every shared user

The `GatewayEvents.UserUpdate` comment says the event covers any user the bot shares a guild with.
Discord only sends `USER_UPDATE` for the current user, the bot itself. Everyone else's username and
avatar changes arrive as `GUILD_MEMBER_UPDATE`, once per shared guild.

1. **Found:** planning the `members` group, which had `UserUpdate` in it (`src/Config/Groups.ts`).
2. **Evidence:** `1.4.0-alpha`, `index.d.ts:797-802`:
   ```ts
   /**
    * Properties of a user the bot shares a guild with changed (username, avatar, banner, ...).
    *
    * Required intent: none (sent regardless of intents)
    */
   readonly UserUpdate: "USER_UPDATE";
   ```
   `ClientEvents.UserUpdate` (`:3951-3955`) says "a cached user's profile changes", which reads the
   same way. Discord's gateway reference: "Sent when properties about the current user change."
3. **What would fix it:** reword both comments to say the event is for the bot's own account, and
   point at `MemberUpdate` for everyone else.
4. **Dossier's position:** `UserUpdate` is cut from the `members` group and from plan section 3. A
   toggle for it would have logged nothing. Not verified against a live gateway by Dossier; if the
   author has seen it fire for another user, this entry is wrong and the cut should be revisited.

## 15. `Member` has avatar and banner hashes but no CDN URL

Same shape as finding 13. `User.avatarURL()` exists; `Member` carries `avatar` and `banner` hashes
for the per-guild profile and has nothing to turn either into a URL.

1. **Found:** writing the `members` group (`src/Logs/MemberLogs.ts`), which reports a server avatar
   being set, replaced or removed.
2. **Evidence:** `1.4.0-alpha`, `index.d.ts:3245-3248`:
   ```ts
   /** Guild-specific avatar hash, or `null` when unset */
   avatar?: string | null;
   /** Guild-specific banner hash, or `null` when unset */
   banner?: string | null;
   ```
   `Member` (`index.d.ts:3240-3388`) declares no URL method. The only `avatarURL` declarations are
   `User` (`:2462`) and `Webhook` (`:5504`).
3. **What would fix it:** `Member.avatarURL()` returning the guild avatar and falling back to
   `user.avatarURL()`, which is what every consumer showing a member wants; and `bannerURL()`.
4. **Dossier's position:** it logs server avatar changes as text and shows the account avatar as the
   thumbnail. `MemberSnapshot.avatarURL` in `src/Logs/MemberLogs.ts` points back here.

## 16. An account change has a before/after in only one of the guilds it is sent to

A username or avatar change arrives as one `GUILD_MEMBER_UPDATE` per guild the user shares with the
bot. Only the first of them reaches a listener with an `oldMember` that differs from `newMember`.

1. **Found:** deciding whether the `members` group could log account changes off `MemberUpdate`
   once finding 14 ruled out `UserUpdate`.
2. **Evidence:** `1.4.0-alpha`. `Member.detach` (`index.d.ts:3271-3276`) documents that `user` is
   the shared cached `User`, which `patch()` updates in place, and that `clone()` copies it. The
   handler (`index.js:10278-10286`) clones, then upserts:
   ```js
   const oldMember = guild.members.get(data.user.id)?.clone();
   const newMember = guild.members.upsert(data);
   ```
   The first guild's dispatch patches the shared `User`. By the second guild's dispatch the clone is
   taken from a user that already has the new name. Reproduced with one user in two guilds:
   ```
   1 fox -> wolf
   2 wolf -> wolf
   ```
3. **What would fix it:** nothing small. The honest options are documenting that `oldMember.user`
   is only a true "before" for the first guild, or having the handler diff the incoming payload's
   user against the cached one and carry that on the event.
4. **Dossier's position:** not blocked. Account changes are out of the MVP (finding 14), and
   `DiffMember` ignores everything on `user`, so the later dispatches are an empty diff either way.

## 17. `WebhookCache` only ever grows: a resync never removes a deleted webhook

`WEBHOOKS_UPDATE` names a channel and nothing else, and the docs point at `fetchChannel` as the way
to resync after one. Both it and `fetchAll` upsert what Discord returned and stop there, so a webhook
that was deleted stays in `guild.webhooks` for the life of the process.

1. **Found:** writing the `server` group (`src/Logs/WebhookSync.ts`), which diffs the cache against a
   fresh listing to tell a created webhook from a changed or deleted one.
2. **Evidence:** `1.4.0-alpha`, `index.d.ts:6149-6156`:
   ```ts
   * A `WebhooksUpdate` event is Discord's
   * hint that something changed in a channel without saying what, so
   * {@link WebhookCache.fetchChannel} is the way to resync after one.
   ```
   The implementation (`index.js:6920-6934`):
   ```js
   async fetchAll() {
     const fetched = await this.client.rest.get(`/guilds/${this.guild.id}/webhooks`);
     return fetched.map((webhook) => this.upsert(webhook));
   }
   async fetchChannel(channelId) {
     const fetched = await this.client.rest.get(`/channels/${channelId}/webhooks`);
     return fetched.map((webhook) => this.upsert(webhook));
   }
   ```
   A delete is the one change a listing reports by omission, and nothing here reads an omission.
   `Webhook.delete()` aside, there is no path that takes an entry out. `IntegrationCache.fetchAll`
   is documented the same way ("call `guild.integrations.fetchAll()` to resync") and is worth the
   same look; Dossier does not use it.
3. **What would fix it:** have `fetchAll` drop cached ids the response did not contain, and
   `fetchChannel` do the same for cached webhooks whose `channelId` is that channel. The caveat is a
   webhook moved to another channel: it is missing from the old channel's listing but not deleted,
   so `fetchChannel` evicting it would be wrong until the new channel is listed. Returning the diff
   (`{ added, updated, removed }`) rather than a bare array would also save every consumer from
   snapshotting the cache by value first, since `upsert` patches in place.
4. **Dossier's position:** not blocked. `WebhookSync.ts` snapshots the cache before each fetch,
   compares by hand, asks `fetch(id)` whether a missing webhook was moved or deleted, and evicts
   with `guild.webhooks.delete(id)` itself. Its header comment points back here.
