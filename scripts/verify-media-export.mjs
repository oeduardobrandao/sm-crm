// Run with: node --import tsx scripts/verify-media-export.mjs
// Exercises the shipped WASM encoder, not a system ffmpeg installation. No media
// leaves this process; generated inputs and outputs live in its virtual filesystem.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { videoArguments } from '../apps/crm/src/pages/entregas/media-editor/geometry.ts';

const require = createRequire(import.meta.url);
const corePath = require.resolve('@ffmpeg/core');
globalThis.self = globalThis;
globalThis.location = { href: new URL(`file://${corePath}`).href };
const createCore = require('@ffmpeg/core');
const core = await createCore({ wasmBinary: readFileSync(require.resolve('@ffmpeg/core/wasm')) });
let logs = [];
core.setLogger(({ message }) => logs.push(message));
const cases = [
  {
    name: 'crop with audio',
    width: 640,
    height: 360,
    zoom: 1.6,
    mode: 'crop',
    background: 'solid',
    audio: true,
  },
  {
    name: 'extreme crop',
    width: 16,
    height: 1600,
    zoom: 3,
    mode: 'crop',
    background: 'solid',
    audio: true,
  },
  {
    name: 'blurred fit',
    width: 640,
    height: 360,
    zoom: 1,
    mode: 'fit',
    background: 'blur',
    audio: true,
  },
  {
    name: 'extreme blurred fit',
    width: 16,
    height: 1600,
    zoom: 1,
    mode: 'fit',
    background: 'blur',
    audio: true,
  },
  {
    name: 'solid fit without audio',
    width: 640,
    height: 360,
    zoom: 1,
    mode: 'fit',
    background: 'solid',
    audio: false,
  },
];
for (const test of cases) {
  core.reset();
  core.setTimeout(120_000);
  logs = [];
  const source = [
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${test.width}x${test.height}:rate=30:duration=3.2`,
  ];
  if (test.audio)
    source.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=3.2');
  assert.equal(
    core.exec(
      ...source,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      'source.mp4',
    ),
    0,
    logs.join('\n'),
  );
  core.FS.rename('source.mp4', 'input');
  core.reset();
  logs = [];
  const adjustment = {
    width: 1080,
    height: 1920,
    mode: test.mode,
    zoom: test.zoom,
    x: 0.5,
    y: 0.5,
    background: test.background,
    color: '#12151a',
  };
  assert.equal(
    core.exec(...videoArguments(adjustment, test.width, test.height, 3.2, 300 * 1024 * 1024)),
    0,
    logs.join('\n'),
  );
  const bytes = Buffer.from(core.FS.readFile('output.mp4'));
  assert.ok(
    bytes.indexOf('moov') >= 0 && bytes.indexOf('moov') < bytes.indexOf('mdat'),
    'MP4 must use faststart',
  );
  assert.equal(bytes.includes(Buffer.from('edts')), false, 'MP4 must not contain an edit list');
  core.reset();
  logs = [];
  // This core emits valid ffprobe JSON while returning -1; assert the actual metadata.
  core.ffprobe(
    '-v',
    'error',
    '-show_entries',
    'stream=codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels:format=duration,size',
    '-of',
    'json',
    'output.mp4',
  );
  const output = logs.join('\n');
  const metadata = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
  const video = metadata.streams.find((s) => s.codec_name === 'h264');
  assert.equal(video.width, 1080);
  assert.equal(video.height, 1920);
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(video.r_frame_rate, '30/1');
  const audio = metadata.streams.find((s) => s.codec_name === 'aac');
  if (test.audio) {
    assert.equal(audio.sample_rate, '48000');
    assert.equal(audio.channels, 2);
  } else assert.equal(audio, undefined);
  assert.ok(Math.abs(Number(metadata.format.duration) - 3.2) < 0.1, 'Keep the complete duration');
  console.log(
    `PASS: ${test.name} — 1080×1920, H.264${test.audio ? '/AAC' : ''}, ${bytes.length} bytes`,
  );
  core.FS.unlink('input');
  core.FS.unlink('output.mp4');
}
