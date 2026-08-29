import { test } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, existsSync, writeFileSync, appendFileSync } from 'node:fs';
import { SHOT_DIR } from './capture';

// Interactive recorder for the EXTERNAL screens the automated specs cannot
// reach (Facebook OAuth consent, claude.ai connector dialog). Run HEADED with
// a human driving the window:
//
//   CAPTURE_SCREENSHOTS=1 npx playwright test --project=screenshots --headed \
//     e2e/screenshots/external-recorder.spec.ts
//
// It saves a frame to e2e/.shots/_rec/ every time any page's pixels change
// (all tabs/popups included), with a manifest mapping frame -> URL. Nothing is
// uploaded: frames are raw material, curated by hand into the named shots of
// docs/superpowers/plans/2026-07-16-external-shot-list.md and only then
// uploaded. Stop by creating e2e/.shots/_rec/STOP or wait out the deadline.
//
// No safety net here on purpose: the human is intentionally completing a real
// OAuth connect (which also renews the capture workspace's expired tokens).

const REC_DIR = path.join(SHOT_DIR, '_rec');
const STOP_FILE = path.join(REC_DIR, 'STOP');
const MAX_FRAMES = 500;
const RECORDING_MINUTES = 20;

test('gravador de telas externas', async ({ page, context }) => {
  test.setTimeout((RECORDING_MINUTES + 2) * 60_000);
  mkdirSync(REC_DIR, { recursive: true });
  const manifest = path.join(REC_DIR, 'manifest.txt');
  writeFileSync(manifest, '');

  const lastShot = new Map<import('@playwright/test').Page, Buffer>();
  const pages = new Set([page]);
  context.on('page', (p) => pages.add(p));

  let frame = 0;
  const snapAll = async () => {
    for (const p of pages) {
      if (p.isClosed() || frame >= MAX_FRAMES) continue;
      try {
        const buf = await p.screenshot({ timeout: 3_000 });
        const prev = lastShot.get(p);
        if (prev && buf.equals(prev)) continue;
        lastShot.set(p, buf);
        frame += 1;
        const name = `${String(frame).padStart(3, '0')}.png`;
        writeFileSync(path.join(REC_DIR, name), buf);
        appendFileSync(manifest, `${name} ${p.url()}\n`);
      } catch {
        // page mid-navigation or closed between checks -- next tick catches it
      }
    }
  };

  await page.goto('/clientes');
  const deadline = Date.now() + RECORDING_MINUTES * 60_000;
  while (Date.now() < deadline && !existsSync(STOP_FILE) && frame < MAX_FRAMES) {
    await snapAll();
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
});
