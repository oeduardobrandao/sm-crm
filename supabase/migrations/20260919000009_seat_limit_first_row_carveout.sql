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
-- The carve-out is deliberately role-agnostic (first row for a workspace_id,
-- any role), not owner-only: accept_workspace_invite() already lets a
-- non-owner be a workspace's first membership row whenever the real seat
-- limit is >= 1, so this only extends that same existing behaviour to the
-- misconfigured case.
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
-- enforce_plan_count_limit() is unaffected by this migration (CREATE OR
-- REPLACE FUNCTION alone updates the function body they already reference).
DROP TRIGGER IF EXISTS trg_limit_seats ON workspace_members;
CREATE TRIGGER trg_limit_seats BEFORE INSERT ON workspace_members
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_count_limit(
    'max_team_members', 'direct', 'workspace_id', 'workspace_id', '', 'true');
