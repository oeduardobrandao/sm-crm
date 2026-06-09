// Deterministically gather a failing cron's source for the triage prompt.
// BFS: the cron's *.ts files + any relative .ts imports within supabase/functions.
// No network, no token. Pure FS.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const ROOT = 'supabase/functions';

export function gather(cron, cap = 40_000) {
  if (!cron || !/^[a-z0-9-]+$/.test(cron)) throw new Error(`invalid cron name: ${cron}`);
  const dir = join(ROOT, cron);
  if (!existsSync(dir)) throw new Error(`cron dir not found: ${dir}`);

  const files = [];
  const seen = new Set();
  let total = 0;
  const queue = readdirSync(dir).filter((f) => f.endsWith('.ts')).sort().map((f) => join(dir, f));

  while (queue.length) {
    const path = queue.shift();
    const norm = relative('.', path);
    if (seen.has(norm) || !existsSync(path)) continue;
    seen.add(norm);
    if (total >= cap) continue;
    let content = readFileSync(path, 'utf8');
    if (total + content.length > cap) content = content.slice(0, cap - total) + '\n/* …truncated… */';
    total += content.length;
    files.push({ path: norm, content });
    for (const m of content.matchAll(/from\s+["'](\.[^"']+\.ts)["']/g)) {
      const rel = relative('.', resolve(dirname(path), m[1]));
      if (rel.startsWith(ROOT + '/')) queue.push(rel);
    }
  }
  return { cronName: cron, files };
}

// CLI: node gather.mjs <cron-name>  -> JSON on stdout
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(JSON.stringify(gather(process.argv[2]), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
