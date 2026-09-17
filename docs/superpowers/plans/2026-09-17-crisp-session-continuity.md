# Crisp Session Continuity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind the CRM's Crisp support widget to a backend-issued, per-user random token (`window.CRISP_TOKEN_ID`) so the same support conversation follows an agency user across browsers, devices and cookie clears.

**Architecture:** A new service-role-only table `crisp_sessions` mints one `uuid` token per user. The existing `crisp-identity` edge function (which already verifies the caller's JWT and HMAC-signs their email) additionally get-or-creates that row and returns `{ signature, crispToken? }`, with `crispToken` best-effort. `AuthContext.tsx`'s already-`userId`-gated Crisp-identify effect reconciles the returned token against a `{ userId, token }` pair cached in `localStorage`: on a mismatch it sets `window.CRISP_TOKEN_ID`, pushes `session:reset`, re-establishes `user:email` and `user:nickname` on the fresh session, and writes the cache; on a match it does nothing; when the token is absent it does nothing continuity-related. Sign-out and user-change null `CRISP_TOKEN_ID` and clear the cache. `index.html` is not touched.

**Tech Stack:** Postgres (migration + psql entitlement suite), Deno edge function (`supabase/functions/crisp-identity`), React 19 context (`apps/crm/src/context/AuthContext.tsx`), Vitest + Testing Library (jsdom), `deno test`.

## Global Constraints

Spec of record: `docs/superpowers/specs/2026-09-17-crisp-session-continuity-design.md`. Every task below implicitly includes this section.

- **Scope:** `apps/crm` only. Admin and Hub load no Crisp integration at all and stay that way.
- **`index.html` is unchanged.** `CRISP_TOKEN_ID` is only ever set from inside `AuthContext.tsx`'s Crisp-identify effect, which hard-gates on `if (!userId) return`. Never from a synchronous, pre-authentication guess.
- **Token storage** is the new table `crisp_sessions`, touched only by `crisp-identity`'s service-role client. Not a `profiles` column (any teammate can read a colleague's `profiles` row; the token is a bearer credential to a Verified conversation).
- **Migration DDL (verbatim from the spec):**
  ```sql
  CREATE TABLE IF NOT EXISTS crisp_sessions (
    user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    token      uuid NOT NULL DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE crisp_sessions ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON crisp_sessions FROM anon, authenticated;
  GRANT ALL ON crisp_sessions TO service_role;
  DROP POLICY IF EXISTS crisp_sessions_service_role ON crisp_sessions;
  CREATE POLICY crisp_sessions_service_role ON crisp_sessions
    FOR ALL TO service_role USING (true) WITH CHECK (true);
  ```
