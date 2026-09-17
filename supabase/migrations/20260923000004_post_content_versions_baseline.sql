-- =====================================================================
-- 20260923000004_post_content_versions_baseline.sql
-- Fixes a gap in 20260923000001: record_post_content_version() only fires
-- AFTER UPDATE, so the very first content-changing edit on any post writes
-- just the post-edit state -- the pre-edit state is never captured, because
-- nothing existed yet to diff it against. For a post whose content was set
-- once at creation and never touched again until, say, a client's edit
-- suggestion is accepted, that means the version-history drawer shows only
-- one row ("versão inicial") when it should show two: what it said before
-- and what it says now.
--
-- Fix: when record_post_content_version() finds no existing version row for
-- the post (v_tip.id is null), insert a synthetic baseline row from OLD.*
-- first, then fall through to the existing logic for the NEW state as
-- before. Also backfills posts already stuck in this state whose sole
-- existing version came from accept_edit_suggestion -- for those we can
-- recover the true pre-suggestion content from
-- post_edit_suggestions.original_*, which accept_edit_suggestion never
-- touches after the suggestion's first submission.
-- =====================================================================

create or replace function record_post_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor          uuid;
  v_source         text;
  v_actor_name     text;
  v_suggestion     bigint;
  v_changed        text[] := '{}';
  v_status_changed boolean;
  v_window         constant interval := interval '5 minutes';
  v_tip            post_content_versions;
begin
  begin
    v_actor := coalesce(nullif(current_setting('app.actor_id', true), '')::uuid, auth.uid());
    v_source := coalesce(
      nullif(current_setting('app.event_source', true), ''),
      case when v_actor is not null then 'workspace_user' else 'system' end
    );
    v_suggestion := nullif(current_setting('app.post_edit_suggestion_id', true), '')::bigint;

    if v_actor is not null then
      select nome into v_actor_name from profiles where id = v_actor;
    end if;

    if new.conteudo is distinct from old.conteudo then
      v_changed := array_append(v_changed, 'conteudo');
    end if;
    if new.conteudo_plain is distinct from old.conteudo_plain then
      v_changed := array_append(v_changed, 'conteudo_plain');
    end if;
    if new.ig_caption is distinct from old.ig_caption then
      v_changed := array_append(v_changed, 'ig_caption');
    end if;
    if new.tiktok_caption is distinct from old.tiktok_caption then
      v_changed := array_append(v_changed, 'tiktok_caption');
    end if;

    -- Same-statement status change breaks coalescing regardless of AFTER-
    -- trigger firing order (Postgres fires same-timing AFTER ROW triggers
    -- in alphabetical order by trigger name, not a guaranteed "status
    -- before content" order -- so a single UPDATE touching both status and
    -- content columns could race against workflow_posts_status_event not
    -- having inserted its row yet if we only checked post_status_events).
    -- Compares NEW/OLD directly so it's immune to that ordering. Matches
    -- every column workflow_posts_status_event's own trigger watches
    -- (20260606000001 for status, widened to include custom_status_id by
    -- 20260805000001_post_status_definitions.sql).
    v_status_changed :=
      new.status is distinct from old.status
      or new.custom_status_id is distinct from old.custom_status_id;

    -- Find the ACTUAL latest version row for this post -- NOT the latest
    -- row matching this actor/source. Filtering by actor/source in the
    -- WHERE clause would make a client-sourced row sitting between two
    -- workspace-user sessions invisible to this query, so an older row
    -- would get found and overwritten instead -- corrupting the "diff vs
    -- immediately preceding version" chain the UI relies on.
    select * into v_tip
      from post_content_versions
      where post_id = new.id
      order by last_touched_at desc
      limit 1;

    -- No version row exists yet for this post: this is the FIRST content-
    -- changing update it has ever gone through. Without a baseline, the
    -- row this trigger is about to write for NEW would be the only one
    -- ever recorded -- the pre-edit state (OLD) would be lost forever, even
    -- though it's still sitting right here. Snapshot it as its own row
    -- before proceeding, dated at old.updated_at (when that state became
    -- true), not now() -- nobody "edited into" this state, it's just what
    -- the post was born with or last held. Skipped when OLD carries no
    -- content at all -- workflow_posts.conteudo_plain defaults to '' (not
    -- null), so nullif() is required or every fresh post's default empty
    -- string would count as "content worth a baseline".
    if v_tip.id is null
       and (old.conteudo is not null or nullif(old.conteudo_plain, '') is not null
            or old.ig_caption is not null or old.tiktok_caption is not null)
    then
      insert into post_content_versions
        (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption,
         changed_fields, source, actor_user_id, actor_name, suggestion_id,
         created_at, last_touched_at)
      values
        (new.id, new.conta_id, old.conteudo, old.conteudo_plain, old.ig_caption, old.tiktok_caption,
         '{}', 'workspace_user', null, null, null,
         old.updated_at, old.updated_at);
    end if;

    if v_tip.id is not null
       and v_source <> 'client'                                    -- never coalesce client-sourced rows
       and v_tip.source = v_source
       and coalesce(v_tip.actor_user_id::text, '') = coalesce(v_actor::text, '')
       and v_tip.last_touched_at >= now() - v_window
       and not v_status_changed
       and not exists (
         select 1 from post_status_events
         where post_id = new.id and created_at > v_tip.last_touched_at
       )
    then
      update post_content_versions set
        conteudo        = new.conteudo,
        conteudo_plain  = new.conteudo_plain,
        ig_caption      = new.ig_caption,
        tiktok_caption  = new.tiktok_caption,
        changed_fields  = (
          select array_agg(distinct x order by x)
          from unnest(v_tip.changed_fields || v_changed) as x
        ),
        last_touched_at = now()
      where id = v_tip.id;
    else
      insert into post_content_versions
        (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption,
         changed_fields, source, actor_user_id, actor_name, suggestion_id,
         created_at, last_touched_at)
      values
        (new.id, new.conta_id, new.conteudo, new.conteudo_plain, new.ig_caption, new.tiktok_caption,
         v_changed, v_source, v_actor, v_actor_name, v_suggestion,
         now(), now());
    end if;
  exception when others then
    raise warning 'record_post_content_version failed for post %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

