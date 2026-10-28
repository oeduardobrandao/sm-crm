\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the task comment thread (20261103000001_tarefa_comentarios.sql):
-- tenant isolation, the RPC-only write path, author-only edit/delete, the
-- 'tarefa_comentario' mention host type and the deduped task_comment notification.
-- Spec: docs/superpowers/specs/2026-10-28-tarefas-kpis-comentarios-historico-design.md (section 2).
--
-- tarefa_comentarios is excluded from the parity helper everywhere, so every block tests
-- the migration's own grants (REVOKE ALL + SELECT, DELETE, UPDATE (conteudo)).

-- =====================================================================
-- Shared seed (session-temporary; each block rolls back its data)
--   ws A ('max', 5 members): a (owner, Ana), resp (assignee of t1, Rui), c (creator of t1,
--     Cris), e (earlier commenter on t1, Edu), o (other member, Olga)
--   ws B: bu (owner), membro m_b (Beto), task tb
--   t1 in A: user_id = c, responsavel = m_resp, one earlier comment by e written directly
--     (no RPC, so it notifies nobody)
-- =====================================================================
create or replace function pg_temp.tc_seed() returns jsonb language plpgsql as $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_a uuid := gen_random_uuid(); v_resp uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid(); v_e uuid := gen_random_uuid();
  v_o uuid := gen_random_uuid(); v_bu uuid := gen_random_uuid();
  v_m_a bigint; v_m_resp bigint; v_m_c bigint; v_m_e bigint; v_m_o bigint; v_m_b bigint;
  v_t1 bigint; v_tb bigint;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_a), (v_resp), (v_c), (v_e), (v_o), (v_bu);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_a, v_ws_a, 'owner'), (v_resp, v_ws_a, 'agent'), (v_c, v_ws_a, 'agent'),
    (v_e, v_ws_a, 'agent'), (v_o, v_ws_a, 'agent'), (v_bu, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_a, v_resp, v_c, v_e, v_o);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_bu;

  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Ana', v_a) returning id into v_m_a;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Rui', v_resp) returning id into v_m_resp;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Cris', v_c) returning id into v_m_c;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Edu', v_e) returning id into v_m_e;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Olga', v_o) returning id into v_m_o;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_bu, v_ws_b, 'Beto', v_bu) returning id into v_m_b;

  insert into tarefas (conta_id, user_id, titulo, responsavel_id)
    values (v_ws_a, v_c, 'Tarefa A', v_m_resp) returning id into v_t1;
  insert into tarefas (conta_id, user_id, titulo)
    values (v_ws_b, v_bu, 'Tarefa B') returning id into v_tb;

  insert into tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo)
    values (v_ws_a, v_t1, v_e, 'comentario antigo');

  return jsonb_build_object(
    'ws_a', v_ws_a, 'ws_b', v_ws_b,
    'a', v_a, 'resp', v_resp, 'c', v_c, 'e', v_e, 'o', v_o, 'bu', v_bu,
    'm_a', v_m_a, 'm_resp', v_m_resp, 'm_c', v_m_c, 'm_e', v_m_e, 'm_o', v_m_o, 'm_b', v_m_b,
    't1', v_t1, 'tb', v_tb);
end $$;

create or replace function pg_temp.tc_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end $$;

-- unread task_comment rows of a user for a task
create or replace function pg_temp.tc_unread(p_user uuid, p_task bigint) returns int language sql as $$
  select count(*)::int from notifications
   where type = 'task_comment' and user_id = p_user and metadata->>'task_id' = p_task::text
     and read_at is null and dismissed_at is null;
$$;

-- =====================================================================
-- foreign_workspace_cannot_read
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_bu uuid := s->>'bu'; v_t1 bigint := s->>'t1';
  v_n int;
begin
  perform pg_temp.tc_as(v_a);
  perform tarefa_comentario_enviar(v_t1, 'oi');
  select count(*) into v_n from tarefa_comentarios where tarefa_id = v_t1;
  assert v_n = 2, format('member of A must read both comments of t1, got %s', v_n);

  perform pg_temp.tc_as(v_bu);
  select count(*) into v_n from tarefa_comentarios;
  assert v_n = 0, format('member of B must read 0 of A''s comments, got %s', v_n);
  reset role;

  raise notice 'PASS tarefa_comentarios.foreign_workspace_cannot_read';
