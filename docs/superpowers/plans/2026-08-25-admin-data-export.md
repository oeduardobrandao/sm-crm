# Admin Portal Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin export the Workspaces list and the Dashboard's Paying-Workspaces/Trials breakdowns as CSV, including owner contact info, from the Admin app.

**Architecture:** The Workspaces export is frontend-only — it re-calls the existing `listWorkspaces` API in bounded pages and serializes client-side. The MRR/Trials export needs one backend addition (`fetchOwnerContacts`, wired into the now-extracted `handleGetMrr`/`handleGetTrials`) so those two endpoints carry owner contact info they don't have today. A shared `csv-export.ts` utility (RFC 4180 serialization + formula-injection neutralization + download) is used by both. A migration fixes a pre-existing nondeterminism in how "the workspace owner" is picked, so both export paths agree with each other.

**Tech Stack:** React 19 + TypeScript + Vite (apps/admin), Deno edge functions (supabase/functions/platform-admin), Postgres/PL-pgSQL migrations, Vitest, Deno test, pgTAP-style SQL assertions.

**Spec:** `docs/superpowers/specs/2026-08-25-admin-data-export-design.md`

## Global Constraints

- Every exported CSV string cell must go through formula-injection neutralization (leading `=`, `+`, `-`, `@`, tab, or CR gets a leading `'`) before quoting — mirrors the existing `csvCell()` convention in `apps/crm/src/pages/importar/components/StepCommit.tsx`.
- Every export that carries owner contact info must also carry the owner's `marketing_opt_in` flag as its own column — this data is used for outreach, and recipients with `marketing_opt_in = false` must not be added to marketing sends.
- "The workspace owner" is defined once, project-wide, as the `owner`-role `workspace_members` row with the earliest `joined_at` (ties broken by `user_id`) — applied identically in the `admin_list_workspaces` RPC and in the new `fetchOwnerContacts` helper, since `workspace_members` allows more than one `owner`-role row per workspace.
- Any new fan-out over `svc.auth.admin.getUserById` must run in bounded concurrent batches (size 8, matching `STRIPE_CONCURRENCY` in `pricing.ts`) with a per-call timeout, and each individual call must be wrapped in its own `try/catch` so one failure cannot reject sibling lookups in the same batch.
- Annual subscription amounts must never be exported under a "monthly" label without normalization (`interval === "year" ? Math.round(amountCents / 12) : amountCents`) — an unconverted annual `amount_cents` overstates the monthly figure by ~12x.
- The Workspaces CSV export must fetch in bounded pages (200/page) and cap total rows at 2,000, never one unbounded request — `admin_list_workspaces` runs per-row correlated subqueries plus a 7-source activity aggregation per workspace.
- Before opening the PR, re-verify the new migration's timestamp prefix against `git ls-tree origin/main:supabase/migrations | tail`, per this repo's migration-version-guard CI gate — two migrations sharing a version prefix silently collide.
- Run `npm run lint`, `npm run format:check`, the four `tsc -p ...` commands, `npm run test`, and `npm run test:functions` before considering any task's changes final (per `CLAUDE.md`).

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260825000001_admin_list_workspaces_deterministic_owner.sql` | Create-or-replace `admin_list_workspaces`, adding a deterministic `ORDER BY` to its owner lookup |
| `supabase/tests/entitlements/67_admin_list_workspaces_owner_tiebreak.sql` | pgTAP-style SQL test pinning that tie-break |
| `supabase/functions/platform-admin/pricing.ts` | Modify: export the existing `withTimeout` helper for reuse |
| `supabase/functions/platform-admin/owner-contact.ts` | New: `fetchOwnerContacts` — batched, bounded, tolerant owner-contact lookup |
| `supabase/functions/__tests__/platform-admin-owner-contact_test.ts` | Deno unit tests for `fetchOwnerContacts` |
| `supabase/functions/platform-admin/mrr.ts` | New: `handleGetMrr`/`handleGetTrials`, extracted from `index.ts`, now owner-enriched |
| `supabase/functions/platform-admin/index.ts` | Modify: remove the two inline handlers, import from `mrr.ts` |
| `supabase/functions/__tests__/platform-admin-mrr_test.ts` | Deno tests proving the handlers attach `owner_*` fields |
| `apps/admin/src/lib/api.ts` | Modify: `PayingWorkspace`/`TrialWorkspace` gain `owner_*` fields |
| `apps/admin/src/lib/csv-export.ts` | New: `sanitizeCell`, `toCSV`, `downloadCSV`, `toMonthlyCents`, `centsToReais` |
| `apps/admin/src/lib/__tests__/csv-export.test.ts` | Vitest tests for the above |
| `apps/admin/src/pages/workspaces-export.ts` | New: Workspaces-export column defs + row-mapping (annual normalization) |
| `apps/admin/src/pages/__tests__/workspaces-export.test.ts` | Vitest tests for the row-mapping (including the odd-cents rounding case) |
| `apps/admin/src/pages/WorkspacesPage.tsx` | Modify: "Export CSV" button, paged/capped fetch-and-download |
| `apps/admin/src/pages/dashboard-export.ts` | New: Paying-Workspaces/Trials column defs + row-mapping |
| `apps/admin/src/pages/__tests__/dashboard-export.test.ts` | Vitest tests for the above |
| `apps/admin/src/pages/DashboardPage.tsx` | Modify: "Export CSV" links on the two card headers |

---

### Task 1: Deterministic owner tie-break in `admin_list_workspaces`

**Files:**
- Create: `supabase/migrations/20260825000001_admin_list_workspaces_deterministic_owner.sql`
- Create: `supabase/tests/entitlements/67_admin_list_workspaces_owner_tiebreak.sql`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `admin_list_workspaces(text, text, int, int)` now returns a deterministic `owner` for a workspace with more than one `owner`-role member (earliest `joined_at`, then `user_id`). Later tasks' `fetchOwnerContacts` (Task 2) must use the identical rule.

- [ ] **Step 1: Re-verify the migration timestamp is free**

Run:
```bash
git ls-tree origin/main:supabase/migrations | tail -5
```
Expected: the newest entry's prefix is `< 20260825000001`. If a same-or-later prefix already exists on `main`, bump the filename below to the next free `202608250000NN` and use that number in every step of this task instead.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260825000001_admin_list_workspaces_deterministic_owner.sql`:

```sql
-- Makes the "owner" picked by admin_list_workspaces deterministic. workspace_members only
-- constrains UNIQUE(user_id, workspace_id) -- nothing stops a workspace from ending up with
-- more than one role='owner' row (an existing owner can promote another member to 'owner'
-- via manage-workspace-user's update-role action), and the previous version's `own` LATERAL
-- picked one with an unordered LIMIT 1, i.e. an arbitrary row. Ties are now broken by
-- joined_at (earliest wins), then user_id -- the same rule the platform-admin
-- fetchOwnerContacts helper (supabase/functions/platform-admin/owner-contact.ts) uses for
-- the MRR/Trials owner enrichment, so both paths agree on "the owner" for a given workspace.
CREATE OR REPLACE FUNCTION admin_list_workspaces(
  p_search  text DEFAULT NULL,
  p_plan_id text DEFAULT NULL,
  p_offset  int  DEFAULT 0,
  p_limit   int  DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH default_plan AS (
  SELECT id, name FROM plans WHERE is_default = true LIMIT 1
),
filtered AS (
  SELECT w.id, w.name, w.logo_url, w.created_at, w.plan_id
    FROM workspaces w
   WHERE (p_search IS NULL OR w.name ILIKE '%' || p_search || '%')
     AND (p_plan_id IS NULL
          OR COALESCE(w.plan_id, (SELECT id FROM default_plan)) = p_plan_id)
),
page AS (
  SELECT * FROM filtered ORDER BY created_at DESC OFFSET p_offset LIMIT p_limit
),
enriched AS (
  SELECT
    p.id,
    p.name,
    p.logo_url,
    p.created_at,
    la.last_activity_at,
    (SELECT count(*) FROM workspace_members m WHERE m.workspace_id = p.id) AS member_count,
    (SELECT count(*) FROM clientes c WHERE c.conta_id = p.id)              AS client_count,
    COALESCE(pl.name, (SELECT name FROM default_plan))                     AS plan_name,
    EXISTS (
      SELECT 1 FROM workspace_plan_overrides o
       WHERE o.workspace_id = p.id
         AND (o.resource_overrides IS NOT NULL OR o.feature_overrides IS NOT NULL)
    ) AS has_overrides,
    own.owner_json AS owner,
    sub.sub_json   AS subscription
  FROM page p
  LEFT JOIN plans pl ON pl.id = p.plan_id
  LEFT JOIN LATERAL (
    SELECT a.last_activity_at
      FROM admin_workspace_last_activity(ARRAY[p.id]) a
  ) la ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'name',             COALESCE(pr.nome, 'Unknown'),
      'email',            COALESCE(u.email, 'Unknown'),
      'telefone',         pr.telefone,
      'marketing_opt_in', COALESCE(pr.marketing_opt_in, false)
    ) AS owner_json
      FROM workspace_members m
      LEFT JOIN profiles pr ON pr.id = m.user_id
      LEFT JOIN auth.users u ON u.id = m.user_id
     WHERE m.workspace_id = p.id AND m.role = 'owner'
     ORDER BY m.joined_at ASC, m.user_id ASC
     LIMIT 1
  ) own ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'status',           s.status,
      'plan_name',        sp.name,
      'billing_interval', s.billing_interval,
      'amount_cents',     COALESCE(
                            s.amount_cents,
                            CASE WHEN s.billing_interval = 'year'
                                 THEN sp.price_brl_annual ELSE sp.price_brl END),
      'currency',         CASE
                            WHEN s.amount_cents IS NOT NULL THEN s.currency
                            WHEN (CASE WHEN s.billing_interval = 'year'
                                       THEN sp.price_brl_annual ELSE sp.price_brl END) IS NOT NULL
                                 THEN 'brl'
                            ELSE NULL
                          END,
      'interval',         COALESCE(s.amount_interval, s.billing_interval),
      'discount_label',   s.discount_label
    ) AS sub_json
      FROM workspace_subscriptions s
      LEFT JOIN plans sp ON sp.id = s.plan_id
     WHERE s.workspace_id = p.id
  ) sub ON true
)
SELECT jsonb_build_object(
  'total',               (SELECT count(*) FROM filtered),
  'total_members',       (SELECT count(*)
                            FROM workspace_members m
                            JOIN filtered f ON f.id = m.workspace_id),
  'total_clients',       (SELECT count(*)
                            FROM clientes c
                            JOIN filtered f ON f.id = c.conta_id),
  'total_with_overrides', (SELECT count(*)
                             FROM filtered f
                            WHERE EXISTS (
                              SELECT 1 FROM workspace_plan_overrides o
                               WHERE o.workspace_id = f.id
                                 AND (o.resource_overrides IS NOT NULL
                                      OR o.feature_overrides IS NOT NULL))),
  'workspaces',          COALESCE(
    (SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC) FROM enriched e),
    '[]'::jsonb)
);
$$;

REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM anon;
REVOKE ALL ON FUNCTION admin_list_workspaces(text, text, int, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION admin_list_workspaces(text, text, int, int) TO service_role;
```

