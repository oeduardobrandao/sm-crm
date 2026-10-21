-- =====================================================================
-- 20260923000001_post_content_versions.sql
-- Google-Docs-style content version history for workflow_posts.
-- Mirrors post_status_events (20260606000001): single-writer SECURITY
-- DEFINER trigger, best-effort (RAISE WARNING on failure, never blocks the
-- content save), SELECT-only RLS for workspace users, zero INSERT/UPDATE/
-- DELETE policy for authenticated (dispute evidence -- must be impossible
-- to tamper with from a client-scoped session).
-- =====================================================================

-- ---------- Table -----------------------------------------------------
create table if not exists post_content_versions (
  id               bigserial primary key,
  post_id          bigint not null references workflow_posts(id) on delete cascade,
  conta_id         uuid   not null,

  -- Full snapshot of all four content fields as of this version (not a
  -- delta) -- makes rendering/diffing any version trivial without
  -- reconstructing state from a chain of patches.
  conteudo         jsonb,
  conteudo_plain   text,
  ig_caption       text,
  tiktok_caption   text,

  -- Which fields differ from this version's immediate predecessor. Unioned
  -- across coalesced saves.
  changed_fields   text[] not null default '{}',

  source           text   not null
                   check (source in ('workspace_user', 'client', 'system')),
  actor_user_id    uuid,
  actor_name       text,

  -- Set only when this version came from accept_edit_suggestion, so the UI
  -- can link back to the original client suggestion.
  suggestion_id    bigint references post_edit_suggestions(id) on delete set null,

  -- created_at = when this version GROUP started; last_touched_at = when it
  -- was last coalesced into. Equal for a single, non-coalesced save. The UI
  -- shows a time range ("14:32-14:41") when they differ, and sorts/anchors
  -- on last_touched_at (not created_at) -- see record_post_content_version.
  created_at       timestamptz not null default now(),
  last_touched_at  timestamptz not null default now()
);

create index if not exists idx_post_content_versions_post_created_at
  on post_content_versions (post_id, created_at);
create index if not exists idx_post_content_versions_post_last_touched
  on post_content_versions (post_id, last_touched_at);

-- ---------- Capture trigger (single writer, best-effort, coalescing) ---
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

drop trigger if exists workflow_posts_content_version on workflow_posts;
create trigger workflow_posts_content_version
  after update of conteudo, conteudo_plain, ig_caption, tiktok_caption on workflow_posts
  for each row
  when (
    new.conteudo is distinct from old.conteudo
    or new.conteudo_plain is distinct from old.conteudo_plain
    or new.ig_caption is distinct from old.ig_caption
    or new.tiktok_caption is distinct from old.tiktok_caption
  )
  execute function record_post_content_version();

-- ---------- RLS -------------------------------------------------------
alter table post_content_versions enable row level security;

drop policy if exists post_content_versions_select on post_content_versions;
create policy post_content_versions_select on post_content_versions
  for select using (conta_id in (select public.get_my_conta_id()));
-- No INSERT/UPDATE/DELETE policy: only the SECURITY DEFINER trigger and
-- service_role write to this table.

drop policy if exists service_role_bypass_post_content_versions on post_content_versions;
create policy service_role_bypass_post_content_versions on post_content_versions
  for all to service_role using (true) with check (true);

-- =====================================================================
-- Fix accept_edit_suggestion: today it applies the client's suggested text
-- without setting any GUC, so the resulting content-version row falls
-- through to auth.uid() -- i.e. gets attributed to the WORKSPACE USER who
-- clicked Accept, not to the client whose text it actually is.
-- =====================================================================
create or replace function accept_edit_suggestion(
  p_suggestion_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_suggestion record;
begin
  select * into v_suggestion
    from post_edit_suggestions
    where id = p_suggestion_id
    for update;

  if v_suggestion is null then
    raise exception 'Suggestion not found';
  end if;

  if v_suggestion.status <> 'pending' then
    raise exception 'Suggestion is not pending (status: %)', v_suggestion.status;
  end if;

  perform set_config('app.accepting_edit_suggestion', v_suggestion.id::text, true);

  -- source is forced to 'client' (the TEXT is client-authored), while
  -- actor_user_id still resolves to auth.uid() -- the accepting workspace
  -- user -- via the trigger's own fallback. That's correct, not a bug: it
  -- records who let this text into the record, while `source` correctly
  -- records where the text came from. The UI's actor label already ignores
  -- actor_name when source = 'client' (renders "Cliente" instead).
  perform set_config('app.event_source', 'client', true);
  perform set_config('app.post_edit_suggestion_id', v_suggestion.id::text, true);

  update workflow_posts set
    conteudo       = coalesce(v_suggestion.suggested_conteudo, conteudo),
    conteudo_plain = coalesce(v_suggestion.suggested_conteudo_plain, conteudo_plain),
    ig_caption     = v_suggestion.suggested_ig_caption
  where id = v_suggestion.post_id;

  update post_edit_suggestions set
    status      = 'accepted',
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_suggestion_id;
end;
$$;

revoke all on function accept_edit_suggestion(bigint) from public;
grant execute on function accept_edit_suggestion(bigint) to authenticated;
grant execute on function accept_edit_suggestion(bigint) to service_role;
