# Seat-limit first-row carve-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a misconfigured `plans` table (no `is_default = true` row) from
breaking every new signup, by making the seat-limit trigger always allow a
workspace's first `workspace_members` row regardless of what the plan limit
resolves to.

**Architecture:** One new migration adds an opt-in 6th trigger argument
(`allow_first_row`) to the existing generic `enforce_plan_count_limit()`
function and rewires only `trg_limit_seats` to pass it. One new entitlement
SQL test proves the carve-out fires exactly when needed (zero default plans,
first seat) and nowhere else (second seat still blocked).

**Tech Stack:** PostgreSQL/plpgsql (Supabase migrations), psql-based
entitlement test harness (`scripts/test-entitlements.sh`).

## Global Constraints

- Migration filename must use a unique timestamp version prefix; current tip
  is `20260919000008_reorder_fluxos_board.sql`, so the new migration must use
  a prefix later than `20260919000008` (e.g. `20260919000009`). Re-check
  `ls supabase/migrations | tail -1` immediately before creating the file, in
  case another migration landed on `main` since this plan was written.
- `enforce_plan_count_limit()` is `SECURITY DEFINER`, `SET search_path = public`
  — the replacement must keep both.
- Do not touch `handle_new_user_workspace()` or any file under
  `supabase/functions/` — this fix is scoped entirely to the two functions
  named above plus the `trg_limit_seats` trigger definition.
- Entitlement tests follow the existing `\set ON_ERROR_STOP on` /
  `\i supabase/tests/entitlements/_helpers.sql` / `begin; do $$ ... end $$;
  rollback;` pattern used throughout `supabase/tests/entitlements/*.sql`.
- Current entitlement-test tip is `92_reorder_fluxos_board.sql`; the new test
  file must be `93_seat_limit_first_row_carveout.sql` (re-check
  `ls supabase/tests/entitlements | tail -1` before creating it).

---

### Task 1: Migration — carve-out in `enforce_plan_count_limit()` + rewire `trg_limit_seats`

**Files:**
- Create: `supabase/migrations/20260919000009_seat_limit_first_row_carveout.sql`

**Interfaces:**
- Consumes: nothing new — reuses the existing `effective_plan_limit(ws_id uuid, limit_key text) returns bigint` function (defined in `supabase/migrations/20260611130001_effective_plan_limit.sql`, unchanged).
- Produces: `enforce_plan_count_limit()` trigger function, now accepting an
  optional `TG_ARGV[5]` (`allow_first_row`, text `'true'` to enable, any other
  value/absent = disabled). `trg_limit_seats` on `workspace_members` is
  recreated passing `'true'` for that argument; all other triggers calling
  this function are untouched (they simply never pass a 6th argument, so
  `TG_ARGV[5]` is `NULL` for them and the carve-out stays off).

This is a single self-contained migration file. There is no separate
"write a failing test first" step for a migration — the test is Task 2, and
Task 3 verifies both together. Write the file directly:

- [ ] **Step 1: Write the migration file**

