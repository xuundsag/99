import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommands, replaceCommands } from '../../controller/src/slash-commands.js';

test('the bot exposes stream, continue, stop and history, and nothing removed', () => {
  const names = buildCommands('Jinx').map((cmd) => cmd.name);
  assert.deepEqual(names, ['stream', 'continue', 'stop', 'history', 'streamer', 'help', 'ping', 'export', 'import']);
  for (const cmd of buildCommands('Jinx').map((item) => item.toJSON())) {
    const firstOptional = (cmd.options || []).findIndex((option) => !option.required);
    if (firstOptional === -1) continue;
    assert.ok((cmd.options || []).slice(0, firstOptional).every((option) => option.required), cmd.name);
  }
  const stream = buildCommands('Jinx')[0].toJSON();
  assert.deepEqual(stream.options.map((o) => o.name), ['anime', 'episode']);
  const firstOptional = stream.options.findIndex((o) => !o.required);
  assert.ok(stream.options.slice(0, firstOptional).every((o) => o.required));
  assert.equal(stream.options.find((o) => o.name === 'episode').required, false);
  assert.equal(stream.options.some((o) => o.name === 'captions' || o.name === 'animeid'), false);
  const cont = buildCommands('Jinx')[1].toJSON();
  assert.equal(cont.options[0].autocomplete, true);
});

test('restart overwrites guild commands and clears the stale global list', async () => {
  const calls = [];
  const rest = {
    async put(route, { body }) {
      calls.push({ route, names: body.map((cmd) => cmd.name) });
      return body;
    },
  };
  const result = await replaceCommands(rest, {
    clientId: 'app',
    guildIds: ['guild'],
    commands: [{ name: 'help' }, { name: 'ping' }, { name: 'export' }],
  });
  assert.deepEqual(calls, [
    { route: '/applications/app/commands', names: [] },
    { route: '/applications/app/guilds/guild/commands', names: ['help', 'ping', 'export'] },
  ]);
  assert.deepEqual(result.names, ['help', 'ping', 'export']);
});