end $$;
rollback;

-- =====================================================================
-- rpc_rejects_foreign_task (plus the content guards)
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_bu uuid := s->>'bu';
  v_t1 bigint := s->>'t1'; v_tb bigint := s->>'tb';
  v_state text; v_bad text; v_n int; v_row tarefa_comentarios;
begin
  -- B calls the RPC on A's task
  perform pg_temp.tc_as(v_bu);
  v_state := null;
  begin
    perform tarefa_comentario_enviar(v_t1, 'intruso');
  exception when others then v_state := sqlstate;
  end;
  assert v_state = 'P0002', format('member of B commenting on A''s task must raise P0002, got %s', v_state);

  -- A calls it on B's task, and on a task id that does not exist
  perform pg_temp.tc_as(v_a);
  foreach v_bad in array array['task_b', 'missing', 'empty', 'blank', 'long'] loop
    v_state := null;
    begin
      case v_bad
        when 'task_b'  then perform tarefa_comentario_enviar(v_tb, 'intruso');
        when 'missing' then perform tarefa_comentario_enviar(-1, 'intruso');
        when 'empty'   then perform tarefa_comentario_enviar(v_t1, '');
        when 'blank'   then perform tarefa_comentario_enviar(v_t1, '   ');
        when 'long'    then perform tarefa_comentario_enviar(v_t1, repeat('x', 4001));
      end case;
    exception when others then v_state := sqlerrm;
    end;
    assert v_state = case v_bad
        when 'task_b'  then 'tarefa_not_found'
        when 'missing' then 'tarefa_not_found'
        when 'long'    then 'content_too_long'
        else 'content_empty' end,
      format('enviar case %s raised %L', v_bad, v_state);
  end loop;

  -- 4000 characters is the inclusive limit; content is trimmed; author is the caller
  perform tarefa_comentario_enviar(v_t1, repeat('y', 4000));
  select * into v_row from tarefa_comentario_enviar(v_t1, '  oi  ');
  assert v_row.author_id = v_a, 'enviar must write author_id = caller';
  assert v_row.conteudo = 'oi', format('enviar must store trimmed content, got %L', v_row.conteudo);
  assert v_row.edited_at is null, 'a new comment must not be marked edited';
  reset role;

  select count(*) into v_n from tarefa_comentarios where conteudo in ('intruso', '', '   ');
  assert v_n = 0, 'rejected sends must write nothing';

  raise notice 'PASS tarefa_comentarios.rpc_rejects_foreign_task';
end $$;
rollback;

-- =====================================================================
-- direct_insert_denied (plus grants, function privileges, realtime, notification types)
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_t1 bigint := s->>'t1';
  v_state text;
begin
  perform pg_temp.tc_as(v_a);
  v_state := null;
  begin
    insert into tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo)
      values (v_ws_a, v_t1, v_a, 'direto');
  exception when insufficient_privilege then v_state := sqlstate;
  end;
  assert v_state = '42501', format('direct INSERT by authenticated must raise 42501, got %s', v_state);
  reset role;

  -- An INSERT with no policy also raises 42501 through RLS, so assert the grant itself.
  assert not has_table_privilege('authenticated', 'public.tarefa_comentarios', 'insert'),
    'authenticated must not hold INSERT on tarefa_comentarios';
  assert has_table_privilege('authenticated', 'public.tarefa_comentarios', 'select'),
    'authenticated must select tarefa_comentarios';
  assert has_table_privilege('authenticated', 'public.tarefa_comentarios', 'delete'),
    'authenticated must delete (own) tarefa_comentarios';
  assert not has_table_privilege('authenticated', 'public.tarefa_comentarios', 'update'),
    'authenticated must not hold table-wide UPDATE';
  assert has_column_privilege('authenticated', 'public.tarefa_comentarios', 'conteudo', 'update'),
    'authenticated must update conteudo';
  assert not has_column_privilege('authenticated', 'public.tarefa_comentarios', 'author_id', 'update'),
    'authenticated must not update author_id';
  assert not has_column_privilege('authenticated', 'public.tarefa_comentarios', 'edited_at', 'update'),
    'authenticated must not update edited_at';
  assert not has_table_privilege('anon', 'public.tarefa_comentarios', 'select'),
    'anon must not read tarefa_comentarios';

  assert has_function_privilege('authenticated', 'public.tarefa_comentario_enviar(bigint,text)', 'execute'),
    'authenticated must execute tarefa_comentario_enviar';
  assert not has_function_privilege('anon', 'public.tarefa_comentario_enviar(bigint,text)', 'execute'),
    'anon must not execute tarefa_comentario_enviar';

  assert exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                 and schemaname = 'public' and tablename = 'tarefa_comentarios'),
    'tarefa_comentarios must be in supabase_realtime';

  -- the new type is accepted by both CHECKs
  insert into notifications (workspace_id, user_id, type, metadata)
    values (v_ws_a, v_a, 'task_comment', jsonb_build_object('task_id', '1'));
  insert into notification_inapp_prefs (user_id, type, enabled) values (v_a, 'task_comment', false);

  raise notice 'PASS tarefa_comentarios.direct_insert_denied';