- [ ] **Step 3: Write the pgTAP-style test**

Create `supabase/tests/entitlements/67_admin_list_workspaces_owner_tiebreak.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid;
  v_early uuid := gen_random_uuid();
  v_late uuid := gen_random_uuid();
  v_result jsonb;
  v_owner jsonb;
begin
  v_ws := et_make_workspace('max');

  insert into auth.users (id, email) values
    (v_early, 'early-owner@example.com'),
    (v_late,  'late-owner@example.com');

  -- handle_new_user_workspace already created a profile per user; re-point them.
  update profiles set nome = 'Early Owner', conta_id = v_ws, active_workspace_id = v_ws
    where id = v_early;
  update profiles set nome = 'Late Owner', conta_id = v_ws, active_workspace_id = v_ws
    where id = v_late;

  -- v_late is inserted first, but v_early has the EARLIER joined_at -- the tie-break
  -- must go by joined_at, not insertion order.
  insert into workspace_members (user_id, workspace_id, role, joined_at) values
    (v_late,  v_ws, 'owner', now()),
    (v_early, v_ws, 'owner', now() - interval '1 day');

  execute 'set local role service_role';
  v_result := admin_list_workspaces(null, null, 0, 50);
  execute 'reset role';

  select w -> 'owner' into v_owner
    from jsonb_array_elements(v_result -> 'workspaces') w
   where (w ->> 'id')::uuid = v_ws;

  assert v_owner ->> 'name' = 'Early Owner',
    format('expected earliest-joined_at owner, got %s', v_owner ->> 'name');
  assert v_owner ->> 'email' = 'early-owner@example.com',
    'owner email must match the earliest-joined_at row';

  raise notice 'PASS 67_admin_list_workspaces_owner_tiebreak';
end $$;
rollback;
```

- [ ] **Step 4: Run the test (if local Supabase is available)**

