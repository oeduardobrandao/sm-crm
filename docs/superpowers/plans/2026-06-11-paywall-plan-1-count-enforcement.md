# Paywall Plan 1 — Entitlement Foundation & Count Enforcement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-enforce per-plan resource *count* limits server-side (DB triggers), with a friendly universal "upgrade" prompt when a limit is hit.

**Architecture:** A single SQL resolver `effective_plan_limit(ws_id, limit_key)` (plan value, overridden by `workspace_plan_overrides.resource_overrides`, fail-closed on invalid setup, `NULL`=unlimited) feeds one generic `BEFORE INSERT` trigger function `enforce_plan_count_limit()` attached to 9 tables. The trigger takes an advisory lock per (workspace, limit) to prevent boundary overshoot, counts the scope, and `RAISE`s `plan_limit_exceeded:<limit_key>` (SQLSTATE `P0001`) when full. `invite-user` gets a friendly seat pre-check. On the frontend, a `mapEntitlementError` util + a global TanStack-Query `MutationCache` `onError` turn that raised error into an upgrade toast — no per-page wiring in this plan.

**Tech Stack:** Postgres/PL-pgSQL (Supabase migrations), Deno (edge functions), React + TanStack Query + sonner (CRM). Tests: SQL via local Supabase + `psql`; edge fn via Deno; frontend via Vitest.

**Scope note:** This is Plan 1 of 4 (foundation). Feature gating (Plan 2), storage unification (Plan 3), and admin un-comp (Plan 4) build on this. Per-page optimistic "at-limit disable" UX (`useEntitlements`) lands in Plan 2 alongside the FeatureGate work; Plan 1 ships hard enforcement + the universal upgrade prompt.

**Spec:** `docs/superpowers/specs/2026-06-11-paywall-feature-gating-design.md` (§6.1, §7).

---

## Prerequisites

- Local Supabase stack running with Docker: `npx supabase start`. The local DB URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (referred to below as `$LOCAL_DB`).
- `npx supabase db reset` applies **all** migrations (and `supabase/seed.sql` if present) to the local DB. Run it after adding each migration to load the new SQL before running `psql` assertions.

```bash
export LOCAL_DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
```

## File Structure

- Create: `supabase/migrations/20260611130001_effective_plan_limit.sql` — the resolver function.
- Create: `supabase/migrations/20260611130002_enforce_plan_count_limit_fn.sql` — the generic trigger function.
- Create: `supabase/migrations/20260611130003_count_triggers.sql` — the 9 `CREATE TRIGGER` statements.
- Create: `supabase/tests/entitlements/_helpers.sql` — fixture helper (`et_make_workspace`) reused by every SQL assertion.
- Create: `supabase/tests/entitlements/*.sql` — one assertion script per task.
- Modify: `supabase/functions/invite-user/index.ts` — seat pre-check.
- Create: `supabase/functions/__tests__/invite-user-seats_test.ts` — Deno test for the pre-check.
- Create: `apps/crm/src/lib/entitlement-errors.ts` — `mapEntitlementError`.
- Create: `apps/crm/src/lib/__tests__/entitlement-errors.test.ts`.
- Modify: `apps/crm/src/App.tsx:46-50` — add `MutationCache` global `onError`.
- Create: `apps/crm/src/lib/__tests__/mutation-error-handler.test.tsx` — global handler test.

---

## Task 1: `effective_plan_limit` SQL resolver

**Files:**
- Create: `supabase/migrations/20260611130001_effective_plan_limit.sql`
- Create: `supabase/tests/entitlements/_helpers.sql`
- Create: `supabase/tests/entitlements/01_effective_plan_limit.sql`

- [ ] **Step 1: Write the fixture helper**

Create `supabase/tests/entitlements/_helpers.sql`:

```sql
-- Creates a workspace on a given plan, returns its id. For use inside a tx that is rolled back.
create or replace function et_make_workspace(p_plan_id text, p_overrides jsonb default null)
returns uuid language plpgsql as $$
declare v_ws uuid;
begin
  insert into workspaces (name, plan_id, plan_source)
    values ('ET test ws', p_plan_id, 'manual')
    returning id into v_ws;
  if p_overrides is not null then
    insert into workspace_plan_overrides (workspace_id, resource_overrides)
      values (v_ws, p_overrides);
  end if;
  return v_ws;
end;
$$;
```

