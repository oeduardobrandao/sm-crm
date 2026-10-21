# Q1 Limits Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the three nearest capacity cliffs found by the 2026-09-22 edge-functions audit: (1) the PostgREST 1000-row silent-truncation family, (2) file-zip whole-file memory buffering + silent-incomplete zips, (3) the unchackpointed 200/day trash purge.

**Architecture:** Part 1 adds a `_shared/paginate.ts` helper (`fetchAllRows` + `chunk`) and sweeps the seven truncation sites, splitting them into "read-aggregate → paginate everything" (MRR, trials, radar, billing leg C, express cleanup) and "per-row network workers → cap + order by urgency" (the two refresh crons, where paginating to 1500 rows would just move the death to the wall clock). Part 2 rewrites file-zip to stream R2 objects straight into the zip (store mode, stall guard, failure manifest, byte/entry/depth budgets) and gives `purgeTrash` a durable checkpoint in the existing `cron_scan_state` table plus a dead-letter alert for maxed-out deletion rows.

**Tech Stack:** Deno edge functions (Supabase), supabase-js v2, zip.js (`npm:@zip.js/zip.js@2`), R2 via presign+fetch (`_shared/r2.ts`), Deno test with dependency-injected fakes (pattern: every `*_test.ts` in `supabase/functions/__tests__/`).

## Global Constraints

- Everything under `supabase/functions/` is **Deno**: `npm:` specifiers or relative `.ts` imports, never CommonJS.
- `npm run check:functions` is the ONLY type gate for edge functions (`test:functions` runs `--no-check`). Run it in every task.
- `deno test` filter matches TEST NAMES, not file paths: `deno test supabase/functions/ --filter "<test name substring>"`. Run from repo root.
- After any `deno test` run, if `git status` shows `deno.lock` churn: `git checkout supabase/functions/deno.lock`. If `node_modules/.deno` appeared: run `npm ci`.
- NEVER log or return raw error details to clients. Generic message out, detail to `console.error`.
- All paginated queries MUST carry a total order ending in an `id` tiebreak — `.range()` skips/repeats rows without one (documented at `supabase/functions/instagram-sync-cron/index.ts:433-436`).
- User-facing copy (the zip manifest file) is Portuguese and must not contain em-dashes; use period or colon.
- Before pushing: `npm run lint`, `npm run format:check`, `npx tsc -p apps/crm/tsconfig.json --noEmit` (plus hub/admin/scripts if any `apps/` file was touched — this plan touches none), `npm run check:functions`, `npm run test:functions`, `npm run test`.
- Deploy notes (for the PR description, not executed by tasks): edge deploys use `npx supabase functions deploy <name> --use-api --project-ref <ref>`; `file-zip` and all crons deploy with `--no-verify-jwt`. Changing `_shared/r2.ts` requires redeploying every importer: `automation-media briefing-audio file-manage file-upload-finalize file-upload-url file-zip hub-bootstrap hub-briefing hub-ideias hub-posts ideia-media-manage instagram-webhook mcp mcp-admin post-media-backfill-thumbnails post-media-cleanup-cron post-media-finalize post-media-manage post-media-upload-url sign-r2-urls tiktok-media`.
- No migrations in this plan. `record_scan_checkpoint` / `cron_scan_state` (migration `20260913000001`) already upsert by `scan_key`, so the new `trash-purge:trash/` key needs no schema change.
- Suggested split: Tasks 1-7 → PR "fix: paginate truncation-prone edge function reads"; Tasks 8-11 → PR "fix: stream file-zip and checkpoint trash purge". Both branch off `claude/edge-functions-audit-e75c52` (already contains the audit docs) or off main with docs cherry-picked — executor asks the user at PR time only if the branch state diverged.

---

### Task 1: `_shared/paginate.ts` helper

**Files:**
- Create: `supabase/functions/_shared/paginate.ts`
- Test: `supabase/functions/__tests__/paginate_test.ts`

**Interfaces:**
- Produces: `fetchAllRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>, pageSize?: number): Promise<T[]>` and `chunk<T>(items: T[], size?: number): T[][]` (default size 500).

- [ ] **Step 0: Commit the uncommitted audit docs so task commits are clean**

```bash
git add docs/superpowers/specs/2026-09-22-edge-functions-capacity-audit.md docs/superpowers/specs/2026-09-22-edge-functions-audit-eli5.md docs/superpowers/plans/2026-09-22-q1-limits-fixes.md
git commit -m "docs: edge functions capacity audit + Q1 fixes plan"
```

- [ ] **Step 1: Write the failing tests**

Create `supabase/functions/__tests__/paginate_test.ts`:

