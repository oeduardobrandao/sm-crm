import type { Page } from '@playwright/test';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Gitignored staging dir; PNGs are reviewed here before upload. */
export const SHOT_DIR = path.join(__dirname, '..', '.shots');

export async function shoot(page: Page, slug: string, index: number, name: string): Promise<void> {
  const dir = path.join(SHOT_DIR, slug);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(index).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file });
}
