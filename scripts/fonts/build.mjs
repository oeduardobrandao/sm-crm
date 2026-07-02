#!/usr/bin/env node
// Estúdio fonts pipeline (docs/estudio-design.md §7). Curates 26 self-hosted Google Fonts
// families from Fontsource's pre-instanced static TTFs (satori cannot read WOFF2 or variable
// fonts) into one canonical binary per (family, weight, style, subset), served identically to
// the browser (satori ArrayBuffer + @font-face) and to the edge render function (via R2).
//
// Usage: node scripts/fonts/build.mjs [--upload]
//   (no flag)  downloads TTFs, writes public/fonts/estudio/**, generates the manifest.
//   --upload   additionally PUTs the canonical TTFs to R2 assets/fonts/v1/ (idempotent).

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FAMILIES_PATH = path.join(__dirname, 'families.json');
const PUBLIC_DIR = path.join(ROOT, 'public/fonts/estudio');
const SHARED_DIR = path.join(ROOT, 'supabase/functions/_shared/fonts');
const MANIFEST_VERSION = 1;
const R2_PREFIX = 'assets/fonts/v1';
const CONCURRENCY = 8;
const UPLOAD = process.argv.includes('--upload');

// ---------------------------------------------------------------------------
// Small concurrency batcher — no new runtime dependency for this alone.
// ---------------------------------------------------------------------------
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function md5(buf) {
  return createHash('md5').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Fontsource metadata + drift gate
// ---------------------------------------------------------------------------
async function fetchFontsourceMeta(fontsourceId) {
  const res = await fetch(`https://api.fontsource.org/v1/fonts/${fontsourceId}`);
  if (!res.ok) {
    throw new Error(`Fontsource metadata fetch failed for '${fontsourceId}': HTTP ${res.status}`);
  }
  return res.json();
}

export function checkDrift(family, meta) {
  const problems = [];
  if (!meta.subsets.includes('latin')) {
    problems.push(`'${family.key}' no longer ships a 'latin' subset on Fontsource.`);
  }
  for (const v of family.variants) {
    if (!meta.weights.includes(v.weight)) {
      problems.push(
        `'${family.key}' no longer ships weight ${v.weight} (available: ${meta.weights.join(', ')}).`,
      );
    }
    if (!meta.styles.includes(v.style)) {
      problems.push(
        `'${family.key}' no longer ships style '${v.style}' (available: ${meta.styles.join(', ')}).`,
      );
    }
  }
  if (
    meta.license !== 'OFL-1.1' &&
    meta.license !== 'Apache-2.0' &&
    meta.license !== 'Ubuntu Font Licence 1.0'
  ) {
    problems.push(
      `'${family.key}' license changed to '${meta.license}' — re-verify embedding rights before shipping.`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------
async function downloadTtf(fontsourceId, npmVersion, subset, weight, style) {
  const url = `https://cdn.jsdelivr.net/fontsource/fonts/${fontsourceId}@${npmVersion}/${subset}-${weight}-${style}.ttf`;
  const res = await fetch(url);
  if (!res.ok) return null; // caller decides whether the subset is optional (latin-ext)
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const families = JSON.parse(await fs.readFile(FAMILIES_PATH, 'utf8'));

  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(path.join(PUBLIC_DIR, 'preview'), { recursive: true });
  await fs.mkdir(SHARED_DIR, { recursive: true });

  console.log(`Fetching Fontsource metadata for ${families.families.length} families...`);
  const metas = await mapLimit(families.families, CONCURRENCY, async (family) => {
    const meta = await fetchFontsourceMeta(family.fontsourceId);
    const problems = checkDrift(family, meta);
    if (problems.length > 0) {
      throw new Error(`Drift gate failed:\n  - ${problems.join('\n  - ')}`);
    }
    return meta;
  });

  const manifestFamilies = [];
  const cssRules = [];
  const previewCssRules = [];
  const attributionLines = [];
  const uploadQueue = [];
  let latinExtUnreliable = null; // set by the slice-1 verification probe below

  console.log('Downloading variant TTFs (latin + latin-ext) and writing public files...');
  for (let fi = 0; fi < families.families.length; fi++) {
    const family = families.families[fi];
    const meta = metas[fi];
    const familyDir = path.join(PUBLIC_DIR, family.key);
    await fs.mkdir(familyDir, { recursive: true });

    const hasLatinExt = meta.subsets.includes('latin-ext');
    const variantEntries = [];

    for (const variant of family.variants) {
      const files = {};
      for (const subset of hasLatinExt ? ['latin', 'latin-ext'] : ['latin']) {
        const buf = await downloadTtf(
          family.fontsourceId,
          meta.npmVersion,
          subset,
          variant.weight,
          variant.style,
        );
        if (!buf) {
          if (subset === 'latin') {
            throw new Error(
              `Missing latin TTF for ${family.key} ${variant.weight}${variant.style === 'italic' ? 'i' : ''} — cannot proceed without the primary subset.`,
            );
          }
          continue; // latin-ext missing is tolerated — hardening only
        }
        const relPath = `/fonts/estudio/${family.key}/${variant.weight}-${variant.style}.${subset}.ttf`;
        const absPath = path.join(
          PUBLIC_DIR,
          family.key,
          `${variant.weight}-${variant.style}.${subset}.ttf`,
        );
        await fs.writeFile(absPath, buf);
        files[subset === 'latin' ? 'latin' : 'latinExt'] = {
          path: relPath,
          r2Key: `${R2_PREFIX}/${family.key}/${variant.weight}-${variant.style}.${subset}.ttf`,
          bytes: buf.length,
          sha256: sha256(buf),
        };
        uploadQueue.push({ r2Key: files[subset === 'latin' ? 'latin' : 'latinExt'].r2Key, buf });

        cssRules.push(
          `@font-face { font-family: "${family.name}"; font-weight: ${variant.weight}; font-style: ${variant.style}; ` +
            `src: url("${relPath}?v=${MANIFEST_VERSION}") format("truetype"); ` +
            `unicode-range: ${meta.unicodeRange[subset === 'latin' ? 'latin' : 'latin-ext']}; font-display: block; }`,
        );
      }
      variantEntries.push({ weight: variant.weight, style: variant.style, files });
    }

    // Preview strip: subset the family's canonical latin TTF for its FIRST variant down to
    // just the display-name characters, output as woff2 (only the DOM preview needs woff2 —
    // satori never reads this file).
    const firstVariantFiles = variantEntries[0].files.latin;
    const firstTtfPath = path.join(ROOT, 'public', firstVariantFiles.path.replace(/^\//, ''));
    const firstTtfBuf = await fs.readFile(firstTtfPath);
    const previewText = family.name + ' AaBbCc 0123';
    const previewBuf = await subsetFont(firstTtfBuf, previewText, { targetFormat: 'woff2' });
    const previewPath = `/fonts/estudio/preview/${family.key}.woff2`;
    await fs.writeFile(path.join(ROOT, 'public', previewPath.replace(/^\//, '')), previewBuf);
    previewCssRules.push(
      `@font-face { font-family: "${family.name} Preview"; src: url("${previewPath}?v=${MANIFEST_VERSION}") format("woff2"); font-display: swap; }`,
    );

    manifestFamilies.push({
      key: family.key,
      name: family.name,
      group: family.group,
      cssFallback: family.cssFallback,
      license: meta.license,
      source: { provider: 'fontsource', id: family.fontsourceId, npmVersion: meta.npmVersion },
      aliases: family.aliases,
      preview: previewPath,
      variants: variantEntries,
    });

    attributionLines.push(
      `- **${family.name}** (\`${family.key}\`) — ${meta.license}, via Fontsource (${family.fontsourceId}@${meta.npmVersion}), source: ${meta.source}`,
    );
  }

  // Slice-1 verification item (design §7): confirm satori's per-glyph fallback across two
  // same-name font entries (latin first, latin-ext second) works for a latin-ext-only glyph.
  // This build script cannot run satori itself (that's the render-core module, a later PR) —
  // it records that the check is still pending so it isn't silently forgotten.
  latinExtUnreliable =
    'UNVERIFIED — run the satori fallback probe from PR 1.4/1.5 before relying on latin-ext.';

  // ---------------------------------------------------------------------------
  // Write generated artifacts
  // ---------------------------------------------------------------------------
  const manifest = {
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    groups: families.groups,
    fallbackKey: families.fallbackKey,
    families: manifestFamilies,
  };
  await fs.writeFile(
    path.join(SHARED_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  const fontKeys = manifestFamilies.map((f) => f.key);
  const keysTs =
    `// GENERATED by scripts/fonts/build.mjs — do not hand-edit.\n` +
    `export const FONT_KEYS = ${JSON.stringify(fontKeys, null, 2)} as const;\n` +
    `export type FontKey = (typeof FONT_KEYS)[number];\n`;
  await fs.writeFile(path.join(SHARED_DIR, 'keys.ts'), keysTs);

  // Import-free by contract (design §7) — consumed by CRM tsc via the cross-boundary import,
  // must carry zero import statements so it never pulls in a runtime dependency.
  const typesTs =
    `// GENERATED by scripts/fonts/build.mjs — do not hand-edit. Intentionally import-free.\n\n` +
    `export interface FontFile {\n  path: string;\n  r2Key: string;\n  bytes: number;\n  sha256: string;\n}\n\n` +
    `export interface FontVariant {\n  weight: number;\n  style: "normal" | "italic";\n  files: { latin: FontFile; latinExt?: FontFile };\n}\n\n` +
    `export interface FontFamily {\n  key: string;\n  name: string;\n  group: string;\n  cssFallback: string;\n  license: string;\n  source: { provider: string; id: string; npmVersion: string };\n  aliases: string[];\n  preview: string;\n  variants: FontVariant[];\n}\n\n` +
    `export interface FontManifest {\n  version: number;\n  generatedAt: string;\n  groups: Record<string, string>;\n  fallbackKey: string;\n  families: FontFamily[];\n}\n`;
  await fs.writeFile(path.join(SHARED_DIR, 'types.ts'), typesTs);

  await fs.writeFile(
    path.join(PUBLIC_DIR, 'fonts.css'),
    '/* GENERATED by scripts/fonts/build.mjs — do not hand-edit. */\n\n' +
      cssRules.join('\n') +
      '\n',
  );
  await fs.writeFile(
    path.join(PUBLIC_DIR, 'preview.css'),
    '/* GENERATED by scripts/fonts/build.mjs — do not hand-edit. */\n\n' +
      previewCssRules.join('\n') +
      '\n',
  );

  const attribution =
    `# Estúdio font attribution\n\nGenerated ${new Date().toISOString()}. All families below are self-hosted from ` +
    `[Fontsource](https://fontsource.org/) under their stated licenses. OFL-1.1 explicitly permits embedding rendered ` +
    `text in commercial images without further attribution; this file exists for internal hygiene, not a legal requirement.\n\n` +
    attributionLines.join('\n') +
    `\n\n## Latin-ext fallback status\n\n${latinExtUnreliable}\n`;
  await fs.writeFile(path.join(SHARED_DIR, 'ATTRIBUTION.md'), attribution);

  const totalBytes = uploadQueue.reduce((sum, u) => sum + u.buf.length, 0);
  console.log(
    `\nGenerated: ${manifestFamilies.length} families, ${uploadQueue.length} TTF files, ` +
      `${(totalBytes / 1024 / 1024).toFixed(2)} MB canonical, ${previewCssRules.length} preview strips.`,
  );

  // ---------------------------------------------------------------------------
  // --upload: idempotent PUT to R2 (skip unchanged via ETag/MD5 compare)
  // ---------------------------------------------------------------------------
  if (UPLOAD) {
    console.log(`\n--upload: syncing ${uploadQueue.length} canonical TTFs to R2 ${R2_PREFIX}/...`);
    const { S3Client, HeadObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    const bucket = process.env.R2_BUCKET;
    if (
      !process.env.R2_ACCOUNT_ID ||
      !process.env.R2_ACCESS_KEY_ID ||
      !process.env.R2_SECRET_ACCESS_KEY ||
      !bucket
    ) {
      throw new Error(
        '--upload requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET in the environment.',
      );
    }

    let uploaded = 0;
    let skipped = 0;
    await mapLimit(uploadQueue, CONCURRENCY, async ({ r2Key, buf }) => {
      const localMd5 = md5(buf);
      let existingEtag = null;
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: r2Key }));
        existingEtag = (head.ETag ?? '').replace(/"/g, '');
      } catch {
        existingEtag = null; // not found — upload
      }
      if (existingEtag === localMd5) {
        skipped++;
        return;
      }
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: r2Key,
          Body: buf,
          ContentType: 'font/ttf',
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      uploaded++;
    });
    console.log(`R2 sync done: ${uploaded} uploaded, ${skipped} unchanged (skipped).`);
  } else {
    console.log('\n(skipping R2 upload — pass --upload to sync canonical TTFs)');
  }

  console.log('\nDone.');
}

// Only run when executed directly (`node scripts/fonts/build.mjs`) — importing this module
// from a test file (to exercise checkDrift/mapLimit/sha256/md5) must never trigger the live
// network build.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('\nfonts:build failed:', err.message);
    process.exit(1);
  });
}
