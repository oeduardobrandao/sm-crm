\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for record_post_content_version() (20260923000001), the capture
-- trigger behind post_content_versions. This is the one piece of real
-- logic in the version-history feature -- the coalescing algorithm -- so
-- unlike 94 (which tests RLS as `authenticated`), this suite drives REAL
-- UPDATE workflow_posts statements through the REAL trigger as the table
-- owner (matching how migrations apply, and how 74_workflow_analytics
-- drives record_post_status_event/record_client_approval) and asserts on
-- the resulting post_content_versions rows directly.
--
-- ACTOR RESOLUTION: auth.uid() reads request.jwt.claims regardless of
-- role, so `perform set_config('request.jwt.claims', ...)` alone is enough
-- to make the trigger resolve a workspace_user actor -- no `set local role
-- authenticated` / et_grant_hosted_parity() needed here (that machinery is
-- only for proving RLS, which 94 already covers).
--
-- TRANSACTION NOW() GOTCHA (same as suite 74): now() is fixed for the
-- whole `do $$ ... $$` block, so two statements in the same section share
-- one timestamp. Sections that need a controlled ordering between a
-- version row and a post_status_events row backdate the version row's
-- created_at/last_touched_at directly via UPDATE (postgres bypasses RLS),
-- then let the status event land at the block's real now(), which is
-- later by construction.

-- =====================================================================
-- 1. Same-actor rapid edits coalesce into one row; changed_fields unions
--    across the coalesced saves.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint;
  v_count int;
  v_row post_content_versions;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  update workflow_posts set conteudo_plain = 'v1' where id = v_post;
  update workflow_posts set ig_caption = 'caption v1' where id = v_post;

  select count(*) into v_count from post_content_versions where post_id = v_post;
  assert v_count = 1,
    format('two rapid same-actor edits must coalesce into 1 row, got %s', v_count);

  select * into v_row from post_content_versions where post_id = v_post;
  assert v_row.conteudo_plain = 'v1', 'coalesced row must carry the latest conteudo_plain';
  assert v_row.ig_caption = 'caption v1', 'coalesced row must carry the latest ig_caption';
  assert v_row.changed_fields @> ARRAY['conteudo_plain','ig_caption']
     and v_row.changed_fields <@ ARRAY['conteudo_plain','ig_caption'],
    format('changed_fields must union both edits, got %s', v_row.changed_fields);
  assert v_row.source = 'workspace_user', format('expected workspace_user source, got %s', v_row.source);
  assert v_row.actor_user_id = v_user, 'coalesced row must attribute to the acting user';

  raise notice 'PASS 95.1 same-actor rapid edits coalesce into one row with unioned changed_fields';
end $$;
rollback;

-- =====================================================================
-- 2. A different actor breaks coalescing, even with no status change and
--    well inside the 5-minute window.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user_a uuid := gen_random_uuid(); v_user_b uuid := gen_random_uuid();
  v_cli bigint; v_post bigint;
  v_count int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user_a), (v_user_b);
  insert into workspace_members (user_id, workspace_id, role) values (v_user_a, v_ws, 'owner');
  insert into workspace_members (user_id, workspace_id, role) values (v_user_b, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user_a;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user_b;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user_a, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  update workflow_posts set conteudo_plain = 'from A' where id = v_post;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b)::text, true);
  update workflow_posts set conteudo_plain = 'from B' where id = v_post;

  select count(*) into v_count from post_content_versions where post_id = v_post;
  assert v_count = 2,
    format('a different actor must break coalescing even inside the window, got %s rows', v_count);

  assert (select actor_user_id from post_content_versions where post_id = v_post order by id asc limit 1) = v_user_a,
    'first row must attribute to user A';
  assert (select actor_user_id from post_content_versions where post_id = v_post order by id desc limit 1) = v_user_b,
    'second row must attribute to user B';

  raise notice 'PASS 95.2 a different actor breaks coalescing (2 rows, correctly attributed)';
end $$;
rollback;

