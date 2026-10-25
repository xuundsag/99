import { REST, Routes, SlashCommandBuilder } from 'discord.js';

export function buildCommands(botName) {
  const stream = new SlashCommandBuilder()
    .setName('stream')
    .setDescription(`Stream an anime episode into your voice channel with ${botName}`)
    .addStringOption((o) =>
      o.setName('anime').setDescription('Anime name. Typos are fine, for example oni poice').setRequired(true),
    )
    .addNumberOption((o) =>
      o.setName('episode').setDescription('Optional. Defaults to the last watched episode, or 1. Ignored for movies').setRequired(false),
    );

  const cont = new SlashCommandBuilder()
    .setName('continue')
    .setDescription('Continue a series you already started')
    .addStringOption((o) =>
      o.setName('anime').setDescription('One of your saved series').setRequired(true).setAutocomplete(true),
    );

  const stop = new SlashCommandBuilder().setName('stop').setDescription('End the current stream and leave voice');

  const history = new SlashCommandBuilder()
    .setName('history')
    .setDescription('List the series you have started, newest first')
    .addIntegerOption((o) => o.setName('limit').setDescription('How many to show, default 5'));

  const streamer = new SlashCommandBuilder().setName('streamer').setDescription('List the streamer accounts in this server');
  const help = new SlashCommandBuilder().setName('help').setDescription(`How to use ${botName}`);
  const ping = new SlashCommandBuilder().setName('ping').setDescription('Check how fast Jinx answers');
  const exp = new SlashCommandBuilder().setName('export').setDescription('Download your watch history as a file');
  const imp = new SlashCommandBuilder()
    .setName('import')
    .setDescription('Restore a watch history file from /export')
    .addAttachmentOption((o) => o.setName('file').setDescription('The JSON file from /export').setRequired(true));

  return [stream, cont, stop, history, streamer, help, ping, exp, imp];
}

export function commandRoutes(clientId, guildId) {
  const list = guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  const item = (id) =>
    guildId ? Routes.applicationGuildCommand(clientId, guildId, id) : Routes.applicationCommand(clientId, id);
  return { list, item };
}

export async function replaceCommands(rest, { clientId, guildIds = [], commands }) {
  const targets = [...new Set((guildIds || []).filter(Boolean))];
  const cleared = await rest.put(Routes.applicationCommands(clientId), { body: targets.length ? [] : commands });
  const registered = [];
  for (const guildId of targets) {
    const body = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    registered.push({ guildId, names: (Array.isArray(body) ? body : commands).map((cmd) => cmd.name) });
  }
  return {
    clearedGlobal: Array.isArray(cleared) ? cleared.map((cmd) => cmd.name) : [],
    guilds: registered,
    names: commands.map((cmd) => cmd.name),
  };
}

export async function registerCommands({ token, clientId, guildIds = [], guildId, log = () => {} }) {
  const rest = new REST({ version: '10' }).setToken(token);
  const commands = buildCommands(process.env.BOT_NAME || 'Jinx').map((cmd) => cmd.toJSON());
  const ids = [...new Set([...(guildIds || []), guildId].filter(Boolean))];
  const result = await replaceCommands(rest, { clientId, guildIds: ids, commands });
  if (!ids.length) {
    log(`no guilds cached, registered globally: ${result.names.join(', ')}. Global commands can take up to an hour.`);
  } else {
    log(`cleared global commands and registered in ${ids.length} guild(s): ${result.names.join(', ')}`);
  }
  return commands;
}
