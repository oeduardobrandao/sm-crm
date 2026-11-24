// Structural guard for the Hub client login: every hub-* function resolves its
// token through resolveHubAccess (which enforces the client's login switch).
// Only hub-auth calls resolveHubToken directly, because it runs before login.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const FUNCTIONS_DIR = new URL("../", import.meta.url);
const RESOLVE_TOKEN_ALLOWLIST = new Set(["hub-auth/handler.ts"]);
const NO_ACCESS_CALL = new Set(["hub-auth"]);

async function hubEntryFiles(): Promise<{ fn: string; rel: string; src: string }[]> {
  const out: { fn: string; rel: string; src: string }[] = [];
  for await (const entry of Deno.readDir(FUNCTIONS_DIR)) {
    if (!entry.isDirectory || !entry.name.startsWith("hub-")) continue;
    for (const file of ["handler.ts", "index.ts"]) {
      const rel = `${entry.name}/${file}`;
      try {
        const src = await Deno.readTextFile(new URL(rel, FUNCTIONS_DIR));
        out.push({ fn: entry.name, rel, src });
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

Deno.test("hub functions never call resolveHubToken directly (except hub-auth)", async () => {
  const files = await hubEntryFiles();
  assert(files.length > 0, "no hub-* entry files found");
  const offenders = files
    .filter((f) => !RESOLVE_TOKEN_ALLOWLIST.has(f.rel) && f.src.includes("resolveHubToken("))
    .map((f) => f.rel);
  assertEquals(offenders, [], `resolveHubToken( still called in: ${offenders.join(", ")}`);
});

Deno.test("every hub function resolves access through resolveHubAccess (except hub-auth)", async () => {
  const files = await hubEntryFiles();
  const byFn = new Map<string, string>();
  for (const f of files) byFn.set(f.fn, (byFn.get(f.fn) ?? "") + f.src);
  const missing = [...byFn.entries()]
    .filter(([fn, src]) => !NO_ACCESS_CALL.has(fn) && !src.includes("resolveHubAccess("))
    .map(([fn]) => fn)
    .sort();
  assertEquals(missing, [], `resolveHubAccess( missing in: ${missing.join(", ")}`);
});

Deno.test("hub-report-docs: /print-doc/ is handled before any resolveHubAccess( call", async () => {
  const src = await Deno.readTextFile(new URL("hub-report-docs/index.ts", FUNCTIONS_DIR));
  const printIdx = src.indexOf('path.startsWith("/print-doc/")');
  const accessIdx = src.indexOf("resolveHubAccess(");
  assert(printIdx >= 0, "/print-doc/ branch not found");
  assert(accessIdx >= 0, "resolveHubAccess( not found in hub-report-docs/index.ts");
  assert(printIdx < accessIdx, "/print-doc/ must be reached before resolveHubAccess(");
});