-- ---------- Backfill -----------------------------------------------------
-- Posts already stuck with exactly the bug above: their EARLIEST
-- post_content_versions row came from accept_edit_suggestion (suggestion_id
-- is not null), meaning it was the first-ever content update on that post
-- and no baseline was captured for it. Recover the true pre-suggestion
-- state from post_edit_suggestions.original_* (untouched since the
-- suggestion's first submission) and insert it dated at the suggestion's
-- own created_at, which is always strictly earlier than the accepted
-- version's created_at. tiktok_caption has no original_* counterpart (the
-- suggestion flow never offers it), so it's carried over unchanged from the
-- existing version row. Guarded by a `not exists` on an earlier row so this
-- is safe to run more than once.
insert into post_content_versions
  (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption,
   changed_fields, source, actor_user_id, actor_name, suggestion_id,
   created_at, last_touched_at)
select
  v.post_id, v.conta_id, s.original_conteudo, s.original_conteudo_plain, s.original_ig_caption,
  v.tiktok_caption,
  '{}', 'workspace_user', null, null, null,
  s.created_at, s.created_at
from post_content_versions v
join post_edit_suggestions s on s.id = v.suggestion_id
where v.id = (
  select v2.id from post_content_versions v2
  where v2.post_id = v.post_id
  order by v2.created_at asc
  limit 1
)
and v.suggestion_id is not null
and not exists (
  select 1 from post_content_versions earlier
  where earlier.post_id = v.post_id and earlier.created_at < v.created_at
);
