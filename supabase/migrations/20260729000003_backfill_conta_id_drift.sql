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
-- signup trigger, invite creation/acceptance, manage-workspace-user's
-- remove action) has always set both columns to the same value in one
-- statement.
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
-- Post-condition: zero divergence between conta_id and active_workspace_id.
--
-- DELIBERATELY NOT ALSO ASSERTED HERE: that every non-null conta_id has a
-- matching workspace_members row. An earlier draft of this migration
-- included that as a "paranoid double-check", reasoning that
-- active_workspace_id is trigger-guarded to always correspond to real
-- membership. That reasoning is WRONG, and asserting it aborts this
-- migration on completely ordinary, ongoing production state:
-- handle_new_user_workspace() (the trigger that fires on signup, current
-- definition confirmed directly against the live function body) sets a
-- pending invitee's conta_id AND active_workspace_id to the invite's
-- workspace in ONE INSERT statement, deliberately BEFORE any
-- workspace_members row exists — that row is only created later, when the
-- invite is accepted (manage-workspace-user's accept-invite action). This
-- is not a rare edge case; any workspace with an unaccepted invite has a
-- profile in exactly this shape at any given moment, and invites routinely
-- sit unaccepted for their full 7-day expiry window.
--
-- Reproduced directly: a real invites row (status='pending') plus the
-- actual live handle_new_user_workspace() trigger firing on a matching
-- auth.users insert leaves conta_id = active_workspace_id (zero drift, the
-- check above is unaffected) with no workspace_members row at all. The
-- removed second check would have raised on that state and aborted this
-- migration -- on every database with even one outstanding invite, which
-- in production is not a hypothetical.
--
-- Dropping it costs nothing: the actual security property (conta_id cannot
-- diverge from the trigger-guarded active_workspace_id) is fully covered by
-- the check above, and INSERT-time membership deferral for invites is a
-- pre-existing, intentional design (20260421000001_defer_invited_user_workspace_membership.sql),
-- not a gap this migration exists to close.
-- -------------------------------------------------------------
DO $$
DECLARE
  v_still_drifted int;
BEGIN
  SELECT count(*) INTO v_still_drifted
    FROM public.profiles
   WHERE conta_id IS DISTINCT FROM active_workspace_id;
  IF v_still_drifted <> 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % row(s) still have conta_id != active_workspace_id',
      v_still_drifted;
  END IF;

  RAISE NOTICE 'backfill verified: every profiles.conta_id matches active_workspace_id';
END $$;