-- =====================================================================
-- 3. An intervening post_status_events row breaks coalescing, even for
--    the same actor/source and well inside the window.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint;
  v_count int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  update workflow_posts set conteudo_plain = 'before status change' where id = v_post;

  -- Backdate the tip so the block's real now() (used by the status event
  -- below) is unambiguously later -- see the transaction-now() note above.
  update post_content_versions
     set created_at = timestamptz '2026-01-01 10:00:00+00',
         last_touched_at = timestamptz '2026-01-01 10:00:00+00'
   where post_id = v_post;

  -- Pure status change: touches only `status`, so only
  -- workflow_posts_status_event fires, not the content trigger.
  update workflow_posts set status = 'revisao_interna' where id = v_post;

  update workflow_posts set conteudo_plain = 'after status change' where id = v_post;

  select count(*) into v_count from post_content_versions where post_id = v_post;
  assert v_count = 2,
    format('an intervening post_status_events row must break coalescing, got %s rows', v_count);
  assert (select conteudo_plain from post_content_versions where post_id = v_post order by id desc limit 1) = 'after status change',
    'the second (post-status-change) row must carry the newer content';

  raise notice 'PASS 95.3 an intervening post_status_events row breaks coalescing';
end $$;
rollback;

-- =====================================================================
-- 4. Same-statement status+content change breaks coalescing via the
--    direct NEW/OLD comparison, immune to same-timing AFTER-trigger
--    firing order (alphabetically, workflow_posts_content_version fires
--    BEFORE workflow_posts_status_event, so the post_status_events row
--    does not exist yet when this trigger runs -- the NOT EXISTS check
--    alone would miss it; v_status_changed must not).
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint;
  v_count int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  update workflow_posts set conteudo_plain = 'before combined update' where id = v_post;

  -- Single statement: status AND content change together.
  update workflow_posts
     set status = 'aprovado_interno', conteudo_plain = 'combined edit'
   where id = v_post;

  select count(*) into v_count from post_content_versions where post_id = v_post;
  assert v_count = 2,
    format('a same-statement status+content change must break coalescing regardless of trigger firing order, got %s rows', v_count);
  assert (select conteudo_plain from post_content_versions where post_id = v_post order by id desc limit 1) = 'combined edit',
    'the second row must carry the combined update''s content';
  assert (select to_status from post_status_events where post_id = v_post order by id desc limit 1) = 'aprovado_interno',
    'setup sanity: the status side of the combined update must also have been audited';

  raise notice 'PASS 95.4 same-statement status+content change breaks coalescing (immune to trigger name-ordering)';
end $$;
rollback;

-- =====================================================================
-- 5. accept_edit_suggestion always produces a fresh, source='client' row
--    linked via suggestion_id -- even for the same post/actor and well
--    inside the coalescing window.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_post bigint; v_suggestion bigint;
  v_count int;
  v_row post_content_versions;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_post;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- R1: an ordinary workspace_user edit, same actor/source that will
  -- accept the suggestion below -- if source alone gated coalescing this
  -- would wrongly merge.
  update workflow_posts set conteudo_plain = 'team draft' where id = v_post;

  insert into post_edit_suggestions
    (post_id, conta_id, token, original_conteudo_plain, suggested_conteudo_plain, changed_fields, status)
    values (v_post, v_ws, 'tok', 'team draft', 'client requested text', ARRAY['conteudo_plain'], 'pending')
    returning id into v_suggestion;

  perform accept_edit_suggestion(v_suggestion);
  perform set_config('app.event_source', '', true);
  perform set_config('app.post_edit_suggestion_id', '', true);
  perform set_config('app.accepting_edit_suggestion', '', true);

  select count(*) into v_count from post_content_versions where post_id = v_post;
  assert v_count = 2,
    format('accept_edit_suggestion must always produce a fresh row, even inside the coalescing window, got %s rows', v_count);

  select * into v_row from post_content_versions where post_id = v_post order by id desc limit 1;
  assert v_row.source = 'client', format('the accepted-suggestion row must carry source=client, got %s', v_row.source);
  assert v_row.suggestion_id = v_suggestion, 'the accepted-suggestion row must link back via suggestion_id';
  assert v_row.actor_user_id = v_user,
    'actor_user_id must still resolve to the accepting workspace user (auth.uid() fallback), even though source=client';
  assert v_row.conteudo_plain = 'client requested text',
    format('the accepted-suggestion row must carry the suggested text, got %s', v_row.conteudo_plain);

  assert (select status from post_edit_suggestions where id = v_suggestion) = 'accepted',
    'setup sanity: the suggestion itself must be marked accepted';

  raise notice 'PASS 95.5 accept_edit_suggestion always produces a fresh source=client row linked via suggestion_id';
end $$;
rollback;
