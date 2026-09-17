-- =====================================================================
-- 20260923000008_post_content_versions_baseline_same_update.sql
-- Fixes a real gap in 20260923000007's "first sent to client" fallback:
-- when an unassigned post's first content edit ALSO transitions its
-- status to 'enviado_cliente' in the SAME UPDATE statement, the fallback
-- query (`select ... from post_status_events where to_status =
-- 'enviado_cliente'`) can't see that transition yet -- Postgres fires
-- same-timing AFTER ROW triggers in alphabetical order by trigger name,
-- and workflow_posts_content_version runs before workflow_posts_status_event
-- (the exact ordering hazard already documented and guarded against
-- elsewhere in this same function, for v_status_changed). The row this
-- lookup wants isn't inserted yet. Since no later edit creates another
-- baseline (v_tip.id is no longer null after this one), the post's
-- baseline is permanently stuck with no actor.
--
-- Fix: when the CURRENT update is itself the transition to
-- 'enviado_cliente' (old.status is distinct from new.status), the answer
-- to "who first sent it to the client" is unambiguous without needing to
-- read post_status_events at all -- it's whoever is making this update,
-- i.e. v_actor_name. This does not change the query-based fallback for
-- the ordinary case (status already changed in an earlier, separate
-- statement/transaction, so the row is already committed and visible).
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
    -- content, so this attributes to OLD's assignee (old.responsavel_id ->
    -- membros.nome, scoped to new.conta_id -- 20260923000007). When
    -- unassigned, falls back to whoever first sent the post to the client
    -- -- either a prior, already-committed post_status_events row, or, if
    -- THIS very update is itself that transition (same-statement hazard:
    -- this trigger fires before workflow_posts_status_event, so it can't
    -- see a row that doesn't exist yet), the current actor directly.
    if v_tip.id is null
       and (old.conteudo is not null or nullif(old.conteudo_plain, '') is not null
            or old.ig_caption is not null or old.tiktok_caption is not null)
    then
      v_baseline_at := least(old.updated_at, now() - interval '1 second');
      v_baseline_actor := null;
      if old.responsavel_id is not null then
        select nome into v_baseline_actor
          from membros
          where id = old.responsavel_id and conta_id = new.conta_id;
      end if;
      if v_baseline_actor is null then
        select actor_name into v_baseline_actor
          from post_status_events
          where post_id = new.id and to_status = 'enviado_cliente'
          order by created_at asc
          limit 1;
      end if;
      if v_baseline_actor is null
         and new.status = 'enviado_cliente'
         and old.status is distinct from new.status
      then
        v_baseline_actor := v_actor_name;
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
