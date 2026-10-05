import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

export const ROOT_FOLDER = dirname(fileURLToPath(import.meta.url + '/..'));

/** How long a stored message is kept. Matches Discord's 14-day bulk delete window. */
export const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

/** Reusable embed colors, all embeds must reference this enum */
export const COLOR = {
	PRIMARY: 0xff7700,
	ERROR: 0xff0000,

	LOG_CREATE: 0x27ae60,    // additive: green (join, create, invite)
	LOG_UPDATE: 0xf39c12,    // mutative: amber (edit, update, rename)
	LOG_DELETE: 0xe74c3c,    // destructive: red (delete, bulk delete)
	LOG_MODERATION: 0xc0392b,// moderation: deep red (ban, kick, timeout, automod)
	LOG_INFO: 0x3498db,      // neutral/info: blue (voice, webhook, misc)
} as const