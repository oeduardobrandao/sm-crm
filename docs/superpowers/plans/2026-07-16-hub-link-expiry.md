# Hub Link Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an in-use Hub link incapable of expiring, and give the CRM a way to rotate a link and to rescue a lapsed one.

**Architecture:** Replace the fixed-date expiry model with a sliding window. One SQL function (`hub_token_touch`) is called from the single `hub-bootstrap` chokepoint on each client visit and pushes `expires_at` forward, throttled and guarded entirely in its `WHERE` clause. Two further SQL functions (`hub_token_rotate`, `hub_token_extend`) are called from the CRM as in-place `UPDATE`s, deliberately avoiding `INSERT` so the `BEFORE INSERT` plan-limit trigger never fires. The CRM finally selects `expires_at` so it can render a link's real state.

**Tech Stack:** Postgres (plpgsql/sql functions, RLS, pgTAP-style psql assertions), Deno edge functions, React 19 + TanStack Query, shadcn/ui, date-fns, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-07-16-hub-link-expiry-design.md`

## Global Constraints

- **Sliding window = `365 days`.** Throttle threshold = `350 days`. These two numbers appear in `hub_token_touch`, `hub_token_rotate`, `hub_token_extend`. Do not introduce a third duration.
- **`IS DISTINCT FROM` is mandatory** in every ownership check. `get_my_conta_id()` returns a **nullable scalar uuid** (`profiles.active_workspace_id`). `<>` and `NOT IN` evaluate to NULL for a NULL workspace, the `IF` never fires, and a `SECURITY DEFINER` function then mutates any workspace's token. This is a security hole, not a style preference.
- **Never write a token value into `audit_log`.** `audit_log` is SELECT-able by every owner/admin in the workspace; a token is a bearer credential.
- **`touchToken` must never throw and never block the response.** Wrap in a timeout AND a catch. This repo has edge-runtime I/O hangs that kill the isolate with no logs.
- **Reference for `get_my_conta_id` is `supabase/migrations/20260315_rls_security_audit.sql:11`.** `supabase/hotfix_recursion.sql` contains a stale, contradictory definition (`SELECT conta_id`) and was never applied as a migration — ignore it.
- **pgTAP files must live in `supabase/tests/entitlements/`.** `scripts/test-entitlements.sh` (`npm run test:db`) scans only that directory; a file placed elsewhere silently never runs.
- **Project refs:** prod = `skjzpekeqefvlojenfsw`, staging = `wlyzhyfondykzpsiqsce`. This checkout is currently linked to **staging**. `cat supabase/.temp/project-ref` returns a bare ref with no env label — always translate it before acting.
- Portuguese UI copy. `toast()` from `sonner`. Icons from `lucide-react` only.

**Deviation from spec (intentional):** the spec named a single migration `20260716000001_hub_token_lifecycle.sql`. This plan uses two migrations (`...000001_hub_token_touch.sql`, `...000002_hub_token_rotate_extend.sql`) so Task 1 and Task 2 are each independently testable and committable. Both are additive; the split has no runtime effect.

---

### Task 1: `hub_token_touch` — the sliding window

**Files:**
- Create: `supabase/migrations/20260716000001_hub_token_touch.sql`
- Create: `supabase/tests/entitlements/30_hub_token_touch.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.hub_token_touch(p_token uuid) returns void`. Task 3 calls this via `db.rpc('hub_token_touch', { p_token })`.

- [ ] **Step 1: Write the failing test**

Create `supabase/tests/entitlements/30_hub_token_touch.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint;
  v_tok uuid; v_before timestamptz; v_after timestamptz;
begin
  v_ws := et_make_workspace('start');
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- CASE 1: inside the window -> renews to ~365d
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '10 days')
    returning token into v_tok;
  perform hub_token_touch(v_tok);
  select expires_at into v_after from client_hub_tokens where token = v_tok;
  assert v_after > now() + interval '364 days',
    'touch must renew a token inside the window';

  -- CASE 2: already expired -> must NOT resurrect
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() - interval '1 day')
    returning token into v_tok;
  select expires_at into v_before from client_hub_tokens where token = v_tok;
  perform hub_token_touch(v_tok);
  select expires_at into v_after from client_hub_tokens where token = v_tok;
  assert v_after = v_before,
    'touch must NEVER resurrect an expired token';

  -- CASE 3: outside the throttle -> must NOT write
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '360 days')
    returning token into v_tok;
  select expires_at into v_before from client_hub_tokens where token = v_tok;
  perform hub_token_touch(v_tok);
  select expires_at into v_after from client_hub_tokens where token = v_tok;
  assert v_after = v_before,
    'touch must not write when expires_at is beyond the 350d throttle';

  -- CASE 4: unknown token -> no error, no rows
  perform hub_token_touch(gen_random_uuid());

  raise notice 'PASS 30_hub_token_touch';