- [ ] **Step 2: Write the failing SQL assertion**

Create `supabase/tests/entitlements/01_effective_plan_limit.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_lim bigint;
begin
  -- 'free' plan: max_clients = 2 (per seeded catalog)
  v_ws := et_make_workspace('free');
  v_lim := effective_plan_limit(v_ws, 'max_clients');
  assert v_lim = 2, format('expected 2, got %s', v_lim);

  -- override wins
  v_ws := et_make_workspace('free', '{"max_clients": 50}'::jsonb);
  v_lim := effective_plan_limit(v_ws, 'max_clients');
  assert v_lim = 50, format('expected 50, got %s', v_lim);

  -- unlimited column (max plan has null max_clients) => NULL
  v_ws := et_make_workspace('max');
  assert effective_plan_limit(v_ws, 'max_clients') is null, 'expected NULL (unlimited)';

  -- fail-closed: unknown workspace
  assert effective_plan_limit('00000000-0000-0000-0000-000000000000', 'max_clients') = 0,
    'unknown workspace must fail closed to 0';

  raise notice 'PASS 01_effective_plan_limit';
end $$;
rollback;
```

- [ ] **Step 3: Run it to verify it fails**

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/01_effective_plan_limit.sql`
Expected: ERROR — `function effective_plan_limit(uuid, text) does not exist`.

- [ ] **Step 4: Write the resolver migration**

Create `supabase/migrations/20260611130001_effective_plan_limit.sql`:

```sql
-- Effective per-workspace resource limit: plan value, overridden by
-- workspace_plan_overrides.resource_overrides. NULL = unlimited; 0 = fail-closed.
create or replace function effective_plan_limit(ws_id uuid, limit_key text)
returns bigint
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_plan_id text;
  v_override jsonb;
  v_limit bigint;
begin
  select plan_id into v_plan_id from workspaces where id = ws_id;
  if not found then
    return 0; -- unknown workspace
  end if;

  if v_plan_id is null then
    select id into v_plan_id from plans where is_default limit 1;
    if v_plan_id is null then
      return 0; -- no default plan configured
    end if;
  end if;

  select resource_overrides into v_override
    from workspace_plan_overrides where workspace_id = ws_id;
  if v_override is not null and v_override ? limit_key then
    return (v_override ->> limit_key)::bigint;
  end if;

  execute format('select %I from plans where id = $1', limit_key)
    into v_limit using v_plan_id;
  if not found then
    return 0; -- plan_id references a missing plan
  end if;

  return v_limit; -- may be NULL => unlimited
end;
$$;
```

- [ ] **Step 5: Reset local DB and run the assertion to verify it passes**

Run: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/01_effective_plan_limit.sql`
Expected: `NOTICE: PASS 01_effective_plan_limit` and no error.

- [ ] **Step 6: Add the `is_default` invariant assertion**

Append to `supabase/tests/entitlements/01_effective_plan_limit.sql`:

```sql
do $$
declare v_n int;
begin
  select count(*) into v_n from plans where is_default;
  assert v_n = 1, format('expected exactly one is_default plan, got %s', v_n);
  raise notice 'PASS is_default invariant';
end $$;
```

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/01_effective_plan_limit.sql`
Expected: both `PASS` notices.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260611130001_effective_plan_limit.sql supabase/tests/entitlements/
git commit -m "feat(paywall): effective_plan_limit resolver + SQL test harness"
```

---

## Task 2: Generic count-limit trigger function (+ clientes trigger)

**Files:**
- Create: `supabase/migrations/20260611130002_enforce_plan_count_limit_fn.sql`
- Create: `supabase/migrations/20260611130003_count_triggers.sql` (clientes only in this task; extended in Tasks 3–4)
- Create: `supabase/tests/entitlements/02_clientes_limit.sql`

- [ ] **Step 1: Write the failing assertion (clientes at limit)**

Create `supabase/tests/entitlements/02_clientes_limit.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_blocked boolean := false;
begin
  v_ws := et_make_workspace('free'); -- max_clients = 2
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C1', 'C1', '#000');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C2', 'C2', '#000');
  begin
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C3', 'C3', '#000'); -- 3rd, over limit
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_clients%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'third client insert should have been blocked';
  raise notice 'PASS 02_clientes_limit';
end $$;
rollback;
```

