import { AutoModerationActionExecutionPayload, DiscordAutoModerationAction } from "simplyjs";

/**
 * How long the first action of a trigger waits for the rest. Discord sends one event per action,
 * so a rule that blocks, alerts and times out arrives as three.
 */
export const AUTOMOD_BATCH_MS = 250;

/** One trigger of one rule by one member, with every action Discord took for it. */
export type AutoModHit = Omit<AutoModerationActionExecutionPayload, "action"> & {
	actions: DiscordAutoModerationAction[];
};

const pending = new Map<string, AutoModHit>();

// Keyed on the member and their content, not only the rule. A blocked message has no id, so the content stands in for it
function Key(payload: AutoModerationActionExecutionPayload): string {
	return `${payload.guildId}:${payload.ruleId}:${payload.userId}:${payload.messageId ?? payload.content}`;
}

/**
 * Adds an action to its trigger's batch and calls `flush` with the batch once the window closes.
 * The timer is unref'd, so a batch still open at shutdown is dropped.
 */
export function QueueAutoModAction(payload: AutoModerationActionExecutionPayload, flush: (hit: AutoModHit) => Promise<void>): void {
	const key = Key(payload);

	const open = pending.get(key);
	if (open) {
		open.actions.push(payload.action);
		return;
	}

	const { action, ...rest } = payload;
	pending.set(key, { ...rest, actions: [action] });

	setTimeout(() => {
		const hit = pending.get(key);
		pending.delete(key);
		if (hit) void flush(hit);
	}, AUTOMOD_BATCH_MS).unref();
}
