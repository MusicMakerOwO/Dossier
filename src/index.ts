import { Client, ClientEvents, ClientEventMap } from "simplyjs";
import { CommandHandler, ButtonHandler, SelectHandler, EventHandler, FullClient } from "./Types/InternalTypes.js"
import { Database } from "./Database.js";
import { ROOT_FOLDER } from "./Constants.js";
import { Log } from "./Log.js";
import { StopBackfill } from "./Backfill.js";
import { CheckPrivilegedIntents } from "./Config/Preflight.js";

import "source-map-support/register.js";
import * as dotenv from "dotenv";

dotenv.config({ path: `${ROOT_FOLDER}/.env` });

import * as Commands from "./Commands/index.js";
import * as Buttons from "./Buttons/index.js";
import * as Selects from "./Selects/index.js";
import * as Events from "./Events/index.js";

const client = new Client({
	token: process.env.TOKEN!,
	intents: [
		"Guilds",
		"GuildMessages",
		"MessageContent",
		"GuildModeration",
		"GuildMembers",
		"AutoModerationExecution",
		"GuildWebhooks",
		"GuildExpressions"
	]
}) as FullClient;

client.commands = new Map();
for (const command of Object.values(Commands) as CommandHandler[]) {
	if (client.commands.has(command.data.name)) {
		throw new Error(`Duplicate command name: "${command.data.name}"`);
	}
	client.commands.set(command.data.name, command);
}

client.buttons = new Map();
for (const button of Object.values(Buttons) as ButtonHandler[]) {
	if (client.buttons.has(button.customId)) {
		throw new Error(`Duplicate button customId: "${button.customId}"`);
	}
	client.buttons.set(button.customId, button);
}

client.selects = new Map();
for (const select of Object.values(Selects) as SelectHandler[]) {
	if (client.selects.has(select.customId)) {
		throw new Error(`Duplicate select customId: "${select.customId}"`);
	}
	client.selects.set(select.customId, select);
}

for (const event of Object.values(Events) as EventHandler<keyof ClientEventMap>[]) {
	client.on(event.name, (...args: unknown[]) => event.execute(client, ... args as ClientEventMap[keyof ClientEventMap]));
}

/**
 * Logs in, unless a privileged intent is switched off. Discord refuses the connection in that
 * case without saying which intent, so this names them first. A failed check does not block login.
 */
async function Start(): Promise<void> {
	const missing = await CheckPrivilegedIntents(client).catch((error: unknown) => {
		Log('WARN', 'Could not check privileged intents, logging in anyway:', error);
		return [];
	});

	if (missing.length > 0) {
		Log('ERROR', `Privileged intents are switched off: ${missing.join(', ')}. Enable them under Bot > Privileged Gateway Intents in the Developer Portal, then start Dossier again.`);
		Database.close();
		process.exitCode = 1;
		return;
	}

	await client.login();
}

void Start();

client.on(ClientEvents.Ready, (user) => {
	Log('INFO', `Logged in as ${user.username}`);
});

process.on('SIGINT', async () => {
	await client.destroy();
	await StopBackfill();
	Database.close();
	Log('INFO','Goodbye!');
	process.exitCode = 0;
});