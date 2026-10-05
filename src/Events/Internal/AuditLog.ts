import { ClientEvents } from "simplyjs";
import { EventHandler } from "../../Types/InternalTypes.js";
import { RecordAuditEntry } from "../../Logs/Attribution.js";

export const auditLogEntryCreate = {
	name: ClientEvents.AuditLogEntryCreate,
	async execute(client, guild, entry) {
		RecordAuditEntry(guild.id, entry);
	}
} as EventHandler<typeof ClientEvents.AuditLogEntryCreate>;