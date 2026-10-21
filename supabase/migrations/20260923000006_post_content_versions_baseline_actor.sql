-- =====================================================================
-- 20260923000006_post_content_versions_baseline_actor.sql
-- The baseline row added in 20260923000004 renders as "—" in the
-- version-history drawer (actor_name is null, and there is no reliable
-- "who wrote this" fact anywhere -- workflow_posts has no created_by
-- column, and no audit trail records post-creation/first-edit authorship).
--
-- Per product decision: attribute the baseline to the post's assignee
-- (workflow_posts.responsavel_id -> membros.nome) as a best-effort label
-- instead of leaving it blank. This is NOT a claim that the assignee wrote
-- the content -- just the closest available "who this post belongs to" at
-- the time. Left null (renders "—") when the post has no assignee.
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
  v_baseline_at    timestamptz;
  v_baseline_actor text;
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
    -- before proceeding. Skipped when OLD carries no content at all --
    -- workflow_posts.conteudo_plain defaults to '' (not null), so nullif()
    -- is required or every fresh post's default empty string would count
    -- as "content worth a baseline".
    --
    -- Timestamp: prefer old.updated_at (when that state genuinely became
    -- true), but never later than 1 second before THIS row's own now() --
    -- old.updated_at is transaction-stable, so a post created and edited in
    -- the same transaction would otherwise tie exactly with the edit's own
    -- now() below (20260923000005).
    --
    -- Actor: no column records who actually wrote a post's original
    -- content (see migration header), so this attributes to OLD's
    -- assignee (old.responsavel_id -> membros.nome) as a best-effort
    -- label, not a verified author. Null when unassigned -- the UI already
    -- renders a null actor_name as "—".
    if v_tip.id is null
       and (old.conteudo is not null or nullif(old.conteudo_plain, '') is not null
            or old.ig_caption is not null or old.tiktok_caption is not null)
    then
      v_baseline_at := least(old.updated_at, now() - interval '1 second');
      v_baseline_actor := null;
      if old.responsavel_id is not null then
        select nome into v_baseline_actor from membros where id = old.responsavel_id;
      end if;
      insert into post_content_versions
        (post_id, conta_id, conteudo, conteudo_plain, ig_caption, tiktok_caption,
         changed_fields, source, actor_user_id, actor_name, suggestion_id,
         created_at, last_touched_at)
      values
        (new.id, new.conta_id, old.conteudo, old.conteudo_plain, old.ig_caption, old.tiktok_caption,
         '{}', 'workspace_user', null, v_baseline_actor, null,
         v_baseline_at, v_baseline_at);
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

-- ---------- Backfill: attribute already-existing baseline rows ---------
-- Baseline rows inserted by 20260923000004 (both by the trigger, if any
-- fired between that migration and this one, and by its one-time backfill)
-- carry actor_name = null. There is no point-in-time responsavel_id to
-- recover for them, so this uses the post's CURRENT assignee as the same
-- best-effort label the trigger now applies going forward. Guarded to only
-- touch rows matching the synthetic-baseline signature untouched since
-- insertion (actor_name still null), so it's safe to run more than once
-- and never overwrites a real actor.
update post_content_versions v
set actor_name = m.nome
from workflow_posts wp
join membros m on m.id = wp.responsavel_id
where v.post_id = wp.id
  and v.changed_fields = '{}'
  and v.source = 'workspace_user'
  and v.actor_user_id is null
  and v.actor_name is null
  and v.suggestion_id is null;
