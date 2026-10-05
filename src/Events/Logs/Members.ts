import { AuditLogEvents, ClientEvents } from "simplyjs";
import { EventHandler } from "../../Types/InternalTypes.js";
import { Log } from "../../Log.js";
import { AwaitAuditEntry, ObserveAuditEntry } from "../../Logs/Attribution.js";
import { SendLog } from "../../Logs/Send.js";
import {
	BuildMemberJoinLog,
	BuildMemberLeaveLog,
	BuildMemberUpdateLog,
	BuildTimeoutEndLog,
	BuildTimeoutLog,
	DiffMember,
	SimplifyMember,
	TimeoutChange
} from "../../Logs/MemberLogs.js";

// Snapshot before the first await: the library evicts a member who left and patches the shared user in place

/** Logs a member joining. Only a bot join waits on the audit log; a person joining has no entry. */
export const memberCreate = {
	name: ClientEvents.MemberCreate,
	async execute(client, guild, member) {
		try {
			const snapshot = SimplifyMember(member);
			const entry = snapshot.bot ? await AwaitAuditEntry(client, guild.id, AuditLogEvents.BotAdd, snapshot.id) : null;
			await SendLog(client, guild.id, "MemberCreate", BuildMemberJoinLog(snapshot, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.MemberCreate>;

/**
 * Logs a member's changes and timeouts. Posts nothing when the diff is empty, which is most updates:
 * Discord also fires this event for changes to the member's account. Role changes and other changes
 * are audited under separate actions, and each is only waited on when the diff calls for it.
 */
export const memberUpdate = {
	name: ClientEvents.MemberUpdate,
	async execute(client, guild, old, now) {
		try {
			const after = SimplifyMember(now);

			if (!old) {
				// With no earlier version to diff, only an audit entry shows the change is worth logging
				const [roles, other] = await Promise.all([
					AwaitAuditEntry(client, guild.id, AuditLogEvents.MemberRoleUpdate, after.id),
					AwaitAuditEntry(client, guild.id, AuditLogEvents.MemberUpdate, after.id)
				]);

				const entry = roles ?? other;
				if (entry) await SendLog(client, guild.id, "MemberUpdate", BuildMemberUpdateLog(undefined, after, [], entry).container);
				return;
			}

			const before = SimplifyMember(old);
			const timeout = TimeoutChange(before, after);
			const fields = DiffMember(before, after);
			if (!timeout && fields.length === 0) return;

			const nickChanged = before.nick !== after.nick;
			const rolesChanged = fields.some((field) => field.startsWith("**Roles "));

			const [roles, other] = await Promise.all([
				rolesChanged ? AwaitAuditEntry(client, guild.id, AuditLogEvents.MemberRoleUpdate, after.id) : null,
				timeout || nickChanged ? AwaitAuditEntry(client, guild.id, AuditLogEvents.MemberUpdate, after.id) : null
			]);

			if (timeout) {
				const log = timeout === "started" ? BuildTimeoutLog(after, other) : BuildTimeoutEndLog(after, other);
				await SendLog(client, guild.id, "MemberUpdate", log.container);
			}

			if (fields.length > 0) {
				// Of these fields, the MemberUpdate entry only covers the nickname
				const entry = roles ?? (nickChanged ? other : null);
				await SendLog(client, guild.id, "MemberUpdate", BuildMemberUpdateLog(before, after, fields, entry).container);
			}
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.MemberUpdate>;

/**
 * Logs a member leaving as a leave, kick or ban, depending on which audit entry exists. The ban
 * entry is observed, not claimed, because guildBanAdd claims it for the mod log. A prune is logged
 * as a leave.
 */
export const memberDelete = {
	name: ClientEvents.MemberDelete,
	async execute(client, guild, member) {
		try {
			const snapshot = SimplifyMember(member);

			const [kick, ban] = await Promise.all([
				AwaitAuditEntry(client, guild.id, AuditLogEvents.MemberKick, snapshot.id),
				ObserveAuditEntry(client, guild.id, AuditLogEvents.GuildBanAdd, snapshot.id)
			]);

			const cause = ban ? "banned" : kick ? "kicked" : "left";
			await SendLog(client, guild.id, "MemberDelete", BuildMemberLeaveLog(snapshot, cause, ban ?? kick).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.MemberDelete>;