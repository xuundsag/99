import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { mediaHeaders } from '../../shared/src/urls.js';
import { resolveEpisode } from '../../shared/src/megaplay.js';

const TTL_MS = 2 * 60 * 60 * 1000;

export function parseTunnelUrl(text) {
  const match = String(text || '').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  return match ? match[0] : null;
}

export function downloadFilename({ title, episode, audio, movie = false, ext = 'mp4' }) {
  const base = String(title || 'anime')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'anime';
  const ep = movie ? '' : `-E${episode}`;
  const lang = audio === 'dub' ? 'Dub' : 'Sub';
  return `${base}${ep}-${lang}.${ext}`;
}

export function pickVariant(masterText, masterUrl) {
  const lines = String(masterText || '').split(/\r?\n/);
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const bandwidth = Number((/BANDWIDTH=(\d+)/.exec(lines[i]) || [])[1] || 0);
    let uri = '';
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (!next) continue;
      if (next.startsWith('#')) break;
      uri = next;
      break;
    }
    if (!uri) continue;
    if (!best || bandwidth >= best.bandwidth) {
      best = { bandwidth, url: new URL(uri, masterUrl).toString() };
    }
  }
  return best;
}

export function segmentList(playlistText, playlistUrl) {
  const lines = String(playlistText || '').split(/\r?\n/);
  const segments = [];
  let map = null;
  for (const line of lines) {
    const mapUri = /#EXT-X-MAP:[^\n]*URI="([^"]+)"/.exec(line);
    if (mapUri) map = new URL(mapUri[1], playlistUrl).toString();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    segments.push(new URL(trimmed, playlistUrl).toString());
  }
  return { map, segments };
}

function commandOnPath(name) {
  try {
    execFileSync('which', [name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function fetchBuffer(url, attempts = 3) {
  let last;
  for (let n = 0; n < attempts; n++) {
    try {
      const res = await fetch(url, { headers: mediaHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      last = err;
      await new Promise((resolve) => setTimeout(resolve, 350 * (n + 1)));
    }
  }
  throw last;
}

async function mapPool(items, limit, fn) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index], index);
    }
  });
  await Promise.all(workers);
}

export async function downloadEpisodeFile({ masterUrl, file, gentle = false, log = () => {} }) {
  const master = await (await fetch(masterUrl, { headers: mediaHeaders() })).text();
  const variant = pickVariant(master, masterUrl);
  if (!variant) throw new Error('The video playlist had no quality to download.');
  const playlistText = await (await fetch(variant.url, { headers: mediaHeaders() })).text();
  const { map, segments } = segmentList(playlistText, variant.url);
  if (!segments.length) throw new Error('The video playlist had no segments.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jinx-dl-'));
  try {
    const parts = new Array(segments.length);
    if (map) {
      fs.writeFileSync(path.join(tmp, 'map.bin'), await fetchBuffer(map));
    }
    await mapPool(segments, gentle ? 2 : 4, async (url, index) => {
      if (gentle) await new Promise((resolve) => setTimeout(resolve, 40));
      const buf = await fetchBuffer(url);
      const part = path.join(tmp, `seg-${String(index).padStart(5, '0')}.bin`);
      fs.writeFileSync(part, buf);
      parts[index] = part;
    });
    const joined = path.join(tmp, 'joined.ts');
    const out = fs.createWriteStream(joined);
    const chunks = map ? [path.join(tmp, 'map.bin'), ...parts] : parts;
    for (const part of chunks) {
      if (!part) throw new Error('A video segment did not save.');
      await appendChunk(part, out);
    }
    await new Promise((resolve, reject) => {
      out.on('error', reject);
      out.end(resolve);
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const mp4 = file.endsWith('.mp4') ? file : `${file}.mp4`;
    const ts = mp4.replace(/\.mp4$/, '.ts');
    if (commandOnPath('ffmpeg')) {
      try {
        await remux(joined, mp4, log);
        return mp4;
      } catch (err) {
        log(`mp4 pack failed, serving the transport stream: ${err.message}`);
      }
    }
    fs.copyFileSync(joined, ts);
    return ts;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function appendChunk(from, to) {
  return new Promise((resolve, reject) => {
    const input = fs.createReadStream(from);
    input.on('error', reject);
    input.on('end', () => {
      if (to.writableNeedDrain) to.once('drain', resolve);
      else resolve();
    });
    input.pipe(to, { end: false });
  });
}

function remux(input, output, log) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', input,
      '-c', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', '+faststart',
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    proc.stderr?.on('data', (chunk) => { err = (err + chunk.toString()).slice(-500); });
    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) resolve(output);
      else {
        log(`remux failed: ${err || code}`);
        reject(new Error('Could not pack the download.'));
      }
    });
  });
}

export async function ensureCloudflared(dir = path.join(os.tmpdir(), 'jinx-bin')) {
  if (commandOnPath('cloudflared')) return 'cloudflared';
  const dest = path.join(dir, 'cloudflared');
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) return dest;
  fs.mkdirSync(dir, { recursive: true });
  const name = process.arch === 'arm64' ? 'cloudflared-linux-arm64' : process.arch === 'arm' ? 'cloudflared-linux-arm' : 'cloudflared-linux-amd64';
  const res = await fetch(`https://github.com/cloudflare/cloudflared/releases/latest/download/${name}`);
  if (!res.ok) throw new Error(`Could not download cloudflared (${res.status}). Install it, then try again.`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1_000_000) throw new Error('cloudflared download was incomplete.');
  fs.writeFileSync(dest, buf, { mode: 0o755 });
  return dest;
}

