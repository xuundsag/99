import { MessageFlags } from 'discord.js';
import { splitTitleEpisode } from '../../shared/src/prefix.js';

export function asInteraction(message) {
  const state = { msg: null, v2: false };
  const api = {
    __prefix: true,
    guildId: message.guildId,
    channelId: message.channelId,
    user: message.author,
    member: message.member,
    guild: message.guild,
    client: message.client,
    deferred: false,
    replied: false,
    async deferReply() {
      api.deferred = true;
      api.replied = true;
      state.msg = await message.reply({ content: 'Working...' });
      return state.msg;
    },
    async reply(payload) {
      api.replied = true;
      const body = toMessage(payload);
      state.msg = await message.reply(body);
      state.v2 = !!(body.flags & MessageFlags.IsComponentsV2);
      return state.msg;
    },
    async editReply(payload) {
      const body = toMessage(payload);
      const wantsV2 = !!(body.flags & MessageFlags.IsComponentsV2);
      if (!state.msg) return api.reply(payload);
      if (wantsV2 && !state.v2) {
        const sent = await message.channel.send(body);
        await state.msg.delete().catch(() => {});
        state.msg = sent;
        state.v2 = true;
        return sent;
      }
      await state.msg.edit(body);
      return state.msg;
    },
  };
  return api;
}

export function optionsFromPrefix(parsed, message) {
  if (parsed.name === 'stream') {
    const split = splitTitleEpisode(parsed.rest);
    return fakeOptions({ anime: split.title, episode: split.episode });
  }
  if (parsed.name === 'continue') return fakeOptions({ anime: parsed.rest });
  if (parsed.name === 'history') {
    const n = Number(parsed.args[0]);
    return fakeOptions({ limit: Number.isInteger(n) && n > 0 ? n : null });
  }
  if (parsed.name === 'import') {
    return fakeOptions({ file: message.attachments?.first?.() || null });
  }
  return fakeOptions({});
}

function fakeOptions(map) {
  return {
    getString(name) { return map[name] ?? null; },
    getNumber(name) { return map[name] == null || map[name] === '' ? null : Number(map[name]); },
    getInteger(name) { return map[name] == null || map[name] === '' ? null : Number(map[name]); },
    getAttachment() { return map.file || null; },
    getFocused() { return ''; },
  };
}

function toMessage(payload) {
  const flags = Number(payload?.flags || 0);
  const v2 = flags & MessageFlags.IsComponentsV2;
  const out = {};
  if (payload?.files) out.files = payload.files;
  if (payload?.components) out.components = payload.components;
  if (v2 && out.components) out.flags = MessageFlags.IsComponentsV2;
  else if (payload?.content) out.content = payload.content;
  if (!out.content && !out.components && !out.files) out.content = 'Done.';
  return out;
}