end $$;
rollback;

-- =====================================================================
-- only_author_updates_and_deletes
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_o uuid := s->>'o'; v_t1 bigint := s->>'t1';
  v_id bigint; v_n int; v_edited timestamptz; v_conteudo text;
begin
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'original');

  -- another member of A
  perform pg_temp.tc_as(v_o);
  update tarefa_comentarios set conteudo = 'hack' where id = v_id;
  get diagnostics v_n = row_count;
  assert v_n = 0, format('non-author UPDATE must affect 0 rows, got %s', v_n);
  delete from tarefa_comentarios where id = v_id;
  get diagnostics v_n = row_count;
  assert v_n = 0, format('non-author DELETE must affect 0 rows, got %s', v_n);

  -- the author
  perform pg_temp.tc_as(v_a);
  update tarefa_comentarios set conteudo = 'editado' where id = v_id;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('author UPDATE must affect 1 row, got %s', v_n);
  reset role;
  select conteudo, edited_at into v_conteudo, v_edited from tarefa_comentarios where id = v_id;
  assert v_conteudo = 'editado', format('content must be the author''s edit, got %L', v_conteudo);
  assert v_edited is not null, 'edited_at must be set after the author''s update';

  perform pg_temp.tc_as(v_a);
  delete from tarefa_comentarios where id = v_id;
  get diagnostics v_n = row_count;
  assert v_n = 1, format('author DELETE must affect 1 row, got %s', v_n);
  reset role;

  raise notice 'PASS tarefa_comentarios.only_author_updates_and_deletes';
end $$;
rollback;

-- =====================================================================
-- participants_notified_once
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_ws_a uuid := s->>'ws_a';
  v_a uuid := s->>'a'; v_resp uuid := s->>'resp'; v_c uuid := s->>'c';
  v_e uuid := s->>'e'; v_o uuid := s->>'o'; v_bu uuid := s->>'bu';
  v_t1 bigint := s->>'t1'; v_m_resp bigint := s->>'m_resp';
  v_t2 bigint; v_users uuid[]; v_meta jsonb; v_link text; v_n int;