function startFileServer(file, token, filename) {
  const mime = file.endsWith('.ts') ? 'video/mp2t' : 'video/mp4';
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith(`/dl/${token}/`)) {
      res.writeHead(404).end();
      return;
    }
    const stat = fs.statSync(file);
    const headers = {
      'Content-Type': mime,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
      if (start > end || start >= stat.size) {
        res.writeHead(416).end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function openTunnel(bin, port) {
  const proc = spawn(bin, ['--protocol', 'http2', 'tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => finish(new Error('Cloudflare tunnel did not return a URL.')), 30000);
    const finish = (err, url) => {
      clearTimeout(timer);
      proc.stdout?.off('data', onData);
      proc.stderr?.off('data', onData);
      proc.off('exit', onExit);
      if (err) {
        try { proc.kill('SIGTERM'); } catch { /* already gone */ }
        reject(err);
      } else resolve({ proc, url });
    };
    const onData = (chunk) => {
      buf += chunk.toString();
      const url = parseTunnelUrl(buf);
      if (url) finish(null, url);
    };
    const onExit = (code) => finish(new Error(`cloudflared exited (${code}) before a URL was ready.`));
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('exit', onExit);
  });
}

export class DownloadHub {
  constructor({ dir, ttlMs = TTL_MS, log = () => {}, gentle = () => false } = {}) {
    this.dir = dir;
    this.ttlMs = ttlMs;
    this.log = log;
    this.gentle = gentle;
    this.jobs = new Map();
    this.sweepLeftovers();
  }

  sweepLeftovers() {
    if (!this.dir || !fs.existsSync(this.dir)) return;
    for (const name of fs.readdirSync(this.dir)) {
      if (name === 'bin') continue;
      fs.rmSync(path.join(this.dir, name), { recursive: true, force: true });
    }
  }

  keyFor({ malId, episode, audio }) {
    return `${malId}:${episode}:${audio || 'sub'}`;
  }

  peek(spec) {
    const job = this.jobs.get(this.keyFor(spec));
    if (!job?.url || job.expiresAt <= Date.now()) return null;
    return job;
  }

  ensure(spec) {
    const key = this.keyFor(spec);
    const ready = this.peek(spec);
    if (ready) return Promise.resolve(ready);
    const current = this.jobs.get(key);
    if (current?.inflight) return current.inflight;
    const inflight = this._build(key, spec).then((job) => {
      this.jobs.set(key, job);
      return job;
    }).catch((err) => {
      const slot = this.jobs.get(key);
      if (slot?.inflight) this.jobs.delete(key);
      throw err;
    });
    this.jobs.set(key, { inflight });
    return inflight;
  }

  async _build(key, spec) {
    let folder = null;
    let server = null;
    let tunnelProc = null;
    try {
      const source = await resolveEpisode({
        malId: spec.malId,
        episode: spec.episode,
        lang: spec.audio === 'dub' ? 'dub' : 'sub',
        log: this.log,
      });
      const id = crypto.randomBytes(9).toString('hex');
      folder = path.join(this.dir, id);
      fs.mkdirSync(folder, { recursive: true });
      const saved = await downloadEpisodeFile({
        masterUrl: source.masterUrl,
        file: path.join(folder, 'video.mp4'),
        gentle: this.gentle(),
        log: this.log,
      });
      const filename = downloadFilename({
        title: spec.title,
        episode: spec.episode,
        audio: source.lang || spec.audio,
        movie: spec.movie,
        ext: saved.endsWith('.ts') ? 'ts' : 'mp4',
      });
      const token = crypto.randomBytes(18).toString('hex');
      server = await startFileServer(saved, token, filename);
      const bin = await ensureCloudflared(path.join(this.dir, 'bin'));
      const tunnel = await openTunnel(bin, server.address().port);
      tunnelProc = tunnel.proc;
      const url = `${tunnel.url}/dl/${token}/${encodeURIComponent(filename)}`;
      const job = {
        key,
        url,
        file: saved,
        folder,
        filename,
        expiresAt: Date.now() + this.ttlMs,
        server,
        tunnel: tunnelProc,
      };
      job.timer = setTimeout(() => this.destroy(key), this.ttlMs);
      job.timer.unref?.();
      this.log(`download ready for ${spec.malId} episode ${spec.episode}, expires in 2 hours`);
      return job;
    } catch (err) {
      try { tunnelProc?.kill('SIGTERM'); } catch { /* already gone */ }
      try { server?.close(); } catch { /* already gone */ }
      if (folder) fs.rmSync(folder, { recursive: true, force: true });
      throw err;
    }
  }

  destroy(key) {
    const job = this.jobs.get(key);
    if (!job || job.inflight) return;
    this.jobs.delete(key);
    clearTimeout(job.timer);
    try { job.tunnel?.kill('SIGTERM'); } catch { /* already gone */ }
    try { job.server?.close(); } catch { /* already gone */ }
    if (job.folder) fs.rmSync(job.folder, { recursive: true, force: true });
    this.log('download expired and the tunnel was removed');
  }

  closeAll() {
    for (const key of [...this.jobs.keys()]) this.destroy(key);
  }
}
