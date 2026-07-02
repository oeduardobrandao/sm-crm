import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkDrift, mapLimit, md5, sha256 } from './build.mjs';

// No network in this file — importing build.mjs is safe because main() is guarded behind an
// entry-point check (`import.meta.url === file://${process.argv[1]}`), so importing it here
// never triggers the live Fontsource/jsDelivr/R2 pipeline.

describe('checkDrift (drift gate)', () => {
  const family = {
    key: 'montserrat',
    variants: [
      { weight: 400, style: 'normal' },
      { weight: 800, style: 'normal' },
    ],
  };

  it('passes when every curated variant is still available', () => {
    const meta = {
      subsets: ['latin', 'latin-ext'],
      weights: [400, 600, 800],
      styles: ['normal'],
      license: 'OFL-1.1',
    };
    expect(checkDrift(family, meta)).toEqual([]);
  });

  it('fails loudly when a curated weight disappears', () => {
    const meta = {
      subsets: ['latin'],
      weights: [400, 600],
      styles: ['normal'],
      license: 'OFL-1.1',
    };
    const problems = checkDrift(family, meta);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => p.includes('800'))).toBe(true);
  });

  it('fails loudly when a curated style disappears', () => {
    const meta = {
      subsets: ['latin'],
      weights: [400, 800],
      styles: ['italic'],
      license: 'OFL-1.1',
    };
    const problems = checkDrift(family, meta);
    expect(problems.some((p) => p.includes("style 'normal'"))).toBe(true);
  });

  it('fails loudly when the latin subset disappears', () => {
    const meta = {
      subsets: ['latin-ext'],
      weights: [400, 800],
      styles: ['normal'],
      license: 'OFL-1.1',
    };
    const problems = checkDrift(family, meta);
    expect(problems.some((p) => p.includes("'latin' subset"))).toBe(true);
  });

  it('fails loudly when the license changes to something non-permissive', () => {
    const meta = {
      subsets: ['latin'],
      weights: [400, 800],
      styles: ['normal'],
      license: 'Proprietary',
    };
    const problems = checkDrift(family, meta);
    expect(problems.some((p) => p.includes('license changed'))).toBe(true);
  });

  it('accepts the other two permissive licenses used across the catalog', () => {
    for (const license of ['Apache-2.0', 'Ubuntu Font Licence 1.0']) {
      const meta = { subsets: ['latin'], weights: [400, 800], styles: ['normal'], license };
      expect(checkDrift(family, meta)).toEqual([]);
    }
  });
});

describe('mapLimit', () => {
  it('preserves result order regardless of completion order', async () => {
    const items = [30, 10, 20, 5];
    const results = await mapLimit(
      items,
      2,
      (ms) => new Promise((r) => setTimeout(() => r(ms), ms)),
    );
    expect(results).toEqual(items);
  });

  it('never runs more than `limit` concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    await mapLimit(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
      },
    );
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});

describe('hashing (idempotent upload compare)', () => {
  it('sha256/md5 are deterministic for the same bytes', () => {
    const buf = Buffer.from('estudio-font-fixture');
    expect(sha256(buf)).toBe(sha256(Buffer.from('estudio-font-fixture')));
    expect(md5(buf)).toBe(md5(Buffer.from('estudio-font-fixture')));
  });

  it('md5 matches what an S3-compatible PUT ETag would be for a non-multipart upload', () => {
    // R2/S3 ETag for a simple PutObject is the MD5 of the body — this is the invariant the
    // build script's idempotent-upload skip logic depends on.
    const buf = Buffer.from('hello world');
    expect(md5(buf)).toBe('5eb63bbbe01eeed093cb22bb8f5acdc3');
  });
});

describe('generated manifest shape (requires a prior `node scripts/fonts/build.mjs` run)', () => {
  // Deliberately not `new URL('...', import.meta.url)` — Vite statically detects that exact
  // call-site pattern as its asset-URL syntax and rewrites it to a dev-server URL, which breaks
  // plain Node file reads under vitest's jsdom environment.
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const manifestPath = join(__dirname, '../../supabase/functions/_shared/fonts/manifest.json');

  it('has exactly 26 families and 50 variants, matching the design §7 curation', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.families).toHaveLength(26);
    const variantCount = manifest.families.reduce((n, f) => n + f.variants.length, 0);
    expect(variantCount).toBe(50);
  });

  it('every family key is unique and kebab-case', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const keys = manifest.families.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z0-9-]+$/);
  });

  it('every variant has a latin file at minimum', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const family of manifest.families) {
      for (const variant of family.variants) {
        expect(variant.files.latin).toBeDefined();
        expect(variant.files.latin.bytes).toBeGreaterThan(0);
      }
    }
  });

  it('fallbackKey resolves to a real family in the catalog', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(manifest.families.some((f) => f.key === manifest.fallbackKey)).toBe(true);
  });

  it("keys.ts's FONT_KEYS matches manifest.json's family keys exactly, in order", async () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const { FONT_KEYS } = await import('../../supabase/functions/_shared/fonts/keys.ts');
    expect(FONT_KEYS).toEqual(manifest.families.map((f) => f.key));
  });
});