```ts
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";

function pageServer(rows: number[], serverCap: number) {
  // Simulates PostgREST: returns at most serverCap rows per range request,
  // regardless of how many the range asked for (the db-max-rows behavior).
  return (from: number, to: number) => {
    const want = Math.min(to - from + 1, serverCap);
    return Promise.resolve({ data: rows.slice(from, from + want), error: null });
  };
}

Deno.test("fetchAllRows drains all rows across pages", async () => {
  const rows = Array.from({ length: 2350 }, (_, i) => i);
  const all = await fetchAllRows(pageServer(rows, 1000), 1000);
  assertEquals(all.length, 2350);
  assertEquals(all[2349], 2349);
});

Deno.test("fetchAllRows survives a server cap SMALLER than pageSize", async () => {
  // The bug a naive "stop when page < pageSize" would reintroduce.
  const rows = Array.from({ length: 250 }, (_, i) => i);
  const all = await fetchAllRows(pageServer(rows, 100), 1000);
  assertEquals(all.length, 250);
});

Deno.test("fetchAllRows returns empty for no rows", async () => {
  assertEquals(await fetchAllRows(pageServer([], 1000)), []);
});

Deno.test("fetchAllRows throws on page error, never returns partial", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      fetchAllRows<number>((from, to) => {
        calls++;
        if (calls === 2) return Promise.resolve({ data: null, error: { message: "boom" } });
        return Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, i) => from + i), error: null });
      }, 10),
    Error,
    "boom",
  );
});

Deno.test("chunk splits and preserves order", () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assertEquals(chunk([], 2), []);
  assertEquals(chunk([1], 500), [[1]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/__tests__/paginate_test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `_shared/paginate.ts`**

```ts
// Paginated reads for edge functions.
//
// PostgREST silently truncates any un-limited select at db-max-rows (1000 on
// hosted Supabase) with NO error — the audit found seven crons/endpoints that
// would return silently wrong data past that. fetchAllRows drains a query via
// .range() pages instead.
//
// CONTRACT for callers:
// - The underlying query MUST have a total order ending in an `id` tiebreak,
//   or .range() can skip/repeat rows across pages (see
//   instagram-sync-cron/index.ts selection comment).
// - Advancement is by rows RECEIVED, and the loop stops only on an EMPTY
//   page: correct even when db-max-rows is smaller than pageSize.
// - Any page error throws. Callers that must not act on a partial set (e.g.
//   billing sweeps) rely on this: never catch-and-continue around it.
export async function fetchAllRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(`paginated read failed at offset ${from}: ${error.message}`);
    const rows = data ?? [];
    if (rows.length === 0) break;
    all.push(...rows);
    from += rows.length;
  }
  return all;
}

/** Splits `.in(...)` id lists so neither the request URL nor the response can
 * hit PostgREST limits. 500 matches data-import's IN_CHUNK. */
export function chunk<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/__tests__/paginate_test.ts`
Expected: 5 passed.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run check:functions
git add supabase/functions/_shared/paginate.ts supabase/functions/__tests__/paginate_test.ts
git commit -m "feat(edge): shared paginated-read helper (fetchAllRows + chunk)"
```

---

### Task 2: platform-admin MRR + trials pagination

**Files:**
- Modify: `supabase/functions/platform-admin/mrr.ts` (both `handleGetMrr` and `handleGetTrials`)
- Modify: `supabase/functions/platform-admin/owner-contact.ts` (its three bulk `.in()` selects)
- Test: extend the existing platform-admin/mrr tests (find with `grep -rln "handleGetMrr" supabase/functions/__tests__/`)

**Interfaces:**
- Consumes: `fetchAllRows`, `chunk` from `../_shared/paginate.ts` (Task 1 signatures).
- Produces: no signature changes; `handleGetMrr`/`handleGetTrials`/`fetchOwnerContacts` keep their exact current signatures and response shapes.

- [ ] **Step 1: Write the failing test**