end $$;
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Start the local DB if it isn't running: `npx supabase start`

Run: `npm run test:db`

Expected: FAIL on `30_hub_token_touch.sql` with `function hub_token_touch(uuid) does not exist`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/migrations/20260716000001_hub_token_touch.sql`:

```sql
-- Sliding-window renewal for Hub links.
--
-- Called once per client visit from hub-bootstrap. Both guards live in the WHERE
-- clause so there is no read-then-write race and no branching in the edge function:
--   expires_at > now()                       -> never resurrect a dead link
--   expires_at < now() + interval '350 days' -> throttle to ~1 write / 15 days
--
-- Context: migration 20260417000002 capped every legacy token with a single UPDATE,
-- so one now() evaluation gave them all the same expiry and they died together on
-- 2026-07-16. A sliding window makes that class of outage structurally impossible.

create or replace function public.hub_token_touch(p_token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update client_hub_tokens
     set expires_at = now() + interval '365 days'
   where token = p_token
     and expires_at > now()
     and expires_at < now() + interval '350 days';
$$;

revoke all on function public.hub_token_touch(uuid) from public, anon, authenticated;
grant execute on function public.hub_token_touch(uuid) to service_role;
```

Note the `revoke`/`grant`: only `hub-bootstrap` (service-role) may call this. Leaving it executable by `anon` would let anyone holding a token keep it alive forever from the browser.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset` (applies the new migration to the local DB), then `npm run test:db`

Expected: PASS — `NOTICE: PASS 30_hub_token_touch`, and the script exits 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716000001_hub_token_touch.sql supabase/tests/entitlements/30_hub_token_touch.sql
git commit -m "feat(hub): add hub_token_touch sliding-window renewal"
```

---

### Task 2: `hub_token_rotate` + `hub_token_extend`

**Files:**
- Create: `supabase/migrations/20260716000002_hub_token_rotate_extend.sql`
- Create: `supabase/tests/entitlements/31_hub_token_rotate_extend.sql`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `public.hub_token_rotate(p_token_id uuid) returns table (token uuid, expires_at timestamptz)`
  - `public.hub_token_extend(p_token_id uuid) returns timestamptz`

  Task 4 calls both via `supabase.rpc(name, { p_token_id })`.

- [ ] **Step 1: Write the failing test**

This test establishes a pattern that does not yet exist in this repo: impersonating a user so `auth.uid()` resolves inside `get_my_conta_id()`. It works by setting `request.jwt.claims` locally in the transaction.

Create `supabase/tests/entitlements/31_hub_token_rotate_extend.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_ws uuid; v_ws2 uuid;
  v_owner uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_nullu uuid := gen_random_uuid();
  v_cli bigint; v_tid uuid; v_old_tok uuid; v_new_tok uuid;
  v_count_before bigint; v_count_after bigint;
  v_exp timestamptz; v_denied boolean; v_audit bigint;
begin
  v_ws  := et_make_workspace('start');
  v_ws2 := et_make_workspace('start');

  insert into auth.users (id) values (v_owner), (v_other), (v_nullu);
  -- owner of v_ws; other belongs to v_ws2; nullu has a NULL active_workspace_id
  insert into profiles (id, conta_id, active_workspace_id, role)
    values (v_owner, v_ws,  v_ws,  'owner'),
           (v_other, v_ws2, v_ws2, 'owner'),
           (v_nullu, v_ws,  null,  'owner');

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into client_hub_tokens (cliente_id, conta_id, expires_at)
    values (v_cli, v_ws, now() + interval '10 days')
    returning id, token into v_tid, v_old_tok;

  -- ---- act as the legitimate owner ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner)::text, true);

  select count(*) into v_count_before from client_hub_tokens;
  select token into v_new_tok from hub_token_rotate(v_tid);
  select count(*) into v_count_after from client_hub_tokens;

  assert v_new_tok <> v_old_tok, 'rotate must change the token value';
  assert v_count_after = v_count_before,
    'rotate must NOT insert a row (would burn max_hub_tokens quota)';

  select expires_at into v_exp from client_hub_tokens where id = v_tid;
  assert v_exp > now() + interval '364 days', 'rotate must reset expires_at to 365d';

  -- extend
  update client_hub_tokens set expires_at = now() - interval '1 day' where id = v_tid;
  select hub_token_extend(v_tid) into v_exp;
  assert v_exp > now() + interval '364 days', 'extend must revive a lapsed token to 365d';

  -- audit rows written, and NO token value leaked into them
  select count(*) into v_audit from audit_log
   where resource_id = v_tid::text and action in ('hub_token.rotate','hub_token.extend');
  assert v_audit = 2, 'rotate and extend must each write an audit_log row';

  select count(*) into v_audit from audit_log
   where resource_id = v_tid::text
     and (metadata::text like '%' || v_old_tok::text || '%'
       or metadata::text like '%' || v_new_tok::text || '%');
  assert v_audit = 0, 'audit_log metadata must never contain a token value';

  -- ---- act as a user from ANOTHER workspace ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other)::text, true);
  v_denied := false;
  begin perform hub_token_rotate(v_tid);
  exception when others then v_denied := true; end;
  assert v_denied, 'a foreign workspace must not rotate this token';

  -- ---- act as a user whose active_workspace_id IS NULL ----
  -- REGRESSION TEST for the IS DISTINCT FROM trap: with `<>` or `NOT IN`, the
  -- comparison yields NULL, the IF never fires, and this rotate SUCCEEDS.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_nullu)::text, true);
  v_denied := false;
  begin perform hub_token_rotate(v_tid);
  exception when others then v_denied := true; end;
  assert v_denied, 'a NULL active_workspace_id must not rotate any token';

  raise notice 'PASS 31_hub_token_rotate_extend';
