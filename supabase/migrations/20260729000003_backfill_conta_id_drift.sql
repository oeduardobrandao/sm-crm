-- =============================================================
-- Backfill profiles.conta_id drift left by the pre-fix vulnerability.
--
-- 20260729000001-000002 stop NEW writes to conta_id/active_workspace_id
-- outside switch_workspace(). They do nothing about rows a client already
-- wrote directly, while GRANT ALL + a WITH CHECK-less UPDATE policy made
-- `UPDATE profiles SET conta_id = <any workspace>` succeed for any
-- authenticated user (reproduced empirically pre-fix: 0 rows visible in a
-- foreign workspace, one UPDATE, 1 row visible).
--
-- A poisoned conta_id is not a one-time read — it is read by the legacy
-- FOR ALL policies on clientes/membros/leads/integracoes_status via
-- get_user_conta_id() on EVERY subsequent request, until the user's next
-- legitimate workspace switch happens to overwrite it. Closing the write
-- path does not revoke access already granted by a poisoned value sitting
-- in the row today.
--
-- active_workspace_id is the trustworthy column to backfill FROM: it has
-- been guarded by trg_validate_active_workspace (20260317_multi_workspace.sql)
-- since before conta_id existed as an independent write target, so a
-- divergence between the two columns can only be explained by a direct
-- write to conta_id that bypassed that guard — exactly the exploited path,
-- and nothing else. Every legitimate writer (switch_workspace(), the
-- signup trigger, invite acceptance, manage-workspace-user's remove action)
-- has always set both columns to the same value in one statement.
--
-- IDEMPOTENT. A second run finds nothing to change and its post-condition
-- still passes -- safe to re-run if this migration is ever replayed.
-- =============================================================

DO $$
DECLARE
  v_drifted int;
BEGIN
  SELECT count(*) INTO v_drifted
    FROM public.profiles
   WHERE conta_id IS DISTINCT FROM active_workspace_id;

  RAISE NOTICE 'profiles with conta_id != active_workspace_id before backfill: %', v_drifted;
END $$;

UPDATE public.profiles
   SET conta_id = active_workspace_id
 WHERE conta_id IS DISTINCT FROM active_workspace_id;

-- -------------------------------------------------------------
-- Post-condition: zero divergence, AND — the paranoid double-check — no
-- non-null conta_id lacks a real workspace_members row. The second check is
-- normally implied by the first (active_workspace_id is trigger-guarded to
-- always correspond to real membership), but asserting it separately means
-- this migration does not silently rely on that guarantee holding in a
-- database state it hasn't itself verified.
-- -------------------------------------------------------------
DO $$
DECLARE
  v_still_drifted int;
  v_unauthorized  int;
BEGIN
  SELECT count(*) INTO v_still_drifted
    FROM public.profiles
   WHERE conta_id IS DISTINCT FROM active_workspace_id;
  IF v_still_drifted <> 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % row(s) still have conta_id != active_workspace_id',
      v_still_drifted;
  END IF;

  SELECT count(*) INTO v_unauthorized
    FROM public.profiles p
   WHERE p.conta_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.workspace_members wm
        WHERE wm.user_id = p.id AND wm.workspace_id = p.conta_id
     );
  IF v_unauthorized <> 0 THEN
    RAISE EXCEPTION 'backfill left % row(s) with a conta_id the user is not a member of',
      v_unauthorized;
  END IF;

  RAISE NOTICE 'backfill verified: every profiles.conta_id matches active_workspace_id '
               'and corresponds to real membership';
END $$;