begin
  perform pg_temp.tc_as(v_a);
  perform tarefa_comentario_enviar(v_t1, 'primeiro @[Ninguem](tarefa:1) comentario');
  reset role;

  select array_agg(user_id order by user_id) into v_users
    from notifications where type = 'task_comment' and metadata->>'task_id' = v_t1::text;
  assert v_users = (select array_agg(u order by u) from unnest(array[v_resp, v_c, v_e]) u),
    format('task_comment must reach assignee, creator and earlier commenter once each, got %s', v_users);
  assert pg_temp.tc_unread(v_a, v_t1) = 0, 'the author must not be notified';

  select metadata, link into v_meta, v_link
    from notifications where type = 'task_comment' and user_id = v_resp;
  assert v_link = '/tarefas?tarefa=' || v_t1 || '&comentarios=1', format('task_comment link, got %s', v_link);
  assert v_meta->>'task_id' = v_t1::text and v_meta->>'task_title' = 'Tarefa A'
     and v_meta->>'author_name' = 'Ana' and v_meta->'authors' = '["Ana"]'::jsonb
     and v_meta->>'count' = '1'
     and v_meta->>'preview' = 'primeiro @Ninguem comentario',
    format('task_comment metadata, got %s', v_meta);

  -- creator = assignee on t2: one row, no "cannot affect row a second time";
  -- an earlier commenter who left the workspace is not notified.
  insert into tarefas (conta_id, user_id, titulo, responsavel_id)
    values (v_ws_a, v_resp, 'Tarefa 2', v_m_resp) returning id into v_t2;
  insert into tarefa_comentarios (conta_id, tarefa_id, author_id, conteudo)
    values (v_ws_a, v_t2, v_o, 'antigo');
  delete from workspace_members where user_id = v_o and workspace_id = v_ws_a;

  perform pg_temp.tc_as(v_a);
  perform tarefa_comentario_enviar(v_t2, 'oi');
  reset role;
  assert pg_temp.tc_unread(v_resp, v_t2) = 1, 'creator who is also the assignee must get exactly one row';
  select count(*) into v_n from notifications where type = 'task_comment' and metadata->>'task_id' = v_t2::text;
  assert v_n = 1, format('t2 must notify only its creator/assignee, got %s rows', v_n);
  assert pg_temp.tc_unread(v_bu, v_t1) = 0, 'a user of another workspace is never notified';

  raise notice 'PASS tarefa_comentarios.participants_notified_once';
end $$;
rollback;

-- =====================================================================
-- second_comment_upserts
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_resp uuid := s->>'resp'; v_c uuid := s->>'c'; v_e uuid := s->>'e';
  v_t1 bigint := s->>'t1';
  v_meta jsonb; v_n int;
begin
  perform pg_temp.tc_as(v_a);
  perform tarefa_comentario_enviar(v_t1, 'um');
  perform pg_temp.tc_as(v_c);
  perform tarefa_comentario_enviar(v_t1, 'dois');
  reset role;

  assert pg_temp.tc_unread(v_resp, v_t1) = 1, 'assignee must keep one unread row';
  select metadata into v_meta from notifications where type = 'task_comment' and user_id = v_resp;
  assert v_meta->>'count' = '2', format('count must be 2, got %s', v_meta->>'count');
  assert v_meta->>'author_name' = 'Cris', format('author_name must be the last author, got %s', v_meta->>'author_name');
  assert v_meta->'authors' = '["Cris", "Ana"]'::jsonb, format('authors, got %s', v_meta->'authors');
  assert v_meta->>'preview' = 'dois', format('preview must be the last comment, got %s', v_meta->>'preview');

  assert pg_temp.tc_unread(v_e, v_t1) = 1, 'earlier commenter must keep one unread row';
  select (metadata->>'count')::int into v_n from notifications where type = 'task_comment' and user_id = v_e;
  assert v_n = 2, format('earlier commenter count must be 2, got %s', v_n);
  -- a became a participant through the first comment; c wrote the second, so c stays at 1
  select (metadata->>'count')::int into v_n from notifications where type = 'task_comment' and user_id = v_a;
  assert v_n = 1, format('first author must be notified of the second comment, got %s', v_n);
  select (metadata->>'count')::int into v_n from notifications where type = 'task_comment' and user_id = v_c;
  assert v_n = 1, format('second author must not be notified of their own comment, got %s', v_n);

  -- once read, the next comment opens a new card
  update notifications set read_at = now() where type = 'task_comment' and user_id = v_resp;
  perform pg_temp.tc_as(v_a);
  perform tarefa_comentario_enviar(v_t1, 'tres');
  reset role;
  select count(*) into v_n from notifications where type = 'task_comment' and user_id = v_resp;
  assert v_n = 2, format('a read card must not absorb new comments, got %s rows', v_n);

  raise notice 'PASS tarefa_comentarios.second_comment_upserts';
end $$;
rollback;

-- =====================================================================
-- mentioned_gets_mention_not_task_comment
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_resp uuid := s->>'resp'; v_c uuid := s->>'c';
  v_t1 bigint := s->>'t1'; v_m_resp bigint := s->>'m_resp';
  v_id bigint; v_meta jsonb; v_link text; v_n int;