end $$;
rollback;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:db`

Expected: FAIL on `31_hub_token_rotate_extend.sql` with `function hub_token_rotate(uuid) does not exist`.

- [ ] **Step 3: Write minimal implementation**

Create `supabase/migrations/20260716000002_hub_token_rotate_extend.sql`:

```sql
-- CRM-facing Hub token lifecycle actions.
--
-- Both are a single UPDATE and never INSERT. trg_limit_hub_tokens is BEFORE INSERT
-- and counts EVERY row for the workspace with no status predicate, so a
-- rotate-by-INSERT would permanently burn a max_hub_tokens slot per rotation and
-- eventually fail with plan_limit_exceeded — a billing error for a security action.
--
-- SECURITY DEFINER is required so the functions can write audit_log (which accepts
-- service-role inserts only). That bypasses RLS, so ownership is checked by hand.
--
-- get_my_conta_id() returns profiles.active_workspace_id — a NULLABLE scalar uuid
-- (20260315_rls_security_audit.sql:11). IS DISTINCT FROM is mandatory: with `<>` or
-- `NOT IN`, a NULL workspace makes the predicate NULL, the IF never fires, and any
-- caller could mutate any workspace's token.

create or replace function public.hub_token_rotate(p_token_id uuid)
returns table (token uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta_id uuid;
  v_cliente_id bigint;
  v_old_expires timestamptz;
begin
  select t.conta_id, t.cliente_id, t.expires_at
    into v_conta_id, v_cliente_id, v_old_expires
    from client_hub_tokens t where t.id = p_token_id;

  if v_conta_id is null then raise exception 'not_found'; end if;
  if v_conta_id is distinct from public.get_my_conta_id() then
    raise exception 'forbidden';
  end if;

  update client_hub_tokens t
     set token = gen_random_uuid(),
         expires_at = now() + interval '365 days'
   where t.id = p_token_id
  returning t.token, t.expires_at into token, expires_at;

  insert into audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_conta_id, auth.uid(), 'hub_token.rotate', 'client_hub_tokens', p_token_id::text,
          jsonb_build_object('cliente_id', v_cliente_id,
                             'old_expires_at', v_old_expires,
                             'new_expires_at', expires_at));

  return next;
end;
$$;