- **Migration filename:** `supabase/migrations/20260923000010_crisp_sessions.sql`. `origin/main`'s tail at plan time is `20260923000009_instagram_carousel_children.sql`. Re-check with `git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3` immediately before `gh pr create` and renumber above the tail if it moved (`migration-version-guard` fails CI on a duplicate prefix; a duplicate is silently skipped by Supabase's `schema_migrations`).
- **Entitlement suite number:** `96`. `supabase/tests/entitlements/` currently tops out at `95_post_content_versions_coalescing.sql` (the spec's "runs up to 95" is accurate).
- **The upsert** must be `.upsert({ user_id }, { onConflict: 'user_id' })` with `ignoreDuplicates` left at its default (`false`), never `true` (`true` compiles to `ON CONFLICT DO NOTHING`, which returns no row on the conflicting call).
- **`crisp-identity` response:** `{ signature, crispToken? }`. `crispToken` is best-effort and simply absent on any failure (network, timeout, the upsert itself). Identity verification must never become collateral damage of the new table.
- **Reconciliation placement:** entirely inside the identify effect, AFTER the existing `if (!active || crispResetGeneration.current !== initialCrispResetGeneration) return;` guard.
- **Three branches, verbatim:** token absent: do nothing continuity-related (not a mismatch, not a clear; "fail closed" was explicitly rejected). Token matches the cached `{ userId, token }` for this exact user: no-op. Otherwise: live rebind, in this order: (a) `window.CRISP_TOKEN_ID = crispToken`, (b) `$crisp.push(['do','session:reset'])`, (c) re-push `user:email` (with the signature) and, if `profile?.nome` is already known, `user:nickname`, in that order, (d) write `{ userId, token: crispToken }` to the cache.
- **Sign-out:** `window.CRISP_TOKEN_ID = null` and the cache clear execute synchronously immediately after `crispResetGeneration.current += 1`, BEFORE `await supabaseSignOut()`. The `session:reset` push stays after the await. The `userChanged` branch of `onAuthStateChange` clears immediately before its own `session:reset` push (it has no `await`).
- **`crispResetGeneration` is NOT bumped by the rebind's `session:reset`.** Its comment must name the rebind as a third push site and say why it is excluded.
- Every `window.$crisp?.push(...)` and every `localStorage` access is individually wrapped in `try/catch`. A support-tooling failure must never break auth.
- `CRISP_TOKEN_ID?: string | null` is added to exactly ONE existing `declare global { interface Window { ... } }` block (this plan uses `TopBarActions.tsx`). `MobileNav.tsx` and `AuthContext.tsx` get no declaration.
- Tests assert `window.CRISP_TOKEN_ID` by reading the property directly; a spy on `$crisp.push` can never observe it.
- `apps/crm/src/lib/__mocks__/supabase.ts` gets no shape change; tests queue `{ data: { signature, crispToken } }` (or omit `crispToken`) through the existing `__queueFunctionsInvokeResponse`.
- `supabase/functions/__tests__/crisp-identity_test.ts` never imports `index.ts` (it throws at module load without `CRISP_IDENTITY_SECRET`). The upsert lives in its own injectable module, `crisp-identity/session.ts`, mirroring `sign.ts`.
- **Deployment order:** migration, then `crisp-identity` (`--no-verify-jwt --use-api`, plus `--project-ref` from this unlinked worktree), then the frontend. Merging to `main` deploys the frontend immediately, so the prod migration and function deploy happen BEFORE the merge.
- **Pre-push gates** (all CI-enforced): `npm run lint`, `npm run format:check` (`npm run format` auto-fixes), `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`, `npm run test`, `npm run check:functions`, `npm run test:functions`. After any `deno` run: `git checkout -- deno.lock`, and if `ls node_modules/.deno` shows anything, `rm -rf node_modules/.deno && npm ci` before trusting Vitest/tsc again.
- Comments explain WHY, never WHAT. No user-facing copy is introduced by this feature.
- Run everything from this worktree: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/crisp-session-continuity-5f7915` on branch `claude/crisp-session-continuity-5f7915`. Confirm with `pwd` and `git branch --show-current` before the first edit. Never touch `/Users/eduardosouza/Projects/sm-crm` (the base checkout).
- Before Task 1: `git fetch origin && git merge --no-edit origin/main`. The branch is one commit behind (#540, tests and UI only, no migrations), so this is a clean merge.
- Commit messages end with the line `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20260923000010_crisp_sessions.sql` (create) | The table, RLS, named-role grants, service-role policy |
| `supabase/tests/entitlements/96_crisp_sessions.sql` (create) | Real `service_role` get-or-create positive + `authenticated`/`anon` negatives |
| `supabase/functions/crisp-identity/session.ts` (create) | Pure, injectable `getOrCreateCrispToken(db, userId)` |
| `supabase/functions/__tests__/crisp-identity_test.ts` (modify) | Fake-db tests for `session.ts` |
| `supabase/functions/crisp-identity/index.ts` (modify) | Bounded fetch, call the upsert, return `crispToken` when present |
| `apps/crm/src/components/layout/TopBarActions.tsx:6-10` (modify) | `Window.CRISP_TOKEN_ID` declaration |
| `apps/crm/src/lib/crispSession.ts` (create) | try/catch-wrapped `localStorage` cache helpers |
| `apps/crm/src/lib/__tests__/crispSession.test.ts` (create) | Cache helper unit tests |
| `apps/crm/src/context/AuthContext.tsx` (modify) | Reconciliation in the identify effect, teardown in `signOut` and `userChanged`, ref comment |
| `apps/crm/src/context/__tests__/AuthContext.test.tsx` (modify) | New cases in the existing `AuthProvider Crisp identification` block |

---

### Task 1: `crisp_sessions` migration and entitlement suite

**Files:**
- Create: `supabase/migrations/20260923000010_crisp_sessions.sql`
- Create: `supabase/tests/entitlements/96_crisp_sessions.sql`
- Reference: `supabase/migrations/20260908000001_admin_mcp_oauth_grants.sql` (shape to follow), `supabase/tests/entitlements/_helpers.sql` (`et_grant_hosted_parity(p_exclude)`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: table `public.crisp_sessions (user_id uuid PK -> auth.users, token uuid default gen_random_uuid(), created_at timestamptz)`, readable/writable by `service_role` only. Task 2's upsert targets it with `onConflict: 'user_id'` and selects `token`.

- [ ] **Step 1: Write the failing entitlement suite**

Create `supabase/tests/entitlements/96_crisp_sessions.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- crisp_sessions (migration 20260923000010): the per-user Crisp Session
-- Continuity token behind window.CRISP_TOKEN_ID. Only crisp-identity's
-- service-role client ever touches it.
--
-- Unlike 78_admin_mcp_oauth_grants (which inserts its fixture as the table
-- owner and so never exercises a service_role positive), this suite runs the
-- real get-or-create AS service_role -- the exact statement PostgREST
-- compiles `.upsert({ user_id }, { onConflict: 'user_id' })` to -- and
-- asserts the token is stable across calls.
--
-- crisp_sessions is EXCLUDED from et_grant_hosted_parity(): the helper
-- re-grants ALL on every public table to anon/authenticated, which would
-- silently undo the very REVOKE this suite asserts (see the helper's own
-- p_exclude comment).

begin;
select et_grant_hosted_parity(array['crisp_sessions']);
do $$
declare
  v_ua       uuid := gen_random_uuid();
  v_t1       uuid;
  v_t2       uuid;
  v_n        int  := -1;
  v_rejected boolean;
begin
  -- Fixture as the table owner, BEFORE any role switch: auth.users is not
  -- writable by the app roles.
  insert into auth.users (id) values (v_ua);

  -- service_role positive: get-or-create twice returns ONE stable token.
  execute 'set local role service_role';
  insert into crisp_sessions (user_id) values (v_ua)
    on conflict (user_id) do update set user_id = excluded.user_id
    returning token into v_t1;
  insert into crisp_sessions (user_id) values (v_ua)
    on conflict (user_id) do update set user_id = excluded.user_id
    returning token into v_t2;
  assert v_t1 is not null, 'service_role get-or-create returned no token';
  assert v_t1 = v_t2,
    format('second get-or-create minted a new token (%s vs %s)', v_t1, v_t2);
  select count(*) into v_n from crisp_sessions where user_id = v_ua;
  assert v_n = 1, format('expected exactly one crisp_sessions row, got %s', v_n);
  execute 'reset role';

  -- authenticated (the row's OWN user): table privilege denied outright.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    select count(*) into v_n from crisp_sessions;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated read crisp_sessions';

  v_rejected := false;
  begin
    insert into crisp_sessions (user_id) values (v_ua)
      on conflict (user_id) do update set user_id = excluded.user_id;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated wrote crisp_sessions';

  v_rejected := false;
  begin
    update crisp_sessions set token = gen_random_uuid() where user_id = v_ua;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated rotated a crisp_sessions token';

  execute 'reset role';

  -- anon: table privilege denied outright.
  execute 'set local role anon';
  v_rejected := false;
  begin
    select count(*) into v_n from crisp_sessions;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'anon read crisp_sessions';
  execute 'reset role';
end $$;
rollback;
```

- [ ] **Step 2: Run the suite to verify it fails**

The suite needs a local Supabase database (colima + Docker). From the worktree root:

```bash
colima status >/dev/null 2>&1 || colima start
npx supabase start -x studio,imgproxy,edge-runtime,realtime,storage-api,logflare,vector,supavisor,mailpit,postgres-meta
npx supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/96_crisp_sessions.sql
```

Expected: FAIL with `ERROR:  relation "crisp_sessions" does not exist` (psql exits non-zero).

If Docker/colima is unavailable on this machine, the CI job `entitlement-tests` runs `supabase start` + `bash scripts/test-entitlements.sh` on every push and is the gate of record; in that case skip the local run here and in Step 4, and confirm the job is green on the PR before merging (Task 7).

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260923000010_crisp_sessions.sql`:

```sql
-- crisp_sessions (spec docs/superpowers/specs/2026-09-17-crisp-session-continuity-design.md).
-- Per-user random token for Crisp Session Continuity (window.CRISP_TOKEN_ID): the same
-- support conversation follows a CRM user across browsers, devices and cookie clears.
-- One row per user who has ever loaded the CRM post-login, minted by gen_random_uuid()
-- and handed out by crisp-identity's get-or-create upsert.
--
-- NOT a profiles column: production's live policy "Users can view own workspace profiles"
-- lets any teammate read a colleague's full profiles row, and this token is a bearer
-- credential to a conversation that already carries its owner's Verified identity.
CREATE TABLE IF NOT EXISTS crisp_sessions (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token      uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crisp_sessions ENABLE ROW LEVEL SECURITY;

-- No policy for authenticated/anon: only crisp-identity's service-role client ever
-- touches this table. Hosted Supabase grants anon/authenticated/service_role
-- EXPLICITLY on every new table via pg_default_acl -- not via the implicit PUBLIC
-- pseudo-role -- so REVOKE ... FROM PUBLIC alone would leave anon/authenticated
-- fully able to read/write this table. Name the roles explicitly instead.
REVOKE ALL ON crisp_sessions FROM anon, authenticated;
GRANT ALL ON crisp_sessions TO service_role;

DROP POLICY IF EXISTS crisp_sessions_service_role ON crisp_sessions;
CREATE POLICY crisp_sessions_service_role ON crisp_sessions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

- [ ] **Step 4: Re-apply migrations and run the suite to verify it passes**

```bash
npx supabase db reset
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/96_crisp_sessions.sql
```

Expected: `BEGIN`, `et_grant_hosted_parity`, `DO`, `ROLLBACK` with no `ERROR` lines and exit code 0. Then run the whole set once to make sure the new file did not disturb its neighbours:

```bash
bash scripts/test-entitlements.sh
```

Expected: `PASS supabase/tests/entitlements/96_crisp_sessions.sql` in the list and `failures=0` at the bottom.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260923000010_crisp_sessions.sql supabase/tests/entitlements/96_crisp_sessions.sql
git commit -m "feat(crisp): add crisp_sessions table for Session Continuity tokens

Service-role-only table, one gen_random_uuid() token per user. Entitlement
suite 96 exercises a real service_role get-or-create (stable token across
two upserts) and denies authenticated/anon at the table-privilege level.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `session.ts`: pure, injectable get-or-create

**Files:**
- Create: `supabase/functions/crisp-identity/session.ts`
- Modify: `supabase/functions/__tests__/crisp-identity_test.ts` (append after line 24)
- Reference: `supabase/functions/crisp-identity/sign.ts` (the pure-function pattern), `supabase/functions/_shared/instagram-publish-utils.ts:57` (`type DbClient = { from: (table: string) => any }` precedent)

**Interfaces:**
- Consumes: table `crisp_sessions` from Task 1.
- Produces: `export type CrispSessionDb = { from: (table: string) => any }` and `export async function getOrCreateCrispToken(db: CrispSessionDb, userId: string): Promise<string | null>`. Task 3 calls it with the real service-role client and omits `crispToken` from the response when it returns `null`.

- [ ] **Step 1: Write the failing tests**

Append to `supabase/functions/__tests__/crisp-identity_test.ts` (after the existing `signEmail` tests; add the import next to the existing `signEmail` import at line 7):

```ts
import { getOrCreateCrispToken } from "../crisp-identity/session.ts";

type UpsertCall = { table: string; values: unknown; options: unknown; columns: string };

/**
 * Fake of the ONE chain session.ts is allowed to use:
 *   from(table).upsert(values, options).select(columns).single()
 * Records every call so tests can assert the exact PostgREST shape, and
 * resolves `.single()` with whatever `result` the test provides (or rejects
 * with `throwWith`, standing in for a network/AbortSignal failure).
 */
function makeFakeDb(
  result: { data: unknown; error: { message: string } | null },
  throwWith?: Error,
) {
  const calls: UpsertCall[] = [];
  const db = {
    from: (table: string) => ({
      upsert: (values: unknown, options: unknown) => ({
        select: (columns: string) => ({
          single: () => {
            calls.push({ table, values, options, columns });
            if (throwWith) return Promise.reject(throwWith);
            return Promise.resolve(result);
          },
        }),
      }),
    }),
  };
  return { db, calls };
}

Deno.test("getOrCreateCrispToken returns the row's token via a user_id-keyed upsert", async () => {
  const { db, calls } = makeFakeDb({
    data: { token: "11111111-2222-4333-8444-555555555555" },
    error: null,
  });
  const token = await getOrCreateCrispToken(db, "user-1");
  assertEquals(token, "11111111-2222-4333-8444-555555555555");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].table, "crisp_sessions");
  assertEquals(calls[0].values, { user_id: "user-1" });
  assertEquals(calls[0].columns, "token");
});

