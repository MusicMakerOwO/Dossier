import { AuditLogEvents, ClientEvents } from "simplyjs";
import { EventHandler, FullClient } from "../../Types/InternalTypes.js";
import { Log } from "../../Log.js";
import { AwaitAuditEntry } from "../../Logs/Attribution.js";
import { CreatedDuring, Moves, Reorder, ReorderQueue, SortByPosition } from "../../Logs/ReorderBatch.js";
import { SendLog } from "../../Logs/Send.js";
import {
	BuildRoleCreateLog,
	BuildRoleDeleteLog,
	BuildRoleReorderLog,
	BuildRoleUpdateLog,
	DiffRole,
	SnapshotRole
} from "../../Logs/RoleLogs.js";

// Snapshot before the first await: the library evicts a deleted role once the event has been emitted

export const roleCreate = {
	name: ClientEvents.RoleCreate,
	async execute(client, guild, role) {
		try {
			const snapshot = SnapshotRole(role);
			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.RoleCreate, snapshot.id);
			await SendLog(client, guild.id, "RoleCreate", BuildRoleCreateLog(snapshot, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.RoleCreate>;

/**
 * Logs what changed on a role. Posts nothing when the diff is empty. A position change is queued
 * for the reorder log instead, because one move fires an update for every role it shifts.
 */
export const roleUpdate = {
	name: ClientEvents.RoleUpdate,
	async execute(client, guild, old, now) {
		try {
			const after = SnapshotRole(now);
			const before = old ? SnapshotRole(old) : undefined;

			if (before?.position != null && before.position !== after.position) {
				QueueRoleReorder(guild.id, after.id, before.position, (batch) => LogRoleReorder(client, guild.id, batch));
			}

			const fields = before ? DiffRole(before, after) : [];

			if (before && fields.length === 0) return;

			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.RoleUpdate, after.id);
			await SendLog(client, guild.id, "RoleUpdate", BuildRoleUpdateLog(before, after, fields, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.RoleUpdate>;

const QueueRoleReorder = ReorderQueue<number>();

/**
 * Logs which roles moved in a reorder batch. Posts nothing when the order is unchanged, as when a
 * create or delete only renumbers the list.
 */
async function LogRoleReorder(client: FullClient, guildId: string, batch: Reorder<number>): Promise<void> {
	try {
		const guild = client.guilds.get(guildId);
		if (!guild) return;

		const roles = [...guild.roles.values()].filter((role) => !CreatedDuring(role.id, batch));

		// Highest position first, the order Discord lists roles in
		const after = SortByPosition(roles.map((role) => [role.id, role.position] as const)).toReversed();
		const before = SortByPosition(roles.map((role) => [role.id, batch.before.get(role.id) ?? role.position] as const)).toReversed();

		const { moves, shifted } = Moves(before, after);
		if (moves.length === 0) return;

		const names = new Map(roles.map((role) => [role.id, role.name]));
		await SendLog(client, guildId, "RoleUpdate", BuildRoleReorderLog(guildId, moves, shifted, names).container);
	} catch (error) {
		Log('ERROR', error);
	}
}

export const roleDelete = {
	name: ClientEvents.RoleDelete,
	async execute(client, guild, role) {
		try {
			const snapshot = SnapshotRole(role);
			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.RoleDelete, snapshot.id);
			await SendLog(client, guild.id, "RoleDelete", BuildRoleDeleteLog(snapshot, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.RoleDelete>;