```sql
-- Fixes a signup-breaking bug: trg_limit_seats can block a workspace's very
-- first workspace_members insert (the owner's own seat) when the workspace's
-- plan_id is NULL and no plan has is_default = true — effective_plan_limit()
-- fails closed to 0 in that case, so the very first seat gets rejected with
-- plan_limit_exceeded:max_team_members, which aborts the whole
-- AFTER INSERT ON auth.users signup transaction (handle_new_user_workspace,
-- 20260719000002_signup_marketing_opt_in.sql).
--
-- A workspace can never legitimately have zero members, so the seat limit
-- should bind starting from the 2nd member, not the 1st, regardless of
-- plan/override/misconfiguration state. This adds an opt-in "allow first row"
-- carve-out to the generic count-limit trigger function and wires it onto
-- trg_limit_seats only — every other resource (clients, leads, hub tokens,
-- workflow templates, ...) legitimately starts at 0 and keeps failing closed.
--
-- See docs/superpowers/specs/2026-09-12-seat-limit-first-row-carveout-design.md
-- for the alternatives considered and why this one was chosen.

CREATE OR REPLACE FUNCTION enforce_plan_count_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit_key text := TG_ARGV[0];
  v_ws_mode   text := TG_ARGV[1];
  v_ws_col    text := TG_ARGV[2];
  v_scope_col text := TG_ARGV[3];
  v_pred      text := coalesce(TG_ARGV[4], '');
  v_allow_first boolean := coalesce(TG_ARGV[5], 'false')::boolean;
  v_ws_id     uuid;
  v_scope_val text;
  v_limit     bigint;
  v_count     bigint;
  v_sql       text;
BEGIN
  -- resolve workspace id from NEW
  IF v_ws_mode = 'via_clientes' THEN
    EXECUTE format('select conta_id from clientes where id = ($1).%I', v_ws_col)
      USING NEW INTO v_ws_id;
  ELSE
    EXECUTE format('select (($1).%I)::uuid', v_ws_col) USING NEW INTO v_ws_id;
  END IF;
  IF v_ws_id IS NULL THEN
    RETURN NEW; -- cannot resolve workspace; defer to other constraints
  END IF;

  -- serialize concurrent inserts for this (workspace, limit) to prevent overshoot
  PERFORM pg_advisory_xact_lock(hashtext(v_ws_id::text || ':' || v_limit_key));

  IF v_allow_first THEN
    -- The carve-out needs to know the count before it can decide whether to
    -- skip the limit check, so it must be computed up front for this trigger.
    IF v_ws_mode = 'via_clientes' THEN
      v_sql := format(
        'select count(*) from %I t join clientes c on c.id = t.%I where c.conta_id = $1',
        TG_TABLE_NAME, v_ws_col);
      EXECUTE v_sql USING v_ws_id INTO v_count;
    ELSE
      EXECUTE format('select (($1).%I)::text', v_scope_col) USING NEW INTO v_scope_val;
      v_sql := format('select count(*) from %I where %I::text = $1', TG_TABLE_NAME, v_scope_col);
      IF v_pred <> '' THEN
        v_sql := v_sql || ' and ' || v_pred;
      END IF;
      EXECUTE v_sql USING v_scope_val INTO v_count;
    END IF;

    IF v_count = 0 THEN
      RETURN NEW; -- first row for this scope is always allowed, regardless of plan/limit state
    END IF;
  END IF;

  -- Fast path preserved for every other trigger (the 8 not passing
  -- allow_first_row): resolve the limit first and skip the count entirely
  -- when unlimited, so bulk inserts on unlimited plans don't pay for a
  -- COUNT(*) they'll never need.
  v_limit := effective_plan_limit(v_ws_id, v_limit_key);
  IF v_limit IS NULL THEN
    RETURN NEW; -- unlimited
  END IF;

  IF NOT v_allow_first THEN
    IF v_ws_mode = 'via_clientes' THEN
      -- workspace-wide count across the clientes join
      v_sql := format(
        'select count(*) from %I t join clientes c on c.id = t.%I where c.conta_id = $1',
        TG_TABLE_NAME, v_ws_col);
      EXECUTE v_sql USING v_ws_id INTO v_count;
    ELSE
      EXECUTE format('select (($1).%I)::text', v_scope_col) USING NEW INTO v_scope_val;
      -- Cast $1 explicitly; the scope value was read from the same column type,
      -- so casting back via the column avoids implicit text→typed mismatches.
      v_sql := format('select count(*) from %I where %I::text = $1', TG_TABLE_NAME, v_scope_col);
      IF v_pred <> '' THEN
        v_sql := v_sql || ' and ' || v_pred;
      END IF;
      EXECUTE v_sql USING v_scope_val INTO v_count;
    END IF;
  END IF;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'plan_limit_exceeded:%', v_limit_key USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Rewire trg_limit_seats only: pass '' for the existing status_pred slot and
-- 'true' for the new allow_first_row slot. Every other trigger that calls
-- enforce_plan_count_limit() is left untouched by this migration.
DROP TRIGGER IF EXISTS trg_limit_seats ON workspace_members;
CREATE TRIGGER trg_limit_seats BEFORE INSERT ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_count_limit(
    'max_team_members', 'direct', 'workspace_id', 'workspace_id', '', 'true');
```

