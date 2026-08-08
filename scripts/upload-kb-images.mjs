// Uploads reviewed KB screenshots to the public kb-images bucket and prints the
// public URL for each, ready to paste into the article migration.
//
// Usage:
//   node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs <slug> [slug...]
//
// .env.kb-upload.local (gitignored via .env.*.local) must define:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BUCKET = 'kb-images';
const SHOT_DIR = path.join(process.cwd(), 'e2e', '.shots');

/**
 * Which slug directories this invocation may upload.
 *
 * Requires an explicit slug. Uploading "everything in e2e/.shots" was the old
 * behavior and it is unsafe: the directory is gitignored, persists between
 * runs, and accumulates PNGs from earlier capture efforts plus partial output
 * from runs that crashed. Every file it holds would go to a PUBLIC bucket, and
 * the human review gate only ever covers the article being worked on.
 */
export function resolveTargetSlugs(argv, availableSlugs) {
  if (argv.length === 0) {
    throw new Error(
      'Informe ao menos um slug. Uso: node --env-file=.env.kb-upload.local ' +
        'scripts/upload-kb-images.mjs <slug> [slug...]\n' +
        `Slugs disponíveis em e2e/.shots: ${availableSlugs.join(', ') || '(nenhum)'}`,
    );
  }
  const missing = argv.filter((s) => !availableSlugs.includes(s));
  if (missing.length > 0) {
    throw new Error(`Slug sem diretório em e2e/.shots: ${missing.join(', ')}`);
  }
  return argv;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('upload-kb-images.mjs');
if (!isDirectRun) {
  // Imported by a test: export the pure helper only, run nothing.
} else {
  const availableSlugs = existsSync(SHOT_DIR) ? readdirSync(SHOT_DIR) : [];
  const targetSlugs = resolveTargetSlugs(process.argv.slice(2), availableSlugs);

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Use --env-file.');
    process.exit(1);
  }

  const supabase = createClient(url, key);

  for (const slug of targetSlugs) {
    const dir = path.join(SHOT_DIR, slug);
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.png'))
      .sort();
    console.log(`\n-- ${slug}`);
    for (const file of files) {
      const objectPath = `${slug}/${file}`;
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(objectPath, readFileSync(path.join(dir, file)), {
          contentType: 'image/png',
          upsert: true,
        });
      if (error) {
        console.error(`FAILED ${objectPath}: ${error.message}`);
        process.exit(1);
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
      console.log(`${file} -> ${data.publicUrl}`);
    }
  }
}
