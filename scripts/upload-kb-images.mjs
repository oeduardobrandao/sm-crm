// Uploads reviewed KB screenshots to the public kb-images bucket and prints the
// public URL for each, ready to paste into the article migration.
//
// Usage:
//   node --env-file=.env.kb-upload.local scripts/upload-kb-images.mjs
//
// .env.kb-upload.local (gitignored via .env.*.local) must define:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const BUCKET = 'kb-images';
const SHOT_DIR = path.join(process.cwd(), 'e2e', '.shots');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Use --env-file.');
  process.exit(1);
}
if (!existsSync(SHOT_DIR)) {
  console.error(`No screenshots at ${SHOT_DIR}. Run: npm run screenshots:capture`);
  process.exit(1);
}

const supabase = createClient(url, key);

for (const slug of readdirSync(SHOT_DIR)) {
  const dir = path.join(SHOT_DIR, slug);
  const files = readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
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