**Post-review correction (folded into the shipped migration, code above already
reflects this):** an initial draft computed `v_count` unconditionally before
calling `effective_plan_limit()`, which silently removed the original
function's fast path — every trigger, not just seats, used to skip the
`COUNT(*)` entirely when `effective_plan_limit()` resolved to `NULL`
(unlimited). The shipped version only computes the count up front when
`v_allow_first` is true (seats); the other 8 triggers still resolve the limit
first and return immediately on `NULL`, exactly as before this migration.

- [ ] **Step 2: Confirm the migration filename doesn't collide**

Run: `ls supabase/migrations | tail -3`
Expected: `20260919000009_seat_limit_first_row_carveout.sql` is the last file
and no other file shares its numeric prefix. If `main` has moved since this
plan was written and a migration now uses `20260919000009`, rename this file
to the next free timestamp (e.g. `20260919000010`) before continuing.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260919000009_seat_limit_first_row_carveout.sql
git commit -m "$(cat <<'EOF'
fix(entitlements): allow a workspace's first seat regardless of plan limit

trg_limit_seats could block the very first workspace_members insert (the
owner's own seat) when a workspace's plan_id is NULL and no plan has
is_default = true, aborting the whole signup transaction. A workspace can
never legitimately have zero members, so the seat limit now binds starting
from the 2nd member; every other resource (clients, leads, hub tokens, ...)
is untouched and still fails closed on row 1.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Entitlement test — carve-out fires once, seat limit still enforced after

**Files:**
- Create: `supabase/tests/entitlements/93_seat_limit_first_row_carveout.sql`

**Interfaces:**
- Consumes: `et_make_workspace(p_plan_id text, p_overrides jsonb default null) returns uuid` and `et_grant_hosted_parity(p_exclude text[] default '{}') returns void`, both from `supabase/tests/entitlements/_helpers.sql` (unchanged by this plan). Also consumes the `plans` table's `is_default` column and the `handle_new_user_workspace()` trigger (both pre-existing, unchanged by this plan).
- Produces: nothing consumed by later tasks — this is the last task.

- [ ] **Step 1: Write the test file**

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Regression test for the seat-limit first-row carve-out: when no plan has
-- is_default = true, a brand-new workspace's plan_id resolves to NULL and
-- effective_plan_limit() fails closed to 0 for every resource, including
-- max_team_members. Without the carve-out, the very first workspace_members
-- insert (the signup owner's own seat) would be blocked, aborting the whole
-- AFTER INSERT ON auth.users transaction. See migration
-- 20260919000009_seat_limit_first_row_carveout.sql.
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_email text := 'seat-carveout-' || replace(v_uid::text, '-', '') || '@example.com';
  v_ws uuid;
  v_second_uid uuid := gen_random_uuid();
  v_blocked boolean := false;
begin
  -- Force the exact failure condition: zero plans with is_default = true.
  -- This UPDATE never commits (the whole test runs inside `begin; ... rollback;`).
  update plans set is_default = false where is_default;
  assert (select count(*) from plans where is_default) = 0,
    'setup failed: expected zero default plans';

  -- Fresh signup: no conta_id in metadata, so handle_new_user_workspace()
  -- takes the fresh-signup (owner) branch and creates a new workspace, then
  -- inserts the owner's workspace_members row. Must NOT raise.
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, v_email, jsonb_build_object('empresa', 'Seat Carveout Co'));

  select workspace_id into v_ws
    from workspace_members
    where user_id = v_uid and role = 'owner';

  assert v_ws is not null,
    'expected a workspace_members owner row for the freshly-signed-up user';

  raise notice 'PASS 93 first seat allowed with zero default plans';

  -- The carve-out must exempt only the FIRST row for this workspace: a
  -- second member insert, with the workspace still on zero default plans,
  -- must still be blocked by the seat limit. Use a real second auth.users
  -- row (workspace_members.user_id has an FK to auth.users) so a blocked
  -- insert unambiguously means "seat limit enforced", not "FK violation".
  insert into auth.users (id, email) values (v_second_uid, 'seat-carveout-second-' || replace(v_second_uid::text, '-', '') || '@example.com');
  begin
    insert into workspace_members (user_id, workspace_id, role)
      values (v_second_uid, v_ws, 'agent');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'plan_limit_exceeded:max_team_members%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'second member insert should still be blocked (limit resolves to 0, not unlimited)';

  raise notice 'PASS 93 second seat still blocked (carve-out is first-row only)';
end $$;
rollback;
```

- [ ] **Step 2: Run the test file in isolation**

Run: `psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/93_seat_limit_first_row_carveout.sql`

Expected: two `NOTICE:  PASS 93 ...` lines, no error, exit code 0. If
`psql` cannot connect, start the local stack first with `npx supabase start`
(see `reference_local_supabase_colima.md` in project memory if `supabase
start` itself fails to find Docker).

- [ ] **Step 3: Run the full entitlement suite to confirm no regressions**

Run: `bash scripts/test-entitlements.sh`
Expected: `ran=<N>  failures=0` on the last line, with
`PASS supabase/tests/entitlements/93_seat_limit_first_row_carveout.sql`
somewhere in the output. This also re-runs every other suite that exercises
`enforce_plan_count_limit()` (e.g. `05_more_count_limits.sql`,
`02_clientes_limit.sql`) to confirm the untouched triggers still fail closed
as before.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/entitlements/93_seat_limit_first_row_carveout.sql
git commit -m "$(cat <<'EOF'
test(entitlements): cover seat-limit first-row carve-out

Reproduces "no default plan configured" and asserts a fresh signup's
owner seat still succeeds, while a second member insert on the same
under-configured workspace is still correctly blocked.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Full local verification pass

**Files:** none (verification only).

**Interfaces:** none — this task only runs commands and inspects output.

- [ ] **Step 1: Re-run the entitlement suite one more time from a clean local DB**

Run: `npx supabase db reset` (re-applies every migration from scratch,
catching any ordering issue the new migration might have introduced), then
`bash scripts/test-entitlements.sh`.
Expected: `ran=<N>  failures=0`.

- [ ] **Step 2: Confirm no duplicate migration version prefixes**

Run:
```bash
ls supabase/migrations | sed -E 's/^([0-9]+)_.*/\1/' | sort | uniq -d
```
Expected: empty output (no duplicates). This is what
`migration-version-guard` in CI checks.

- [ ] **Step 3: Confirm the working tree is otherwise clean**

Run: `git status --short`
Expected: only the two new files from Tasks 1 and 2 were ever added (both
already committed by this point), and no stray modified files (e.g. from
`npx supabase db reset` regenerating `supabase/.temp/` — that directory is
git-ignored, so it should not show up).

- [ ] **Step 4: No commit needed for this task** — it's verification-only. If
Steps 1-2 fail, fix the root cause in Task 1 or 2's file and re-commit there
(don't add a third "fix" commit on top; amend is also not appropriate per
this repo's git conventions — make a new commit on the same task's file if
already pushed, otherwise just re-edit and re-commit cleanly since these are
brand-new files with no external history).

## Self-Review Notes

- **Spec coverage:** Design doc's "Design" section → Task 1. "Testing"
  section (all 4 numbered steps) → Task 2, Step 1 (all four are in the one
  `do $$ ... end $$` block, since they share the same forced zero-default-plan
  state and must run in the same transaction to avoid a real commit of that
  state). "Out of scope" section → already handled outside this plan via the
  spawned follow-up task, no plan action needed.
- **Placeholder scan:** none found — every step has literal file content or
  literal commands.
- **Type consistency:** `enforce_plan_count_limit()` signature (no SQL
  parameters, reads everything from `TG_ARGV`) is unchanged from the existing
  function; only the body changes. `trg_limit_seats`'s argument list grows
  from 4 to 6 positional strings, matching the function body's `TG_ARGV[0..5]`
  reads exactly.
