import { AuditLogEvents, Channel, ClientEvents, Guild } from "simplyjs";
import { EventHandler, FullClient } from "../../Types/InternalTypes.js";
import { LoggedEvent } from "../../Config/Groups.js";
import { Log } from "../../Log.js";
import { AuditAction, AwaitAuditEntry } from "../../Logs/Attribution.js";
import { CreatedDuring, Moves, Reorder, ReorderQueue, SortByPosition } from "../../Logs/ReorderBatch.js";
import { SendLog } from "../../Logs/Send.js";
import {
	BuildChannelCreateLog,
	BuildChannelDeleteLog,
	BuildChannelReorderLog,
	BuildChannelUpdateLog,
	BuildThreadCreateLog,
	ChannelMove,
	ChannelSnapshot,
	DiffChannel,
	DiffOverwrites,
	Snapshot,
	SortScope,
	SortScopeOf
} from "../../Logs/ChannelLogs.js";

export const channelCreate = {
	name: ClientEvents.ChannelCreate,
	async execute(client, guild, channel) {
		try {
			const snapshot = Snapshot(channel);
			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.ChannelCreate, snapshot.id);
			await SendLog(client, guild.id, "ChannelCreate", BuildChannelCreateLog(snapshot, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.ChannelCreate>;

export const channelUpdate = {
	name: ClientEvents.ChannelUpdate,
	async execute(client, guild, before, after) {
		await LogUpdate(client, guild, "ChannelUpdate", before, after);
	}
} as EventHandler<typeof ClientEvents.ChannelUpdate>;

export const channelDelete = {
	name: ClientEvents.ChannelDelete,
	async execute(client, guild, channel) {
		try {
			const snapshot = Snapshot(channel);
			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.ChannelDelete, snapshot.id);
			await SendLog(client, guild.id, "ChannelDelete", BuildChannelDeleteLog(snapshot, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.ChannelDelete>;

export const threadCreate = {
	name: ClientEvents.ThreadCreate,
	async execute(client, guild, thread, newlyCreated) {
		try {
			// Discord also sends this event when the bot is added to an existing private thread
			if (!newlyCreated) {
				Log('TRACE', `Thread ${thread.id} became visible, but was not just created`);
				return;
			}

			await SendLog(client, guild.id, "ThreadCreate", BuildThreadCreateLog(Snapshot(thread)).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.ThreadCreate>;

export const threadUpdate = {
	name: ClientEvents.ThreadUpdate,
	async execute(client, guild, before, after) {
		await LogUpdate(client, guild, "ThreadUpdate", before, after);
	}
} as EventHandler<typeof ClientEvents.ThreadUpdate>;

export const threadDelete = {
	name: ClientEvents.ThreadDelete,
	async execute(client, guild, thread) {
		try {
			const snapshot = Snapshot(thread);
			const entry = await AwaitAuditEntry(client, guild.id, AuditLogEvents.ThreadDelete, snapshot.id);
			await SendLog(client, guild.id, "ThreadDelete", BuildChannelDeleteLog(snapshot, entry).container);
		} catch (error) {
			Log('ERROR', error);
		}
	}
} as EventHandler<typeof ClientEvents.ThreadDelete>;

/**
 * Logs what changed on a channel or thread. Posts nothing when the diff is empty. A position change
 * is queued for the reorder log instead, because one move fires an update for every sibling it shifts.
 */
async function LogUpdate(client: FullClient, guild: Guild, event: Extract<LoggedEvent, "ChannelUpdate" | "ThreadUpdate">, old: Channel | undefined, now: Channel): Promise<void> {
	try {
		const after = Snapshot(now);
		const before = old ? Snapshot(old) : undefined;

		if (before?.position != null && before.position !== after.position) {
			const placement = { position: before.position, parentId: before.parentId };
			QueueChannelReorder(guild.id, after.id, placement, (batch) => LogChannelReorder(client, guild.id, batch));
		}

		const fields = before ? DiffChannel(before, after, ForumTagNames(guild, after)) : [];
		const overwrites = before ? DiffOverwrites(before.overwrites, after.overwrites, guild.id) : [];

		if (before && fields.length === 0 && overwrites.length === 0) return;

		// Discord audits a permission overwrite change under its own action, not CHANNEL_UPDATE
		const action: AuditAction = event === "ThreadUpdate"
			? AuditLogEvents.ThreadUpdate
			: fields.length === 0 && overwrites.length > 0 ? overwrites[0].action : AuditLogEvents.ChannelUpdate;

		const entry = await AwaitAuditEntry(client, guild.id, action, after.id);
		await SendLog(client, guild.id, event, BuildChannelUpdateLog(before, after, fields, overwrites, entry).container);
	} catch (error) {
		Log('ERROR', error);
	}
}

/** Where a channel sat before a reorder. The parent is included because a move into another category changes both at once. */
type Placement = { position: number; parentId: string | null };

const QueueChannelReorder = ReorderQueue<Placement>();

/**
 * Logs which channels moved in a reorder batch, across all lists, as one log. Posts nothing when
 * every order is unchanged, as when a create or delete only renumbers a list.
 */
async function LogChannelReorder(client: FullClient, guildId: string, batch: Reorder<Placement>): Promise<void> {
	try {
		const guild = client.guilds.get(guildId);
		if (!guild) return;

		const channels = [...guild.channels.values()]
			.map(Snapshot)
			.filter((channel) => channel.position !== null && !CreatedDuring(channel.id, batch));

		const before = Lists(channels, (channel) => batch.before.get(channel.id));
		const after = Lists(channels, () => undefined);

		const moves: ChannelMove[] = [];
		let shifted = 0;

		for (const [key, list] of after) {
			const result = Moves(before.get(key)?.ids ?? [], list.ids);
			moves.push(...result.moves.map((move) => ({ ...move, scope: list.scope })));
			shifted += result.shifted;
		}

		if (moves.length === 0) return;

		const names = new Map(channels.map((channel) => [channel.id, channel.name]));
		await SendLog(client, guildId, "ChannelUpdate", BuildChannelReorderLog(moves, shifted, names).container);
	} catch (error) {
		Log('ERROR', error);
	}
}

/** Groups channels into the lists Discord ranks them in, each sorted top to bottom. `placed` overrides a channel's cached placement. */
function Lists(channels: ChannelSnapshot[], placed: (channel: ChannelSnapshot) => Placement | undefined): Map<string, { scope: SortScope; ids: string[] }> {
	const lists = new Map<string, { scope: SortScope; entries: [string, number][] }>();

	for (const channel of channels) {
		const { position, parentId } = placed(channel) ?? { position: channel.position!, parentId: channel.parentId };
		const scope = SortScopeOf(channel.type, parentId);
		const key = `${scope.bucket}:${scope.parentId}`;

		const list = lists.get(key) ?? { scope, entries: [] };
		list.entries.push([channel.id, position]);
		lists.set(key, list);
	}

	return new Map([...lists].map(([key, { scope, entries }]) => [key, { scope, ids: SortByPosition(entries) }]));
}

/** Returns tag names by id from the thread's parent forum. Empty when the parent is not cached. */
function ForumTagNames(guild: Guild, thread: ChannelSnapshot): Map<string, string> {
	if (thread.appliedTags.length === 0 || !thread.parentId) return new Map();

	const parent = guild.channels.get(thread.parentId);
	if (!parent) return new Map();

	return new Map(Snapshot(parent).availableTags.flatMap((tag) => tag.id ? [[tag.id, tag.name] as const] : []));
}
