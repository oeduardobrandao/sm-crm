-- =====================================================================
-- 20261106000001_edit_suggestion_superseded_trigger.sql
--
-- Spec: docs/superpowers/specs/2026-10-29-edit-suggestion-no-auto-reject-design.md §3-§4.
--
-- Today any team edit of a post (conteudo, ig_caption or status) silently
-- rejects the client's pending Hub edit suggestion
-- (auto_reject_pending_suggestion, 20260521000001). The team saves a caption
-- fix and the client's suggestion vanishes with no review and no notice.
--
-- 1. status gains 'superseded': the suggestion was closed by the system, not
--    reviewed by a person (reviewed_by stays NULL). Distinct from 'rejected',
--    which is always a person's decision.
-- 2. The auto-reject trigger and its function are dropped. A team edit no
--    longer touches a pending suggestion; accept_edit_suggestion detects the
--    fields the team changed since (conflict handling lives in later
--    migrations of this change).
-- 3. close_suggestion_on_publish() replaces it: the only thing that still
--    closes a pending suggestion by itself is publication (status -> 'postado'),
--    because a published post can no longer take the edit. AFTER UPDATE so it
--    reads NEW.status after the BEFORE-row triggers ran, notably
--    workflow_posts_z1_reconcile_custom_status (a custom status can never
--    behave as 'postado', 20260805000001, so custom_status_id needs no entry
--    in the OF list). The accept RPC sets app.accepting_edit_suggestion while
--    it writes the post; the guard is kept.
-- 4. Backfill: every past auto-rejection has reviewed_by IS NULL, every manual
--    rejection (reject_edit_suggestion) stamps the reviewer, so the NULL ones
--    are reclassified as 'superseded'. reviewed_by is ON DELETE SET NULL, so a
--    rejection by a since-deleted user is also reclassified; accepted as noise.
--
-- Stale comment, not touched here: 20260928150001 §3b says record_client_approval
-- exists because "the auto-reject trigger would silently reject a pending
-- suggestion". The trigger is gone but the refusal stays valid (a client
-- approval would leave a pending suggestion on an approved post), so that
-- function is not re-created.
--
-- Note for readers of 20260923000004: original_* now means the per-field base
-- of the suggestion (what the client saw), no longer a snapshot of the whole
-- post. That applied migration is not edited.
--
-- Deploy: this migration, 20261106000002 and 20261106000003 go out in ONE
-- db push, never this one alone: without the trigger gone and before the new
-- accept, the old accept writes ig_caption unconditionally.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. status check
-- ---------------------------------------------------------------------
alter table post_edit_suggestions drop constraint if exists post_edit_suggestions_status_check;
alter table post_edit_suggestions add constraint post_edit_suggestions_status_check
  check (status in ('pending', 'accepted', 'rejected', 'superseded'));

-- ---------------------------------------------------------------------
-- 2. drop the auto-reject trigger
-- ---------------------------------------------------------------------
drop trigger if exists auto_reject_pending_suggestion on workflow_posts;
drop function if exists trg_auto_reject_pending_suggestion();

-- ---------------------------------------------------------------------
-- 3. close on publish
-- ---------------------------------------------------------------------
create or replace function close_suggestion_on_publish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- accept_edit_suggestion is applying the suggested content
  if nullif(current_setting('app.accepting_edit_suggestion', true), '') is not null then
    return new;
  end if;

  if new.status = 'postado' and old.status is distinct from 'postado' then
    update post_edit_suggestions
       set status      = 'superseded',
           reviewed_at = now()
     where post_id = new.id
       and status = 'pending';
  end if;

  return new;
end;
$$;

revoke all on function close_suggestion_on_publish() from public, anon, authenticated;
grant execute on function close_suggestion_on_publish() to service_role;

drop trigger if exists trg_close_suggestion_on_publish on workflow_posts;
create trigger trg_close_suggestion_on_publish
  after update of status on workflow_posts
  for each row execute function close_suggestion_on_publish();

-- ---------------------------------------------------------------------
-- 4. backfill past auto-rejections
-- ---------------------------------------------------------------------
update post_edit_suggestions set status = 'superseded' where status = 'rejected' and reviewed_by is null;