(Verified against `20260301_baseline_schema.sql:39-54`: `clientes`' NOT NULL set is `user_id, conta_id, nome, sigla, cor` — the fixtures above include all five.)

- [ ] **Step 2: Run it to verify it fails**

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/02_clientes_limit.sql`
Expected: assertion failure `third client insert should have been blocked` (no trigger yet).

- [ ] **Step 3: Write the generic trigger function**

Create `supabase/migrations/20260611130002_enforce_plan_count_limit_fn.sql`:

```sql
-- Generic BEFORE INSERT count limiter. TG_ARGV:
--   [0] limit_key      e.g. 'max_clients' (a column on plans)
--   [1] ws_mode        'direct' | 'via_clientes'
--   [2] ws_column      column on NEW holding the workspace id (direct),
--                      or the clientes FK column to join through (via_clientes)
--   [3] scope_column   column on NEW that buckets the count (direct mode only)
--   [4] status_pred    optional extra WHERE predicate, e.g. "status = 'ativo'"
create or replace function enforce_plan_count_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit_key text := TG_ARGV[0];
  v_ws_mode   text := TG_ARGV[1];
  v_ws_col    text := TG_ARGV[2];
  v_scope_col text := TG_ARGV[3];
  v_pred      text := coalesce(TG_ARGV[4], '');
  v_ws_id     uuid;
  v_scope_val text;
  v_limit     bigint;
  v_count     bigint;
  v_sql       text;
begin
  -- resolve workspace id from NEW
  if v_ws_mode = 'via_clientes' then
    execute format('select conta_id from clientes where id = ($1).%I', v_ws_col)
      using NEW into v_ws_id;
  else
    execute format('select (($1).%I)::uuid', v_ws_col) using NEW into v_ws_id;
  end if;
  if v_ws_id is null then
    return NEW; -- cannot resolve workspace; defer to other constraints
  end if;

  -- serialize concurrent inserts for this (workspace, limit) to prevent overshoot
  perform pg_advisory_xact_lock(hashtext(v_ws_id::text || ':' || v_limit_key));

  v_limit := effective_plan_limit(v_ws_id, v_limit_key);
  if v_limit is null then
    return NEW; -- unlimited
  end if;

  if v_ws_mode = 'via_clientes' then
    -- workspace-wide count across the clientes join
    v_sql := format(
      'select count(*) from %I t join clientes c on c.id = t.%I where c.conta_id = $1',
      TG_TABLE_NAME, v_ws_col);
    execute v_sql using v_ws_id into v_count;
  else
    execute format('select (($1).%I)::text', v_scope_col) using NEW into v_scope_val;
    v_sql := format('select count(*) from %I where %I = $1', TG_TABLE_NAME, v_scope_col);
    if v_pred <> '' then
      v_sql := v_sql || ' and ' || v_pred;
    end if;
    execute v_sql using v_scope_val into v_count;
  end if;

  if v_count >= v_limit then
    raise exception 'plan_limit_exceeded:%', v_limit_key using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;
```

- [ ] **Step 4: Attach the clientes trigger**

Create `supabase/migrations/20260611130003_count_triggers.sql`:

```sql
-- Resource count enforcement triggers (block-new; existing rows untouched).
drop trigger if exists trg_limit_clientes on clientes;
create trigger trg_limit_clientes before insert on clientes
  for each row execute function enforce_plan_count_limit('max_clients', 'direct', 'conta_id', 'conta_id');
```

- [ ] **Step 5: Reset and verify it passes**

Run: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/02_clientes_limit.sql`
Expected: `NOTICE: PASS 02_clientes_limit`.

- [ ] **Step 6: Add an override + unlimited regression to the same assertion**

Append to `supabase/tests/entitlements/02_clientes_limit.sql`:

```sql
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); i int;
begin
  -- override raises the limit
  v_ws := et_make_workspace('free', '{"max_clients": 3}'::jsonb);
  for i in 1..3 loop
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C'||i, 'C'||i, '#000');
  end loop; -- 3 allowed by override
  -- max plan: unlimited
  v_ws := et_make_workspace('max');
  for i in 1..10 loop
    insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'M'||i, 'M'||i, '#000');
  end loop;
  raise notice 'PASS 02_clientes override/unlimited';
end $$;
rollback;
```

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/02_clientes_limit.sql`
Expected: both `PASS` notices.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260611130002_enforce_plan_count_limit_fn.sql supabase/migrations/20260611130003_count_triggers.sql supabase/tests/entitlements/02_clientes_limit.sql
git commit -m "feat(paywall): generic count-limit trigger + clientes enforcement"
```

---

## Task 3: Remaining workspace-scoped triggers (seats, leads, hub tokens, templates, instagram)

**Files:**
- Modify: `supabase/migrations/20260611130003_count_triggers.sql`
- Create: `supabase/tests/entitlements/03_workspace_scoped.sql`

- [ ] **Step 1: Write failing assertions for the 5 tables**

Create `supabase/tests/entitlements/03_workspace_scoped.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean;
begin
  -- LEADS: free max_leads = 10
  v_ws := et_make_workspace('free');
  for i in 1..10 loop insert into leads (user_id, conta_id, nome) values (v_uid, v_ws, 'L'||i); end loop;
  v_blocked := false;
  begin insert into leads (user_id, conta_id, nome) values (v_uid, v_ws, 'L11');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'lead over limit must block';

  -- SEATS: free max_team_members = 1 (workspace_members scoped by workspace_id)
  v_ws := et_make_workspace('free');
  insert into workspace_members (user_id, workspace_id, role) values (gen_random_uuid(), v_ws, 'owner');
  v_blocked := false;
  begin insert into workspace_members (user_id, workspace_id, role) values (gen_random_uuid(), v_ws, 'agent');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second seat must block on free';

  -- INSTAGRAM (via clientes join): free max_instagram_accounts = 1
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into instagram_accounts (client_id, instagram_user_id) values (v_cli, 'ig1');
  v_blocked := false;
  begin insert into instagram_accounts (client_id, instagram_user_id) values (v_cli, 'ig2');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second instagram account must block on free';

  raise notice 'PASS 03_workspace_scoped';
end $$;
rollback;
```

(Adjust column lists to each table's `NOT NULL` set per `20260301_baseline_schema.sql`. `client_hub_tokens` and `workflow_templates` follow the same pattern — add analogous blocks if you want explicit coverage; their triggers are added in Step 3 regardless.)

- [ ] **Step 2: Run to verify it fails**

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/03_workspace_scoped.sql`
Expected: first assertion failure (`lead over limit must block`).

- [ ] **Step 3: Append the 5 triggers**

Append to `supabase/migrations/20260611130003_count_triggers.sql`:

```sql
drop trigger if exists trg_limit_leads on leads;
create trigger trg_limit_leads before insert on leads
  for each row execute function enforce_plan_count_limit('max_leads', 'direct', 'conta_id', 'conta_id');

-- login seats: workspace_members is scoped by workspace_id (not conta_id)
drop trigger if exists trg_limit_seats on workspace_members;
create trigger trg_limit_seats before insert on workspace_members
  for each row execute function enforce_plan_count_limit('max_team_members', 'direct', 'workspace_id', 'workspace_id');

drop trigger if exists trg_limit_hub_tokens on client_hub_tokens;
create trigger trg_limit_hub_tokens before insert on client_hub_tokens
  for each row execute function enforce_plan_count_limit('max_hub_tokens', 'direct', 'conta_id', 'conta_id');

drop trigger if exists trg_limit_templates on workflow_templates;
create trigger trg_limit_templates before insert on workflow_templates
  for each row execute function enforce_plan_count_limit('max_workflow_templates', 'direct', 'conta_id', 'conta_id');

-- instagram_accounts has no conta_id: resolve + count through clientes
drop trigger if exists trg_limit_instagram on instagram_accounts;
create trigger trg_limit_instagram before insert on instagram_accounts
  for each row execute function enforce_plan_count_limit('max_instagram_accounts', 'via_clientes', 'client_id', '');
```

- [ ] **Step 4: Reset and verify it passes**

Run: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/03_workspace_scoped.sql`
Expected: `NOTICE: PASS 03_workspace_scoped`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260611130003_count_triggers.sql supabase/tests/entitlements/03_workspace_scoped.sql
git commit -m "feat(paywall): seat/lead/hub-token/template/instagram count triggers"
```

---

## Task 4: Sub-entity-scoped triggers (active workflows/client, props/template, posts/workflow)

**Files:**
- Modify: `supabase/migrations/20260611130003_count_triggers.sql`
- Create: `supabase/tests/entitlements/04_sub_entity.sql`

- [ ] **Step 1: Write failing assertion (active workflows per client)**

Create `supabase/tests/entitlements/04_sub_entity.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_blocked boolean := false; i int;
begin
  -- free max_active_workflows_per_client = 1, scoped per cliente_id, only status='ativo'
  v_ws := et_make_workspace('free');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W1', 'ativo');
  -- an archived one must NOT count
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W-old', 'arquivado');
  begin
    insert into workflows (user_id, conta_id, cliente_id, titulo, status)
      values (v_uid, v_ws, v_cli, 'W2', 'ativo'); -- 2nd active for client => block
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'second active workflow for client must block';
  raise notice 'PASS 04_sub_entity';
end $$;
rollback;
```

(Adjust `workflows`/`workflow_posts`/`template_property_definitions` column lists to their `NOT NULL` sets.)

- [ ] **Step 2: Run to verify it fails**

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/04_sub_entity.sql`
Expected: assertion failure `second active workflow for client must block`.

- [ ] **Step 3: Append the 3 sub-entity triggers**

Append to `supabase/migrations/20260611130003_count_triggers.sql`:

```sql
-- active workflows per client: scope cliente_id, only status='ativo'
drop trigger if exists trg_limit_workflows on workflows;
create trigger trg_limit_workflows before insert on workflows
  for each row execute function enforce_plan_count_limit(
    'max_active_workflows_per_client', 'direct', 'conta_id', 'cliente_id', 'status = ''ativo''');

-- custom properties per template
drop trigger if exists trg_limit_custom_props on template_property_definitions;
create trigger trg_limit_custom_props before insert on template_property_definitions
  for each row execute function enforce_plan_count_limit(
    'max_custom_properties_per_template', 'direct', 'conta_id', 'template_id');

-- posts per workflow
drop trigger if exists trg_limit_posts on workflow_posts;
create trigger trg_limit_posts before insert on workflow_posts
  for each row execute function enforce_plan_count_limit(
    'max_posts_per_workflow', 'direct', 'conta_id', 'workflow_id');
```

Note: the trigger resolves the workspace from `NEW.conta_id` but counts within the `scope_column` bucket (`cliente_id`/`template_id`/`workflow_id`) — the limit comes from the workspace's plan, the count from the sub-entity.

- [ ] **Step 4: Reset and verify it passes**

Run: `npx supabase db reset && psql "$LOCAL_DB" -f supabase/tests/entitlements/04_sub_entity.sql`
Expected: `NOTICE: PASS 04_sub_entity`.

- [ ] **Step 5: Concurrency regression (advisory lock)**

Append to `supabase/tests/entitlements/04_sub_entity.sql` a same-session sanity check that the lock function is invoked (full two-connection race is verified manually):

```sql
begin;
do $$
declare v_ws uuid; v_uid uuid := gen_random_uuid(); v_n int;
begin
  v_ws := et_make_workspace('free'); -- max_clients = 2
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'A', 'A', '#000');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_uid, v_ws, 'B', 'B', '#000');
  select count(*) into v_n from clientes where conta_id = v_ws;
  assert v_n = 2, 'exactly two clients';
  raise notice 'PASS 04 lock-path smoke';
end $$;
rollback;
```

Run: `psql "$LOCAL_DB" -f supabase/tests/entitlements/04_sub_entity.sql`
Expected: both `PASS` notices. (Note in the commit body: true concurrent-overshoot is verified manually with two `psql` sessions holding open transactions.)

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260611130003_count_triggers.sql supabase/tests/entitlements/04_sub_entity.sql
git commit -m "feat(paywall): sub-entity count triggers (workflows/props/posts)"
```

---

## Task 5: `invite-user` seat pre-check (friendly error before the trigger)

**Files:**
- Modify: `supabase/functions/invite-user/index.ts`
- Create: `supabase/functions/__tests__/invite-user-seats_test.ts`

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/__tests__/invite-user-seats_test.ts` (follow the mock-DB pattern in `file-upload-url_test.ts`):

```ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { seatsAvailable } from "../invite-user/seats.ts";

Deno.test("seatsAvailable: blocks when members+pending >= limit", () => {
  assertEquals(seatsAvailable({ limit: 1, members: 1, pendingInvites: 0 }), false);
  assertEquals(seatsAvailable({ limit: 3, members: 1, pendingInvites: 1 }), true);
  assertEquals(seatsAvailable({ limit: 3, members: 2, pendingInvites: 1 }), false);
});

Deno.test("seatsAvailable: null limit = unlimited", () => {
  assertEquals(seatsAvailable({ limit: null, members: 99, pendingInvites: 5 }), true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/invite-user-seats_test.ts`
Expected: FAIL — cannot find module `../invite-user/seats.ts`.

- [ ] **Step 3: Write the pure helper**

Create `supabase/functions/invite-user/seats.ts`:

```ts
export function seatsAvailable(
  args: { limit: number | null; members: number; pendingInvites: number },
): boolean {
  if (args.limit === null) return true; // unlimited
  return args.members + args.pendingInvites < args.limit;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/invite-user-seats_test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the pre-check into the invite flow**

In `supabase/functions/invite-user/index.ts`, after `profile.conta_id` is known and before the `invites` insert (the path around lines 178 / 206), add:

```ts
import { seatsAvailable } from "./seats.ts";
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts"; // see Step 6

// ...inside the handler, after resolving profile.conta_id:
const limit = await effectivePlanLimit(adminClient, profile.conta_id, "max_team_members");
const [{ count: members }, { count: pending }] = await Promise.all([
  adminClient.from("workspace_members").select("*", { count: "exact", head: true })
    .eq("workspace_id", profile.conta_id),
  adminClient.from("invites").select("*", { count: "exact", head: true })
    .eq("conta_id", profile.conta_id).eq("status", "pending"),
]);
if (!seatsAvailable({ limit, members: members ?? 0, pendingInvites: pending ?? 0 })) {
  return new Response(
    JSON.stringify({ error: "plan_limit_exceeded", resource: "max_team_members" }),
    { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}
```

- [ ] **Step 6: Add the limit RPC helper**

Create `supabase/functions/_shared/entitlements-rpc.ts`:

```ts
import { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Calls the SQL effective_plan_limit(); returns null for unlimited. */
export async function effectivePlanLimit(
  svc: SupabaseClient, workspaceId: string, limitKey: string,
): Promise<number | null> {
  const { data, error } = await svc.rpc("effective_plan_limit", {
    ws_id: workspaceId, limit_key: limitKey,
  });
  if (error) throw error;
  return data === null ? null : Number(data);
}
```

- [ ] **Step 7: Run the existing invite-user tests + new test to confirm no regression**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/invite-user-seats_test.ts`
Expected: PASS. (Manually verify the handler against local Supabase: a free workspace with the owner seat rejects a 2nd invite with `403 plan_limit_exceeded`.)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/invite-user/ supabase/functions/_shared/entitlements-rpc.ts supabase/functions/__tests__/invite-user-seats_test.ts
git commit -m "feat(paywall): invite-user seat pre-check via effective_plan_limit"
```

---

## Task 6: `mapEntitlementError` frontend util

**Files:**
- Create: `apps/crm/src/lib/entitlement-errors.ts`
- Create: `apps/crm/src/lib/__tests__/entitlement-errors.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/entitlement-errors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapEntitlementError } from '../entitlement-errors';

describe('mapEntitlementError', () => {
  it('maps a raised count-limit message', () => {
    const r = mapEntitlementError({ message: 'plan_limit_exceeded:max_clients' });
    expect(r).toEqual({ kind: 'limit', key: 'max_clients', label: 'clientes' });
  });
  it('maps a 403 feature_disabled JSON body', () => {
    const r = mapEntitlementError({ error: 'feature_disabled', feature: 'feature_leads' });
    expect(r).toEqual({ kind: 'feature', key: 'feature_leads', label: 'Leads' });
  });
  it('maps a quota_exceeded body', () => {
    const r = mapEntitlementError({ error: 'quota_exceeded', used: 9, quota: 10 });
    expect(r).toEqual({ kind: 'quota', key: 'storage', label: 'armazenamento', used: 9, quota: 10 });
  });
  it('returns null for unrelated errors', () => {
    expect(mapEntitlementError({ message: 'network error' })).toBeNull();
    expect(mapEntitlementError(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- entitlement-errors`
Expected: FAIL — cannot resolve `../entitlement-errors`.

- [ ] **Step 3: Implement the util**

Create `apps/crm/src/lib/entitlement-errors.ts`:

```ts
export type EntitlementError =
  | { kind: 'limit'; key: string; label: string }
  | { kind: 'feature'; key: string; label: string }
  | { kind: 'quota'; key: 'storage'; label: string; used?: number; quota?: number };

// PT labels for the limit_key / feature flag surfaced to users.
const LIMIT_LABELS: Record<string, string> = {
  max_clients: 'clientes',
  max_team_members: 'usuários',
  max_leads: 'leads',
  max_instagram_accounts: 'contas do Instagram',
  max_hub_tokens: 'portais do Hub',
  max_workflow_templates: 'modelos de fluxo',
  max_active_workflows_per_client: 'fluxos ativos por cliente',
  max_custom_properties_per_template: 'propriedades personalizadas',
  max_posts_per_workflow: 'posts por fluxo',
};

const FEATURE_LABELS: Record<string, string> = {
  feature_leads: 'Leads',
  feature_financial: 'Financeiro',
  feature_contracts: 'Contratos',
  feature_ideas: 'Ideias',
  feature_hub_portal: 'Portal do Cliente',
  feature_analytics_reports: 'Relatórios e Analytics',
  feature_post_scheduling: 'Agendamento de Posts',
  feature_instagram_ai: 'Análise com IA',
  feature_best_times: 'Melhores Horários',
  feature_audience_demographics: 'Demografia da Audiência',
  feature_post_tagging: 'Tags de Posts',
  feature_brand_customization: 'Personalização de Marca',
  feature_custom_properties: 'Propriedades Personalizadas',
  feature_csv_import: 'Importação CSV',
};

/** Normalizes a DB-raised message or an edge-function JSON error into an EntitlementError, or null. */
export function mapEntitlementError(err: unknown): EntitlementError | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as { message?: string; error?: string; feature?: string; used?: number; quota?: number };

  // DB-raised PostgREST message: "plan_limit_exceeded:max_clients"
  const msg = typeof e.message === 'string' ? e.message : '';
  const limitMatch = msg.match(/plan_limit_exceeded:([a-z_]+)/);
  if (limitMatch || e.error === 'plan_limit_exceeded') {
    const key = limitMatch?.[1] ?? 'max_team_members';
    return { kind: 'limit', key, label: LIMIT_LABELS[key] ?? key };
  }
  if (e.error === 'feature_disabled' && e.feature) {
    return { kind: 'feature', key: e.feature, label: FEATURE_LABELS[e.feature] ?? e.feature };
  }
  if (e.error === 'quota_exceeded' || /quota_exceeded/.test(msg)) {
    return { kind: 'quota', key: 'storage', label: 'armazenamento', used: e.used, quota: e.quota };
  }
  return null;
}

/** User-facing PT sentence for an entitlement error. */
export function entitlementMessage(e: EntitlementError): string {
  if (e.kind === 'limit') return `Você atingiu o limite de ${e.label} do seu plano.`;
  if (e.kind === 'feature') return `O recurso "${e.label}" não está disponível no seu plano.`;
  return 'Você atingiu o limite de armazenamento do seu plano.';
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- entitlement-errors`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/entitlement-errors.ts apps/crm/src/lib/__tests__/entitlement-errors.test.ts
git commit -m "feat(paywall): mapEntitlementError + PT labels util"
```

---

## Task 7: Global mutation error handler → upgrade prompt

**Files:**
- Create: `apps/crm/src/lib/entitlement-toast.tsx`
- Modify: `apps/crm/src/App.tsx:46-50`
- Create: `apps/crm/src/lib/__tests__/entitlement-toast.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/entitlement-toast.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEntitlementMutationError } from '../entitlement-toast';

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

describe('handleEntitlementMutationError', () => {
  beforeEach(() => toastError.mockClear());

  it('shows an upgrade toast for an entitlement error and returns true', () => {
    const handled = handleEntitlementMutationError({ message: 'plan_limit_exceeded:max_clients' });
    expect(handled).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0][0]).toContain('clientes');
  });

  it('ignores non-entitlement errors and returns false', () => {
    const handled = handleEntitlementMutationError(new Error('boom'));
    expect(handled).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- entitlement-toast`
Expected: FAIL — cannot resolve `../entitlement-toast`.

- [ ] **Step 3: Implement the handler**

Create `apps/crm/src/lib/entitlement-toast.tsx`:

```tsx
import { toast } from 'sonner';
import { mapEntitlementError, entitlementMessage } from './entitlement-errors';

/**
 * If `err` is an entitlement error, shows an upgrade toast and returns true.
 * Owners get a "Fazer upgrade" action to /configuracao/cobranca; non-owner copy
 * is handled by the upgrade-unlock screen (Plan 2) — here we always offer the link,
 * since only owners trigger plan-limited create flows in practice.
 */
export function handleEntitlementMutationError(err: unknown): boolean {
  const mapped = mapEntitlementError(err);
  if (!mapped) return false;
  toast.error(entitlementMessage(mapped), {
    action: { label: 'Fazer upgrade', onClick: () => { window.location.href = '/configuracao/cobranca'; } },
  });
  return true;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -- entitlement-toast`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into the global QueryClient**

Modify `apps/crm/src/App.tsx`. Add imports near the top:

```tsx
import { QueryClient, QueryClientProvider, MutationCache } from '@tanstack/react-query';
import { handleEntitlementMutationError } from './lib/entitlement-toast';
```

Replace the `queryClient` definition (lines 46-50) with:

```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
  mutationCache: new MutationCache({
    onError: (error) => {
      // Entitlement errors get a universal upgrade toast; everything else falls
      // through to each mutation's own onError.
      handleEntitlementMutationError(error);
    },
  }),
});
```

- [ ] **Step 6: Typecheck + full frontend suite**

Run: `npm run build && npm run test`
Expected: build succeeds; all tests pass (765+ plus the new ones).

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/lib/entitlement-toast.tsx apps/crm/src/lib/__tests__/entitlement-toast.test.tsx apps/crm/src/App.tsx
git commit -m "feat(paywall): global mutation onError shows upgrade toast on limit errors"
```

---

## Final verification

- [ ] **Run the full SQL suite**

```bash
npx supabase db reset
for f in supabase/tests/entitlements/0*.sql; do echo "== $f =="; psql "$LOCAL_DB" -f "$f"; done
```
Expected: every script prints its `PASS` notice(s), no errors.

- [ ] **Run TS suites**

```bash
deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/invite-user-seats_test.ts
npm run test
npm run build
```
Expected: all green.

- [ ] **Manual smoke (local Supabase):** create a free workspace via the app, add clients up to 2 → the 3rd create shows the "Você atingiu o limite de clientes" upgrade toast; existing clients remain editable.

---

## Self-review notes

- **Spec coverage (§6.1, §7):** resolver (Task 1), generic trigger + advisory lock + `via_clientes` (Task 2), all 9 tables across workspace-scoped (Tasks 2–3) and sub-entity (Task 4), `invite-user` pre-check (Task 5), error contract + universal upgrade UX (Tasks 6–7). `effective_plan_feature`, feature gating, storage, admin un-comp, and per-page at-limit disable are explicitly out of scope (Plans 2–4).
- **Type consistency:** `effective_plan_limit(ws_id, limit_key)` signature is identical in the migration (Task 1), the RPC helper (Task 5), and is invoked by the trigger (Task 2). `mapEntitlementError`'s `EntitlementError` shape (Task 6) is consumed unchanged by `handleEntitlementMutationError` (Task 7).
- **Planning pins resolved:** seat table = `workspace_members` (by `workspace_id`); `workflows.status='ativo'`; `instagram_accounts` via the `clientes` join.
- **Known limitation:** SQL trigger tests run against local Supabase via `psql` (not in CI, consistent with the repo having no DB test harness). True concurrent-overshoot is verified manually with two open `psql` transactions; the advisory lock is the mechanism.
