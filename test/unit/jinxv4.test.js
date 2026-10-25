import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCues, captionUrls } from '../../shared/src/captions.js';
import { parsePrefix, splitTitleEpisode, helpText, pingText } from '../../shared/src/prefix.js';
import { parseTunnelUrl, pickVariant, segmentList, downloadFilename } from '../../controller/src/downloads.js';
import { normaliseSources } from '../../shared/src/megaplay.js';
import { audioFilter } from '../../player/src/capture.js';
import { describePanel, describeMore, describeDownloadLink, describeDownloadStatus, BTN } from '../../shared/src/panel.js';

test('dub caption files with short stamps and commas still become cues', () => {
  const vtt = `WEBVTT

00:00:01.001 --> 00:00:03.135
( Panting )

00:01.500 --> 00:04.000
Short stamp
`;
  const srt = `1
00:00:04,200 --> 00:00:05,000
Comma stamp
`;
  assert.equal(parseCues(vtt).length, 2);
  assert.equal(parseCues(vtt)[0].text, '( Panting )');
  assert.equal(parseCues(vtt)[1].start, 1.5);
  assert.equal(parseCues(srt)[0].text, 'Comma stamp');
  assert.equal(parseCues('WEBVTT\n\nNOTE This is a thumbnail VTT file\n\n00:00:00.000 --> 00:00:05.000\nthumb.jpg').length, 0);
});

test('caption ranking prefers English and skips preview tracks', () => {
  const urls = captionUrls({
    captions: [
      { file: 'https://cdn/a/b/preview/thumbnails.vtt', label: 'English', default: true },
      { file: 'https://cdn/a/b/subtitles/spa.vtt', label: 'Spanish' },
      { file: 'https://cdn/a/b/subtitles/eng-0.vtt', label: 'English', default: true },
    ],
  });
  assert.equal(urls[0], 'https://cdn/a/b/subtitles/eng-0.vtt');
  assert.equal(urls.includes('https://cdn/a/b/preview/thumbnails.vtt'), false);
});

test('a dub video path comes from the thumbnail, not the sub caption folder', () => {
  const result = normaliseSources({
    tracks: [
      { file: 'https://cdn/anime/hash/subhash/subtitles/eng-2.vtt', kind: 'captions', label: 'English', default: true },
      { file: 'https://cdn/anime/hash/dubhash/preview/thumbnails.vtt', kind: 'thumbnails' },
    ],
  });
  assert.match(result.masterUrl, /\/dubhash\/master\.m3u8$/);
  assert.equal(result.captions[0].file.includes('subhash'), true);
});

test('prefix commands parse names, episodes and the simple help text', () => {
  assert.equal(parsePrefix('hello j!ping', 'j!'), null);
  assert.equal(parsePrefix('J!Ping', 'j!').name, 'ping');
  assert.deepEqual(splitTitleEpisode('one piece 12'), { title: 'one piece', episode: 12 });
  assert.deepEqual(splitTitleEpisode('86'), { title: '86', episode: null });
  assert.match(helpText('j!'), /j!stream name \[episode\]/);
  assert.equal(pingText(41.2), 'Pong 41ms');
  assert.doesNotMatch(helpText('j!'), /audio:sub|More options/);
});

test('download helpers pick the highest variant and a tunnel url', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
    'low.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=5500000,RESOLUTION=1920x1080',
    'high.m3u8',
  ].join('\n');
  assert.equal(pickVariant(master, 'https://cdn/anime/a/b/master.m3u8').url, 'https://cdn/anime/a/b/high.m3u8');
  const list = segmentList('#EXTM3U\n#EXTINF:4,\nseg-1.jpg\n', 'https://cdn/anime/a/b/high.m3u8');
  assert.equal(list.segments[0], 'https://cdn/anime/a/b/seg-1.jpg');
  assert.equal(parseTunnelUrl('INF https://blue-fog.trycloudflare.com registered'), 'https://blue-fog.trycloudflare.com');
  assert.equal(downloadFilename({ title: 'One Piece', episode: 3, audio: 'dub' }), 'One-Piece-E3-Dub.mp4');
});

test('the capture audio filter no longer hard-jumps 100ms and the panel has download plus sub dub', () => {
  const filter = audioFilter();
  assert.match(filter, /alimiter/);
  assert.doesNotMatch(filter, /min_hard_comp=0\.100/);
  const panel = describePanel({
    title: 'One Piece', episode: 1, searchUrl: 'https://example.com', position: 1, duration: 10,
    audio: 'sub', captions: true, state: 'playing', autoplay: true,
  });
  assert.deepEqual(panel.children[4].components.map((b) => b.id), [BTN.MORE, BTN.DOWNLOAD]);
  const more = describeMore({ audio: 'sub', volume: 1, autoplay: true, captions: true, state: 'playing' });
  assert.deepEqual(more.children.at(-1).components.map((b) => b.label), ['Sub', 'Dub', 'Stop']);
  assert.equal(describeDownloadStatus('Initialising.').children[0].content, 'Initialising.');
  assert.equal(describeDownloadLink('https://example.com/file.mp4').children[0].components[0].url, 'https://example.com/file.mp4');
  assert.equal(describeDownloadLink('https://example.com/file.mp4').children.some((child) => child.kind === 'text'), false);
});
