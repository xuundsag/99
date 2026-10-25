export const DEFAULT_PREFIX = 'j!';

export function parsePrefix(content, prefix = DEFAULT_PREFIX) {
  const raw = String(content || '').trim();
  const mark = String(prefix || DEFAULT_PREFIX);
  if (!mark || !raw.toLowerCase().startsWith(mark.toLowerCase())) return null;
  const body = raw.slice(mark.length).trim();
  if (!body) return null;
  const space = body.search(/\s/);
  const name = (space === -1 ? body : body.slice(0, space)).toLowerCase();
  const rest = space === -1 ? '' : body.slice(space + 1).trim();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) return null;
  return { name, rest, args: rest ? rest.split(/\s+/) : [] };
}

export function splitTitleEpisode(rest) {
  const text = String(rest || '').trim().replace(/^["']|["']$/g, '');
  if (!text) return { title: '', episode: null };
  const match = /^(.*\S)\s+(\d{1,5})$/.exec(text);
  if (!match) return { title: text, episode: null };
  const title = match[1].trim();
  if (title.length < 2) return { title: text, episode: null };
  return { title, episode: Number(match[2]) };
}

export function helpText(prefix = DEFAULT_PREFIX) {
  return [
    `${prefix}stream name [episode]`,
    `${prefix}continue name`,
    `${prefix}stop`,
    `${prefix}history`,
    `${prefix}streamer`,
    `${prefix}export`,
    `${prefix}import`,
    `${prefix}ping`,
    'Same names work as slash commands.',
  ].join('\n');
}

export function pingText(ms) {
  const n = Number.isFinite(Number(ms)) ? Math.max(0, Math.round(Number(ms))) : 0;
  return `Pong ${n}ms`;
}