begin
  perform pg_temp.tc_as(v_a);
  perform tarefa_comentario_enviar(v_t1, 'sem mencao');
  select id into v_id from tarefa_comentario_enviar(v_t1, 'oi @[Rui](membro:' || v_m_resp || ')');
  reset role;

  select count(*) into v_n from mencoes
   where host_type = 'tarefa_comentario' and host_id = v_id and mentioned_membro_id = v_m_resp;
  assert v_n = 1, format('the RPC must record the mention, got %s rows', v_n);

  select link, metadata into v_link, v_meta from notifications where type = 'mention' and user_id = v_resp;
  assert v_link = '/tarefas?tarefa=' || v_t1 || '&comentarios=1', format('mention link, got %s', v_link);
  assert v_meta->>'host_type' = 'tarefa_comentario' and v_meta->>'context_title' = 'Tarefa A'
     and (v_meta->>'task_id')::bigint = v_t1 and v_meta->>'actor_name' = 'Ana'
     and v_meta ? 'excerpt',
    format('mention metadata, got %s', v_meta);

  assert pg_temp.tc_unread(v_resp, v_t1) = 1, 'mentioned assignee keeps a single task_comment row';
  select metadata into v_meta from notifications where type = 'task_comment' and user_id = v_resp;
  assert v_meta->>'count' = '1', format('the mentioning comment must not update the task_comment, got %s', v_meta->>'count');
  select (metadata->>'count')::int into v_n from notifications where type = 'task_comment' and user_id = v_c;
  assert v_n = 2, format('other participants are still notified, got %s', v_n);

  raise notice 'PASS tarefa_comentarios.mentioned_gets_mention_not_task_comment';
end $$;
rollback;

-- =====================================================================
-- foreign_membro_mention_dropped
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_bu uuid := s->>'bu'; v_t1 bigint := s->>'t1'; v_m_b bigint := s->>'m_b';
  v_id bigint; v_n int;
begin
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'oi @[Beto](membro:' || v_m_b || ')');
  reset role;

  select count(*) into v_n from mencoes where host_type = 'tarefa_comentario' and host_id = v_id;
  assert v_n = 0, format('a mention of another workspace''s membro must be dropped, got %s', v_n);
  select count(*) into v_n from notifications where user_id = v_bu;
  assert v_n = 0, format('the foreign user must get nothing, got %s', v_n);

  raise notice 'PASS tarefa_comentarios.foreign_membro_mention_dropped';
end $$;
rollback;

-- =====================================================================
-- edit_adds_mention
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_resp uuid := s->>'resp';
  v_t1 bigint := s->>'t1'; v_m_resp bigint := s->>'m_resp';
  v_id bigint; v_n int; v_link text;
begin
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'sem mencao');
  update tarefa_comentarios set conteudo = 'agora @[Rui](membro:' || v_m_resp || ')' where id = v_id;
  perform sync_mentions('tarefa_comentario', v_id, array[v_m_resp]);
  reset role;

  select count(*) into v_n from mencoes
   where host_type = 'tarefa_comentario' and host_id = v_id and mentioned_membro_id = v_m_resp;
  assert v_n = 1, format('sync_mentions as the author must record the new mention, got %s', v_n);
  select link into v_link from notifications where type = 'mention' and user_id = v_resp;
  assert v_link = '/tarefas?tarefa=' || v_t1 || '&comentarios=1', format('mention link, got %s', v_link);

  -- removing the mention prunes it
  perform pg_temp.tc_as(v_a);
  perform sync_mentions('tarefa_comentario', v_id, '{}'::bigint[]);
  reset role;
  select count(*) into v_n from mencoes where host_type = 'tarefa_comentario' and host_id = v_id;
  assert v_n = 0, format('an empty sync must prune the mention, got %s', v_n);

  raise notice 'PASS tarefa_comentarios.edit_adds_mention';
end $$;
rollback;

-- =====================================================================
-- non_author_sync_rejected
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_o uuid := s->>'o'; v_bu uuid := s->>'bu';
  v_t1 bigint := s->>'t1'; v_m_resp bigint := s->>'m_resp';
  v_id bigint; v_n int; v_msg text; v_user uuid;
