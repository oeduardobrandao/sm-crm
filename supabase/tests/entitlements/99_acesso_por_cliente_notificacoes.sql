\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, quem recebe notificação e e-mail
-- (20261115000011_acesso_por_cliente_f_notificacoes.sql).
-- Criação: resolve_notification_targets(ws, responsavel, roles, p_cliente_id)
-- mantém sempre o responsável (o item é dele) e, entre os destinatários por
-- papel, só quem vê o cliente: owner, 'todos', cliente atribuído ou o contexto
-- de um item dele naquele cliente (can_see_cliente_context_for). Todo chamador
-- passa o cliente, e insert_notification_batch grava notifications.cliente_id.
-- Entrega: claim_notification_emails aplica a mesma regra por destinatário, no
-- workspace da própria notificação; a linha fora do escopo é marcada como
-- tratada (emailed_at) e não volta.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md

begin;
select et_grant_hosted_parity();

create temp table _fx (k text primary key, v text not null);
create or replace function pg_temp.fx(p_k text) returns text language sql as $f$
  select v from _fx where k = p_k;
$f$;
-- users of a uuid[] as a sorted, comma-separated list of fixture keys
create or replace function pg_temp.who(p_ids uuid[]) returns text language sql as $f$
  select coalesce(string_agg(f.k, ',' order by f.k), '<none>')
    from _fx f
   where f.k not like 'm\_%' and f.k not like 'c%' and f.k not like 'ws%'
     and f.v::text = any (select unnest(p_ids)::text);
$f$;
-- recipients (fixture keys) and distinct cliente_id of the notifications of a type
create or replace function pg_temp.notified(p_type text) returns text language sql as $f$
  select pg_temp.who(array_agg(n.user_id)) from notifications n
   where n.type = p_type and n.workspace_id = pg_temp.fx('ws')::uuid;
$f$;
create or replace function pg_temp.notified_clientes(p_type text) returns text language sql as $f$
  select coalesce(string_agg(distinct coalesce(n.cliente_id::text, 'null'), ','), '<none>') from notifications n
   where n.type = p_type and n.workspace_id = pg_temp.fx('ws')::uuid;
$f$;
create or replace function pg_temp.notif(p_ws uuid, p_user uuid, p_cliente bigint, p_tag text)
returns uuid language sql as $f$
  insert into notifications (workspace_id, user_id, type, metadata, cliente_id)
  values (p_ws, p_user, 'post_message', jsonb_build_object('tag', p_tag), p_cliente)
  returning id;
$f$;
-- calls of the scope helpers in this transaction
create or replace function pg_temp.scope_calls() returns bigint language sql as $f$
  select coalesce(sum(calls), 0)::bigint from pg_stat_xact_user_functions
   where schemaname = 'public'
     and funcname in ('can_see_cliente_context_for', 'can_access_cliente', 'can_see_cliente_context');
$f$;

-- =============================================================
-- block 1: fixtures
-- =============================================================
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_ws2 uuid := et_make_workspace('max');
  v_ws3 uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();     -- admin, 'todos'
  v_radm uuid := gen_random_uuid();    -- admin, restricted to A, nothing of his in B
  v_radm2 uuid := gen_random_uuid();   -- admin, restricted to A, owns a post in B
  v_restr uuid := gen_random_uuid();   -- agent, restricted to A
  v_multi uuid := gen_random_uuid();   -- 'todos' in ws, restricted to A2 in ws2
  v_owner3 uuid := gen_random_uuid();  -- ws3: only owner + 'todos' admin
  v_adm3 uuid := gen_random_uuid();
  v_ca bigint; v_cb bigint; v_ca2 bigint; v_cb2 bigint; v_c3 bigint;
  m_restr bigint; m_radm bigint; m_radm2 bigint; m_owner bigint;