In the existing mrr test file, add a test that the fake db returns 1000-row pages and asserts all rows are aggregated. The existing tests use a fake `svc` with a builder chain; extend the fake so `.range(from, to)` slices a fixture of 1500 subscription rows, and assert `paying_count === 1500` (all priced via the injectable `fetchOwnerContactsFn` and a fake `priceSubscriptionRows` path already used by current tests — reuse the file's existing fake construction verbatim; only the fixture size and `.range` support are new).

```ts
Deno.test("handleGetMrr aggregates past the 1000-row PostgREST page", async () => {
  // fake returns rows only via .range(from,to) slices; 1500 subs total
  // ... build on the file's existing fakeSvc helper ...
  const res = await handleGetMrr(fakeSvc as any, {}, async () => new Map());
  const body = await res.json();
  assertEquals(body.paying_count, 1500);
});
```

(The executor writes the concrete fake against the file's existing helpers — the test file already fakes this exact query chain; copy its pattern, add `.range`.)

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/ --filter "aggregates past the 1000-row"`
Expected: FAIL (current code issues a single un-ranged select; the fake's `.range`-only data path returns nothing, or the count is 1000 — either failure is acceptance).

- [ ] **Step 3: Implement**

In `mrr.ts`, replace the primary select in `handleGetMrr` (lines 45-51):

```ts
import { chunk, fetchAllRows } from "../_shared/paginate.ts";

const rows = await fetchAllRows<SubRow>((from, to) =>
  svc
    .from("workspace_subscriptions")
    .select(
      "workspace_id, provider, status, plan_id, billing_interval, stripe_subscription_id, amount_cents, currency, amount_interval, discount_label",
    )
    .in("status", [...MRR_STATUSES])
    .order("workspace_id", { ascending: true })
    .order("id", { ascending: true })
    .range(from, to)
);
```

(Declare a local `SubRow` type matching the selected columns; `workspace_subscriptions` has an `id` pk — verify with `grep -n "create table" supabase/migrations/*workspace_subscriptions*` and use the pk column that exists; if the pk is `workspace_id` alone, order by it alone.)

Same change in `handleGetTrials` for the `status = 'trialing'` select. Then chunk the dependent lookups in BOTH handlers:

```ts
const nameByWs = new Map<string, string>();
const createdByWs = new Map<string, string>();
for (const ids of chunk(wsIds)) {
  const { data: wsRows, error: wsErr } = await svc
    .from("workspaces").select("id, name, created_at").in("id", ids);
  if (wsErr) throw wsErr; // was silently ignored; a missing name must not zero a paying row
  for (const w of wsRows ?? []) {
    nameByWs.set(w.id, w.name);
    createdByWs.set(w.id, w.created_at);
  }
}
```

Apply the same chunk loop to the `plans` lookup (planIds) in both handlers, and to `fetchLastActivity` (chunk the RPC's `workspace_ids` argument at 500 and merge the maps — the RPC returns setof and is subject to the same row cap).

In `owner-contact.ts`: wrap its `workspace_members`, `workspaces` and `profiles` bulk `.in()` selects in the same `chunk` loop (keep its existing concurrency-8 `getUserById` stage untouched).

- [ ] **Step 4: Run the new test + the file's whole suite**

Run: `deno test supabase/functions/ --filter "MRR"` (and the mrr test file directly)
Expected: all pass, including pre-existing tests (they exercise the same fakes — if a pre-existing fake lacks `.range`/`.order`, extend the fake, do not weaken the assertion).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run check:functions
git add supabase/functions/platform-admin/ supabase/functions/__tests__/
git commit -m "fix(platform-admin): paginate MRR/trials reads past the 1000-row PostgREST cap"
```

---

### Task 3: retention-radar-cron pagination

**Files:**
- Modify: `supabase/functions/retention-radar-cron/index.ts:20-55`
- Test: `supabase/functions/__tests__/` (find the radar test with `grep -rln "retention" supabase/functions/__tests__/`; if none exists for the run body, add assertions to `radar-logic` tests only for what is extractable, and otherwise verify by typecheck — the run body takes `supabase` implicitly, so ALSO move the three reads behind small exported helpers if a test file exists; if not, keep the change minimal and rely on Task 2's identical helper being tested)

**Interfaces:**
- Consumes: `fetchAllRows`, `chunk` from `../_shared/paginate.ts`.

- [ ] **Step 1: Implement (same recipe as Task 2)**

- Primary select (`workspace_subscriptions`, `index.ts:20-23`): `fetchAllRows` with `.order("workspace_id").order("id").range(from, to)` (same pk caveat as Task 2).
- `workspaces .in("id", ids)` (`:41-42`): chunk loop, `throw wsErr` stays.
- `admin_workspace_last_activity` RPC (`:49-50`): chunk `ids` at 500, merge maps.

- [ ] **Step 2: Verify**

Run: `npm run check:functions && deno test supabase/functions/ --filter "radar"`
Expected: typecheck clean; existing radar tests pass.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/retention-radar-cron/
git commit -m "fix(retention-radar): paginate subscription scan past the 1000-row cap"
```

---

### Task 4: billing-downgrade-cron leg C pagination

**Files:**
- Modify: `supabase/functions/billing-downgrade-cron/handler.ts:296-330`
- Test: `supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from `../_shared/paginate.ts`.
- Invariant preserved: this read is LOAD-BEARING (a partial set makes paid subscriptions look orphaned and cancels them). `fetchAllRows` throws on any page error, so the leg still aborts into its catch. Keep the per-call `abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))` on every page.

- [ ] **Step 1: Write the failing test**

`billing-downgrade-cron-handler_test.ts` already fakes leg C's reads (find the fake serving `workspace_subscriptions` with `pagarme_subscription_id`). Add a test where the fake holds 1200 linked ids served via `.range()` and assert the sweep does NOT cancel a remote subscription whose id is in rows 1001-1200.

- [ ] **Step 2: Run to verify it fails**

Run: `deno test supabase/functions/ --filter "leg C"` (adjust to the file's test-name convention)
Expected: FAIL — with the current single read the fake either truncates (sub looks orphaned → cancel recorded) or the old `{count}` check throws; assert specifically that no cancel happened for the tail id.

- [ ] **Step 3: Implement**

Replace both reads (`handler.ts:296-319`) with:

```ts
const linked = await fetchAllRows<{ pagarme_subscription_id: string | null }>((from, to) =>
  deps.db
    .from("workspace_subscriptions")
    .select("id, pagarme_subscription_id")
    .not("pagarme_subscription_id", "is", null)
    .order("id", { ascending: true })
    .range(from, to)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
);
```

Same for `pagarme_checkout_attempts` (keep `.eq("state", "pending")`). Delete the now-redundant `{count:"exact"}` truncation checks and their comments, replacing the comment with: pagination makes truncation impossible; `fetchAllRows` throws on any page error so the fail-closed contract (abort the whole leg) is unchanged.

- [ ] **Step 4: Run the full billing test file**

Run: `deno test supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts`
Expected: all pass (existing truncation-detection tests will need updating: a test that asserted "truncated read throws" becomes "page error throws" — rewrite it against the new fake, keeping the invariant name).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run check:functions
git add supabase/functions/billing-downgrade-cron/ supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts
git commit -m "fix(billing-downgrade): paginate leg C reads; keep fail-closed on page errors"
```

---

### Task 5: analytics-report-cron queue pagination

**Files:**
- Modify: `supabase/functions/analytics-report-cron/queue.ts:43-51`
- Test: `supabase/functions/__tests__/analytics-report-cron_test.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from `../_shared/paginate.ts`.
- `SupabaseLike` in queue.ts stays structural; the fake in the test gains `.order`/`.range` support.

- [ ] **Step 1: Failing test** — fake `instagram_accounts` with 1100 rows served via `.range`; assert `result.total === 1100` and 1100 upserts recorded.
- [ ] **Step 2: Run** `deno test supabase/functions/__tests__/analytics-report-cron_test.ts` — expected FAIL (total 1000 or 0 depending on fake).
- [ ] **Step 3: Implement** — replace the select with `fetchAllRows` + `.not("encrypted_access_token","is",null).order("id",{ascending:true}).range(from,to)`. The per-account loop stays sequential (idempotent monthly upserts; run remains O(accounts) — acceptable for now, noted in the audit as a Q3 item).
- [ ] **Step 4: Run** the test file — all pass.
- [ ] **Step 5: Commit**

```bash
npm run check:functions
git add supabase/functions/analytics-report-cron/ supabase/functions/__tests__/analytics-report-cron_test.ts
git commit -m "fix(analytics-report-cron): paginate account scan so accounts past 1000 still get reports"
```

---

### Task 6: express-post-cleanup-cron pagination

**Files:**
- Modify: `supabase/functions/express-post-cleanup-cron/handler.ts` (pass 1 `:117-135`; passes 2 and 3 selects; the `deleteOrphanFiles` per-file loop is OUT of scope)
- Test: `supabase/functions/__tests__/express-post-cleanup-cron_test.ts`

**Interfaces:**
- Consumes: `fetchAllRows`, `chunk` from `../_shared/paginate.ts`.
- `ExpressPostCleanupDb` structural type: extend so the builder chain includes `.order` and `.range` (mirror how the test fake implements them).

- [ ] **Step 1: Failing test** — fake `workflow_posts` with 1200 express/postado rows across 600 workflows served via `.range`; assert workflows from the tail (row > 1000) still get concluded.
- [ ] **Step 2: Run** the test file — expected FAIL.
- [ ] **Step 3: Implement** — pass 1 primary select via `fetchAllRows` (order `workflow_id` then `id`); `candidateIds` lookup via `chunk(candidateIds)` loop over the `workflows .in("id", ids).eq("status","ativo")` select, accumulating `activeExpress`. Apply `fetchAllRows` to the pass 2 and pass 3 candidate selects as well (their cutoff filters stay; only ordering + range are added).
- [ ] **Step 4: Run** the test file — all pass, including existing tests (extend the fake, not the assertions).
- [ ] **Step 5: Commit**

```bash
npm run check:functions
git add supabase/functions/express-post-cleanup-cron/ supabase/functions/__tests__/express-post-cleanup-cron_test.ts
git commit -m "fix(express-cleanup): paginate candidate scans; chunk workflow id lookups"
```

---

### Task 7: refresh crons — cap + order by urgency (NOT paginate-all)

**Files:**
- Modify: `supabase/functions/instagram-refresh-cron/index.ts:77-83`
- Modify: `supabase/functions/tiktok-refresh-cron/core.ts:131-137`
- Test: `supabase/functions/__tests__/` — tiktok refresh has `runTikTokRefreshCron` DI tests (find with `grep -rln "runTikTokRefreshCron" supabase/functions/__tests__/`); instagram-refresh has none for the run body — its change is select-clause-only, covered by typecheck + the tiktok test proving the pattern.

**Interfaces:**
- No new shared code. Rationale (goes in a comment at each select): these crons do slow serial network work per row; draining 1500 rows in one isolate trades silent truncation for a wall-clock death. A cap with `token_expires_at asc` ordering turns overflow into a safe backlog: the soonest-to-expire always go first, and the cadence (6h against a 30d window) retries the rest. **This is why they deliberately do NOT use fetchAllRows.**

- [ ] **Step 1: Failing test (tiktok)** — in the tiktok refresh test file, fake 3 candidate accounts with distinct `access_token_expires_at`, have the fake honor `.order`/`.limit`, and assert the refresh call order is soonest-first and that a `limit` was applied (fake records the requested limit; assert it equals 200).
- [ ] **Step 2: Run** — expected FAIL (no order/limit in current query).
- [ ] **Step 3: Implement.** In `tiktok-refresh-cron/core.ts`, add to the select chain:

```ts
.order("access_token_expires_at", { ascending: true, nullsFirst: false })
.order("id", { ascending: true })
.limit(REFRESH_BATCH_LIMIT)
```

with `const REFRESH_BATCH_LIMIT = Math.max(1, parseInt(Deno.env.get("REFRESH_BATCH_LIMIT") || "200", 10) || 200);` at module top of `core.ts` — read via `deps.refreshBatchLimit ?? 200` if the deps object pattern fits better (match the file's existing env style). In `instagram-refresh-cron/index.ts`, same three lines on the candidates select, ordering by `token_expires_at`.
- [ ] **Step 4: Run** the tiktok test file + `npm run check:functions` — pass.
- [ ] **Step 5: Commit**

```bash
git add supabase/functions/tiktok-refresh-cron/ supabase/functions/instagram-refresh-cron/
git commit -m "fix(refresh-crons): cap batch at 200 ordered by expiry instead of unbounded unordered scan"
```

- [ ] **Step 6: PR for Part 1**

Run the full pre-push gate (Global Constraints), then push and open the PR titled `fix(edge): paginate truncation-prone reads past PostgREST's 1000-row cap`. Body lists the seven sites, the aggregate-vs-worker split rationale, and the deploy list for Part 1: `platform-admin retention-radar-cron billing-downgrade-cron analytics-report-cron express-post-cleanup-cron instagram-refresh-cron tiktok-refresh-cron` (all crons with `--no-verify-jwt`; platform-admin without). End the body with the attribution line from the session reminder.

---

### Task 8: file-zip handler extraction (testability refactor, no behavior change)

**Files:**
- Create: `supabase/functions/file-zip/handler.ts`
- Modify: `supabase/functions/file-zip/index.ts` (becomes the thin `Deno.serve` shell: env, cors, token verify, `createClient`, calls the handler)
- Test: `supabase/functions/__tests__/file-zip_test.ts`

**Interfaces:**
- Produces (Task 9 depends on these exact names):

```ts
export interface FileZipDeps {
  db: {
    from(table: string): any; // structural, like ExpressPostCleanupDb
  };
  contaId: string;
  // Returns the object stream or null (missing). Task 8 wires _shared/r2.ts
  // getObject; Task 9 replaces the wiring with the signed streaming getter.
  getObjectStream: (key: string) => Promise<ReadableStream<Uint8Array> | null>;
}
export interface ZipPlanEntry { name: string; r2Key: string; path: string; size_bytes: number | null; }
// Walks a folder tree (or resolves file_ids) into a flat entry list.
export async function collectFolderEntries(deps: FileZipDeps, folderId: number): Promise<ZipPlanEntry[]>;
export async function collectFileEntries(deps: FileZipDeps, fileIds: number[]): Promise<ZipPlanEntry[]>;
// Builds the zip response body stream from entries.
export function buildZipStream(deps: FileZipDeps, entries: ZipPlanEntry[]): ReadableStream<Uint8Array>;
```

- [ ] **Step 1: Move the walk + zip IIFE bodies into `handler.ts`** with the interfaces above, `index.ts` keeping: token verify (unchanged), 404/400 responses, filename headers. Behavior identical: same queries, same `.blob()` buffering (that changes in Task 9), same skip logging.
- [ ] **Step 2: Write characterization tests** in `file-zip_test.ts`: fake db with a 2-level folder tree (3 files), fake `getObjectStream` returning small `ReadableStream`s from byte arrays; assert `collectFolderEntries` returns 3 entries with correct nested paths, and that `buildZipStream` produces a parseable zip (use zip.js `ZipReader` + `Uint8ArrayReader` on the concatenated stream output) containing the 3 paths.
- [ ] **Step 3: Run** `deno test supabase/functions/__tests__/file-zip_test.ts` — pass.
- [ ] **Step 4: Typecheck and commit**

```bash
npm run check:functions
git add supabase/functions/file-zip/ supabase/functions/__tests__/file-zip_test.ts
git commit -m "refactor(file-zip): extract handler with injected deps (no behavior change)"
```

---

### Task 9: file-zip streaming, store mode, budgets, failure manifest

**Files:**
- Modify: `supabase/functions/file-zip/handler.ts`, `supabase/functions/file-zip/index.ts`, `supabase/functions/file-zip/utils.ts`
- Modify: `supabase/functions/_shared/r2.ts` (add `getObjectStreamSigned`)
- Test: `supabase/functions/__tests__/file-zip_test.ts`

**Interfaces:**
- Consumes: Task 8's `FileZipDeps`/`collectFolderEntries`/`buildZipStream`; `fetchAllRows`/`chunk` from Task 1; `signGetUrl` from `_shared/r2.ts`.
- Produces in `utils.ts` (exact values):

```ts
export const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024;      // unchanged
export const MAX_ZIP_TOTAL_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB refusal threshold
export const MAX_ZIP_ENTRIES = 2000;
export const MAX_FOLDER_DEPTH = 10;                        // matches file-manage
export const STALL_IDLE_MS = 15_000;
```

- Produces in `_shared/r2.ts`:

```ts
/** Streaming GET via presign + fetch (the SDK transport is the documented
 * edge-runtime hang path). Bounds time-to-first-byte only; body stalls are
 * the caller's job (file-zip wraps with a per-chunk stall guard) because a
 * total AbortSignal would kill legitimately large slow bodies. */
export async function getObjectStreamSigned(key: string): Promise<ReadableStream<Uint8Array> | null> {
  try {
    const url = await signGetUrl(key, 300);
    const ac = new AbortController();
    const headerTimer = setTimeout(() => ac.abort(), 15_000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(headerTimer);
    if (!res.ok) { await res.body?.cancel(); return null; }
    return res.body;
  } catch { return null; }
}
```

- [ ] **Step 1: Write the failing tests** (add to `file-zip_test.ts`):

```ts
Deno.test("buildZipStream streams entries without buffering and stores (level 0)", async () => {
  // fake getObjectStream returns a 3-chunk stream; assert the zip parses and
  // the entry's compressionMethod is 0 (store) via ZipReader entry metadata.
});

Deno.test("zip includes LEIA-ME manifest when an object is missing", async () => {
  // 2 entries, second getObjectStream -> null; assert zip contains entry 1 +
  // "LEIA-ME-arquivos-faltando.txt" listing entry 2's path, and completes.
});

Deno.test("collectFolderEntries paginates file pages and stops at depth cap", async () => {
  // fake db serves 1100 files in one folder via .range; folder chain 12 deep;
  // assert 1100 entries from the wide folder and no entries below depth 10.
});

Deno.test("oversized total is refused before streaming", async () => {
  // entries summing over MAX_ZIP_TOTAL_BYTES -> handler returns a refusal
  // marker (see Step 3) instead of a stream.
});

Deno.test("a stalled object stream errors the zip instead of hanging", async () => {
  // getObjectStream returns a stream that never produces a chunk; with
  // STALL_IDLE_MS overridden small via deps, assert the output stream errors
  // (reader.read() rejects) rather than hanging. Use a deps.stallIdleMs
  // override field to keep the test fast.
});
```

- [ ] **Step 2: Run to verify the new tests fail** (`deno test supabase/functions/__tests__/file-zip_test.ts`).

- [ ] **Step 3: Implement.** In `handler.ts`:

1. `collectFolderEntries`: replace both walk queries with `fetchAllRows` (order `id`), track depth, stop descending at `MAX_FOLDER_DEPTH` with a `console.error`. `collectFileEntries`: `chunk(fileIds)` and **throw** on query error (fixes the silent-empty-zip: `index.ts` maps a thrown collect into a 500 JSON before any stream starts).
2. Pre-flight in `index.ts` after collecting entries: if `entries.length > MAX_ZIP_ENTRIES` or `sum(size_bytes) > MAX_ZIP_TOTAL_BYTES`, return `413` JSON `{ error: "Seleção grande demais para exportar em um único zip" }` (no stream started). Treat `size_bytes == null` as `MAX_FILE_SIZE_BYTES` in the sum (defense for legacy rows; schema says NOT NULL).
3. `buildZipStream`: for each entry — skip if `size_bytes` over `MAX_FILE_SIZE_BYTES` (or null) recording the path in `skipped[]`; get the stream via `deps.getObjectStream`; on null record and continue; else `await zipWriter.add(entry.path, withStallGuard(stream, stallIdleMs), { level: 0 })` inside try/catch that records failures in `skipped[]`. After the loop, if `skipped.length > 0` add a final entry `LEIA-ME-arquivos-faltando.txt` (Portuguese, no em-dashes): a header line `Os arquivos abaixo nao puderam ser incluidos neste zip:` plus one path per line (use zip.js `TextReader`). Wrap the whole async body in try/catch: on catastrophic error `await zipWriter.close().catch(() => {})` is NOT enough — call `writable.abort(err)` so the client's download fails visibly instead of hanging.
4. `withStallGuard` (in `handler.ts`):

```ts
export function withStallGuard(
  stream: ReadableStream<Uint8Array>,
  idleMs: number,
): ReadableStream<Uint8Array> {
  let timer: ReturnType<typeof setTimeout>;
  return stream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      start(controller) {
        timer = setTimeout(() => controller.error(new Error("object stream stalled")), idleMs);
      },
      transform(chunk, controller) {
        clearTimeout(timer);
        timer = setTimeout(() => controller.error(new Error("object stream stalled")), idleMs);
        controller.enqueue(chunk);
      },
      flush() { clearTimeout(timer); },
    }),
  );
}
```

5. `index.ts` wiring: `getObjectStream: getObjectStreamSigned` (drop the `getObject` import; if nothing else imports the old SDK-transport `getObject`, leave it in r2.ts untouched — removing it is out of scope).
6. zip.js runtime check: the tests in Step 1 exercise `add(name, readableStream)` and `{ level: 0 }` against the real library — if the floating `@2` resolution rejects a raw `ReadableStream`, wrap as `{ readable: stream }` per zip.js's Reader duck-type; the test is the arbiter.

- [ ] **Step 4: Run the whole file-zip test file** — all pass.
- [ ] **Step 5: Full gate and commit**

```bash
npm run check:functions && npm run test:functions
git add supabase/functions/file-zip/ supabase/functions/_shared/r2.ts supabase/functions/__tests__/file-zip_test.ts
git commit -m "fix(file-zip): stream objects into the zip (store mode), budgets, stall guard, failure manifest"
```

---

### Task 10: purgeTrash checkpoint + deadline

**Files:**
- Modify: `supabase/functions/_shared/r2.ts:156-175` (`purgeTrash`)
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts:165-182` (caller)
- Test: `supabase/functions/__tests__/` — add `purge-trash_test.ts` (r2.ts's `purgeTrash` takes the SDK client via `getR2()`; refactor it to accept an injectable page-lister + deleter so it's testable, mirroring `listOrphanKeyPage`'s consumers)

**Interfaces:**
- Produces (new signature; post-media-cleanup-cron is the ONLY caller — verify with `grep -rn "purgeTrash" supabase/functions/`):

```ts
export interface PurgeTrashOpts {
  maxPerRun?: number;        // default 500 (was 200)
  startToken?: string | null;
  deadlineMs?: number;       // default 55_000, checked between pages
  // test seams; default to the real implementations
  listPage?: (token: string | undefined) => Promise<{ objects: Array<{ key: string; lastModified: Date }>; nextToken: string | null }>;
  deleteFn?: (key: string) => Promise<void>;
  nowFn?: () => number;
}
export interface PurgeTrashResult { purged: number; nextToken: string | null; cycleCompleted: boolean; }
export async function purgeTrash(olderThanDays: number, opts?: PurgeTrashOpts): Promise<PurgeTrashResult>;
```

- [ ] **Step 1: Write the failing tests** (`purge-trash_test.ts`, driving via `listPage`/`deleteFn` fakes):

```ts
Deno.test("purgeTrash resumes from startToken and returns the next one", ...);
Deno.test("purgeTrash deletes only objects older than the cutoff", ...);
Deno.test("cap reached mid-page returns the CURRENT page's producing token, not the next (no skipped objects)", ...);
Deno.test("deadline exceeded stops between pages and preserves resume token", ...);
Deno.test("invalid startToken (listPage throws on first call with a token) retries once from null", ...);
Deno.test("cycleCompleted true only when the final page reports no continuation", ...);
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement.** Core loop semantics (this replaces `r2.ts:156-175`):

```ts
export async function purgeTrash(olderThanDays: number, opts: PurgeTrashOpts = {}): Promise<PurgeTrashResult> {
  const { maxPerRun = 500, deadlineMs = 55_000, nowFn = Date.now } = opts;
  const listPage = opts.listPage ?? realListTrashPage; // wraps ListObjectsV2Command w/ 30s abort, as today
  const deleteFn = opts.deleteFn ?? deleteObject;
  const cutoff = nowFn() - olderThanDays * 24 * 60 * 60 * 1000;
  const startedAt = nowFn();
  let purged = 0;
  // Token that PRODUCED the page currently being processed. Persisting this
  // (not nextToken) on an early exit means an interrupted page is re-listed,
  // never skipped: deletes are idempotent (deleteObject treats 404 as done).
  let pageToken: string | null = opts.startToken ?? null;
  let retriedFromNull = false;
  while (true) {
    let page;
    try {
      page = await listPage(pageToken ?? undefined);
    } catch (e) {
      if (pageToken !== null && !retriedFromNull) {
        // Stale/invalid continuation token (R2 InvalidArgument): restart cycle.
        console.error("purgeTrash: list failed with token, restarting from head", e);
        pageToken = null; retriedFromNull = true; continue;
      }
      throw e;
    }
    for (const obj of page.objects) {
      if (purged >= maxPerRun) return { purged, nextToken: pageToken, cycleCompleted: false };
      if (obj.lastModified.getTime() < cutoff) { await deleteFn(obj.key); purged++; }
    }
    if (page.nextToken === null) return { purged, nextToken: null, cycleCompleted: true };
    pageToken = page.nextToken;
    if (nowFn() - startedAt >= deadlineMs) return { purged, nextToken: pageToken, cycleCompleted: false };
  }
}
```

Caller change in `post-media-cleanup-cron/index.ts` (replacing `:165-182`), reusing the checkpoint I/O already defined for the orphan scan (`readCheckpoint`/`writeCheckpoint` closures at `:143-162` — lift them to named local functions so both call sites share them):

```ts
const PURGE_SCAN_KEY = "trash-purge:trash/";
let trashPurged = 0;
try {
  const startToken = await readCheckpoint(PURGE_SCAN_KEY);
  const result = await withWatchdog(90_000, () => purgeTrash(30, { startToken }));
  if (result) {
    trashPurged = result.purged;
    await writeCheckpoint(PURGE_SCAN_KEY, result.nextToken, { cycleCompleted: result.cycleCompleted });
  }
} catch (e) { console.error("post-media-cleanup:purge-trash", e); }
```

`withWatchdog` is the existing Promise-race pattern from `:170-179` extracted to a local helper (resolves `null` on timeout — checkpoint is then NOT written, so the next run resumes from the previous token; the internal 55s deadline makes the 90s watchdog a true last resort). Keep the comment explaining that the internal deadline is the primary bound and why the watchdog no longer needs to be 60s.

- [ ] **Step 4: Run** `deno test supabase/functions/__tests__/purge-trash_test.ts` + `npm run check:functions` — pass.
- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/r2.ts supabase/functions/post-media-cleanup-cron/ supabase/functions/__tests__/purge-trash_test.ts
git commit -m "fix(cleanup): checkpoint trash purge in cron_scan_state; raise cap to 500 with internal deadline"
```

---

### Task 11: dead-letter alert for exhausted deletion rows

**Files:**
- Modify: `supabase/functions/post-media-cleanup-cron/index.ts` (alerts block, `:196-215`)
- Test: extend the cleanup cron's existing tests if the alerts block is exercised there (`grep -rln "reportCronFailure" supabase/functions/__tests__/ | grep -i cleanup`); if the block isn't test-covered today, add the check with typecheck-only verification and note it in the commit body.

**Interfaces:**
- Consumes: the drain queries' own tables. The legacy drain filters `attempts < 6` (`index.ts:53`), the `file_deletions` drain `attempts < 5` (`index.ts:75`) — read the two table names and exact attempt caps from those lines at implementation time and use the same values here.

- [ ] **Step 1: Implement.** After the existing alert composition, add two `head: true` count queries:

```ts
// Dead-letter visibility: rows past their attempt cap are silently excluded
// from the drains forever. The alert TEXT is deliberately stable (no counts)
// so cron-health's dedup collapses repeats; the count goes to the log only.
const { count: deadFileRows } = await svc
  .from("file_deletions")
  .select("id", { count: "exact", head: true })
  .gte("attempts", 5);
if ((deadFileRows ?? 0) > 0) {
  console.error(`post-media-cleanup: ${deadFileRows} file_deletions rows past attempt cap`);
  alerts.push({ error: "file_deletions has dead-lettered rows past the attempt cap" });
}
```

and the equivalent for the legacy queue table with `.gte("attempts", 6)`. Confirm how `cron-health-cron`'s `alreadyReported` derives its dedup key (`cron-health-cron/index.ts:29-42`); if it dedups on the first line of the error, the stable text above collapses; if it doesn't, keep the alert anyway (weekly noise beats silent data loss) and say so in the code comment.

- [ ] **Step 2: Verify** `npm run check:functions`; run the cleanup cron test file if it exists.
- [ ] **Step 3: Commit**

```bash
git add supabase/functions/post-media-cleanup-cron/
git commit -m "feat(cleanup): alert on dead-lettered deletion rows instead of silent permanent exclusion"
```

- [ ] **Step 4: PR for Part 2**

Full pre-push gate, push, open PR `fix(media): stream file-zip and checkpoint the trash purge`. Body must include the deploy order note: `_shared/r2.ts` changed, so ALL importers listed in Global Constraints need redeploy (functions deploy before/independently of frontend; no migrations involved), `file-zip` and `post-media-cleanup-cron` with `--no-verify-jwt`, all via `--use-api`. End with the attribution line.

---

## Self-Review (performed at plan-writing time)

- **Spec coverage:** Q1.1 seven sites → Tasks 2-7 (mrr ×2 counts as one site file; radar; leg C; analytics queue; express; both refresh crons). Q1.2 → Tasks 8-9 (streaming, store, NULL-size defense, budgets, manifest, abort semantics, stall guard, tree pagination). Q1.3 → Tasks 10-11 (checkpoint, cursor-only-after-success, deadline vs watchdog, invalid-token reset, cap raise, 30-day retention preserved via unchanged `olderThanDays=30`, dead-letter alert). Gap deliberately excluded: Q1.4 (Crisp backoff) and Q1.5 (Graph classifier) are not in the user's "1, 2, and 3" ask.
- **Placeholder scan:** Tasks 2/3/5/6 test steps direct the executor to build on named existing fakes rather than inlining full fake code — the fakes are file-specific and already exist; the assertions and fixture sizes are specified exactly. No TBDs.
- **Type consistency:** `fetchAllRows`/`chunk` signatures identical across Tasks 1-9; `FileZipDeps`/`ZipPlanEntry`/`buildZipStream` identical across Tasks 8-9; `PurgeTrashOpts`/`PurgeTrashResult` used only in Task 10; `readCheckpoint`/`writeCheckpoint` reuse the exact closures at `post-media-cleanup-cron/index.ts:143-162`.