begin
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'meu comentario');

  foreach v_user in array array[v_o, v_bu] loop
    perform pg_temp.tc_as(v_user);
    v_msg := null;
    begin
      perform sync_mentions('tarefa_comentario', v_id, array[v_m_resp]);
    exception when others then v_msg := sqlerrm;
    end;
    assert v_msg = 'host not found', format('sync by a non-author must raise host not found, got %L', v_msg);
  end loop;
  reset role;

  select count(*) into v_n from mencoes where host_type = 'tarefa_comentario' and host_id = v_id;
  assert v_n = 0, format('a rejected sync must write nothing, got %s', v_n);

  raise notice 'PASS tarefa_comentarios.non_author_sync_rejected';
end $$;
rollback;

-- =====================================================================
-- cleanup_on_delete
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_t1 bigint := s->>'t1'; v_m_resp bigint := s->>'m_resp';
  v_id bigint; v_n int;
begin
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'oi @[Rui](membro:' || v_m_resp || ')');
  reset role;
  select count(*) into v_n from mencoes where host_type = 'tarefa_comentario' and host_id = v_id;
  assert v_n = 1, format('precondition: one mencoes row, got %s', v_n);

  perform pg_temp.tc_as(v_a);
  delete from tarefa_comentarios where id = v_id;
  reset role;
  select count(*) into v_n from mencoes where host_type = 'tarefa_comentario' and host_id = v_id;
  assert v_n = 0, format('deleting the comment must remove its mencoes rows, got %s', v_n);

  -- deleting the task cascades to its comments and their mencoes
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'de novo @[Rui](membro:' || v_m_resp || ')');
  reset role;
  delete from tarefas where id = v_t1;
  select count(*) into v_n from tarefa_comentarios where tarefa_id = v_t1;
  assert v_n = 0, format('deleting the task must cascade to its comments, got %s', v_n);
  select count(*) into v_n from mencoes where host_type = 'tarefa_comentario' and host_id = v_id;
  assert v_n = 0, format('the task cascade must also clean mencoes, got %s', v_n);

  raise notice 'PASS tarefa_comentarios.cleanup_on_delete';
end $$;
rollback;

-- =====================================================================
-- oversized_mention_token_ignored
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_t1 bigint := s->>'t1';
  v_id bigint; v_n int;
begin
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'x @[X](membro:99999999999999999999)');
  reset role;
  assert v_id is not null, 'the comment must be sent';
  select count(*) into v_n from mencoes where host_type = 'tarefa_comentario' and host_id = v_id;
  assert v_n = 0, format('an oversized token must be ignored, got %s rows', v_n);

  raise notice 'PASS tarefa_comentarios.oversized_mention_token_ignored';
end $$;
rollback;

-- =====================================================================
-- author_cannot_update_author_id
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_comentarios']);
do $$
declare
  s jsonb := pg_temp.tc_seed();
  v_a uuid := s->>'a'; v_o uuid := s->>'o'; v_t1 bigint := s->>'t1';
  v_id bigint; v_state text; v_col text;
begin
  perform pg_temp.tc_as(v_a);
  select id into v_id from tarefa_comentario_enviar(v_t1, 'meu');

  foreach v_col in array array['author_id', 'edited_at', 'tarefa_id', 'conta_id'] loop
    v_state := null;
    begin
      case v_col
        when 'author_id' then update tarefa_comentarios set author_id = v_o where id = v_id;
        when 'edited_at' then update tarefa_comentarios set edited_at = null where id = v_id;
        when 'tarefa_id' then update tarefa_comentarios set tarefa_id = tarefa_id where id = v_id;
        when 'conta_id'  then update tarefa_comentarios set conta_id = conta_id where id = v_id;
      end case;
    exception when insufficient_privilege then v_state := sqlstate;
    end;
    assert v_state = '42501', format('author UPDATE of %s must raise 42501, got %s', v_col, v_state);
  end loop;
  reset role;

  raise notice 'PASS tarefa_comentarios.author_cannot_update_author_id';
end $$;
rollback;