begin
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
  values (v_ws, '{"feature_mensagens": true}'::jsonb);
  insert into auth.users (id, email) values
    (v_owner, 'owner@acnt.test'), (v_adm, 'adm@acnt.test'), (v_radm, 'radm@acnt.test'),
    (v_radm2, 'radm2@acnt.test'), (v_restr, 'restr@acnt.test'), (v_multi, 'multi@acnt.test'),
    (v_owner3, 'owner3@acnt.test'), (v_adm3, 'adm3@acnt.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_adm, v_ws, 'admin'), (v_radm, v_ws, 'admin'), (v_radm2, v_ws, 'admin'),
    (v_restr, v_ws, 'agent'), (v_multi, v_ws, 'agent'),
    (v_owner, v_ws2, 'owner'), (v_multi, v_ws2, 'agent'),
    (v_owner3, v_ws3, 'owner'), (v_adm3, v_ws3, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_adm, v_radm, v_radm2, v_restr, v_multi);
  update profiles set conta_id = v_ws3, active_workspace_id = v_ws3 where id in (v_owner3, v_adm3);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws2, 'A2', 'A2', '#333', 'ativo') returning id into v_ca2;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws2, 'B2', 'B2', '#444', 'ativo') returning id into v_cb2;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner3, v_ws3, 'C3', 'C3', '#555', 'ativo') returning id into v_c3;

  update workspace_members set client_scope = 'atribuidos'
   where workspace_id = v_ws and user_id in (v_radm, v_radm2, v_restr);
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values
    (v_ws, v_radm, v_ca), (v_ws, v_radm2, v_ca), (v_ws, v_restr, v_ca);
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws2 and user_id = v_multi;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws2, v_multi, v_ca2);

  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Owner', v_owner) returning id into m_owner;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Restr', v_restr) returning id into m_restr;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Radm', v_radm) returning id into m_radm;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Radm2', v_radm2) returning id into m_radm2;
  -- radm2's own post in B: B's context is open to him
  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (v_ws, v_cb, 'pBradm2', m_radm2);
  perform set_config('request.jwt.claims', '', true);

  insert into _fx values
    ('ws', v_ws), ('ws2', v_ws2), ('ws3', v_ws3),
    ('owner', v_owner), ('adm', v_adm), ('radm', v_radm), ('radm2', v_radm2), ('restr', v_restr),
    ('multi', v_multi), ('owner3', v_owner3), ('adm3', v_adm3),
    ('ca', v_ca), ('cb', v_cb), ('ca2', v_ca2), ('cb2', v_cb2), ('c3', v_c3),
    ('m_owner', m_owner), ('m_restr', m_restr), ('m_radm', m_radm), ('m_radm2', m_radm2);
end $$;

-- =============================================================
-- block 2: resolve_notification_targets
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_ca bigint := pg_temp.fx('ca');
  v_cb bigint := pg_temp.fx('cb');
  v_r text;
begin
  -- restricted_not_targeted_for_hidden_client: role fan-out never uses the
  -- context branch, so radm2 (own post in B) is out as well as radm
  v_r := pg_temp.who(resolve_notification_targets(v_ws, null, array['owner','admin'], v_cb));
  assert v_r = 'adm,owner', 'restricted_not_targeted_for_hidden_client: ' || v_r;
  -- restricted_with_own_item_targeted_when_responsavel: the responsável path stays
  v_r := pg_temp.who(resolve_notification_targets(v_ws, pg_temp.fx('m_radm2')::bigint, array['owner','admin'], v_cb));
  assert v_r = 'adm,owner,radm2', 'restricted_with_own_item_targeted_when_responsavel: ' || v_r;

  -- restricted_targeted_when_responsavel: the item is his, client hidden or not
  v_r := pg_temp.who(resolve_notification_targets(v_ws, pg_temp.fx('m_restr')::bigint, null, v_cb));
  assert v_r = 'restr', 'restricted_targeted_when_responsavel (no roles): ' || v_r;
  v_r := pg_temp.who(resolve_notification_targets(v_ws, pg_temp.fx('m_radm')::bigint, array['owner','admin'], v_cb));
  assert v_r = 'adm,owner,radm', 'restricted_targeted_when_responsavel (with roles): ' || v_r;

  -- todos_targets_unchanged: no client, or a client everyone sees
  v_r := pg_temp.who(resolve_notification_targets(v_ws, null, array['owner','admin'], null));
  assert v_r = 'adm,owner,radm,radm2', 'todos_targets_unchanged (no client): ' || v_r;
  v_r := pg_temp.who(resolve_notification_targets(v_ws, null, array['owner','admin']));
  assert v_r = 'adm,owner,radm,radm2', 'todos_targets_unchanged (3-arg call): ' || v_r;
  v_r := pg_temp.who(resolve_notification_targets(v_ws, null, array['owner','admin'], v_ca));
  assert v_r = 'adm,owner,radm,radm2', 'todos_targets_unchanged (assigned client): ' || v_r;
  v_r := pg_temp.who(resolve_notification_targets(v_ws, null, array['owner'], v_cb));
  assert v_r = 'owner', 'owner_only_roles: ' || v_r;

  -- named-argument call, as the edge functions make it
  v_r := pg_temp.who(resolve_notification_targets(
    p_workspace_id => v_ws, p_responsavel_id => null, p_roles_filter => array['owner','admin'], p_cliente_id => v_cb));
  assert v_r = 'adm,owner', 'named_args_call: ' || v_r;

  raise notice 'PASS block 2 resolve_notification_targets';
