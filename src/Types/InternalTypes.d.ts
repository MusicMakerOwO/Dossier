import { Client, SlashCommandInteraction, ButtonInteraction, SelectMenuInteraction, ClientEventMap, SlashCommandBuilder } from "simplyjs";

export interface CommandHandler {
	data: SlashCommandBuilder;
	execute: (client: Client, interaction: SlashCommandInteraction) => Promise<void>;
}

export interface ButtonHandler {
	customId: string;
	execute: (client: Client, interaction: ButtonInteraction, args: string[]) => Promise<void>;
}

export interface SelectHandler {
	customId: string;
	execute: (client: Client, interaction: SelectMenuInteraction, args: string[]) => Promise<void>;
}

export interface FullClient extends Client {
	commands: Map<string, CommandHandler>;
	buttons: Map<string, ButtonHandler>;
	selects: Map<string, SelectHandler>;
}

/** Events take `FullClient` because the interaction dispatchers need `client.commands`, `client.buttons` and `client.selects`. */
export interface EventHandler<T extends keyof ClientEventMap> {
	name: T;
	execute: (client: FullClient, ... args: ClientEventMap[T]) => Promise<void>
}