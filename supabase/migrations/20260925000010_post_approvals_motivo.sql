-- =====================================================================
-- 20260925000010_post_approvals_motivo.sql
-- Correction-reason tag on post_approvals, required only for
-- action = 'correcao', and record_client_approval widened to accept it.
-- Spec: docs/superpowers/specs/2026-09-17-post-approval-history-design.md (§3)
-- =====================================================================

alter table post_approvals add column if not exists motivo text;

-- Phase 1 of 3 (spec §3): validate the VALUE when present, do not require
-- presence yet. The deployed hub-approve still calls the RPC with 6 args
-- (motivo = NULL) until it is redeployed; a mandatory CHECK here would
-- reject every correction in that window. Phase 3 (20260925000001) swaps
-- this for the conditional NOT VALID constraint once hub-approve and the
-- Hub bundle are live.
alter table post_approvals drop constraint if exists post_approvals_motivo_value_check;
alter table post_approvals
  add constraint post_approvals_motivo_value_check
  check (motivo is null or motivo in ('legenda', 'imagem_video', 'data', 'outro'));

-- Replace, never overload. Postgres identifies a function by name + argument
-- types: CREATE OR REPLACE with a new trailing parameter would create a
-- SECOND function, and the existing 6-argument call in hub-approve would then
-- match both candidates (exact match vs. default-filled) and fail as
-- ambiguous. Drop the old signature, create the only new one, and re-apply
-- the grants to that exact signature (REVOKE FROM PUBLIC also strips
-- service_role, so the GRANT is not optional).
drop function if exists record_client_approval(bigint, text, text, text, boolean, text);

create function record_client_approval(
  p_post_id           bigint,
  p_token             text,
  p_action            text,
  p_comentario        text,
  p_is_workspace_user boolean,
  p_new_status        text,
  p_motivo            text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval bigint;
begin
  insert into post_approvals (post_id, token, action, comentario, is_workspace_user, motivo)
  values (p_post_id, p_token, p_action, p_comentario, p_is_workspace_user, p_motivo)
  returning id into v_approval;

  perform set_config('app.event_source',     'client',         true);
  perform set_config('app.post_approval_id', v_approval::text, true);

  update workflow_posts set status = p_new_status where id = p_post_id;

  return v_approval;
end;
$$;

revoke all on function record_client_approval(bigint, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function record_client_approval(bigint, text, text, text, boolean, text, text) to service_role;