create or replace function public.hub_token_extend(p_token_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta_id uuid;
  v_cliente_id bigint;
  v_old_expires timestamptz;
  v_new_expires timestamptz;
begin
  select t.conta_id, t.cliente_id, t.expires_at
    into v_conta_id, v_cliente_id, v_old_expires
    from client_hub_tokens t where t.id = p_token_id;

  if v_conta_id is null then raise exception 'not_found'; end if;
  if v_conta_id is distinct from public.get_my_conta_id() then
    raise exception 'forbidden';
  end if;

  update client_hub_tokens t
     set expires_at = now() + interval '365 days'
   where t.id = p_token_id
  returning t.expires_at into v_new_expires;

  insert into audit_log (conta_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_conta_id, auth.uid(), 'hub_token.extend', 'client_hub_tokens', p_token_id::text,
          jsonb_build_object('cliente_id', v_cliente_id,
                             'old_expires_at', v_old_expires,
                             'new_expires_at', v_new_expires));

  return v_new_expires;
end;
$$;

revoke all on function public.hub_token_rotate(uuid) from public, anon;
revoke all on function public.hub_token_extend(uuid) from public, anon;
grant execute on function public.hub_token_rotate(uuid) to authenticated;
grant execute on function public.hub_token_extend(uuid) to authenticated;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx supabase db reset && npm run test:db`

Expected: PASS — `NOTICE: PASS 31_hub_token_rotate_extend`, exit 0.

To prove the NULL test has teeth, temporarily change `is distinct from` to `<>` and re-run: the NULL-workspace assertion must FAIL. Restore `is distinct from` afterwards.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260716000002_hub_token_rotate_extend.sql supabase/tests/entitlements/31_hub_token_rotate_extend.sql
git commit -m "feat(hub): add hub_token_rotate + hub_token_extend with NULL-safe ownership checks"
```

---

### Task 3: Call `hub_token_touch` from `hub-bootstrap`

**Files:**
- Modify: `supabase/functions/hub-bootstrap/handler.ts`
- Modify: `supabase/functions/hub-bootstrap/index.ts`
- Test: `supabase/functions/__tests__/hub-bootstrap_test.ts` (create if absent)

**Interfaces:**
- Consumes: `hub_token_touch(p_token uuid)` from Task 1.
- Produces: `HubBootstrapHandlerDeps` gains `touchToken: (token: string) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create/extend `supabase/functions/__tests__/hub-bootstrap_test.ts`:

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHubBootstrapHandler } from "../hub-bootstrap/handler.ts";

const cors = () => ({});
const NOW = "2026-07-16T12:00:00.000Z";
const TOKEN = "49ded0d7-0c34-4b88-8a60-f9d459113f3c";

function makeDb(tokenRow: unknown) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
          maybeSingle: async () => ({
            data: table === "workspaces"
              ? { id: "ws-1", name: "WS", logo_url: null, brand_color: "#111", hub_enabled: true }
              : tokenRow,
          }),
          gt: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
            maybeSingle: async () => ({ data: tokenRow }),
          }),
          single: async () => ({ data: { nome: "Vanessa" } }),
        }),
      }),
      // effective_plan_feature is reached through rpc, below
    }),
    rpc: async () => ({ data: true, error: null }),
  };
}

const req = () =>
  new Request(`https://x/?workspace=dk-marketing-medico&token=${TOKEN}`, { method: "GET" });

Deno.test("touchToken is called when the token resolves", async () => {
  const calls: string[] = [];
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async (t: string) => { calls.push(t); },
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  assertEquals(calls, [TOKEN]);
});

Deno.test("touchToken is NOT called when the token does not resolve", async () => {
  const calls: string[] = [];
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb(null) as any,
    now: () => NOW,
    touchToken: async (t: string) => { calls.push(t); },
  });
  const res = await handler(req());
  assertEquals(res.status, 404);
  assertEquals(calls, []);
});

Deno.test("a throwing touchToken must NOT break the client's portal", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async () => { throw new Error("renewal exploded"); },
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:functions -- --filter hub-bootstrap`

Expected: FAIL — `touchToken` is not a property of `HubBootstrapHandlerDeps` (type error / undefined call).

- [ ] **Step 3: Write minimal implementation**

In `supabase/functions/hub-bootstrap/handler.ts`, add to the deps interface:

```ts
interface HubBootstrapHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  /** Sliding-window renewal. MUST NOT throw — a renewal failure must never
   *  break the client's portal. See index.ts for the timeout + catch wrapper. */
  touchToken: (token: string) => Promise<void>;
}
```

And immediately after the token resolves (replacing the existing `if (!hubToken) ...` block's follow-on):

```ts
    const hubToken = await resolveHubToken(db as any, token, deps.now(), conta.id);
    if (!hubToken) return json({ error: "Link inválido." }, 404);

    // Sliding window: keep an in-use link alive. Throttled inside the SQL function.
    // Defence in depth — index.ts already swallows errors, but a handler-level catch
    // guarantees no renewal fault can ever reach the client.
    try {
      await deps.touchToken(token);
    } catch {
      // intentionally ignored
    }
```

In `supabase/functions/hub-bootstrap/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createHubBootstrapHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOUCH_TIMEOUT_MS = 1500;

