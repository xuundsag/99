const STAMP = '(?:(\\d{1,2}):)?(\\d{2}):(\\d{2})[.,](\\d{1,3})';
const CUE_LINE = new RegExp(`^${STAMP}\\s*-->\\s*${STAMP}`);

function stampToSeconds(hours, minutes, seconds, fraction) {
  const ms = String(fraction || '0').padEnd(3, '0').slice(0, 3);
  return (Number(hours || 0) * 3600) + (Number(minutes) * 60) + Number(seconds) + (Number(ms) / 1000);
}

function cleanCueText(text) {
  return String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

export function parseCues(text) {
  const body = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (/thumbnail vtt/i.test(body.slice(0, 240))) return [];
  const lines = body.split('\n');
  const cues = [];
  for (let i = 0; i < lines.length; i++) {
    const match = CUE_LINE.exec(lines[i].trim());
    if (!match) continue;
    const start = stampToSeconds(match[1], match[2], match[3], match[4]);
    const end = stampToSeconds(match[5], match[6], match[7], match[8]);
    const textLines = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) break;
      if (CUE_LINE.test(lines[j].trim())) break;
      textLines.push(lines[j]);
    }
    const cueText = cleanCueText(textLines.join('\n'));
    if (!cueText || /xywh=|thumbnails?\./i.test(cueText)) continue;
    if (end > start) cues.push({ start, end, text: cueText });
  }
  return cues;
}

function captionScore(track) {
  const label = String(track?.label || '');
  const file = String(track?.file || '');
  if (/\/preview\/|thumbnail/i.test(file)) return -100;
  let score = 0;
  if (track?.default) score += 4;
  if (/\b(english|eng)\b/i.test(label)) score += 10;
  if (/\b(cc|sdh)\b|closed caption/i.test(label)) score += 3;
  if (/portuguese|spanish|french|german|arabic|italian/i.test(label)) score -= 2;
  return score;
}

export function captionUrls(source) {
  return (source?.captions || [])
    .filter((track) => track && typeof track.file === 'string' && !/\/preview\/|thumbnail/i.test(track.file))
    .slice()
    .sort((a, b) => captionScore(b) - captionScore(a))
    .map((track) => track.file);
}

export async function fetchCaptionCues(urls, { fetchImpl = fetch, headers, log = () => {} } = {}) {
  for (const url of urls || []) {
    try {
      const res = await fetchImpl(url, { headers });
      if (!res.ok) {
        log(`caption fetch ${res.status}`);
        continue;
      }
      const cues = parseCues(await res.text());
      if (cues.length) return cues;
    } catch (err) {
      log(`caption fetch failed: ${err.message}`);
    }
  }
  return [];
}