end $$;

-- =============================================================
-- block 3: insert_notification_batch and the callers write the client
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_ca bigint := pg_temp.fx('ca');
  v_cb bigint := pg_temp.fx('cb');
  v_owner uuid := pg_temp.fx('owner');
  v_restr uuid := pg_temp.fx('restr');
  m_restr bigint := pg_temp.fx('m_restr');
  m_radm bigint := pg_temp.fx('m_radm');
  v_post bigint; v_postA bigint; v_task bigint; v_thread bigint; v_wf bigint; v_etapa bigint;
  v_n bigint; v_r text;
begin
  delete from notifications where workspace_id = v_ws;

  -- insert_batch_writes_cliente_id
  perform insert_notification_batch(v_ws, array[v_owner], 'post_message', null, '{}'::jsonb, null, v_cb);
  select count(*) into v_n from notifications where workspace_id = v_ws and user_id = v_owner and cliente_id = v_cb;
  assert v_n = 1, 'insert_batch_writes_cliente_id: ' || v_n;
  perform insert_notification_batch(v_ws, array[v_owner], 'invite_accepted', null, '{}'::jsonb);
  select count(*) into v_n from notifications where workspace_id = v_ws and type = 'invite_accepted' and cliente_id is null;
  assert v_n = 1, 'insert_batch_without_client_null: ' || v_n;
  delete from notifications where workspace_id = v_ws;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- client_message about B: fan-out drops both restricted admins, writes B
  insert into mensagens (conta_id, cliente_id, content, is_workspace_user) values (v_ws, v_cb, 'oi', false);
  v_r := pg_temp.notified('client_message');
  assert v_r = 'adm,owner', 'client_message_targets: ' || v_r;
  assert pg_temp.notified_clientes('client_message') = v_cb::text, 'client_message_cliente_id: ' || pg_temp.notified_clientes('client_message');
  insert into mensagens (conta_id, cliente_id, content, is_workspace_user) values (v_ws, v_ca, 'oi', false);
  select count(*) into v_n from notifications where type = 'client_message' and workspace_id = v_ws and cliente_id = v_ca;
  assert v_n = 4, 'client_message_assigned_client_all_admins: ' || v_n;

  -- post_assigned to the restricted member in B: his, written with B
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_cb, 'pB') returning id into v_post;
  update workflow_posts set responsavel_id = m_restr where id = v_post;
  v_r := pg_temp.notified('post_assigned');
  assert v_r = 'restr', 'post_assigned_targets: ' || v_r;
  assert pg_temp.notified_clientes('post_assigned') = v_cb::text, 'post_assigned_cliente_id';

  -- task_assigned in B
  insert into tarefas (conta_id, user_id, titulo, responsavel_id, cliente_id)
  values (v_ws, v_owner, 'tB', m_restr, v_cb) returning id into v_task;
  v_r := pg_temp.notified('task_assigned');
  assert v_r = 'restr', 'task_assigned_targets: ' || v_r;
  assert pg_temp.notified_clientes('task_assigned') = v_cb::text, 'task_assigned_cliente_id';

  -- mention on the task: client read from the host
  insert into mencoes (conta_id, host_type, host_id, mentioned_membro_id, author_id)
  values (v_ws, 'tarefa', v_task, m_radm, v_owner);
  assert pg_temp.notified('mention') = 'radm', 'mention_targets: ' || pg_temp.notified('mention');
  assert pg_temp.notified_clientes('mention') = v_cb::text, 'mention_cliente_id: ' || pg_temp.notified_clientes('mention');

  -- tarefa comment (direct insert path)
  perform tarefa_comentario_enviar(v_task, 'comentário');
  assert pg_temp.notified('task_comment') = 'restr', 'task_comment_targets: ' || pg_temp.notified('task_comment');
  assert pg_temp.notified_clientes('task_comment') = v_cb::text, 'task_comment_cliente_id';

  -- post discussion (direct insert path)
  insert into post_comment_threads (post_id, conta_id, quoted_text, created_by, field)
  values (v_post, v_ws, '', v_owner, 'geral') returning id into v_thread;
  insert into post_comments (thread_id, author_id, content) values (v_thread, v_owner, 'olá');
  assert pg_temp.notified('post_discussion') = 'restr', 'post_discussion_targets: ' || pg_temp.notified('post_discussion');
  assert pg_temp.notified_clientes('post_discussion') = v_cb::text, 'post_discussion_cliente_id';

  -- step_activated: workflow family, fan-out filtered, written with B
  insert into workflows (conta_id, cliente_id, titulo) values (v_ws, v_cb, 'wB') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, status)
  values (v_wf, 1, 'e1', 1, 'pendente') returning id into v_etapa;
  update workflow_etapas set status = 'ativo' where id = v_etapa;
  v_r := pg_temp.notified('step_activated');
  assert v_r = 'adm', 'step_activated_targets (actor owner excluded): ' || v_r;
  assert pg_temp.notified_clientes('step_activated') = v_cb::text, 'step_activated_cliente_id';

  -- post status automation, 'member' target: a configured member is not "his";
  -- context (radm2's own post in B) does not count either
  insert into post_status_automations (conta_id, trigger_status, action_type, config)
  values (v_ws, 'revisao_interna', 'notify', jsonb_build_object('target', 'member', 'membro_id', m_radm)),
         (v_ws, 'revisao_interna', 'notify', jsonb_build_object('target', 'member', 'membro_id', pg_temp.fx('m_radm2')::bigint));
  insert into workflow_posts (conta_id, cliente_id, titulo) values (v_ws, v_ca, 'pA') returning id into v_postA;
  update workflow_posts set status = 'revisao_interna' where id in (v_post, v_postA);
  v_r := pg_temp.notified('post_status_automation');
  assert v_r = 'radm,radm2', 'automation_member_targets: ' || v_r;
  assert pg_temp.notified_clientes('post_status_automation') = v_ca::text,
    'automation_member_only_visible_client: ' || pg_temp.notified_clientes('post_status_automation');

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS block 3 callers write cliente_id';
end $$;

-- =============================================================
-- block 4: claim_notification_emails
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_ws2 uuid := pg_temp.fx('ws2');
  v_ca bigint := pg_temp.fx('ca');
  v_cb bigint := pg_temp.fx('cb');
  v_ca2 bigint := pg_temp.fx('ca2');
  v_cb2 bigint := pg_temp.fx('cb2');
  v_ids uuid[];
  v_got text; v_hidden text; v_n bigint;
begin
  delete from notifications where workspace_id in (v_ws, v_ws2);
  -- tag = user/client
  perform pg_temp.notif(v_ws, pg_temp.fx('owner')::uuid, v_cb, 'owner/B');
  perform pg_temp.notif(v_ws, pg_temp.fx('adm')::uuid, v_cb, 'adm/B');
  perform pg_temp.notif(v_ws, pg_temp.fx('radm')::uuid, v_cb, 'radm/B');
  perform pg_temp.notif(v_ws, pg_temp.fx('radm')::uuid, v_ca, 'radm/A');
  perform pg_temp.notif(v_ws, pg_temp.fx('radm')::uuid, null, 'radm/none');
  perform pg_temp.notif(v_ws, pg_temp.fx('radm2')::uuid, v_cb, 'radm2/B');
  perform pg_temp.notif(v_ws, pg_temp.fx('multi')::uuid, v_cb, 'multi/B');
  perform pg_temp.notif(v_ws2, pg_temp.fx('multi')::uuid, v_ca2, 'multi/A2');
  perform pg_temp.notif(v_ws2, pg_temp.fx('multi')::uuid, v_cb2, 'multi/B2');
  update notifications set created_at = now() - interval '20 minutes' where workspace_id in (v_ws, v_ws2);

  select array_agg(c.id) into v_ids
    from claim_notification_emails(now() - interval '10 minutes', now() - interval '1 day', 1000) c;
  select string_agg(n.metadata->>'tag', ',' order by n.metadata->>'tag') into v_got
    from notifications n where n.id = any (v_ids) and n.workspace_id in (v_ws, v_ws2);
  -- claim_skips_hidden (radm/B), claim_sends_own_item_via_context (radm2/B),
  -- claim_other_workspace_follows_its_scope (multi: B sent in ws, B2 skipped in ws2)
  assert v_got = 'adm/B,multi/A2,multi/B,owner/B,radm/A,radm/none,radm2/B', 'claim_returns_in_scope_only: ' || coalesce(v_got, '<none>');

  -- claim_skips_hidden_and_marks_emailed: not returned, never offered again
  select string_agg(n.metadata->>'tag', ',' order by n.metadata->>'tag') into v_hidden
    from notifications n
   where n.workspace_id in (v_ws, v_ws2) and n.emailed_at is not null and not (n.id = any (v_ids));
  assert v_hidden = 'multi/B2,radm/B', 'claim_skips_hidden_and_marks_emailed: ' || coalesce(v_hidden, '<none>');
  select count(*) into v_n from notifications where workspace_id in (v_ws, v_ws2) and emailed_at is null;
  assert v_n = 0, 'claim_leaves_nothing_queued: ' || v_n;
  select count(*) into v_n
    from claim_notification_emails(now() - interval '10 minutes', now() - interval '1 day', 1000) c
    join notifications n on n.id = c.id where n.workspace_id in (v_ws, v_ws2);
  assert v_n = 0, 'claim_second_run_empty: ' || v_n;

  raise notice 'PASS block 4 claim_notification_emails';
end $$;

-- =============================================================
-- block 5: owner / 'todos' cost nothing
-- =============================================================
set local track_functions = 'all';
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_ws3 uuid := pg_temp.fx('ws3');
  v_c3 bigint := pg_temp.fx('c3');
  v_before bigint; v_after bigint; v_r text;
begin
  delete from notifications where workspace_id in (select v::uuid from _fx where k like 'ws%');

  -- todos_owner_zero_helper_calls: ws3 has only an owner and a 'todos' admin
  v_before := pg_temp.scope_calls();
  v_r := pg_temp.who(resolve_notification_targets(v_ws3, null, array['owner','admin'], v_c3));
  assert v_r = 'adm3,owner3', 'ws3_targets: ' || v_r;
  perform pg_temp.notif(v_ws3, pg_temp.fx('owner3')::uuid, v_c3, 'o3');
  perform pg_temp.notif(v_ws3, pg_temp.fx('adm3')::uuid, v_c3, 'a3');
  update notifications set created_at = now() - interval '20 minutes' where workspace_id = v_ws3;
  perform claim_notification_emails(now() - interval '10 minutes', now() - interval '1 day', 1000);
  v_after := pg_temp.scope_calls();
  assert v_after = v_before, format('todos_owner_zero_helper_calls: %s -> %s', v_before, v_after);

  -- sanity: claiming a restricted recipient's row does call the helper
  perform pg_temp.notif(v_ws, pg_temp.fx('radm')::uuid, pg_temp.fx('cb')::bigint, 'rB');
  update notifications set created_at = now() - interval '20 minutes' where workspace_id = v_ws;
  v_before := pg_temp.scope_calls();
  perform claim_notification_emails(now() - interval '10 minutes', now() - interval '1 day', 1000);
  v_after := pg_temp.scope_calls();
  assert v_after > v_before, format('restricted_calls_helper: %s -> %s', v_before, v_after);

  raise notice 'PASS block 5 zero helper calls for owner/todos';
end $$;

-- =============================================================
-- block 6: grants and signatures
-- =============================================================
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.resolve_notification_targets(uuid, bigint, text[], bigint)',
    'public.insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid, bigint)',
    'public.can_see_cliente_context_for(uuid, uuid, bigint)',
    'public.claim_notification_emails(timestamptz, timestamptz, int)'
  ] loop
    assert not has_function_privilege('anon', f, 'EXECUTE'), 'anon must not execute ' || f;
    assert not has_function_privilege('authenticated', f, 'EXECUTE'), 'authenticated must not execute ' || f;
    assert has_function_privilege('service_role', f, 'EXECUTE'), 'service_role must execute ' || f;
  end loop;
  assert to_regprocedure('public.resolve_notification_targets(uuid, bigint, text[])') is null,
    'old 3-arg resolve_notification_targets must be gone (no overload)';
  assert to_regprocedure('public.insert_notification_batch(uuid, uuid[], text, text, jsonb, uuid)') is null,
    'old 6-arg insert_notification_batch must be gone (no overload)';
  raise notice 'PASS block 6 grants';
end $$;

rollback;