Deno.serve(createHubBootstrapHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  // The edge runtime can hang on I/O and kill the isolate with no error logs, so this
  // is bounded by an explicit timeout as well as a catch.
  touchToken: async (token: string) => {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await Promise.race([
      db.rpc("hub_token_touch", { p_token: token }),
      new Promise((resolve) => setTimeout(resolve, TOUCH_TIMEOUT_MS)),
    ]);
  },
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:functions -- --filter hub-bootstrap`

Expected: PASS — all three tests green.

Then run the whole suite to catch contract breaks in sibling hub tests:
Run: `npm run test:functions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-bootstrap/handler.ts supabase/functions/hub-bootstrap/index.ts supabase/functions/__tests__/hub-bootstrap_test.ts
git commit -m "feat(hub): renew hub token on each client visit via hub-bootstrap"
```

---

### Task 4: Store layer — `expires_at`, extend, rotate

**Files:**
- Modify: `apps/crm/src/store/hub.ts:75-98`
- Test: `apps/crm/src/__tests__/store.hub.test.ts`

**Interfaces:**
- Consumes: `hub_token_rotate`, `hub_token_extend` from Task 2.
- Produces:
  - `getHubToken(clienteId: number): Promise<{ id: string; token: string; is_active: boolean; expires_at: string } | null>`
  - `extendHubToken(tokenId: string): Promise<string>`
  - `rotateHubToken(tokenId: string): Promise<{ token: string; expires_at: string }>`

  Task 5 consumes all three.

- [ ] **Step 1: Write the failing test**

Add to `apps/crm/src/__tests__/store.hub.test.ts` (match the file's existing mock style for `supabase`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getHubToken, extendHubToken, rotateHubToken } from '../store/hub';
import { supabase } from '../store/core';

vi.mock('../store/core', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  getContaId: vi.fn(),
  getUserId: vi.fn(),
}));

describe('hub token lifecycle', () => {
  beforeEach(() => vi.resetAllMocks());

  it('getHubToken selects expires_at', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 't1', token: 'tok', is_active: true, expires_at: '2027-07-16T10:00:00Z' },
    });
    const select = vi.fn().mockReturnValue({
      eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }),
    });
    (supabase.from as any).mockReturnValue({ select });

    const row = await getHubToken(15);
    expect(select).toHaveBeenCalledWith('id, token, is_active, expires_at');
    expect(row?.expires_at).toBe('2027-07-16T10:00:00Z');
  });

  it('extendHubToken calls the hub_token_extend rpc', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: '2027-07-16T10:00:00Z', error: null });
    const out = await extendHubToken('t1');
    expect(supabase.rpc).toHaveBeenCalledWith('hub_token_extend', { p_token_id: 't1' });
    expect(out).toBe('2027-07-16T10:00:00Z');
  });

  it('rotateHubToken calls the hub_token_rotate rpc and returns the new token', async () => {
    (supabase.rpc as any).mockResolvedValue({
      data: [{ token: 'new-tok', expires_at: '2027-07-16T10:00:00Z' }], error: null,
    });
    const out = await rotateHubToken('t1');
    expect(supabase.rpc).toHaveBeenCalledWith('hub_token_rotate', { p_token_id: 't1' });
    expect(out.token).toBe('new-tok');
  });

  it('rotateHubToken throws on rpc error', async () => {
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    await expect(rotateHubToken('t1')).rejects.toThrow('forbidden');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- store.hub`

Expected: FAIL — `extendHubToken is not a function`, and the `getHubToken` select assertion fails because it currently requests `'id, token, is_active'`.

- [ ] **Step 3: Write minimal implementation**

In `apps/crm/src/store/hub.ts`, replace `getHubToken` and append the two new functions:

```ts
export interface HubTokenRow {
  id: string;
  token: string;
  is_active: boolean;
  /** Sliding-window expiry. Renewed on each client visit by hub_token_touch. */
  expires_at: string;
}

export async function getHubToken(clienteId: number) {
  const { data } = await supabase
    .from('client_hub_tokens')
    .select('id, token, is_active, expires_at')
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as HubTokenRow | null;
}

/** Revives a lapsed link, preserving its URL. Rescue only — auto-renew covers normal use. */
export async function extendHubToken(tokenId: string): Promise<string> {
  const { data, error } = await supabase.rpc('hub_token_extend', { p_token_id: tokenId });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Issues a new token in place. The previous URL stops working immediately. */
export async function rotateHubToken(
  tokenId: string,
): Promise<{ token: string; expires_at: string }> {
  const { data, error } = await supabase.rpc('hub_token_rotate', { p_token_id: tokenId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return row as { token: string; expires_at: string };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- store.hub`
Expected: PASS — 4 tests green.

Run: `npm run build`
Expected: `tsc` clean (the `HubTokenRow` type change must not break `HubTab`).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/hub.ts apps/crm/src/__tests__/store.hub.test.ts
git commit -m "feat(crm): expose expires_at and add extend/rotate hub token actions"
```

---

### Task 5: Acesso tab — expiry visibility, rotate, rescue

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx:126-216`
- Test: `apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `getHubToken` (now returning `expires_at`), `extendHubToken`, `rotateHubToken` from Task 4.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx`. Mirror the mocking conventions already used by the CRM's other page tests (mock `../../../store/hub`, wrap in a `QueryClientProvider`).

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HubTab } from '../HubTab';
import * as hubStore from '../../../store/hub';