This suite needs a local Postgres (`colima start` first if using colima, per this repo's local-Supabase setup). If you have it running:
```bash
npm run test:db
```
Expected: `PASS 67_admin_list_workspaces_owner_tiebreak` appears in the output, no `assert` failures. If local Supabase isn't available in this environment, skip running it directly — `entitlement-tests` in CI (`.github/workflows/ci.yml`) runs this same suite and will catch a failure there. Do not skip *writing* the file.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260825000001_admin_list_workspaces_deterministic_owner.sql supabase/tests/entitlements/67_admin_list_workspaces_owner_tiebreak.sql
git commit -m "fix(admin): make admin_list_workspaces owner lookup deterministic"
```

---

### Task 2: `fetchOwnerContacts` owner-contact helper

**Files:**
- Modify: `supabase/functions/platform-admin/pricing.ts` (export `withTimeout`)
- Create: `supabase/functions/platform-admin/owner-contact.ts`
- Test: `supabase/functions/__tests__/platform-admin-owner-contact_test.ts`

**Interfaces:**
- Consumes: `withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T>` (from `pricing.ts`, made exported by this task).
- Produces: `fetchOwnerContacts(svc: SupabaseClient, workspaceIds: string[]): Promise<Map<string, OwnerContact>>` where `OwnerContact = { name: string; email: string | null; telefone: string | null; marketing_opt_in: boolean }`. Task 3 imports this directly.

- [ ] **Step 1: Export `withTimeout` from `pricing.ts`**

In `supabase/functions/platform-admin/pricing.ts`, change:
```ts
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
```
to:
```ts
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
```
(Only the `export` keyword is added — no other change to this function or file.)

- [ ] **Step 2: Run the existing pricing tests to confirm nothing broke**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-pricing_test.ts
```
Expected: all existing tests still PASS (an `export` addition is behavior-neutral).

- [ ] **Step 3: Write the failing tests for `fetchOwnerContacts`**

Create `supabase/functions/__tests__/platform-admin-owner-contact_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { fetchOwnerContacts } from "../platform-admin/owner-contact.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

interface Member {
  workspace_id: string;
  user_id: string;
  joined_at: string;
}
interface Profile {
  id: string;
  nome: string | null;
  telefone: string | null;
  marketing_opt_in: boolean | null;
}

function makeFakeSvc(opts: {
  members: Member[];
  profiles: Profile[];
  getUserById: (id: string) => Promise<{ data: { user: { id: string; email: string } | null } }>;
  membersError?: Error;
  profilesError?: Error;
}) {
  const db = {
    from(table: string) {
      if (table === "workspace_members") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => ({
              eq: (_col2: string, _role: string) => ({
                order: (col1: string, o1: { ascending: boolean }) => ({
                  order: (col2: string, o2: { ascending: boolean }) => {
                    if (opts.membersError) {
                      return Promise.resolve({ data: null, error: opts.membersError });
                    }
                    const filtered = opts.members.filter((m) => ids.includes(m.workspace_id));
                    const sorted = [...filtered].sort((a, b) => {
                      const av = String((a as unknown as Record<string, unknown>)[col1]);
                      const bv = String((b as unknown as Record<string, unknown>)[col1]);
                      const c1 = av.localeCompare(bv) * (o1.ascending ? 1 : -1);
                      if (c1 !== 0) return c1;
                      const av2 = String((a as unknown as Record<string, unknown>)[col2]);
                      const bv2 = String((b as unknown as Record<string, unknown>)[col2]);
                      return av2.localeCompare(bv2) * (o2.ascending ? 1 : -1);
                    });
                    return Promise.resolve({ data: sorted, error: null });
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => {
              if (opts.profilesError) {
                return Promise.resolve({ data: null, error: opts.profilesError });
              }
              return Promise.resolve({
                data: opts.profiles.filter((p) => ids.includes(p.id)),
                error: null,
              });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: { admin: { getUserById: (id: string) => opts.getUserById(id) } },
  };
  return db as unknown as SupabaseClient;
}

Deno.test("picks the earliest-joined_at owner when a workspace has two owner rows", async () => {
  const svc = makeFakeSvc({
    members: [
      { workspace_id: "ws-1", user_id: "user-late", joined_at: "2026-02-01T00:00:00Z" },
      { workspace_id: "ws-1", user_id: "user-early", joined_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: [
      { id: "user-late", nome: "Late Owner", telefone: null, marketing_opt_in: false },
      { id: "user-early", nome: "Early Owner", telefone: null, marketing_opt_in: true },
    ],
    getUserById: (id) => Promise.resolve({ data: { user: { id, email: `${id}@example.com` } } }),
  });

  const result = await fetchOwnerContacts(svc, ["ws-1"]);
  assertEquals(result.get("ws-1"), {
    name: "Early Owner",
    email: "user-early@example.com",
    telefone: null,
    marketing_opt_in: true,
  });
});

Deno.test("a workspace with no owner-role row has no entry in the result map", async () => {
  const svc = makeFakeSvc({
    members: [{ workspace_id: "ws-1", user_id: "user-1", joined_at: "2026-01-01T00:00:00Z" }],
    profiles: [{ id: "user-1", nome: "Alice", telefone: null, marketing_opt_in: false }],
    getUserById: (id) => Promise.resolve({ data: { user: { id, email: "alice@example.com" } } }),
  });

  const result = await fetchOwnerContacts(svc, ["ws-1", "ws-2"]);
  assert(result.has("ws-1"), "ws-1 should have an owner entry");
  assert(!result.has("ws-2"), "ws-2 has no owner-role member and should have no entry");
});

Deno.test("empty workspaceIds returns an empty map without querying", async () => {
  const svc = makeFakeSvc({
    members: [],
    profiles: [],
    getUserById: () => {
      throw new Error("must not be called");
    },
  });
  const result = await fetchOwnerContacts(svc, []);
  assertEquals(result.size, 0);
});

Deno.test("a single getUserById failure blanks only that owner's email, siblings still resolve", async () => {
  const svc = makeFakeSvc({
    members: [
      { workspace_id: "ws-1", user_id: "user-1", joined_at: "2026-01-01T00:00:00Z" },
      { workspace_id: "ws-2", user_id: "user-2", joined_at: "2026-01-01T00:00:00Z" },
    ],
    profiles: [
      { id: "user-1", nome: "Alice", telefone: null, marketing_opt_in: true },
      { id: "user-2", nome: "Bob", telefone: null, marketing_opt_in: false },
    ],
    getUserById: (id) => {
      if (id === "user-1") return Promise.reject(new Error("network blip"));
      return Promise.resolve({ data: { user: { id, email: "bob@example.com" } } });
    },
  });

  const result = await fetchOwnerContacts(svc, ["ws-1", "ws-2"]);
  assertEquals(result.get("ws-1"), {
    name: "Alice",
    email: null,
    telefone: null,
    marketing_opt_in: true,
  });
  assertEquals(result.get("ws-2"), {
    name: "Bob",
    email: "bob@example.com",
    telefone: null,
    marketing_opt_in: false,
  });
});

Deno.test("workspace_members query failure propagates instead of being swallowed", async () => {
  const svc = makeFakeSvc({
    members: [],
    profiles: [],
    getUserById: () => Promise.resolve({ data: { user: null } }),
    membersError: new Error("db down"),
  });

  let threw = false;
  try {
    await fetchOwnerContacts(svc, ["ws-1"]);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "db down");
  }
  assert(threw, "expected fetchOwnerContacts to throw on a membership-query failure");
});

Deno.test("profiles query failure propagates instead of being swallowed", async () => {
  const svc = makeFakeSvc({
    members: [{ workspace_id: "ws-1", user_id: "user-1", joined_at: "2026-01-01T00:00:00Z" }],
    profiles: [],
    getUserById: () => Promise.resolve({ data: { user: null } }),
    profilesError: new Error("profiles down"),
  });

  let threw = false;
  try {
    await fetchOwnerContacts(svc, ["ws-1"]);
  } catch (err) {
    threw = true;
    assertEquals((err as Error).message, "profiles down");
  }
  assert(threw, "expected fetchOwnerContacts to throw on a profiles-query failure");
});

Deno.test("batches getUserById calls in groups no larger than 8", async () => {
  const N = 10;
  const members: Member[] = Array.from({ length: N }, (_, i) => ({
    workspace_id: `ws-${i}`,
    user_id: `user-${i}`,
    joined_at: "2026-01-01T00:00:00Z",
  }));
  const profiles: Profile[] = members.map((m) => ({
    id: m.user_id,
    nome: `Name ${m.user_id}`,
    telefone: null,
    marketing_opt_in: false,
  }));

  let inFlight = 0;
  let maxInFlight = 0;

  const svc = makeFakeSvc({
    members,
    profiles,
    getUserById: async (id) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { data: { user: { id, email: `${id}@example.com` } } };
    },
  });

  await fetchOwnerContacts(svc, members.map((m) => m.workspace_id));
  assert(maxInFlight <= 8, `expected concurrency <= 8, got ${maxInFlight}`);
  assert(maxInFlight > 1, "sanity check: batching should still run some calls concurrently");
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-owner-contact_test.ts
```
Expected: FAIL — `owner-contact.ts` does not exist yet (module not found).

- [ ] **Step 5: Implement `fetchOwnerContacts`**

Create `supabase/functions/platform-admin/owner-contact.ts`:

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { withTimeout } from "./pricing.ts";

const OWNER_LOOKUP_CONCURRENCY = 8;
const OWNER_LOOKUP_TIMEOUT_MS = 5000;

export interface OwnerContact {
  name: string;
  email: string | null;
  telefone: string | null;
  marketing_opt_in: boolean;
}

/**
 * Resolves the "owner" of each given workspace for admin display/export purposes.
 * workspace_members only constrains UNIQUE(user_id, workspace_id) -- more than one
 * role='owner' row per workspace is possible -- so ties are broken by earliest
 * joined_at, then user_id. This must match the tie-break admin_list_workspaces uses
 * (migration 20260825000001) so both paths agree on "the owner" for the same workspace.
 *
 * A workspace with no owner-role row has no entry in the returned map -- callers must
 * treat a missing entry as "no owner", not an error.
 */
export async function fetchOwnerContacts(
  svc: SupabaseClient,
  workspaceIds: string[],
): Promise<Map<string, OwnerContact>> {
  const result = new Map<string, OwnerContact>();
  if (workspaceIds.length === 0) return result;

  const { data: members, error: membersError } = await svc
    .from("workspace_members")
    .select("workspace_id, user_id, joined_at")
    .in("workspace_id", workspaceIds)
    .eq("role", "owner")
    .order("joined_at", { ascending: true })
    .order("user_id", { ascending: true });
  if (membersError) throw membersError;

  const ownerByWorkspace = new Map<string, string>();
  for (const m of (members ?? []) as Array<{ workspace_id: string; user_id: string }>) {
    if (!ownerByWorkspace.has(m.workspace_id)) {
      ownerByWorkspace.set(m.workspace_id, m.user_id);
    }
  }

  const ownerUserIds = [...new Set(ownerByWorkspace.values())];
  if (ownerUserIds.length === 0) return result;

  const { data: profiles, error: profilesError } = await svc
    .from("profiles")
    .select("id, nome, telefone, marketing_opt_in")
    .in("id", ownerUserIds);
  if (profilesError) throw profilesError;

  const profileById = new Map(
    ((profiles ?? []) as Array<{
      id: string;
      nome: string | null;
      telefone: string | null;
      marketing_opt_in: boolean | null;
    }>).map((p) => [p.id, p]),
  );

  const emailById = new Map<string, string | null>();
  for (let i = 0; i < ownerUserIds.length; i += OWNER_LOOKUP_CONCURRENCY) {
    const batch = ownerUserIds.slice(i, i + OWNER_LOOKUP_CONCURRENCY);
    await Promise.all(
      batch.map(async (userId) => {
        try {
          const { data } = await withTimeout(
            svc.auth.admin.getUserById(userId),
            OWNER_LOOKUP_TIMEOUT_MS,
            "owner email lookup",
          );
          emailById.set(userId, data?.user?.email ?? null);
        } catch (err) {
          console.error(
            `[platform-admin] owner email lookup failed for ${userId}:`,
            (err as Error).message,
          );
          emailById.set(userId, null);
        }
      }),
    );
  }

  for (const [workspaceId, userId] of ownerByWorkspace) {
    const profile = profileById.get(userId);
    result.set(workspaceId, {
      name: profile?.nome ?? "Unknown",
      email: emailById.get(userId) ?? null,
      telefone: profile?.telefone ?? null,
      marketing_opt_in: profile?.marketing_opt_in ?? false,
    });
  }

  return result;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-owner-contact_test.ts
```
Expected: all 7 tests PASS.

- [ ] **Step 7: Restore deno.lock if it was dirtied and commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/platform-admin/pricing.ts supabase/functions/platform-admin/owner-contact.ts supabase/functions/__tests__/platform-admin-owner-contact_test.ts
git commit -m "feat(admin): add bounded, fault-tolerant owner-contact lookup"
```

---

### Task 3: Extract `handleGetMrr`/`handleGetTrials` into `mrr.ts`, wire owner enrichment

**Files:**
- Create: `supabase/functions/platform-admin/mrr.ts`
- Modify: `supabase/functions/platform-admin/index.ts`
- Modify: `apps/admin/src/lib/api.ts`
- Test: `supabase/functions/__tests__/platform-admin-mrr_test.ts`

**Interfaces:**
- Consumes: `fetchOwnerContacts` (Task 2), `priceSubscriptionRows` (existing, `pricing.ts`), `aggregateMrr`/`toMonthlyCents` (existing, `_shared/billing-logic.ts`).
- Produces: `handleGetMrr(svc, headers, fetchOwnerContactsFn?)` and `handleGetTrials(svc, headers, fetchOwnerContactsFn?)`, both exported from `mrr.ts`, both returning JSON bodies whose workspace rows now include `owner_name: string | null`, `owner_email: string | null`, `owner_telefone: string | null`, `owner_marketing_opt_in: boolean`. Tasks 5/6 rely on these field names existing on `PayingWorkspace`/`TrialWorkspace` in `apps/admin/src/lib/api.ts`.

- [ ] **Step 1: Write the failing tests for the extracted, owner-enriched handlers**

Create `supabase/functions/__tests__/platform-admin-mrr_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { handleGetMrr, handleGetTrials } from "../platform-admin/mrr.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const HEADERS = { "Content-Type": "application/json" };

function makeFakeSvc(rows: {
  subscriptions: Record<string, unknown>[];
  workspaces: Array<{ id: string; name: string }>;
  plans: Array<{ id: string; name: string; price_brl: number | null; price_brl_annual: number | null }>;
}) {
  const db = {
    from(table: string) {
      if (table === "workspace_subscriptions") {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: rows.subscriptions, error: null }),
            eq: () => Promise.resolve({ data: rows.subscriptions, error: null }),
          }),
        };
      }
      if (table === "workspaces") {
        return { select: () => ({ in: () => Promise.resolve({ data: rows.workspaces, error: null }) }) };
      }
      if (table === "plans") {
        return { select: () => ({ in: () => Promise.resolve({ data: rows.plans, error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return db as unknown as SupabaseClient;
}

const fakeFetchOwnerContacts = (_svc: SupabaseClient, workspaceIds: string[]) =>
  Promise.resolve(
    new Map(
      workspaceIds.map((id) => [
        id,
        { name: `Owner of ${id}`, email: `${id}@example.com`, telefone: "11999999999", marketing_opt_in: true },
      ]),
    ),
  );

Deno.test("handleGetMrr attaches owner_* fields from fetchOwnerContacts to each row", async () => {
  const svc = makeFakeSvc({
    subscriptions: [
      {
        workspace_id: "ws-1",
        provider: "stripe",
        status: "active",
        plan_id: "pro",
        billing_interval: "month",
        stripe_subscription_id: null,
        amount_cents: 9900,
        currency: "brl",
        amount_interval: "month",
        discount_label: null,
      },
    ],
    workspaces: [{ id: "ws-1", name: "Alpha" }],
    plans: [{ id: "pro", name: "Pro", price_brl: 9900, price_brl_annual: null }],
  });

  const res = await handleGetMrr(svc, HEADERS, fakeFetchOwnerContacts);
  const body = await res.json();
  assertEquals(body.workspaces.length, 1);
  assertEquals(body.workspaces[0].owner_name, "Owner of ws-1");
  assertEquals(body.workspaces[0].owner_email, "ws-1@example.com");
  assertEquals(body.workspaces[0].owner_telefone, "11999999999");
  assertEquals(body.workspaces[0].owner_marketing_opt_in, true);
});

Deno.test("handleGetTrials attaches owner_* fields from fetchOwnerContacts to each row", async () => {
  const svc = makeFakeSvc({
    subscriptions: [
      {
        workspace_id: "ws-2",
        provider: "stripe",
        plan_id: "pro",
        billing_interval: "year",
        stripe_subscription_id: null,
        current_period_end: "2026-09-01T00:00:00Z",
        amount_cents: 99000,
        currency: "brl",
        amount_interval: "year",
        discount_label: null,
      },
    ],
    workspaces: [{ id: "ws-2", name: "Beta" }],
    plans: [{ id: "pro", name: "Pro", price_brl: null, price_brl_annual: 99000 }],
  });

  const res = await handleGetTrials(svc, HEADERS, fakeFetchOwnerContacts);
  const body = await res.json();
  assertEquals(body.trials.length, 1);
  assertEquals(body.trials[0].owner_name, "Owner of ws-2");
  assertEquals(body.trials[0].owner_email, "ws-2@example.com");
  assertEquals(body.trials[0].monthly_cents, 8250); // round(99000/12) = 8250
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-mrr_test.ts
```
Expected: FAIL — `mrr.ts` does not exist yet.

- [ ] **Step 3: Create `mrr.ts` with the extracted, owner-enriched handlers**

Create `supabase/functions/platform-admin/mrr.ts`:

```ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aggregateMrr, toMonthlyCents } from "../_shared/billing-logic.ts";
import { priceSubscriptionRows } from "./pricing.ts";
import { fetchOwnerContacts } from "./owner-contact.ts";

/**
 * Monthly recurring revenue + the paying-workspace breakdown behind it, driven by the Stripe
 * subscription mirror (workspace_subscriptions), NOT by plan-assignment counts -- so comped/manual
 * plan grants (which have no subscription row) never inflate it. Only in-force paid subscriptions
 * count (active/past_due). Each is priced from its live Stripe amount, net of coupons; if Stripe
 * is unreachable it falls back to the plan's catalog price. Annual is normalized to monthly, and
 * the total is the exact sum of the per-workspace monthly amounts returned in `workspaces`.
 *
 * Extracted from index.ts (was an inline, un-exported handleGetMrr) so the owner-contact
 * enrichment added here for the admin CSV export is unit-testable. `fetchOwnerContactsFn` is
 * injectable so tests can substitute a fixture without re-testing fetchOwnerContacts itself.
 */
export async function handleGetMrr(
  svc: SupabaseClient,
  headers: Record<string, string>,
  fetchOwnerContactsFn: typeof fetchOwnerContacts = fetchOwnerContacts,
) {
  const { data: subs, error: subsError } = await svc
    .from("workspace_subscriptions")
    .select(
      "workspace_id, provider, status, plan_id, billing_interval, stripe_subscription_id, amount_cents, currency, amount_interval, discount_label",
    )
    .in("status", ["active", "past_due"]);
  if (subsError) throw subsError;

  const rows = subs ?? [];
  const wsIds = rows.map((s) => s.workspace_id);
  const planIds = [...new Set(rows.map((s) => s.plan_id).filter(Boolean))] as string[];

  const nameByWs = new Map<string, string>();
  if (wsIds.length) {
    const { data: wsRows } = await svc.from("workspaces").select("id, name").in("id", wsIds);
    for (const w of wsRows ?? []) nameByWs.set(w.id, w.name);
  }

  const planById = new Map<
    string,
    { name: string; price_brl: number | null; price_brl_annual: number | null }
  >();
  if (planIds.length) {
    const { data: planRows } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", planIds);
    for (const p of planRows ?? []) {
      planById.set(p.id, {
        name: p.name,
        price_brl: p.price_brl ?? null,
        price_brl_annual: p.price_brl_annual ?? null,
      });
    }
  }

  const priceable = await priceSubscriptionRows(svc, rows, nameByWs, planById);

  const { mrr_cents, paying_count, priced } = aggregateMrr(priceable);
  const ownerContacts = await fetchOwnerContactsFn(
    svc,
    [...new Set(priced.map((r) => r.workspace_id))],
  );
  const workspaces = priced
    .map((r) => {
      const owner = ownerContacts.get(r.workspace_id);
      return {
        workspace_id: r.workspace_id,
        name: r.name,
        plan_name: r.plan_name,
        status: r.status,
        interval: r.interval,
        monthly_cents: r.monthly_cents,
        discount_label: r.discount_label,
        amount_source: r.amount_source,
        owner_name: owner?.name ?? null,
        owner_email: owner?.email ?? null,
        owner_telefone: owner?.telefone ?? null,
        owner_marketing_opt_in: owner?.marketing_opt_in ?? false,
      };
    })
    .sort((a, b) => b.monthly_cents - a.monthly_cents);

  return new Response(JSON.stringify({ mrr_cents, paying_count, currency: "brl", workspaces }), {
    status: 200,
    headers,
  });
}

/**
 * Workspaces on a Stripe trial. Trials are `workspace_subscriptions.status = 'trialing'`, and
 * for a trialing subscription `current_period_end` is the trial-end date. Each trial carries an
 * EXPECTED monthly contribution, priced from the LIVE Stripe amount net of coupons (catalog price
 * as a fallback). Extracted from index.ts alongside handleGetMrr for the same testability reason.
 */
export async function handleGetTrials(
  svc: SupabaseClient,
  headers: Record<string, string>,
  fetchOwnerContactsFn: typeof fetchOwnerContacts = fetchOwnerContacts,
) {
  const { data: subs, error } = await svc
    .from("workspace_subscriptions")
    .select(
      "workspace_id, provider, plan_id, billing_interval, stripe_subscription_id, current_period_end, amount_cents, currency, amount_interval, discount_label",
    )
    .eq("status", "trialing");
  if (error) throw error;

  const rows = subs ?? [];
  const wsIds = rows.map((s) => s.workspace_id);
  const planIds = [...new Set(rows.map((s) => s.plan_id).filter(Boolean))] as string[];

  const nameByWs = new Map<string, string>();
  if (wsIds.length) {
    const { data: wsRows } = await svc.from("workspaces").select("id, name").in("id", wsIds);
    for (const w of wsRows ?? []) nameByWs.set(w.id, w.name);
  }

  const planById = new Map<
    string,
    { name: string; price_brl: number | null; price_brl_annual: number | null }
  >();
  if (planIds.length) {
    const { data: planRows } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", planIds);
    for (const p of planRows ?? []) {
      planById.set(p.id, {
        name: p.name,
        price_brl: p.price_brl ?? null,
        price_brl_annual: p.price_brl_annual ?? null,
      });
    }
  }

  const priced = await priceSubscriptionRows(svc, rows, nameByWs, planById);
  const ownerContacts = await fetchOwnerContactsFn(
    svc,
    [...new Set(priced.map((r) => r.workspace_id))],
  );
  const trials = priced
    .map((r) => {
      const owner = ownerContacts.get(r.workspace_id);
      return {
        workspace_id: r.workspace_id,
        name: r.name,
        plan_name: r.plan_name,
        interval: r.interval,
        trial_ends_at: r.current_period_end ?? null,
        monthly_cents: toMonthlyCents(r.interval, r.amount_cents),
        owner_name: owner?.name ?? null,
        owner_email: owner?.email ?? null,
        owner_telefone: owner?.telefone ?? null,
        owner_marketing_opt_in: owner?.marketing_opt_in ?? false,
      };
    })
    .sort((a, b) => {
      if (!a.trial_ends_at) return 1;
      if (!b.trial_ends_at) return -1;
      return a.trial_ends_at < b.trial_ends_at ? -1 : a.trial_ends_at > b.trial_ends_at ? 1 : 0;
    });

  const trial_mrr_cents = trials.reduce((sum, t) => sum + (t.monthly_cents ?? 0), 0);

  return new Response(
    JSON.stringify({ trials, trial_count: trials.length, trial_mrr_cents, currency: "brl" }),
    { status: 200, headers },
  );
}
```

- [ ] **Step 4: Remove the inline handlers and their now-unused imports from `index.ts`**

In `supabase/functions/platform-admin/index.ts`:

1. Add this import near the other handler imports at the top (next to `import { handleListWorkspaces } from "./list-workspaces.ts";`):
```ts
import { handleGetMrr, handleGetTrials } from "./mrr.ts";
```

2. Delete these two now-unused imports (nothing else in `index.ts` calls `priceSubscriptionRows`, `aggregateMrr`, or `toMonthlyCents` once the handlers below are removed):
```ts
import { aggregateMrr, toMonthlyCents } from "../_shared/billing-logic.ts";
```
```ts
import { priceSubscriptionRows } from "./pricing.ts";
```
Leave `import { buildAmountColumns, fetchStripeAmount } from "../_shared/stripe-amount.ts";` in place — `buildSubscriptionDetail` still uses both.

3. Delete the entire `handleGetMrr` function body (the block starting with its JSDoc comment `/** * Monthly recurring revenue ... */` and ending at the closing `}` right before the `handleGetTrials` JSDoc comment).

4. Delete the entire `handleGetTrials` function body (the block starting with its JSDoc comment `/** * Workspaces on a Stripe trial. ... */` and ending at the closing `}` right before `async function handleDeletePlan`).

The `case "get-mrr":` / `case "get-trials":` lines in the `switch (action)` block stay exactly as they are (`return await handleGetMrr(svc, headers);` / `return await handleGetTrials(svc, headers);`) — they now resolve to the imported functions instead of the local ones, with identical call signatures (the new third parameter has a default).

- [ ] **Step 5: Add `owner_*` fields to the admin API types**

In `apps/admin/src/lib/api.ts`, modify `PayingWorkspace`:
```ts
export interface PayingWorkspace {
  workspace_id: string;
  name: string;
  plan_name: string | null;
  status: string | null;
  /** Billing interval ("month" | "year"). */
  interval: string | null;
  /** This workspace's monthly contribution to MRR, in centavos. */
  monthly_cents: number;
  /** Coupon/discount label when the live Stripe amount is discounted. */
  discount_label: string | null;
  /** Whether monthly_cents came from live Stripe or the plan's catalog price. */
  amount_source: 'stripe' | 'pagarme' | 'catalog' | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_telefone: string | null;
  owner_marketing_opt_in: boolean;
}
```
and `TrialWorkspace`:
```ts
export interface TrialWorkspace {
  workspace_id: string;
  name: string;
  plan_name: string | null;
  /** Billing interval that will apply once the trial converts ("month" | "year"). */
  interval: string | null;
  /** Trial-end date (ISO string), i.e. the subscription's current_period_end. Null if unknown. */
  trial_ends_at: string | null;
  /** Expected monthly contribution once converted (catalog price, annual→monthly). Null if unpriced. */
  monthly_cents: number | null;
  owner_name: string | null;
  owner_email: string | null;
  owner_telefone: string | null;
  owner_marketing_opt_in: boolean;
}
```
(Only the four new fields are added to each interface; every other line is unchanged.)

- [ ] **Step 6: Run the tests to verify they pass**

```bash
deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/platform-admin-mrr_test.ts supabase/functions/__tests__/platform-admin-pricing_test.ts supabase/functions/__tests__/platform-admin-list-workspaces_test.ts
```
Expected: all PASS.

- [ ] **Step 7: Typecheck the admin app and functions**

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
```
Expected: no errors (confirms `index.ts`'s remaining code and `api.ts`'s new fields are consistent).

- [ ] **Step 8: Restore deno.lock if dirtied and commit**

```bash
git checkout -- deno.lock 2>/dev/null || true
git add supabase/functions/platform-admin/mrr.ts supabase/functions/platform-admin/index.ts apps/admin/src/lib/api.ts supabase/functions/__tests__/platform-admin-mrr_test.ts
git commit -m "feat(admin): extract handleGetMrr/handleGetTrials, attach owner contact"
```

---

### Task 4: Shared CSV utility

**Files:**
- Create: `apps/admin/src/lib/csv-export.ts`
- Test: `apps/admin/src/lib/__tests__/csv-export.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CsvColumn` (`{ key: string; label: string }`), `sanitizeCell(value: string): string`, `toCSV(rows: Record<string, unknown>[], columns: CsvColumn[]): string`, `downloadCSV(filename: string, csvText: string): void`, `toMonthlyCents(interval: string | null | undefined, amountCents: number | null | undefined): number | null`, `centsToReais(cents: number | null | undefined): number | string`. Tasks 5 and 6 import all of these except `sanitizeCell` (used internally by `toCSV`).

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/lib/__tests__/csv-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { centsToReais, sanitizeCell, toCSV, toMonthlyCents } from '../csv-export';

describe('sanitizeCell', () => {
  it('prefixes values starting with =, +, -, @, tab, or CR with a leading quote', () => {
    expect(sanitizeCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(sanitizeCell('+1234')).toBe("'+1234");
    expect(sanitizeCell('-1234')).toBe("'-1234");
    expect(sanitizeCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(sanitizeCell('\tdanger')).toBe("'\tdanger");
    expect(sanitizeCell('\rdanger')).toBe("'\rdanger");
  });

  it('leaves a value that only contains, but does not start with, a risky character alone', () => {
    expect(sanitizeCell('Sub-Total')).toBe('Sub-Total');
    expect(sanitizeCell('a@b.com')).toBe('a@b.com');
  });

  it('leaves ordinary text alone', () => {
    expect(sanitizeCell('Acme Corp')).toBe('Acme Corp');
  });
});

describe('toCSV', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount' },
  ];

  it('produces a BOM-prefixed header row and one row per input, CRLF-separated', () => {
    const csv = toCSV([{ name: 'Acme', amount: 100 }], columns);
    expect(csv).toBe('\uFEFF"Name","Amount"\r\n"Acme","100"');
  });

  it('quotes fields containing commas or quotes and doubles embedded quotes', () => {
    const csv = toCSV([{ name: 'Silva, Ana "A"', amount: 1 }], columns);
    expect(csv).toContain('"Silva, Ana ""A"""');
  });

  it('keeps a newline inside a field as part of one quoted cell', () => {
    const csv = toCSV([{ name: 'line1\nline2', amount: 1 }], columns);
    expect(csv).toContain('"line1\nline2"');
  });

  it('renders null/undefined cells as an empty string', () => {
    const csv = toCSV([{ name: null, amount: undefined }], columns);
    expect(csv).toBe('\uFEFF"Name","Amount"\r\n"",""');
  });

  it('returns just the header for an empty row list', () => {
    const csv = toCSV([], columns);
    expect(csv).toBe('\uFEFF"Name","Amount"');
  });

  it('neutralizes formula-injection risk in cell values before quoting', () => {
    const csv = toCSV([{ name: '=cmd|calc', amount: 1 }], columns);
    expect(csv).toContain('"\'=cmd|calc"');
  });
});

describe('toMonthlyCents', () => {
  it('divides annual amounts by 12, rounded to the nearest cent', () => {
    expect(toMonthlyCents('year', 180001)).toBe(15000);
    expect(toMonthlyCents('year', 180000)).toBe(15000);
  });

  it('passes monthly amounts through unchanged', () => {
    expect(toMonthlyCents('month', 9900)).toBe(9900);
  });

  it('returns null for a non-positive or missing amount', () => {
    expect(toMonthlyCents('month', 0)).toBeNull();
    expect(toMonthlyCents('month', null)).toBeNull();
    expect(toMonthlyCents('year', undefined)).toBeNull();
  });
});

describe('centsToReais', () => {
  it('converts integer cents to decimal reais', () => {
    expect(centsToReais(180001)).toBe(1800.01);
    expect(centsToReais(15000)).toBe(150);
  });

  it('returns an empty string for null/undefined', () => {
    expect(centsToReais(null)).toBe('');
    expect(centsToReais(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run apps/admin/src/lib/__tests__/csv-export.test.ts
```
Expected: FAIL — `../csv-export` module not found.

- [ ] **Step 3: Implement `csv-export.ts`**

Create `apps/admin/src/lib/csv-export.ts`:

```ts
/**
 * CSV export helpers for the Admin app: serialization, formula-injection
 * neutralization, download, and the shared cents -> monthly-cents rule for
 * annual subscriptions. Mirrors, without importing (the two apps don't share
 * a CSV module), the parsing conventions in apps/crm/src/lib/csv.ts and the
 * csvCell() formula-injection mitigation in
 * apps/crm/src/pages/importar/components/StepCommit.tsx.
 */

export interface CsvColumn {
  key: string;
  label: string;
}

/**
 * Neutralizes CSV formula injection: a cell opened in Excel/Sheets that starts
 * with =, +, -, @, a tab, or a carriage return can be interpreted as a formula.
 * Prefixing a leading ' forces the cell to be read as literal text without
 * changing how it displays -- the convention StepCommit.tsx's csvCell() already
 * uses in this repo (that one covers =/+/-/@; this adds tab/CR too, per the
 * broader OWASP CSV-injection character set).
 */
export function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

function quoteField(value: string): string {
  const safe = sanitizeCell(value);
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Serializes rows to RFC 4180 CSV text with a UTF-8 BOM, ready for Excel. */
export function toCSV(rows: Record<string, unknown>[], columns: CsvColumn[]): string {
  const header = columns.map((c) => quoteField(c.label)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => quoteField(formatCell(row[c.key]))).join(','),
  );
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

/** Triggers a browser download of `csvText` as `filename`. */
export function downloadCSV(filename: string, csvText: string): void {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Normalizes a per-interval charge to a monthly figure -- annual subscriptions
 * divided by 12, rounded on integer cents (not on decimal reais). Mirrors
 * toMonthlyCents in supabase/functions/_shared/billing-logic.ts, duplicated
 * here because that module is a Deno edge-function file and can't be imported
 * into the Vite-built admin frontend.
 */
export function toMonthlyCents(
  interval: string | null | undefined,
  amountCents: number | null | undefined,
): number | null {
  if (amountCents == null || amountCents <= 0) return null;
  return interval === 'year' ? Math.round(amountCents / 12) : amountCents;
}

/** cents -> decimal reais, e.g. 180001 -> 1800.01. Returns '' for null/undefined. */
export function centsToReais(cents: number | null | undefined): number | string {
  return cents == null ? '' : cents / 100;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run apps/admin/src/lib/__tests__/csv-export.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/csv-export.ts apps/admin/src/lib/__tests__/csv-export.test.ts
git commit -m "feat(admin): add CSV export utility with formula-injection neutralization"
```

---

### Task 5: Workspaces export

**Files:**
- Create: `apps/admin/src/pages/workspaces-export.ts`
- Test: `apps/admin/src/pages/__tests__/workspaces-export.test.ts`
- Modify: `apps/admin/src/pages/WorkspacesPage.tsx`

**Interfaces:**
- Consumes: `toCSV`, `downloadCSV`, `toMonthlyCents`, `centsToReais`, `CsvColumn` (Task 4); `WorkspaceSummary`, `listWorkspaces` (existing, `apps/admin/src/lib/api.ts`); `statusMeta` (existing, `apps/admin/src/lib/subscription.ts`).
- Produces: `WORKSPACE_EXPORT_COLUMNS: CsvColumn[]`, `buildWorkspaceExportRows(workspaces: WorkspaceSummary[]): Record<string, string | number>[]` — used only by `WorkspacesPage.tsx` in this task.

- [ ] **Step 1: Write the failing tests for the row-mapping function**

Create `apps/admin/src/pages/__tests__/workspaces-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildWorkspaceExportRows } from '../workspaces-export';
import type { WorkspaceSummary } from '../../lib/api';

function baseWorkspace(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'ws-1',
    name: 'Acme',
    logo_url: null,
    created_at: '2026-01-15T10:00:00Z',
    last_activity_at: '2026-08-20T12:00:00Z',
    owner: { name: 'Ana', email: 'ana@example.com', telefone: '11999999999', marketing_opt_in: true },
    member_count: 3,
    client_count: 5,
    plan_name: 'Pro',
    has_overrides: false,
    subscription: {
      status: 'active',
      plan_name: 'Pro',
      billing_interval: 'month',
      amount_cents: 9900,
      currency: 'brl',
      interval: 'month',
      discount_label: null,
    },
    ...overrides,
  };
}

describe('buildWorkspaceExportRows', () => {
  it('normalizes an annual subscription amount to a monthly figure, keeping the raw amount too', () => {
    const rows = buildWorkspaceExportRows([
      baseWorkspace({
        subscription: {
          status: 'active',
          plan_name: 'Pro',
          billing_interval: 'year',
          amount_cents: 180001,
          currency: 'brl',
          interval: 'year',
          discount_label: null,
        },
      }),
    ]);
    expect(rows[0].billing_interval).toBe('year');
    expect(rows[0].subscription_amount_brl).toBe(1800.01);
    expect(rows[0].monthly_amount_brl).toBe(150);
  });

  it('keeps a monthly subscription amount equal to its normalized monthly amount', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace()]);
    expect(rows[0].subscription_amount_brl).toBe(99);
    expect(rows[0].monthly_amount_brl).toBe(99);
  });

  it('blanks contact and consent columns when the workspace has no owner', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace({ owner: null })]);
    expect(rows[0].owner_name).toBe('');
    expect(rows[0].owner_email).toBe('');
    expect(rows[0].owner_telefone).toBe('');
    expect(rows[0].owner_marketing_opt_in).toBe('no');
  });

  it('blanks subscription columns when the workspace has no subscription', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace({ subscription: null })]);
    expect(rows[0].subscription_status).toBe('');
    expect(rows[0].billing_interval).toBe('');
    expect(rows[0].subscription_amount_brl).toBe('');
    expect(rows[0].monthly_amount_brl).toBe('');
  });

  it('formats created/last-activity as plain ISO dates, not locale strings', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace()]);
    expect(rows[0].created_at).toBe('2026-01-15');
    expect(rows[0].last_activity_at).toBe('2026-08-20');
  });

  it('renders overrides as yes/no', () => {
    const rows = buildWorkspaceExportRows([baseWorkspace({ has_overrides: true })]);
    expect(rows[0].has_overrides).toBe('yes');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run apps/admin/src/pages/__tests__/workspaces-export.test.ts
```
Expected: FAIL — `../workspaces-export` module not found.

- [ ] **Step 3: Implement `workspaces-export.ts`**

Create `apps/admin/src/pages/workspaces-export.ts`:

```ts
import type { WorkspaceSummary } from '../lib/api';
import { centsToReais, toMonthlyCents, type CsvColumn } from '../lib/csv-export';
import { statusMeta } from '../lib/subscription';

export const WORKSPACE_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'owner_email', label: 'Owner Email' },
  { key: 'owner_telefone', label: 'Owner Phone' },
  { key: 'owner_marketing_opt_in', label: 'Owner Marketing Opt-in' },
  { key: 'plan_name', label: 'Plan' },
  { key: 'subscription_status', label: 'Subscription Status' },
  { key: 'billing_interval', label: 'Billing Interval' },
  { key: 'subscription_amount_brl', label: 'Subscription Amount (R$)' },
  { key: 'monthly_amount_brl', label: 'Monthly Amount (R$)' },
  { key: 'discount_label', label: 'Discount' },
  { key: 'client_count', label: 'Clients' },
  { key: 'member_count', label: 'Members' },
  { key: 'has_overrides', label: 'Has Overrides' },
  { key: 'created_at', label: 'Created' },
  { key: 'last_activity_at', label: 'Last Activity' },
];

function isoDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

/** Flattens WorkspaceSummary rows into the CSV shape for WORKSPACE_EXPORT_COLUMNS. */
export function buildWorkspaceExportRows(
  workspaces: WorkspaceSummary[],
): Record<string, string | number>[] {
  return workspaces.map((ws) => {
    const sub = ws.subscription;
    return {
      workspace_name: ws.name,
      owner_name: ws.owner?.name ?? '',
      owner_email: ws.owner?.email ?? '',
      owner_telefone: ws.owner?.telefone ?? '',
      owner_marketing_opt_in: ws.owner?.marketing_opt_in ? 'yes' : 'no',
      plan_name: ws.plan_name ?? '',
      subscription_status: sub ? statusMeta(sub.status).label : '',
      billing_interval: sub?.interval ?? '',
      subscription_amount_brl: centsToReais(sub?.amount_cents ?? null),
      monthly_amount_brl: centsToReais(
        toMonthlyCents(sub?.interval ?? null, sub?.amount_cents ?? null),
      ),
      discount_label: sub?.discount_label ?? '',
      client_count: ws.client_count,
      member_count: ws.member_count,
      has_overrides: ws.has_overrides ? 'yes' : 'no',
      created_at: isoDate(ws.created_at),
      last_activity_at: isoDate(ws.last_activity_at),
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run apps/admin/src/pages/__tests__/workspaces-export.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Wire the "Export CSV" button into `WorkspacesPage.tsx`**

In `apps/admin/src/pages/WorkspacesPage.tsx`:

1. Change the top imports from:
```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight } from 'lucide-react';
import { listWorkspaces, listPlans, type WorkspaceSummary } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';
import {
  statusMeta,
  toneBadgeClass,
  hasSubscription,
  formatMoney,
  intervalSuffix,
} from '../lib/subscription';
import { describeActivity, type ActivityTone } from './workspace-activity';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
```
to:
```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, ArrowRight, Download } from 'lucide-react';
import { toast } from 'sonner';
import { listWorkspaces, listPlans, type WorkspaceSummary } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';
import {
  statusMeta,
  toneBadgeClass,
  hasSubscription,
  formatMoney,
  intervalSuffix,
} from '../lib/subscription';
import { describeActivity, type ActivityTone } from './workspace-activity';
import { Tooltip, TooltipTrigger, TooltipContent } from '../components/ui/tooltip';
import { toCSV, downloadCSV } from '../lib/csv-export';
import { WORKSPACE_EXPORT_COLUMNS, buildWorkspaceExportRows } from './workspaces-export';
```

2. Inside `WorkspacesPage()`, right after the existing `const limit = 20;` line, add:
```tsx
  const [exporting, setExporting] = useState(false);

  async function handleExportCsv() {
    setExporting(true);
    try {
      const PAGE_SIZE = 200;
      const MAX_ROWS = 2000;
      const all: WorkspaceSummary[] = [];
      let total = Infinity;
      for (let offset = 0; offset < Math.min(total, MAX_ROWS); offset += PAGE_SIZE) {
        const page = await listWorkspaces({
          search: search || undefined,
          plan_id: planFilter || undefined,
          offset,
          limit: PAGE_SIZE,
        });
        total = page.total;
        all.push(...page.workspaces);
      }

      if (all.length === 0) {
        toast.error('Nothing to export');
        return;
      }

      const rows = all.slice(0, MAX_ROWS);
      const csv = toCSV(buildWorkspaceExportRows(rows), WORKSPACE_EXPORT_COLUMNS);
      downloadCSV(`workspaces-${new Date().toISOString().slice(0, 10)}.csv`, csv);

      if (total > MAX_ROWS) {
        toast.error(
          `Exported the first ${MAX_ROWS} of ${total} matching workspaces — narrow your search or plan filter to export the rest.`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }
```
(This references `search` and `planFilter`, both already declared as state a few lines above in the existing code.)

3. Add the button to the filter row. Change:
```tsx
        <select
          value={planFilter}
          onChange={(e) => {
            setPlanFilter(e.target.value);
            setPage(0);
          }}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All Plans</option>
          {plansData?.plans?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
```
to:
```tsx
        <select
          value={planFilter}
          onChange={(e) => {
            setPlanFilter(e.target.value);
            setPage(0);
          }}
          className="px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground focus:outline-none focus:border-primary"
        >
          <option value="">All Plans</option>
          {plansData?.plans?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleExportCsv}
          disabled={exporting}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-card border border-border text-sm text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
        >
          <Download size={16} />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/workspaces-export.ts apps/admin/src/pages/__tests__/workspaces-export.test.ts apps/admin/src/pages/WorkspacesPage.tsx
git commit -m "feat(admin): add Export CSV to the Workspaces list"
```

---

### Task 6: Dashboard (Paying Workspaces / Trials) export

**Files:**
- Create: `apps/admin/src/pages/dashboard-export.ts`
- Test: `apps/admin/src/pages/__tests__/dashboard-export.test.ts`
- Modify: `apps/admin/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `toCSV`, `downloadCSV`, `centsToReais`, `CsvColumn` (Task 4); `PayingWorkspace`, `TrialWorkspace` with their `owner_*` fields (Task 3); `statusMeta` (existing).
- Produces: `PAYING_WORKSPACE_EXPORT_COLUMNS`, `buildPayingWorkspaceExportRows`, `TRIAL_EXPORT_COLUMNS`, `buildTrialExportRows` — used only by `DashboardPage.tsx` in this task.

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/pages/__tests__/dashboard-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPayingWorkspaceExportRows, buildTrialExportRows } from '../dashboard-export';
import type { PayingWorkspace, TrialWorkspace } from '../../lib/api';

function payingWorkspace(overrides: Partial<PayingWorkspace> = {}): PayingWorkspace {
  return {
    workspace_id: 'ws-1',
    name: 'Acme',
    plan_name: 'Pro',
    status: 'active',
    interval: 'month',
    monthly_cents: 9900,
    discount_label: null,
    amount_source: 'stripe',
    owner_name: 'Ana',
    owner_email: 'ana@example.com',
    owner_telefone: '11999999999',
    owner_marketing_opt_in: true,
    ...overrides,
  };
}

function trialWorkspace(overrides: Partial<TrialWorkspace> = {}): TrialWorkspace {
  return {
    workspace_id: 'ws-2',
    name: 'Beta',
    plan_name: 'Pro',
    interval: 'year',
    trial_ends_at: '2026-09-05T00:00:00Z',
    monthly_cents: 8250,
    owner_name: 'Bruno',
    owner_email: 'bruno@example.com',
    owner_telefone: null,
    owner_marketing_opt_in: false,
    ...overrides,
  };
}

describe('buildPayingWorkspaceExportRows', () => {
  it('maps owner contact and consent, and converts monthly_cents to reais', () => {
    const rows = buildPayingWorkspaceExportRows([payingWorkspace()]);
    expect(rows[0].workspace_name).toBe('Acme');
    expect(rows[0].owner_name).toBe('Ana');
    expect(rows[0].owner_marketing_opt_in).toBe('yes');
    expect(rows[0].monthly_amount_brl).toBe(99);
  });

  it('blanks owner fields that are null', () => {
    const rows = buildPayingWorkspaceExportRows([
      payingWorkspace({ owner_name: null, owner_email: null, owner_telefone: null }),
    ]);
    expect(rows[0].owner_name).toBe('');
    expect(rows[0].owner_email).toBe('');
    expect(rows[0].owner_telefone).toBe('');
  });
});

describe('buildTrialExportRows', () => {
  it('maps owner contact/consent and formats trial_ends_at as a plain ISO date', () => {
    const rows = buildTrialExportRows([trialWorkspace()]);
    expect(rows[0].workspace_name).toBe('Beta');
    expect(rows[0].owner_marketing_opt_in).toBe('no');
    expect(rows[0].trial_ends_at).toBe('2026-09-05');
    expect(rows[0].monthly_amount_brl).toBe(82.5);
  });

  it('blanks trial_ends_at when null', () => {
    const rows = buildTrialExportRows([trialWorkspace({ trial_ends_at: null })]);
    expect(rows[0].trial_ends_at).toBe('');
  });

  it('blanks monthly_amount_brl when monthly_cents is null', () => {
    const rows = buildTrialExportRows([trialWorkspace({ monthly_cents: null })]);
    expect(rows[0].monthly_amount_brl).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run apps/admin/src/pages/__tests__/dashboard-export.test.ts
```
Expected: FAIL — `../dashboard-export` module not found.

- [ ] **Step 3: Implement `dashboard-export.ts`**

Create `apps/admin/src/pages/dashboard-export.ts`:

```ts
import type { PayingWorkspace, TrialWorkspace } from '../lib/api';
import { centsToReais, type CsvColumn } from '../lib/csv-export';
import { statusMeta } from '../lib/subscription';

export const PAYING_WORKSPACE_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'owner_email', label: 'Owner Email' },
  { key: 'owner_telefone', label: 'Owner Phone' },
  { key: 'owner_marketing_opt_in', label: 'Owner Marketing Opt-in' },
  { key: 'plan_name', label: 'Plan' },
  { key: 'status', label: 'Status' },
  { key: 'interval', label: 'Billing Interval' },
  { key: 'monthly_amount_brl', label: 'Monthly Amount (R$)' },
  { key: 'discount_label', label: 'Discount' },
  { key: 'amount_source', label: 'Amount Source' },
];

export function buildPayingWorkspaceExportRows(
  workspaces: PayingWorkspace[],
): Record<string, string | number>[] {
  return workspaces.map((ws) => ({
    workspace_name: ws.name,
    owner_name: ws.owner_name ?? '',
    owner_email: ws.owner_email ?? '',
    owner_telefone: ws.owner_telefone ?? '',
    owner_marketing_opt_in: ws.owner_marketing_opt_in ? 'yes' : 'no',
    plan_name: ws.plan_name ?? '',
    status: statusMeta(ws.status).label,
    interval: ws.interval ?? '',
    monthly_amount_brl: centsToReais(ws.monthly_cents),
    discount_label: ws.discount_label ?? '',
    amount_source: ws.amount_source ?? '',
  }));
}

export const TRIAL_EXPORT_COLUMNS: CsvColumn[] = [
  { key: 'workspace_name', label: 'Workspace' },
  { key: 'owner_name', label: 'Owner Name' },
  { key: 'owner_email', label: 'Owner Email' },
  { key: 'owner_telefone', label: 'Owner Phone' },
  { key: 'owner_marketing_opt_in', label: 'Owner Marketing Opt-in' },
  { key: 'plan_name', label: 'Plan' },
  { key: 'interval', label: 'Billing Interval' },
  { key: 'trial_ends_at', label: 'Trial Ends' },
  { key: 'monthly_amount_brl', label: 'Expected Monthly Amount (R$)' },
];

function isoDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '';
}

export function buildTrialExportRows(
  trials: TrialWorkspace[],
): Record<string, string | number>[] {
  return trials.map((t) => ({
    workspace_name: t.name,
    owner_name: t.owner_name ?? '',
    owner_email: t.owner_email ?? '',
    owner_telefone: t.owner_telefone ?? '',
    owner_marketing_opt_in: t.owner_marketing_opt_in ? 'yes' : 'no',
    plan_name: t.plan_name ?? '',
    interval: t.interval ?? '',
    trial_ends_at: isoDate(t.trial_ends_at),
    monthly_amount_brl: centsToReais(t.monthly_cents),
  }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run apps/admin/src/pages/__tests__/dashboard-export.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Wire the "Export CSV" links into `DashboardPage.tsx`**

In `apps/admin/src/pages/DashboardPage.tsx`:

1. Change the top imports from:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { listWorkspaces, listPlans, getMrr, getTrials } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';
import { formatMoney, intervalLabel, statusMeta, toneBadgeClass } from '../lib/subscription';
```
to:
```tsx
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { listWorkspaces, listPlans, getMrr, getTrials } from '../lib/api';
import { getPlanColor } from '../lib/plan-colors';
import { formatMoney, intervalLabel, statusMeta, toneBadgeClass } from '../lib/subscription';
import { toCSV, downloadCSV } from '../lib/csv-export';
import {
  PAYING_WORKSPACE_EXPORT_COLUMNS,
  buildPayingWorkspaceExportRows,
  TRIAL_EXPORT_COLUMNS,
  buildTrialExportRows,
} from './dashboard-export';
```

2. Right after the `trialsData` query (`const { data: trialsData, isLoading: trialsLoading } = useQuery({...});`), add:
```tsx
  function exportPayingWorkspacesCsv() {
    const workspaces = mrrData?.workspaces ?? [];
    if (workspaces.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    const csv = toCSV(buildPayingWorkspaceExportRows(workspaces), PAYING_WORKSPACE_EXPORT_COLUMNS);
    downloadCSV(`paying-workspaces-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  function exportTrialsCsv() {
    const trials = trialsData?.trials ?? [];
    if (trials.length === 0) {
      toast.error('Nothing to export');
      return;
    }
    const csv = toCSV(buildTrialExportRows(trials), TRIAL_EXPORT_COLUMNS);
    downloadCSV(`trials-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }
```

3. In the "Paying Workspaces" card, change:
```tsx
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Paying Workspaces</h2>
          <span className="text-sm text-muted-foreground">
            {mrrLoading
              ? '—'
              : `${mrrData?.paying_count ?? 0} · ${formatMoney(mrrData?.mrr_cents ?? null, mrrData?.currency)}/mês`}
          </span>
        </div>
```
to:
```tsx
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Paying Workspaces</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {mrrLoading
                ? '—'
                : `${mrrData?.paying_count ?? 0} · ${formatMoney(mrrData?.mrr_cents ?? null, mrrData?.currency)}/mês`}
            </span>
            <button
              onClick={exportPayingWorkspacesCsv}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>
```

4. In the "Trials" card, change:
```tsx
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Trials</h2>
          <span className="text-sm text-muted-foreground">
            {trialsLoading
              ? '—'
              : `${trialsData?.trial_count ?? 0} · ${formatMoney(trialMrrCents, currency)}/mês`}
          </span>
        </div>
```
to:
```tsx
        <div className="flex items-baseline justify-between mb-4 gap-3">
          <h2 className="font-semibold">Trials</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              {trialsLoading
                ? '—'
                : `${trialsData?.trial_count ?? 0} · ${formatMoney(trialMrrCents, currency)}/mês`}
            </span>
            <button
              onClick={exportTrialsCsv}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download size={14} />
              Export CSV
            </button>
          </div>
        </div>
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc -p apps/admin/tsconfig.json --noEmit
```
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/pages/dashboard-export.ts apps/admin/src/pages/__tests__/dashboard-export.test.ts apps/admin/src/pages/DashboardPage.tsx
git commit -m "feat(admin): add Export CSV to the Dashboard's Paying Workspaces and Trials cards"
```

---

### Task 7: Full verification sweep

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: nothing — this task's deliverable is a verified, working feature.

- [ ] **Step 1: Run the full frontend and function test suites**

```bash
npm run test
npm run test:functions
git checkout -- deno.lock 2>/dev/null || true
```
Expected: all suites PASS.

- [ ] **Step 2: Run all four typecheck targets**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json --noEmit
```
Expected: no errors in any of the four.

- [ ] **Step 3: Lint and format**

```bash
npm run lint
npm run format:check
```
Expected: no errors. If `format:check` fails, run `npm run format` and re-verify no unintended files changed before committing the diff.

- [ ] **Step 4: Manual browser verification — Workspaces export**

Start the admin dev server and open it in the Browser pane:
```bash
npm run dev:admin
```
Then, in the browser:
1. Sign in as a platform admin and navigate to `/admin/workspaces`.
2. Click "Export CSV" with no search/plan filter applied. Confirm a file named `workspaces-<today>.csv` downloads (check the browser's download list or network panel).
3. Read the downloaded file's first two lines (e.g. via a terminal `head -2` on the download location) and confirm: the header row matches `WORKSPACE_EXPORT_COLUMNS`' labels in order, and the first data row has non-empty `Workspace`/`Owner Email` cells for a workspace known to have an owner.
4. Type a search term that matches zero workspaces, click "Export CSV" again, and confirm a "Nothing to export" toast appears with no file download.
5. Check the browser console (`read_console_messages`) for errors during both actions.

- [ ] **Step 5: Manual browser verification — Dashboard export**

In the browser, navigate to `/admin` (Dashboard):
1. Click "Export CSV" on the "Paying Workspaces" card. Confirm `paying-workspaces-<today>.csv` downloads, and its header row matches `PAYING_WORKSPACE_EXPORT_COLUMNS`.
2. Click "Export CSV" on the "Trials" card. Confirm `trials-<today>.csv` downloads, and its header row matches `TRIAL_EXPORT_COLUMNS`.
3. If either card is currently empty (no paying workspaces or no trials), confirm the "Nothing to export" toast appears instead of an empty file.
4. Check the browser console for errors.

- [ ] **Step 6: Re-verify the migration timestamp before opening the PR**

```bash
git ls-tree origin/main:supabase/migrations | tail -5
```
Confirm `20260825000001_admin_list_workspaces_deterministic_owner.sql` (or whatever number Task 1 Step 1 settled on) still doesn't collide with anything merged to `main` since this branch started. Rename and re-commit if it now does.

- [ ] **Step 7: Final commit if formatting or verification produced any diffs**

```bash
git status
git add -A
git commit -m "chore(admin): format fixes from data-export verification sweep"
```
(Skip this commit if `git status` shows a clean tree.)