Deno.test("getOrCreateCrispToken upserts on user_id and never sets ignoreDuplicates", async () => {
  // ignoreDuplicates: true compiles to ON CONFLICT DO NOTHING, which returns
  // no row on the conflicting call -- a second call for the same user would
  // then get null instead of the existing token. The option must stay at its
  // default (absent or false).
  const { db, calls } = makeFakeDb({ data: { token: "t" }, error: null });
  await getOrCreateCrispToken(db, "user-1");
  const options = calls[0].options as Record<string, unknown>;
  assertEquals(options.onConflict, "user_id");
  assert(
    !("ignoreDuplicates" in options) || options.ignoreDuplicates === false,
    "ignoreDuplicates must not be true",
  );
});

Deno.test("getOrCreateCrispToken returns null on a PostgREST error", async () => {
  const { db } = makeFakeDb({ data: null, error: { message: "relation does not exist" } });
  assertEquals(await getOrCreateCrispToken(db, "user-1"), null);
});

Deno.test("getOrCreateCrispToken returns null when the chain throws", async () => {
  const { db } = makeFakeDb({ data: null, error: null }, new Error("aborted"));
  assertEquals(await getOrCreateCrispToken(db, "user-1"), null);
});

Deno.test("getOrCreateCrispToken returns null when the row carries no string token", async () => {
  const { db: noRow } = makeFakeDb({ data: null, error: null });
  assertEquals(await getOrCreateCrispToken(noRow, "user-1"), null);
  const { db: emptyToken } = makeFakeDb({ data: { token: "" }, error: null });
  assertEquals(await getOrCreateCrispToken(emptyToken, "user-1"), null);
  const { db: wrongType } = makeFakeDb({ data: { token: 42 }, error: null });
  assertEquals(await getOrCreateCrispToken(wrongType, "user-1"), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:functions -- --filter getOrCreateCrispToken
```

Expected: the run errors while loading `supabase/functions/__tests__/crisp-identity_test.ts` with `Module not found "file:///.../supabase/functions/crisp-identity/session.ts"`.

- [ ] **Step 3: Write `session.ts`**

Create `supabase/functions/crisp-identity/session.ts`:

```ts
/**
 * Get-or-create the caller's Crisp Session Continuity token.
 *
 * Pure and dependency-injected, like sign.ts: crisp-identity_test.ts never
 * imports index.ts (it throws at module load without CRISP_IDENTITY_SECRET,
 * which the edge-function-tests CI job does not set), so the upsert has to be
 * testable through a fake `db` rather than through the handler.
 *
 * `db` is the same loose structural shape _shared/instagram-publish-utils.ts
 * and _shared/tiktok-publish-utils.ts use for an injected client. A narrower
 * structural type is a known deno-check trap: passing a real SupabaseClient
 * to it can fail with TS2589 (excessively deep instantiation).
 */
// deno-lint-ignore no-explicit-any
export type CrispSessionDb = { from: (table: string) => any };

/**
 * Returns the user's stable token, or null on ANY failure. Best-effort by
 * design: identity verification (the signature) is the more established of
 * crisp-identity's two jobs and must never become collateral damage of this
 * table -- the caller simply omits `crispToken` from the response on null.
 *
 * `.upsert({ user_id }, { onConflict: 'user_id' })` with `ignoreDuplicates`
 * left at its default (false) compiles to
 *   INSERT ... ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
 *   RETURNING token
 * which returns the EXISTING row's token on the conflicting call. Do NOT set
 * `ignoreDuplicates: true`: that is ON CONFLICT DO NOTHING, which returns no
 * row on conflict and would break "a second call returns the same token".
 */
export async function getOrCreateCrispToken(
  db: CrispSessionDb,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await db
      .from("crisp_sessions")
      .upsert({ user_id: userId }, { onConflict: "user_id" })
      .select("token")
      .single();
    if (error) {
      console.error("[crisp-identity] crisp_sessions upsert failed", error.message ?? error);
      return null;
    }
    const token = (data as { token?: unknown } | null)?.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch (err) {
    console.error("[crisp-identity] crisp_sessions upsert threw", err);
    return null;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm run test:functions -- --filter getOrCreateCrispToken
npm run test:functions -- --filter signEmail
git checkout -- deno.lock
```

Expected: 5 `getOrCreateCrispToken` tests `ok`, 2 `signEmail` tests still `ok`. The `console.error` lines from the failure-path tests are expected output, not failures.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/crisp-identity/session.ts supabase/functions/__tests__/crisp-identity_test.ts
git commit -m "feat(crisp-identity): add injectable getOrCreateCrispToken

Same pure-function shape as sign.ts so the test file can keep never
importing index.ts. Best-effort: null on any error, never throws.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire the upsert into `crisp-identity/index.ts` with a bounded fetch

**Files:**
- Modify: `supabase/functions/crisp-identity/index.ts` (whole file, 49 lines)
- Reference: `supabase/functions/crisp-sync-cron/index.ts:46-59` (bounded global fetch precedent)

**Interfaces:**
- Consumes: `getOrCreateCrispToken(db, userId)` from Task 2.
- Produces: HTTP response body `{ signature: string, crispToken?: string }`. Task 5's effect reads `data.crispToken` and treats a missing or non-string value as "absent".

There is no unit test for `index.ts` by design (module-load throw without `CRISP_IDENTITY_SECRET`). Its verification is `npm run check:functions` here and the two-call staging smoke in Task 7.

- [ ] **Step 1: Replace `index.ts`**

Write `supabase/functions/crisp-identity/index.ts` as:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import { signEmail } from "./sign.ts";
import { getOrCreateCrispToken } from "./session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRISP_IDENTITY_SECRET = Deno.env.get("CRISP_IDENTITY_SECRET") ??
  (() => {
    throw new Error("CRISP_IDENTITY_SECRET is required");
  })();

// Per-request bound on every call the client below makes (getUser and the
// crisp_sessions upsert). The CRM gives the whole invoke 5s
// (AuthContext.tsx, `timeout: 5000`) and falls back to an UNSIGNED push when
// that fires, so a stalled PostgREST call on the new, best-effort upsert would
// cost the user the signature too -- exactly what best-effort is meant to
// rule out. Two sequential calls at 2s each stay inside the client's 5s.
// Same shape as crisp-sync-cron's bounded global fetch.
const REQUEST_TIMEOUT_MS = 2_000;

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Unauthorized" }, 401);

    // Service-role client + getUser(token). NOT an anon client: this project's
    // tokens are ES256 and an anon client cannot verify them.
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
              : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }),
      },
    });
    const { data, error } = await svc.auth.getUser(token);
    // email_confirmed_at is required, not just a present email: GoTrue can
    // resolve a session for an account that registered but never confirmed
    // its address (depends on a dashboard setting this repo can't see or
    // control). Without this check, an attacker could register
    // victim@company.com, get a session pre-confirmation, and receive a
    // genuine signature for an email nobody proved they own -- the exact
    // failure this endpoint exists to prevent. Matches the candidate rule
    // crisp-sync-cron already enforces (email_confirmed_at is not null).
    if (error || !data.user?.email || !data.user.email_confirmed_at) {
      return json({ error: "Unauthorized" }, 401);
    }

    // THE EMAIL COMES FROM THE VERIFIED TOKEN, NEVER FROM THE REQUEST BODY.
    // Signing a caller-supplied address would turn this endpoint into an oracle
    // that mints a valid "verified" badge for any customer on demand -- strictly
    // worse than having no identity verification at all, because the badge would
    // then be actively misleading.
    const signature = await signEmail(data.user.email, CRISP_IDENTITY_SECRET);

    // Session Continuity token, best-effort: null on any failure, in which
    // case the response simply omits crispToken and the CRM leaves whatever
    // binding it already has untouched (spec, Data flow step 3, "absent").
    // Same JWT trust boundary as the signature: user id from the verified
    // token, never from the request.
    const crispToken = await getOrCreateCrispToken(svc, data.user.id);
    return json(crispToken ? { signature, crispToken } : { signature });
  } catch (err) {
    return internalServerError(json, "crisp-identity", err);
  }
});
```

- [ ] **Step 2: Type-check and run the function suite**

```bash
npm run check:functions
npm run test:functions -- --filter crisp
git checkout -- deno.lock
ls node_modules/.deno 2>/dev/null && (rm -rf node_modules/.deno && npm ci) || true
```

Expected: `check:functions` exits 0 with no errors mentioning `crisp-identity`; the `crisp` filter runs the `crisp-identity` and `crisp-sync-cron` tests, all `ok`. `supabase/config.toml` already carries `[functions.crisp-identity] verify_jwt = false` (line 195), so `config-audit_test.ts` needs no change.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/crisp-identity/index.ts
git commit -m "feat(crisp-identity): return a best-effort crispToken alongside the signature

Get-or-create the caller's crisp_sessions row after signing. Every call the
service-role client makes is now bounded at 2s so a stalled upsert can never
push the response past the CRM's 5s invoke timeout and cost the signature.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `Window.CRISP_TOKEN_ID` declaration and the `localStorage` cache module

**Files:**
- Modify: `apps/crm/src/components/layout/TopBarActions.tsx:6-10`
- Create: `apps/crm/src/lib/crispSession.ts`
- Create: `apps/crm/src/lib/__tests__/crispSession.test.ts`
- Reference: `apps/crm/src/components/guide/guideStorage.ts:31-58` (the repo's try/catch-wrapped `localStorage` convention)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces (used by Tasks 5 and 6):
  - `window.CRISP_TOKEN_ID?: string | null` (ambient, via global augmentation)
  - `export const CRISP_SESSION_STORAGE_KEY = 'crisp_session_v1'`
  - `export interface CrispSessionCache { userId: string; token: string }`
  - `export function readCrispSessionCache(): CrispSessionCache | null`
  - `export function writeCrispSessionCache(userId: string, token: string): void`
  - `export function clearCrispSessionCache(): void`

- [ ] **Step 1: Write the failing cache tests**

Create `apps/crm/src/lib/__tests__/crispSession.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CRISP_SESSION_STORAGE_KEY,
  clearCrispSessionCache,
  readCrispSessionCache,
  writeCrispSessionCache,
} from '../crispSession';

describe('crispSession cache', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('round-trips a { userId, token } pair under a single versioned key', () => {
    writeCrispSessionCache('user-1', 'tok-1');
    expect(readCrispSessionCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
    expect(JSON.parse(localStorage.getItem(CRISP_SESSION_STORAGE_KEY) ?? 'null')).toEqual({
      userId: 'user-1',
      token: 'tok-1',
    });
  });

  it('reads null when nothing is cached', () => {
    expect(readCrispSessionCache()).toBeNull();
  });

  it('reads null for malformed or incomplete entries instead of throwing', () => {
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, '{not json');
    expect(readCrispSessionCache()).toBeNull();
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId: 'user-1' }));
    expect(readCrispSessionCache()).toBeNull();
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId: '', token: 'tok-1' }));
    expect(readCrispSessionCache()).toBeNull();
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId: 'user-1', token: 7 }));
    expect(readCrispSessionCache()).toBeNull();
  });

  it('clear removes the entry', () => {
    writeCrispSessionCache('user-1', 'tok-1');
    clearCrispSessionCache();
    expect(localStorage.getItem(CRISP_SESSION_STORAGE_KEY)).toBeNull();
    expect(readCrispSessionCache()).toBeNull();
  });

  it('never throws when storage is unavailable', () => {
    // Safari private mode / blocked storage: every Storage call throws.
    // vi.restoreAllMocks() in test/vitest.setup.ts undoes these spies.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => writeCrispSessionCache('user-1', 'tok-1')).not.toThrow();
    expect(readCrispSessionCache()).toBeNull();
    expect(() => clearCrispSessionCache()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run apps/crm/src/lib/__tests__/crispSession.test.ts
```

Expected: FAIL with `Failed to resolve import "../crispSession"`.

- [ ] **Step 3: Write the cache module**

Create `apps/crm/src/lib/crispSession.ts`:

```ts
/**
 * localStorage cache behind Crisp Session Continuity
 * (docs/superpowers/specs/2026-09-17-crisp-session-continuity-design.md).
 *
 * Holds the `{ userId, token }` pair the widget was LAST bound to in this
 * browser, so AuthContext's Crisp-identify effect can tell "Crisp already has
 * it right, do nothing" from "rebind now" without resetting the session on
 * every load. It is a reconciliation hint, never a credential source:
 * nothing reads it before authentication (index.html is deliberately
 * untouched), and `window.CRISP_TOKEN_ID` is only ever set from a
 * server-confirmed token.
 *
 * Every access is wrapped: private browsing, blocked storage or a full quota
 * must never break auth (same discipline as every `$crisp.push` in
 * AuthContext.tsx).
 */
export const CRISP_SESSION_STORAGE_KEY = 'crisp_session_v1';

export interface CrispSessionCache {
  userId: string;
  token: string;
}

export function readCrispSessionCache(): CrispSessionCache | null {
  try {
    const raw = localStorage.getItem(CRISP_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CrispSessionCache> | null;
    if (
      !parsed ||
      typeof parsed.userId !== 'string' ||
      !parsed.userId ||
      typeof parsed.token !== 'string' ||
      !parsed.token
    ) {
      return null;
    }
    return { userId: parsed.userId, token: parsed.token };
  } catch {
    return null;
  }
}

export function writeCrispSessionCache(userId: string, token: string): void {
  try {
    localStorage.setItem(CRISP_SESSION_STORAGE_KEY, JSON.stringify({ userId, token }));
  } catch {
    // Best effort: a failed write only means the next load rebinds again.
  }
}

export function clearCrispSessionCache(): void {
  try {
    localStorage.removeItem(CRISP_SESSION_STORAGE_KEY);
  } catch {
    // Best effort: see writeCrispSessionCache.
  }
}
```

- [ ] **Step 4: Declare `CRISP_TOKEN_ID` on `Window`**

In `apps/crm/src/components/layout/TopBarActions.tsx`, replace lines 6-10:

```ts
declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
  }
}
```

with:

```ts
declare global {
  interface Window {
    $crisp?: Array<unknown[]>;
    /**
     * Crisp Session Continuity token, read by the widget on `session:reset`.
     * Only ever written by AuthContext.tsx: set on an authenticated rebind,
     * nulled on sign-out and user change. Declared here once; a TS global
     * augmentation merges across the compilation, so MobileNav.tsx's own
     * `$crisp` block deliberately does not repeat it.
     */
    CRISP_TOKEN_ID?: string | null;
  }
}
```

- [ ] **Step 5: Run the tests and the CRM typecheck to verify they pass**

```bash
npx vitest run apps/crm/src/lib/__tests__/crispSession.test.ts
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run format:check
```

Expected: 5 tests pass; `tsc` exits 0; `format:check` clean (if Prettier rewraps any of the new lines, run `npm run format` and re-run the test file before committing).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/lib/crispSession.ts apps/crm/src/lib/__tests__/crispSession.test.ts apps/crm/src/components/layout/TopBarActions.tsx
git commit -m "feat(crm): Crisp session cache helpers and Window.CRISP_TOKEN_ID type

try/catch-wrapped localStorage helpers for the { userId, token } pair the
identify effect reconciles against, plus the ambient CRISP_TOKEN_ID
declaration on the one existing Window augmentation.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Reconciliation in the Crisp-identify effect

**Files:**
- Modify: `apps/crm/src/context/AuthContext.tsx` (imports after line 29; new ref mirror before line 388; the identify effect at lines 428-473)
- Modify: `apps/crm/src/context/__tests__/AuthContext.test.tsx` (imports near line 47; the `AuthProvider Crisp identification` block's `beforeEach`/`afterEach` at lines 487-494; new cases appended before the block's closing `});` at line 741)

**Interfaces:**
- Consumes: `readCrispSessionCache`, `writeCrispSessionCache`, `CRISP_SESSION_STORAGE_KEY` (Task 4); `window.CRISP_TOKEN_ID` (Task 4); response shape `{ signature?, crispToken? }` (Task 3).
- Produces: the three reconciliation branches. Task 6 adds the teardown counterpart and relies on the same cache key and the effect's placement of every write after the `crispResetGeneration` guard.

- [ ] **Step 1: Extend the test block's setup and add helpers**

In `apps/crm/src/context/__tests__/AuthContext.test.tsx`, add the import right after line 47 (`import { AuthProvider, useAuth } from '../AuthContext';`):

```ts
import { CRISP_SESSION_STORAGE_KEY } from '../../lib/crispSession';
```

Then replace the block's `beforeEach`/`afterEach` (lines 487-494):

```ts
  beforeEach(() => {
    window.$crisp = [];
    crispPush = vi.spyOn(window.$crisp, 'push');
  });

  afterEach(() => {
    delete (window as { $crisp?: unknown }).$crisp;
  });
```

with:

```ts
  beforeEach(() => {
    window.$crisp = [];
    crispPush = vi.spyOn(window.$crisp, 'push');
    // Session Continuity state is per-browser (localStorage + a window
    // property), so it would leak between cases without this.
    localStorage.clear();
    delete (window as { CRISP_TOKEN_ID?: unknown }).CRISP_TOKEN_ID;
  });

  afterEach(() => {
    delete (window as { $crisp?: unknown }).$crisp;
    delete (window as { CRISP_TOKEN_ID?: unknown }).CRISP_TOKEN_ID;
    localStorage.clear();
  });

  // CRISP_TOKEN_ID is a plain window property assignment, not a $crisp.push,
  // so the push spy can never observe it: every continuity assertion reads
  // window.CRISP_TOKEN_ID and the cache directly.
  function readCache(): { userId: string; token: string } | null {
    const raw = localStorage.getItem(CRISP_SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { userId: string; token: string }) : null;
  }

  const OWNER_PROFILE = {
    id: 'user-1',
    nome: 'Eduardo Souza',
    role: 'owner',
    conta_id: 'conta-1',
  };
```

- [ ] **Step 2: Write the reconciliation tests**

Append the following inside the `describe('AuthProvider Crisp identification', ...)` block, immediately before its closing `});` (currently line 741):

```ts
  it('binds on first login: sets CRISP_TOKEN_ID, resets, re-pushes email then nickname, then caches', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);

    // Hold the invoke so profile hydration (and its nickname push on the OLD,
    // anonymous session) has settled before the token arrives. That makes the
    // post-reset push order deterministic instead of racing hydration.
    let resolveInvoke!: (value: { data: unknown; error?: unknown }) => void;
    mockedSupabase.__queueFunctionsInvokeResponse(
      new Promise((resolve) => {
        resolveInvoke = resolve;
      }),
    );

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:nickname', ['Eduardo Souza']]);
    });
    // Nothing continuity-related may happen before the server confirms a token.
    expect(window.CRISP_TOKEN_ID).toBeUndefined();
    expect(readCache()).toBeNull();
    crispPush.mockClear();

    await act(async () => {
      resolveInvoke({ data: { signature: 'abc', crispToken: 'tok-1' }, error: null });
    });

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:nickname', ['Eduardo Souza']]);
    });
    expect(window.CRISP_TOKEN_ID).toBe('tok-1');
    // Exact order after the token lands: reset the session so the widget
    // re-reads CRISP_TOKEN_ID, then re-establish BOTH traits on the fresh
    // session (a reset forgets them, and the separate nickname effect is
    // keyed on [userId, profile?.nome], which a rebind never changes).
    expect(crispPush.mock.calls.map((call) => call[0])).toEqual([
      ['do', 'session:reset'],
      ['set', 'user:email', ['eduardo@example.com', 'abc']],
      ['set', 'user:nickname', ['Eduardo Souza']],
    ]);
    expect(readCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
  });

  it('does nothing continuity-related when the token matches the cached pair for this user', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);
    localStorage.setItem(
      CRISP_SESSION_STORAGE_KEY,
      JSON.stringify({ userId: 'user-1', token: 'tok-1' }),
    );
    mockedSupabase.__queueFunctionsInvokeResponse({
      data: { signature: 'abc', crispToken: 'tok-1' },
      error: null,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com', 'abc']]);
    });
    // Crisp's own cookie already resumes the bound session across reloads
    // (verified against the production widget); a reset here would restart
    // the conversation on every load for nothing.
    expect(crispPush).not.toHaveBeenCalledWith(['do', 'session:reset']);
    expect(window.CRISP_TOKEN_ID).toBeUndefined();
    expect(readCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
  });

  it('rebinds when the cached pair belongs to a different user, even for an identical token', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);
    // A stale pair from whoever used this browser before: same token string
    // must NOT count as a match for a different userId.
    localStorage.setItem(
      CRISP_SESSION_STORAGE_KEY,
      JSON.stringify({ userId: 'user-0', token: 'tok-1' }),
    );
    mockedSupabase.__queueFunctionsInvokeResponse({
      data: { signature: 'abc', crispToken: 'tok-1' },
      error: null,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['do', 'session:reset']);
    });
    expect(window.CRISP_TOKEN_ID).toBe('tok-1');
    await waitFor(() => {
      expect(readCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
    });
  });

  it('leaves an existing binding untouched when crispToken is absent (a failure is not a mismatch)', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);
    // A binding established earlier in this browser's life.
    localStorage.setItem(
      CRISP_SESSION_STORAGE_KEY,
      JSON.stringify({ userId: 'user-1', token: 'tok-1' }),
    );
    window.CRISP_TOKEN_ID = 'tok-1';
    // The function signed the email but its upsert failed: no crispToken.
    mockedSupabase.__queueFunctionsInvokeResponse({ data: { signature: 'abc' }, error: null });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com', 'abc']]);
    });
    // "Fail closed" was explicitly rejected: a transient hiccup must not
    // regress an already-correct binding into a visible reset.
    expect(crispPush).not.toHaveBeenCalledWith(['do', 'session:reset']);
    expect(window.CRISP_TOKEN_ID).toBe('tok-1');
    expect(readCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
  });

  it('writes nothing when crispToken is absent and nothing was cached', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);
    mockedSupabase.__queueFunctionsInvokeResponse({ data: { signature: 'abc' }, error: null });

    renderWithAuth();

    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['eduardo@example.com', 'abc']]);
    });
    expect(crispPush).not.toHaveBeenCalledWith(['do', 'session:reset']);
    expect(window.CRISP_TOKEN_ID).toBeUndefined();
    expect(readCache()).toBeNull();
  });
```

- [ ] **Step 3: Run the file to verify the new cases fail as expected**

```bash
npx vitest run apps/crm/src/context/__tests__/AuthContext.test.tsx
```

Expected: `binds on first login` FAILS (the post-token `waitFor` for the nickname re-push times out, since nothing re-pushes after the invoke resolves yet) and `rebinds when the cached pair belongs to a different user` FAILS (the `waitFor` for `session:reset` times out). The other three new cases (`matches`, `absent with binding`, `absent with nothing cached`) already PASS: they pin the behaviours a naive "always rebind" or "fail closed" implementation would break, and must keep passing after Step 4. Every pre-existing case still passes.

- [ ] **Step 4: Implement the reconciliation**

In `apps/crm/src/context/AuthContext.tsx`:

(a) Add the import after line 29 (`import { clearPopupSession } from '../hooks/popupSession';`):

```ts
import { readCrispSessionCache, writeCrispSessionCache } from '../lib/crispSession';
```

(b) Insert this ref mirror immediately before the `// Crisp identification, split out from the profile-hydration effect above` comment (currently line 388):

```ts
  // Latest known display name, for the Session Continuity rebind inside the
  // identify effect below. That effect is keyed on [userId, user?.email] on
  // purpose (a name change must not re-invoke crisp-identity), so it cannot
  // read `profile?.nome` from its own closure without going stale: the
  // profile usually resolves AFTER the effect has started. A ref mirror gives
  // the rebind whatever name is known at push time, if any. Same
  // backstop-mirror pattern as canSeeFinancialsRef / membershipRef below.
  const profileNomeRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    profileNomeRef.current = profile?.nome;
  }, [profile?.nome]);

```

(c) Replace the identify effect (currently lines 428-473, from `useEffect(() => {` through `}, [userId, user?.email]);`) with:

```ts
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const initialCrispResetGeneration = crispResetGeneration.current;

    (async () => {
      if (!user?.email) return;
      let signature: string | undefined;
      let crispToken: string | undefined;
      try {
        // Explicit timeout: browser fetch has no default one, and
        // functions-js resolves rather than throws on genuine errors -- but
        // a HANG is neither. Without a bound, a stalled edge function would
        // suppress identification indefinitely (user:email never pushed at
        // all), which is worse than the unsigned fallback this catch block
        // exists for. This repo has been bitten before by unbounded I/O in
        // state-setting handlers (R2 presign) -- same fix here.
        const { data } = await supabase.functions.invoke('crisp-identity', { timeout: 5000 });
        const payload = data as { signature?: string; crispToken?: unknown } | null;
        signature = payload?.signature;
        // Absent whenever the function's best-effort upsert failed (or on
        // any transport failure). Treated below as "nothing to reconcile",
        // never as a signal to tear an existing binding down.
        crispToken =
          typeof payload?.crispToken === 'string' && payload.crispToken
            ? payload.crispToken
            : undefined;
      } catch {
        // Signing is best-effort. A failure means the session shows as
        // Unverified in the inbox, which is the pre-existing behaviour and is
        // strictly better than blocking support access entirely.
      }
      // Both checks matter: `active` closes the ordinary effect-re-run/
      // unmount race, `crispResetGeneration` closes the session:reset race
      // (see the comment above this effect) that `active` cannot, because it
      // is only cleared asynchronously by React's own cleanup.
      if (!active || crispResetGeneration.current !== initialCrispResetGeneration) return;

      // Session Continuity reconciliation. Placed AFTER the guard above on
      // purpose: a write before it could let a response for an already
      // signed-out identity bind the NEXT person on a shared machine to the
      // outgoing user's token, and that binding persists across reloads.
      //
      //   token absent  -> nothing continuity-related happens (not a
      //                    mismatch, not a clear); the identity push below
      //                    proceeds exactly as before.
      //   token matches the cached { userId, token } for THIS user
      //                 -> no-op: Crisp's own cookie already resumes the
      //                    bound session across reloads (verified against
      //                    the production widget).
      //   otherwise     -> live rebind: set CRISP_TOKEN_ID, reset so the
      //                    widget re-reads it, re-establish identity on the
      //                    fresh session below, then record the pair.
      //
      // The rebind's session:reset deliberately does NOT bump
      // crispResetGeneration; see that ref's declaration.
      let reboundTo: string | null = null;
      if (crispToken) {
        const cached = readCrispSessionCache();
        const matches =
          cached !== null && cached.userId === userId && cached.token === crispToken;
        if (!matches) {
          reboundTo = crispToken;
          window.CRISP_TOKEN_ID = crispToken;
          try {
            window.$crisp?.push(['do', 'session:reset']);
          } catch {
            // Never let a support-tooling nicety break auth.
          }
        }
      }

      try {
        // Second element is the identity signature. Crisp marks the session
        // Verified only when it validates; unsigned sessions still work.
        window.$crisp?.push(
          signature
            ? ['set', 'user:email', [user.email, signature]]
            : ['set', 'user:email', [user.email]],
        );
      } catch {
        // Never let a support-tooling nicety break auth.
      }

      if (reboundTo) {
        // A reset starts a fresh local session that has forgotten every trait
        // set on the prior one. user:email was just re-pushed above; the
        // nickname has to be re-established here too, because the separate
        // nickname effect is keyed on [userId, profile?.nome], which a rebind
        // alone never changes, so it would not re-fire on its own.
        const nome = profileNomeRef.current;
        if (nome) {
          try {
            window.$crisp?.push(['set', 'user:nickname', [nome]]);
          } catch {
            // Never let a support-tooling nicety break auth.
          }
        }
        writeCrispSessionCache(userId, reboundTo);
      }
    })();

    return () => {
      active = false;
    };
  }, [userId, user?.email]);
```

The long comment block that precedes the effect (lines 388-427, "Crisp identification, split out from the profile-hydration effect above...") stays exactly as it is; only the effect body changes.

- [ ] **Step 5: Run the file, the CRM typecheck and lint to verify everything passes**

```bash
npx vitest run apps/crm/src/context/__tests__/AuthContext.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
npm run format:check
```

Expected: every case in the file passes (the 5 new ones and all pre-existing ones); `tsc` exits 0; lint reports no new warnings for `AuthContext.tsx` (the `react-hooks/exhaustive-deps` rule is satisfied: the effect reads `profileNomeRef.current`, not `profile`); `format:check` clean (Prettier may collapse the `const matches = ...` expression onto one line; if it complains, run `npm run format` and re-run the test file before committing).

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/context/AuthContext.tsx apps/crm/src/context/__tests__/AuthContext.test.tsx
git commit -m "feat(crm): reconcile the Crisp session token inside the identify effect

Absent token: nothing continuity-related. Match against the cached
{ userId, token }: no-op (Crisp's own cookie resumes the session). Mismatch:
set CRISP_TOKEN_ID, session:reset, re-push email then nickname, cache the
pair. All writes sit after the crispResetGeneration guard.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Teardown on sign-out and user change, and the `crispResetGeneration` comment

**Files:**
- Modify: `apps/crm/src/context/AuthContext.tsx` (imports line from Task 5; the `crispResetGeneration` doc comment at lines 188-204; the `userChanged` branch at lines 264-278; `signOut` at lines 881-890)
- Modify: `apps/crm/src/context/__tests__/AuthContext.test.tsx` (two cases appended to the `AuthProvider Crisp identification` block)

**Interfaces:**
- Consumes: `clearCrispSessionCache` (Task 4); `window.CRISP_TOKEN_ID` (Task 4); `readCache()` and `OWNER_PROFILE` test helpers (Task 5).
- Produces: nothing new for later tasks; Task 7 verifies the sign-out behaviour in a real browser.

- [ ] **Step 1: Write the failing teardown tests**

Append inside the `describe('AuthProvider Crisp identification', ...)` block, after the cases added in Task 5:

```ts
  it('nulls CRISP_TOKEN_ID and clears the cache synchronously on sign-out, before supabaseSignOut() resolves', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);
    mockedSupabase.__queueFunctionsInvokeResponse({
      data: { signature: 'abc', crispToken: 'tok-1' },
      error: null,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(window.CRISP_TOKEN_ID).toBe('tok-1');
    });
    await waitFor(() => {
      expect(readCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
    });
    crispPush.mockClear();

    // Sync act() overload: runs only the synchronous prefix of signOut()
    // (everything before its first `await`) without draining microtasks --
    // the same technique the in-flight-signing race test above uses. The
    // mocked supabaseSignOut() has therefore NOT resolved yet at the
    // assertions below, which is what proves the clear happens before the
    // await rather than after it. If that await ever rejected or hung, a
    // clear placed after it would silently leave the next person on this
    // machine bound to this user's token across reloads.
    act(() => {
      screen.getByText('sair').click();
    });
    expect(window.CRISP_TOKEN_ID).toBeNull();
    expect(readCache()).toBeNull();
    // The reset push lives AFTER the await and must not have fired yet:
    // this is what shows the assertions above ran inside the pre-await window.
    expect(crispPush).not.toHaveBeenCalledWith(['do', 'session:reset']);

    await act(async () => {});
    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['do', 'session:reset']);
    });
  });

  it('drops the binding on an in-place user change (A -> B) before B is identified', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1', email: 'eduardo@example.com' });
    mockedSupabase.__setCurrentProfile(OWNER_PROFILE);
    mockedSupabase.__queueFunctionsInvokeResponse({
      data: { signature: 'abc', crispToken: 'tok-1' },
      error: null,
    });

    renderWithAuth();

    await waitFor(() => {
      expect(window.CRISP_TOKEN_ID).toBe('tok-1');
    });
    await waitFor(() => {
      expect(readCache()).toEqual({ userId: 'user-1', token: 'tok-1' });
    });
    crispPush.mockClear();

    // B's own crisp-identity call gets the mock's default { data: null }
    // (no token), so nothing may re-bind after the clear below.
    await act(async () => {
      mockedSupabase.__emitAuthChange('SIGNED_IN', {
        user: { id: 'user-2', email: 'bruna@example.com' },
      });
    });

    expect(window.CRISP_TOKEN_ID).toBeNull();
    expect(readCache()).toBeNull();
    expect(crispPush).toHaveBeenCalledWith(['do', 'session:reset']);
    // B is identified on the reset, anonymous session, never on A's binding.
    await waitFor(() => {
      expect(crispPush).toHaveBeenCalledWith(['set', 'user:email', ['bruna@example.com']]);
    });
  });
```

- [ ] **Step 2: Run the file to verify the two new cases fail**

```bash
npx vitest run apps/crm/src/context/__tests__/AuthContext.test.tsx
```

Expected: `nulls CRISP_TOKEN_ID ... on sign-out` FAILS at `expect(window.CRISP_TOKEN_ID).toBeNull()` (received `'tok-1'`); `drops the binding on an in-place user change` FAILS the same way. Everything else passes.

- [ ] **Step 3: Implement the teardown**

In `apps/crm/src/context/AuthContext.tsx`:

(a) Extend the Task 5 import line to:

```ts
import {
  clearCrispSessionCache,
  readCrispSessionCache,
  writeCrispSessionCache,
} from '../lib/crispSession';
```

(b) In the `userChanged` branch of `onAuthStateChange`, replace (currently lines 273-278):

```ts
        crispResetGeneration.current += 1;
        try {
          window.$crisp?.push(['do', 'session:reset']);
        } catch {
          // Never let a support-tooling nicety break auth.
        }
```

with:

```ts
        crispResetGeneration.current += 1;
        // Session Continuity: B must not inherit A's token binding either.
        // Immediately before the reset push is safe HERE (unlike signOut,
        // which has to clear before its await): this handler runs
        // synchronously start to finish.
        window.CRISP_TOKEN_ID = null;
        clearCrispSessionCache();
        try {
          window.$crisp?.push(['do', 'session:reset']);
        } catch {
          // Never let a support-tooling nicety break auth.
        }
```

(c) In `signOut`, replace (currently lines 888-890):

```ts
    crispResetGeneration.current += 1;
    profileRequestId.current += 1;
    await supabaseSignOut();
```

with:

```ts
    crispResetGeneration.current += 1;
    // Session Continuity teardown, synchronously and BEFORE the await below.
    // If `supabaseSignOut()` rejects or hangs, nothing after it ever runs, so
    // a clear placed next to the session:reset push would silently survive a
    // failed sign-out and the NEXT person on a shared machine would load
    // bound to this user's token, across reloads, not just one render.
    // Costs nothing to do early. The session:reset push itself stays after
    // the await, matching the best-effort placement of every other Crisp
    // push in this file.
    window.CRISP_TOKEN_ID = null;
    clearCrispSessionCache();
    profileRequestId.current += 1;
    await supabaseSignOut();
```

(d) Replace the first paragraph of the `crispResetGeneration` doc comment (currently lines 188-191):

```ts
  /**
   * Counts CRISP IDENTITY RESETS only — bumped at exactly the two places that
   * push `['do', 'session:reset']` (the user-change branch of
   * onAuthStateChange, and signOut) and nowhere else.
   *
```

with:

```ts
  /**
   * Counts CRISP IDENTITY RESETS only — bumped at exactly the two places that
   * push `['do', 'session:reset']` for an OUTGOING identity (the user-change
   * branch of onAuthStateChange, and signOut) and nowhere else.
   *
   * There is a THIRD session:reset push site, the Session Continuity rebind
   * inside the identify effect, and it deliberately does NOT bump this
   * counter. That reset is a same-identity self-correction (binding the
   * widget to the current user's own token), not an identity going away, so
   * there is no in-flight response for a stale identity to fence off. Bumping
   * it there would make the effect's own post-await guard reject the very
   * pushes the rebind is about to make. Do not "fix" it into bumping.
   *
```

The rest of that comment (from `* Deliberately NOT \`authGeneration\`...` to the closing `*/`) is unchanged.

- [ ] **Step 4: Run the file, the CRM typecheck, lint and format to verify everything passes**

```bash
npx vitest run apps/crm/src/context/__tests__/AuthContext.test.tsx
npx tsc -p apps/crm/tsconfig.json --noEmit
npm run lint
npm run format:check
```

Expected: every case passes, including the pre-existing `resets the Crisp session on sign-out` and the in-flight race case; `tsc` exits 0; lint clean; `format:check` clean (run `npm run format` and re-check if Prettier rewraps any of the new code).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/context/AuthContext.tsx apps/crm/src/context/__tests__/AuthContext.test.tsx
git commit -m "feat(crm): drop the Crisp token binding on sign-out and user change

signOut nulls CRISP_TOKEN_ID and clears the cache before its await so a
rejected or hung supabaseSignOut() can never leave the next person on a
shared machine bound to the outgoing user's token. The userChanged branch
clears next to its own reset push. crispResetGeneration's comment now names
the rebind as the third reset site and why it is excluded.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Full gates, staging rollout, smoke test, browser verification and PR

**Files:**
- No source changes unless the `chat:hide` browser check (Step 5) fires; then: `apps/crm/src/context/AuthContext.tsx` (the `if (reboundTo)` block from Task 5) and `apps/crm/src/context/__tests__/AuthContext.test.tsx` (the first-login case's expected sequence).

**Interfaces:**
- Consumes: everything above.
- Produces: the PR, with the migration and function already live on staging and the prod rollout order in the PR body.

- [ ] **Step 1: Run every CI gate locally**

```bash
git status --short          # must print nothing
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
git checkout -- deno.lock
ls node_modules/.deno 2>/dev/null && (rm -rf node_modules/.deno && npm ci) || true
```

Expected: every command exits 0. If `format:check` fails, `npm run format`, re-run the four `tsc` + `npm run test`, and commit the formatting as `style: prettier` (with the trailer).

- [ ] **Step 2: Apply the migration and deploy the function to STAGING**

Staging ref: `wlyzhyfondykzpsiqsce`. The worktree is unlinked (no `supabase/.temp/project-ref`), so pass the ref explicitly. `--use-api` bundles from the shell CWD's `supabase/functions/crisp-identity/`, so run from this worktree, on this branch.

```bash
pwd && git branch --show-current     # the worktree path and claude/crisp-session-continuity-5f7915
npx supabase link --project-ref wlyzhyfondykzpsiqsce < /dev/null
npx supabase db push --linked
npx supabase functions deploy crisp-identity --project-ref wlyzhyfondykzpsiqsce --no-verify-jwt --use-api
```

Expected: `db push` lists and applies `20260923000010_crisp_sessions.sql`; the deploy prints `Deployed Functions on project wlyzhyfondykzpsiqsce: crisp-identity`. Neither command asks for the database password: `link` reads the CLI token from the macOS keychain (`< /dev/null` suppresses its prompt) and `db push --linked` connects through the Management API's login role.

Two known ways `db push` fails on staging, and what to do (both documented in the `reference-staging-ops-management-api` memory note, dated 2026-09-04):

- `Failed to create login role: Connection terminated due to connection timeout`: the staging database is unhealthy even though the project status says ACTIVE_HEALTHY. Confirm with `GET https://api.supabase.com/v1/projects/wlyzhyfondykzpsiqsce/health?services=db,rest,auth` and restart with `POST https://api.supabase.com/v1/projects/wlyzhyfondykzpsiqsce/restart` (bearer token: `security find-generic-password -s "Supabase CLI" -a supabase -w > /tmp/crisp-smoke/mgmt.txt`, then `curl -H @/tmp/crisp-smoke/mgmt-header.txt` with `Authorization: Bearer <token>` in that file; never the token on the command line). It takes about 10 minutes to come back; retry `db push` afterwards.
- `LegacyDbPushMissingLocalError` (staging carries migration versions this repo does not have): apply the migration out of band and record it by hand. Write `/tmp/crisp-smoke/apply.sql` as the full contents of `supabase/migrations/20260923000010_crisp_sessions.sql` followed by `insert into supabase_migrations.schema_migrations (version, name) values ('20260923000010', 'crisp_sessions') on conflict do nothing; select version from supabase_migrations.schema_migrations where version = '20260923000010';`, run `npx supabase db query --linked --file /tmp/crisp-smoke/apply.sql` (only the last statement's rows print; expect one row), and continue with the function deploy.

If `db push` stalls at a `Enter your database password:` prompt instead (the login role path silently unavailable), do NOT type a password; abort with Ctrl-C and use the out-of-band `db query` path above, which needs none.

Ground-truth the served bundle (a successful deploy from the wrong tree still reports success):

```bash
mkdir -p /tmp/crisp-smoke && cd /tmp/crisp-smoke
npx supabase functions download crisp-identity --project-ref wlyzhyfondykzpsiqsce
grep -l "crisp_sessions" supabase/functions/crisp-identity/*.ts
cd - >/dev/null
```

Expected: `grep` prints `supabase/functions/crisp-identity/session.ts` (the served bundle contains the new module). Do not run `functions download` inside the repo; it overwrites local files.

- [ ] **Step 3: Two-call smoke: the PostgREST upsert really returns the existing row**

The SQL suite in Task 1 exercises what `.upsert({ user_id }, { onConflict: 'user_id' })` is expected to compile to; this is the only check that proves PostgREST actually emits that (`DO UPDATE ... RETURNING`), not `DO NOTHING`.

1. Sign in to `https://staging.mesaas.com.br` with a staging account (the staging frontend must already be deployed; if the branch is not on staging yet, do Step 4 first and come back).
2. DevTools > Application > Local Storage > `https://staging.mesaas.com.br` > key `sb-wlyzhyfondykzpsiqsce-auth-token` > copy the `access_token` value to the clipboard.
3. Never put the token on a command line. Write it to a header file and let curl read the file:

```bash
printf 'Authorization: Bearer %s\n' "$(pbpaste)" > /tmp/crisp-smoke/header.txt
for i in 1 2; do
  curl -sS -X POST -H @/tmp/crisp-smoke/header.txt \
    https://wlyzhyfondykzpsiqsce.supabase.co/functions/v1/crisp-identity
  echo
done
rm /tmp/crisp-smoke/header.txt
```

Expected: two `{"signature":"<64 hex chars>","crispToken":"<uuid>"}` lines with IDENTICAL `crispToken` values. A `401` means the copied JWT expired (they last one hour); copy a fresh one. If a fresh JWT still gets a `401` from the gateway (not from the function), add a second header line `apikey: <staging anon key>` (Supabase dashboard > Project Settings > API) to `/tmp/crisp-smoke/header.txt` and retry. A response with `signature` but no `crispToken` means the upsert failed inside the function: check the function logs in the Supabase dashboard (Edge Functions > crisp-identity > Logs) for `[crisp-identity] crisp_sessions upsert failed` before going further.

- [ ] **Step 4: Put the branch on the staging frontend**

Staging's edge functions only allow `ALLOWED_ORIGINS=https://staging.mesaas.com.br`, so `crisp-identity` CORS-fails from any `localhost` port and the browser verification below can only run on the deployed staging origin. The staging Vercel deployment follows `origin/staging`.

```bash
git fetch origin staging
git push origin claude/crisp-session-continuity-5f7915:staging \
  || (git worktree add /tmp/crisp-smoke/staging-merge origin/staging \
      && git -C /tmp/crisp-smoke/staging-merge merge --no-edit claude/crisp-session-continuity-5f7915 \
      && git -C /tmp/crisp-smoke/staging-merge push origin HEAD:staging \
      && git worktree remove /tmp/crisp-smoke/staging-merge)
```

Expected: the push lands (fast-forward, or via the throwaway merge worktree when `staging` has commits this branch lacks); Vercel builds and `https://staging.mesaas.com.br` serves the new bundle within a few minutes (the CI workflow also fires on `staging`).

- [ ] **Step 5: Browser verification on `https://staging.mesaas.com.br`**

Use a real browser with DevTools. All commands go in the console.

1. **First login binds.** Log in. Wait a few seconds for `crisp-identity`. Then:
   - `window.CRISP_TOKEN_ID` prints a uuid.
   - `localStorage.getItem('crisp_session_v1')` prints `{"userId":"<your uid>","token":"<same uuid>"}`.
   - `$crisp.get('session:identifier')` prints `session_...`; write it down as S1.
   - `$crisp.get('user:email')` prints your email and `$crisp.get('user:nickname')` your name (both re-established after the reset).
2. **Reload resumes silently (match branch).** Reload the page. After it settles:
   - `window.CRISP_TOKEN_ID` prints `undefined` (no preload, and a match writes nothing).
   - `$crisp.get('session:identifier')` equals S1 (Crisp's own cookie resumed it).
3. **Continuity across a fresh browser profile.** Open a private/incognito window (fresh cookies and storage), log in as the same user, wait, then `$crisp.get('session:identifier')` equals S1. This is the feature.
4. **`chat:hide` check (the spec's implementation-time check).** In the private window from step 3, right after login (a rebind just happened), on any app route: `$crisp.is('chat:visible')`.
   - `false`: nothing to do.
   - `true`: the rebind's `session:reset` re-showed the bubble `AppLayout` had hidden. Add a `chat:hide` re-push at the end of the `if (reboundTo)` block in `AuthContext.tsx`, immediately after the nickname push and before `writeCrispSessionCache(userId, reboundTo);`:

     ```ts
        // The rebind's session:reset re-shows the bubble AppLayout hid on
        // mount (observed on staging); hide it again on the fresh session.
        try {
          window.$crisp?.push(['do', 'chat:hide']);
        } catch {
          // Never let a support-tooling nicety break auth.
        }
     ```

     and extend the first-login test's expected sequence in `AuthContext.test.tsx` to:

     ```ts
    expect(crispPush.mock.calls.map((call) => call[0])).toEqual([
      ['do', 'session:reset'],
      ['set', 'user:email', ['eduardo@example.com', 'abc']],
      ['set', 'user:nickname', ['Eduardo Souza']],
      ['do', 'chat:hide'],
    ]);
     ```

     Re-run `npx vitest run apps/crm/src/context/__tests__/AuthContext.test.tsx`, then Step 1's gates, commit as `fix(crm): re-hide the Crisp bubble after a Session Continuity rebind` (with the trailer), re-run Step 4 and re-check `$crisp.is('chat:visible')` is `false`.
5. **Sign-out tears down.** Sign out from the app. On the resulting `/login` page:
   - `window.CRISP_TOKEN_ID` prints `null`.
   - `localStorage.getItem('crisp_session_v1')` prints `null`.
   - `$crisp.get('session:identifier')` is NOT S1 (fresh anonymous session).

- [ ] **Step 6: Open the PR**

Re-check the migration prefix against `origin/main` right before creating the PR:

```bash
git fetch origin main
git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3
```

Expected: the tail is still `20260923000009_instagram_carousel_children.sql`. If a newer prefix appeared, `git mv` the migration to the next free prefix, update the reference in `supabase/tests/entitlements/96_crisp_sessions.sql`'s header comment, commit, and (because staging already applied the old version name) re-run `npx supabase db push --linked` against staging after the rename so `schema_migrations` there matches.

```bash
git push -u origin claude/crisp-session-continuity-5f7915
gh pr create --base main --title "Crisp Session Continuity: bind the support widget to a per-user token" --body-file - <<'EOF'
## What

Adds Crisp **Session Continuity** to the CRM: `crisp-identity` now get-or-creates a per-user random token in a new service-role-only `crisp_sessions` table and returns it as `crispToken` (best-effort, alongside the existing signature). `AuthContext.tsx`'s already-`userId`-gated identify effect reconciles it against a `{ userId, token }` pair cached in `localStorage`: mismatch = live rebind (`CRISP_TOKEN_ID`, `session:reset`, re-push email + nickname, cache); match = no-op; absent = nothing continuity-related. Sign-out and user change null `CRISP_TOKEN_ID` and clear the cache before any await. `index.html` is untouched.

Spec: `docs/superpowers/specs/2026-09-17-crisp-session-continuity-design.md`
Plan: `docs/superpowers/plans/2026-09-17-crisp-session-continuity.md`

## Verified on staging

- Two `crisp-identity` calls with the same JWT return the same `crispToken`.
- First login binds; reload resumes the same `session:identifier` with no rebind; a fresh incognito login as the same user lands on the same session; sign-out nulls `CRISP_TOKEN_ID` and clears the cache.

## Prod rollout order (before merging, since merge deploys the frontend)

1. `npx supabase db push --linked` against prod (`skjzpekeqefvlojenfsw`).
2. `npx supabase functions deploy crisp-identity --project-ref skjzpekeqefvlojenfsw --no-verify-jwt --use-api` from this branch's tree.
3. Merge.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

Expected: the PR opens; CI's eight jobs run. Confirm `entitlement-tests` is green (it is the gate of record for `96_crisp_sessions.sql` if Task 1 could not run locally) and read the `e2e-secrets-guard` warning before trusting a green `e2e`.

- [ ] **Step 7: Prod rollout after approval (do not merge first)**

```bash
pwd && git branch --show-current
npx supabase link --project-ref skjzpekeqefvlojenfsw < /dev/null
npx supabase db push --linked
npx supabase functions deploy crisp-identity --project-ref skjzpekeqefvlojenfsw --no-verify-jwt --use-api
mkdir -p /tmp/crisp-smoke/prod && cd /tmp/crisp-smoke/prod
npx supabase functions download crisp-identity --project-ref skjzpekeqefvlojenfsw
grep -l "crisp_sessions" supabase/functions/crisp-identity/*.ts
cd - >/dev/null
```

Expected: the migration applies, the deploy succeeds, and `grep` prints `session.ts`. The same two `db push` failure modes and fallbacks from Step 2 apply here (health check / restart via the Management API, or out-of-band `npx supabase db query --linked --file` with the manual `schema_migrations` insert); substitute the prod ref `skjzpekeqefvlojenfsw` in the URLs and never type a database password. Only then merge the PR (`gh pr merge --squash`). After the frontend deploy, repeat Step 5's items 1, 2 and 5 once on `https://mesaas.com.br` with your own account.