vi.mock('../../../store/hub');

const DAY = 86_400_000;
const token = (expiresInDays: number) => ({
  id: 't1', token: 'tok-1', is_active: true,
  expires_at: new Date(Date.now() + expiresInDays * DAY).toISOString(),
});

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HubTab clienteId={15} contaId="ws-1" workspaceSlug="dk-marketing-medico" />
    </QueryClientProvider>,
  );
}

describe('HubTab — Acesso', () => {
  beforeEach(() => vi.resetAllMocks());

  it('shows a healthy link with no Estender button', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    renderTab();
    await waitFor(() => expect(screen.getByText(/Expira em/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Estender/ })).not.toBeInTheDocument();
  });

  it('shows Estender when the link is near expiry', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(12));
    renderTab();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Estender/ })).toBeInTheDocument());
  });

  it('shows the Expirado badge and Estender when lapsed', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(-1));
    renderTab();
    await waitFor(() => expect(screen.getByText('Expirado')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Estender/ })).toBeInTheDocument();
  });

  it('does not rotate until the confirm dialog is accepted', async () => {
    vi.mocked(hubStore.getHubToken).mockResolvedValue(token(360));
    vi.mocked(hubStore.rotateHubToken).mockResolvedValue({
      token: 'tok-2', expires_at: new Date(Date.now() + 365 * DAY).toISOString(),
    });
    renderTab();
    await waitFor(() => screen.getByRole('button', { name: /Gerar novo link/ }));

    await userEvent.click(screen.getByRole('button', { name: /Gerar novo link/ }));
    expect(hubStore.rotateHubToken).not.toHaveBeenCalled();  // dialog open, not confirmed

    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(hubStore.rotateHubToken).toHaveBeenCalledWith('t1'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- HubTab`

Expected: FAIL — no `Expira em` text, no `Estender` / `Gerar novo link` buttons exist.

- [ ] **Step 3: Write minimal implementation**

In `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`, add imports:

```tsx
import { differenceInCalendarDays, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { RefreshCw, CalendarClock } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { extendHubToken, rotateHubToken } from '@/store/hub';
```

Add derived state and handlers inside the component, next to the existing `hubUrl`:

```tsx
  const expiresAt = tokenData ? new Date(tokenData.expires_at) : null;
  const daysLeft = expiresAt ? differenceInCalendarDays(expiresAt, new Date()) : null;
  const isExpired = daysLeft !== null && daysLeft < 0;
  const isNearExpiry = daysLeft !== null && daysLeft >= 0 && daysLeft <= 30;
  // Auto-renew throttles at 350d, so a live link never lands in this range.
  // The rescue only surfaces for genuinely dormant clients.
  const showRescue = isExpired || isNearExpiry;

  async function handleExtend() {
    if (!tokenData) return;
    try {
      await extendHubToken(tokenData.id);
      qc.invalidateQueries({ queryKey: ['hub-token', clienteId] });
      toast.success('Link renovado por mais 1 ano.');
    } catch (e: any) {
      toast.error(mapTokenError(e));
    }
  }

  async function handleRotate() {
    if (!tokenData) return;
    try {
      await rotateHubToken(tokenData.id);
      qc.invalidateQueries({ queryKey: ['hub-token', clienteId] });
      toast.success('Novo link gerado. Envie-o ao cliente — o anterior parou de funcionar.');
    } catch (e: any) {
      toast.error(mapTokenError(e));
    }
  }
```

Add this helper at module scope (below the imports). Raw Postgres text must never reach the user:

```tsx
function mapTokenError(e: { message?: string }): string {
  const m = e?.message ?? '';
  if (m.includes('forbidden')) return 'Sem permissão para este cliente.';
  if (m.includes('not_found')) return 'Link não encontrado.';
  return 'Não foi possível concluir a ação.';
}
```

Insert the status line directly beneath the existing `<code>{hubUrl}</code>` row's closing `</div>` (still inside the `tokenData ?` branch), and the two buttons into the existing button row:

```tsx
              {expiresAt && (
                <p
                  className={
                    isExpired
                      ? 'w-full text-xs font-medium text-destructive'
                      : isNearExpiry
                        ? 'w-full text-xs font-medium text-amber-600'
                        : 'w-full text-xs text-muted-foreground'
                  }
                >
                  <CalendarClock size={12} className="mr-1 inline" />
                  {isExpired ? (
                    <>
                      <span className="mr-1.5 rounded bg-destructive/10 px-1.5 py-0.5 uppercase">
                        Expirado
                      </span>
                      Expirou em {format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })}
                    </>
                  ) : isNearExpiry ? (
                    <>Expira em {daysLeft} dias ({format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })})</>
                  ) : (
                    <>Expira em {format(expiresAt, 'dd/MM/yyyy', { locale: ptBR })}</>
                  )}
                </p>
              )}

              {showRescue && (
                <Button size="sm" variant="outline" onClick={handleExtend}>
                  <CalendarClock size={14} className="mr-1.5" /> Estender +1 ano
                </Button>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive">
                    <RefreshCw size={14} className="mr-1.5" /> Gerar novo link
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Gerar um novo link?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O link atual para de funcionar imediatamente. O cliente perde o acesso
                      até você enviar o novo link. Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={handleRotate}>Confirmar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
```

`@/components/ui/alert-dialog` already exists in this repo
(`apps/crm/src/components/ui/alert-dialog.tsx`) — verified 2026-07-16. Do not re-add it
via shadcn; that would overwrite the existing component.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- HubTab`
Expected: PASS — 4 tests green.

Run: `npm run build`
Expected: `tsc` clean, vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/HubTab.tsx apps/crm/src/pages/cliente-detalhe/__tests__/HubTab.test.tsx
git commit -m "feat(crm): show hub link expiry and add rotate + rescue actions"
```

---

### Task 6: Full verification and deploy

**Files:** none modified.

- [ ] **Step 1: Run every suite**

```bash
npm run format          # CI enforces prettier despite CLAUDE.md saying otherwise
npm run lint            # CI enforces eslint
npm run test            # vitest
npm run test:functions  # deno
npm run test:db         # pgTAP
npm run build           # tsc + vite
```

Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Confirm the deploy target**

```bash
cat supabase/.temp/project-ref
```

This prints a bare ref with **no environment label**. Translate it: `skjzpekeqefvlojenfsw` = **prod**, `wlyzhyfondykzpsiqsce` = **staging**. Do not proceed until it matches your intent. Switch with `npm run db:link:staging` or `npm run db:link:prod` and re-run the `cat` to verify — a successful `link` does not echo the environment back.

- [ ] **Step 3: Staging first — migrations, then function**

```bash
npm run db:link:staging
cat supabase/.temp/project-ref          # must print wlyzhyfondykzpsiqsce
npx supabase migration list --linked
npx supabase db push --linked --dry-run # confirm ONLY 20260716000001/2 are pending
npx supabase db push --linked
npx supabase functions deploy hub-bootstrap --project-ref wlyzhyfondykzpsiqsce --use-api
```

`db push` applies **every** migration missing from the target's history, not just yours — the dry run is what catches an unexpected backlog. `--use-api` is required because the local Docker bundler is broken in this repo.

- [ ] **Step 4: Verify on staging before touching prod**

Open a staging Hub link. Then confirm the renewal actually fired:

```sql
select token, expires_at, (expires_at > now() + interval '360 days') as renovado
from client_hub_tokens where token = '<the token you opened>';
```

Expected: `renovado = true`. Then set it beyond the throttle and confirm no write:

```sql
update client_hub_tokens set expires_at = now() + interval '360 days' where token = '<token>';
-- reload the Hub page, then:
select expires_at from client_hub_tokens where token = '<token>';  -- must be unchanged
```

- [ ] **Step 5: Prod**

```bash
npm run db:link:prod
cat supabase/.temp/project-ref          # must print skjzpekeqefvlojenfsw
npx supabase migration list --linked
npx supabase db push --linked --dry-run
npx supabase db push --linked
npx supabase functions deploy hub-bootstrap --project-ref skjzpekeqefvlojenfsw --use-api
```

Order matters: migrations first. `hub-bootstrap` calls `hub_token_touch`, so deploying the function before the migration would make every bootstrap log a failed RPC (harmless — it's swallowed — but it would mean no renewal happens).

If `db push --dry-run` shows unexpected pending migrations, stop and fall back to applying only these two via the SQL editor, then record them:

```sql
insert into supabase_migrations.schema_migrations (version)
values ('20260716000001'), ('20260716000002') on conflict do nothing;
```

- [ ] **Step 6: Verify on prod with the real client**

```sql
select c.nome, t.expires_at, (t.expires_at > now()) as valido
from client_hub_tokens t join clientes c on c.id = t.cliente_id
where c.id = 15;
```

Have Vanessa load her link, then re-run. Her `expires_at` should be **unchanged** — she sits at ~2027-07-16, which is beyond the 350d throttle, so `hub_token_touch` correctly does nothing. That is the throttle working, not a failure.

To prove renewal on prod, use a client whose token is inside the window, or confirm via the staging check in Step 4.

- [ ] **Step 7: Commit**

Nothing to commit. Open the PR:

```bash
git push -u origin claude/dk-marketing-link-expirado-d0ec2a
gh pr create --title "fix(hub): sliding-window link expiry + rotate/rescue actions" --body "$(cat <<'EOF'
## Why

A DK Marketing Médico client hit "Link inválido ou expirado" on 2026-07-16. Root cause: migration `20260417000002` (VULN-005) ran at 2026-04-17 10:54:01 and capped every legacy hub token with a **single** `UPDATE` — one `now()` evaluation, so every legacy token in the database got the identical expiry and they all died together at 10:54 UTC today. The reported client was simply the first to click.

Deactivate/reactivate could never have helped: `setHubTokenActive` writes only `is_active`, which is orthogonal to expiry. And nobody could see it coming because `getHubToken` never selected `expires_at`.

Prod was already remediated out-of-band (cohort extended +365d, all URLs preserved). This PR removes the failure mode.

## What

- `hub_token_touch` — sliding window, called once per client visit from `hub-bootstrap`. Both guards live in the `WHERE` clause: never resurrects a dead link, throttles to ~1 write/15 days. An in-use link can no longer expire, and the new 2027-07-16 cohort cliff dissolves as clients visit at their own times.
- `hub_token_rotate` / `hub_token_extend` — in-place `UPDATE`s. Deliberately not `INSERT`s: `trg_limit_hub_tokens` is `BEFORE INSERT` and counts all rows, so rotate-by-insert would permanently burn `max_hub_tokens` quota and eventually fail with `plan_limit_exceeded`.
- CRM Acesso tab shows real expiry state; rotate is behind a confirm dialog; the rescue extend appears only for lapsed/near-lapsed links.

## Security notes

Both CRM RPCs are `SECURITY DEFINER` (required to write `audit_log`, which takes service-role inserts only), so ownership is checked by hand with `IS DISTINCT FROM`. `get_my_conta_id()` returns a **nullable** scalar; `<>` or `NOT IN` would yield NULL for a NULL `active_workspace_id`, skip the check, and let that caller mutate any workspace's token. There is a dedicated pgTAP regression test for exactly that case. No token value is ever written to `audit_log`.

## Test plan

- pgTAP: renewal/throttle/never-resurrect; rotate changes token with row-count unchanged (quota untouched); `forbidden` for a foreign workspace AND for a NULL `active_workspace_id`; audit rows written with no token leakage
- Deno: touch called on success, not on failure, and a throwing touch still returns 200
- Vitest/RTL: `expires_at` plumbed through; the three colour states; rotate gated behind confirm

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Plan self-review

**Spec coverage:** auto-renew → Task 1 + 3. Rotate → Task 2 + 5. Rescue extend → Task 2 + 5. `expires_at` visibility → Task 4 + 5. Audit → Task 2. Error mapping → Task 5. Deployment notes → Task 6. Every spec section maps to a task.

**Placeholder scan:** no TBD/TODO; every code step carries complete code; no "similar to Task N".

**Type consistency:** `HubTokenRow.expires_at: string` (Task 4) is consumed as `new Date(tokenData.expires_at)` in Task 5. `hub_token_rotate` returns `table(token, expires_at)` (Task 2) → `data[0]` unwrapped in Task 4 → `{ token, expires_at }` in Task 5. `touchToken: (token: string) => Promise<void>` matches between the deps interface and `index.ts` (Task 3). `p_token` (touch) vs `p_token_id` (rotate/extend) is intentional — touch keys on the token value, the CRM RPCs key on the row id.

**Known gap carried from the spec:** roster-wide discovery is out of scope by explicit decision. A client who never visits still lapses silently and is found only when they call; the rescue makes that a seconds-long fix.
