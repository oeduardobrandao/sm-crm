-- =====================================================================
-- 20260925000013_post_approvals_motivo_reasons.sql
-- Replaces the correction-reason value set: 'imagem_video'/'data' become
-- 'midia'/'texto' ('legenda'/'outro' unchanged). No production rows use
-- motivo yet (hub-approve's motivo support is not deployed there), so no
-- backfill is needed. Still phase 1 (spec §3): the CHECK stays permissive
-- on presence.
-- =====================================================================

alter table post_approvals drop constraint if exists post_approvals_motivo_value_check;
alter table post_approvals
  add constraint post_approvals_motivo_value_check
  check (motivo is null or motivo in ('legenda', 'midia', 'texto', 'outro'));
