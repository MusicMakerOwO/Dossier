import { Client } from "simplyjs";
import * as Commands from "./Commands/index.js";

import "source-map-support/register.js";
import * as dotenv from "dotenv";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: `${__dirname}/../.env`, quiet: true });

// Just an empty instance, no login
const client = new Client({
	token: process.env.TOKEN!,
	intents: []
});

const commands = Object.values(Commands).map(command => command.data);

client.registerPublicCommands(commands)
	.then(() => {
		console.log('Slash commands registered!');
	})
	.catch(console.error);