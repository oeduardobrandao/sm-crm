// Run a command with the VITE_* variables from the repo's .env loaded.
//
// A git worktree has no .env of its own (it is gitignored), so `npm run dev` there
// dies with "Missing Supabase environment variables". This falls back to the main
// checkout's .env. Only VITE_* keys are forwarded: the server secrets that share that
// file (TOKEN_ENCRYPTION_KEY, STRIPE_*, META_APP_SECRET) have no business in a dev
// server. Variables already set in your shell win, same as Vite's own precedence.
//
// Usage: node scripts/with-env.mjs <command> [args...]
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('Usage: node scripts/with-env.mjs <command> [args...]');
  process.exit(2);
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function mainCheckoutRoot() {
  try {
    const gitDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    ).trim();
    return dirname(gitDir);
  } catch {
    return null;
  }
}

const mainRoot = mainCheckoutRoot();
const candidates = [join(repoRoot, '.env'), mainRoot && join(mainRoot, '.env')].filter(Boolean);
const envPath = candidates.find(existsSync);
if (!envPath) {
  console.error(
    `[with-env] No .env found. Looked in:\n${candidates.map((c) => `  ${c}`).join('\n')}`,
  );
  process.exit(1);
}

const vars = Object.fromEntries(
  Object.entries(parse(readFileSync(envPath))).filter(([key]) => key.startsWith('VITE_')),
);
console.log(`[with-env] ${Object.keys(vars).length} VITE_* vars from ${envPath}`);

const child = spawn(command, args, { stdio: 'inherit', env: { ...vars, ...process.env } });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', (err) => {
  console.error(`[with-env] Could not run "${command}": ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
