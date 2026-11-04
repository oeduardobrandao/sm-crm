\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Acesso por cliente, notificações e vínculo de membro
-- (20261115000007_acesso_por_cliente_c5_notif_membros.sql).
-- notifications: the recipient reads a notification with no client, or about a
-- client he sees (scope or the context of an own item there). The scope is
-- judged in the notification's own workspace: the bell lists every workspace
-- the user belongs to, and my_client_scope_all() / can_see_cliente_context()
-- answer for the ACTIVE one. In a workspace other than the active one only
-- the membership's own scope counts (owner, 'todos', or an assigned client).
-- Only read_at / dismissed_at are UPDATE-granted, so mark-read can't re-scope.
-- membros: trg_membros_crm_user_scope_lock. Linking, relinking or unlinking
-- membros.crm_user_id to or from a member with client_scope = 'atribuidos' in
-- that workspace (INSERT or UPDATE) is owner-only: the link decides what
-- my_membro_ids() returns, i.e. what is "é dele" for that member.
-- equipe chat: unchanged, a restricted member keeps the rooms he is in.
-- Spec: docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md
-- Inventory: docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md

begin;
select et_grant_hosted_parity();
-- production column grants of the two tables whose write privileges matter here
-- (parity hands out table-level ALL, which overrides column grants):
-- notifications (20260430000001) and membros (20261022000001)
revoke update on public.notifications from authenticated;
grant update (read_at, dismissed_at) on public.notifications to authenticated;
revoke update on public.membros from authenticated;
grant update (nome, cargo, tipo, custo_mensal, data_pagamento) on public.membros to authenticated;

-- ids shared between the DO blocks
create temp table _fx (k text primary key, v text not null);
create or replace function pg_temp.fx(p_k text) returns text language sql as $f$
  select v from _fx where k = p_k;
$f$;

-- count(*) of a query as p_user (authenticated)
create or replace function pg_temp.n_as(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- "SQLSTATE: message" raised by a statement as p_user, or NULL on success
create or replace function pg_temp.err_as(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return sqlstate || ': ' || sqlerrm;
  end;
  execute 'reset role';
  return null;
end $f$;
-- rows affected by a statement as p_user
create or replace function pg_temp.rows_as(p_user uuid, p_sql text) returns bigint language plpgsql as $f$
declare v bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  get diagnostics v = row_count;
  execute 'reset role';
  return v;
end $f$;
-- notification row (as superuser), returns its id
create or replace function pg_temp.notif(p_ws uuid, p_user uuid, p_cliente bigint, p_tag text)
returns uuid language sql as $f$
  insert into notifications (workspace_id, user_id, type, metadata, cliente_id)
  values (p_ws, p_user, 'post_message', jsonb_build_object('tag', p_tag), p_cliente)
  returning id;
$f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;
grant select on _fx to authenticated;

-- =============================================================
-- block 1: fixtures
-- =============================================================
do $$
declare
  v_ws uuid := et_make_workspace('max');
  v_ws2 uuid := et_make_workspace('max');
  v_owner uuid := gen_random_uuid();
  v_todos uuid := gen_random_uuid();
  v_adm uuid := gen_random_uuid();     -- admin, 'todos'
  v_radm uuid := gen_random_uuid();    -- admin, restricted to A
  v_restr uuid := gen_random_uuid();   -- agent, restricted to A, nothing of his in B
  v_restr2 uuid := gen_random_uuid();  -- agent, restricted to A, owns a post in B
  v_restr3 uuid := gen_random_uuid();  -- agent, restricted, no membro (INSERT cases)
  v_restr4 uuid := gen_random_uuid();  -- agent, restricted, no membro (relink cases)
  v_todos2 uuid := gen_random_uuid();  -- agent, 'todos', no membro (relink to a todos user)
  v_multi uuid := gen_random_uuid();   -- 'todos' in ws (active), restricted to A2 in ws2
  v_out uuid := gen_random_uuid();     -- restricted to A in ws (active), 'todos' in ws2
  v_ca bigint; v_cb bigint; v_ca2 bigint; v_cb2 bigint;
  m_restr bigint; m_restr2 bigint; m_free bigint; m_todos bigint;
  v_conv bigint;
begin
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id, email) values
    (v_owner, 'owner@acnl.test'), (v_todos, 'todos@acnl.test'), (v_adm, 'adm@acnl.test'),
    (v_radm, 'radm@acnl.test'), (v_restr, 'restr@acnl.test'), (v_restr2, 'restr2@acnl.test'),
    (v_restr3, 'restr3@acnl.test'), (v_restr4, 'restr4@acnl.test'), (v_todos2, 'todos2@acnl.test'),
    (v_multi, 'multi@acnl.test'), (v_out, 'out@acnl.test');
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'), (v_todos, v_ws, 'agent'), (v_adm, v_ws, 'admin'), (v_radm, v_ws, 'admin'),
    (v_restr, v_ws, 'agent'), (v_restr2, v_ws, 'agent'), (v_restr3, v_ws, 'agent'), (v_restr4, v_ws, 'agent'),
    (v_todos2, v_ws, 'agent'), (v_multi, v_ws, 'agent'), (v_out, v_ws, 'agent'),
    (v_owner, v_ws2, 'owner'), (v_multi, v_ws2, 'agent'), (v_out, v_ws2, 'agent');
  -- everyone works in ws (the active workspace)
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_todos, v_adm, v_radm, v_restr, v_restr2, v_restr3, v_restr4, v_todos2, v_multi, v_out);

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'A', 'A', '#111', 'ativo') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws, 'B', 'B', '#222', 'ativo') returning id into v_cb;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws2, 'A2', 'A2', '#333', 'ativo') returning id into v_ca2;
  insert into clientes (user_id, conta_id, nome, sigla, cor, status) values (v_owner, v_ws2, 'B2', 'B2', '#444', 'ativo') returning id into v_cb2;

  update workspace_members set client_scope = 'atribuidos'
   where workspace_id = v_ws and user_id in (v_radm, v_restr, v_restr2, v_restr3, v_restr4, v_out);
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values
    (v_ws, v_radm, v_ca), (v_ws, v_restr, v_ca), (v_ws, v_restr2, v_ca), (v_ws, v_restr3, v_ca),
    (v_ws, v_restr4, v_ca), (v_ws, v_out, v_ca);
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws2 and user_id = v_multi;
  insert into workspace_member_clientes (workspace_id, user_id, cliente_id) values (v_ws2, v_multi, v_ca2);

  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Restr', v_restr) returning id into m_restr;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Restr2', v_restr2) returning id into m_restr2;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_owner, v_ws, 'Todos', v_todos) returning id into m_todos;
  -- unlinked roster entry (a former employee) with work assigned in B
  insert into membros (user_id, conta_id, nome) values (v_owner, v_ws, 'Livre') returning id into m_free;

  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (v_ws, v_cb, 'pBown', m_restr2);
  insert into workflow_posts (conta_id, cliente_id, titulo, responsavel_id) values (v_ws, v_cb, 'pBfree', m_free);

  -- team chat room with the restricted member in it
  insert into equipe_conversas (conta_id, tipo, nome, created_by) values (v_ws, 'grupo', 'Sala', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id) values (v_conv, v_ws, v_owner), (v_conv, v_ws, v_restr);
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content) values (v_conv, v_ws, v_owner, 'oi');

  -- notifications: drop what the fixture triggers emitted, then one per (user, client)
  delete from notifications where workspace_id in (v_ws, v_ws2);
  perform pg_temp.notif(v_ws, u, c, t)
     from unnest(array[v_owner, v_todos, v_restr, v_restr2, v_radm]) u,
          (values (v_ca, 'A'), (v_cb, 'B'), (null::bigint, 'none')) x(c, t);
  perform pg_temp.notif(v_ws, v_multi, c, t) from (values (v_ca, 'A'), (v_cb, 'B'), (null::bigint, 'none')) x(c, t);
  perform pg_temp.notif(v_ws2, v_multi, c, t) from (values (v_ca2, 'A2'), (v_cb2, 'B2'), (null::bigint, 'none2')) x(c, t);
  perform pg_temp.notif(v_ws, v_out, c, t) from (values (v_ca, 'A'), (v_cb, 'B'), (null::bigint, 'none')) x(c, t);
  perform pg_temp.notif(v_ws2, v_out, c, t) from (values (v_ca2, 'A2'), (v_cb2, 'B2'), (null::bigint, 'none2')) x(c, t);
  perform set_config('request.jwt.claims', '', true);

  insert into _fx values
    ('ws', v_ws), ('ws2', v_ws2), ('owner', v_owner), ('todos', v_todos), ('adm', v_adm), ('radm', v_radm),
    ('restr', v_restr), ('restr2', v_restr2), ('restr3', v_restr3), ('restr4', v_restr4), ('todos2', v_todos2),
    ('multi', v_multi), ('out', v_out),
    ('ca', v_ca), ('cb', v_cb), ('ca2', v_ca2), ('cb2', v_cb2),
    ('m_restr', m_restr), ('m_restr2', m_restr2), ('m_free', m_free), ('m_todos', m_todos), ('conv', v_conv);
end $$;

-- =============================================================
-- block 2: notifications read
-- =============================================================
do $$
declare
  v_restr uuid := pg_temp.fx('restr');
  v_restr2 uuid := pg_temp.fx('restr2');
  v_radm uuid := pg_temp.fx('radm');
  v_todos uuid := pg_temp.fx('todos');
  v_owner uuid := pg_temp.fx('owner');
  v_multi uuid := pg_temp.fx('multi');
  v_out uuid := pg_temp.fx('out');
  v_n bigint; v_tags text;
  q text := $q$select string_agg(metadata->>'tag', ',' order by metadata->>'tag') from notifications$q$;
begin
  -- notification_about_b_hidden + notification_without_client_visible
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute q into v_tags;
  execute 'reset role';
  assert v_tags = 'A,none', 'restricted_sees_a_and_no_client_only: ' || coalesce(v_tags, '<none>');
  perform set_config('request.jwt.claims', json_build_object('sub', v_radm, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute q into v_tags;
  execute 'reset role';
  assert v_tags = 'A,none', 'restricted_admin_sees_a_and_no_client_only: ' || coalesce(v_tags, '<none>');

  -- notification_about_own_b_post_visible: an own item in B opens B's context,
  -- so EVERY notification of his about B shows (the plan's chosen predicate)
  perform set_config('request.jwt.claims', json_build_object('sub', v_restr2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute q into v_tags;
  execute 'reset role';
  assert v_tags = 'A,B,none', 'notification_about_own_b_post_visible: ' || coalesce(v_tags, '<none>');

  -- todos / owner: unchanged (their own three)
  v_n := pg_temp.n_as(v_todos, 'select count(*) from notifications');
  assert v_n = (select count(*) from notifications where user_id = v_todos), 'todos_counts_unchanged (notifications): ' || v_n;
  assert v_n = 3, 'todos sees his three: ' || v_n;
  v_n := pg_temp.n_as(v_owner, 'select count(*) from notifications');
  assert v_n = (select count(*) from notifications where user_id = v_owner), 'owner_counts_unchanged (notifications): ' || v_n;

  -- cross-workspace: the scope of the notification's workspace decides, not the
  -- active one. multi is 'todos' in ws (active) but restricted to A2 in ws2.
  perform set_config('request.jwt.claims', json_build_object('sub', v_multi, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute q into v_tags;
  execute 'reset role';
  assert v_tags = 'A,A2,B,none,none2', 'notification_of_other_workspace_follows_its_scope (multi): ' || coalesce(v_tags, '<none>');
  -- out is restricted to A in ws (active) but 'todos' in ws2: B2 shows
  perform set_config('request.jwt.claims', json_build_object('sub', v_out, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute q into v_tags;
  execute 'reset role';
  assert v_tags = 'A,A2,B2,none,none2', 'notification_of_other_workspace_follows_its_scope (out): ' || coalesce(v_tags, '<none>');
end $$;

-- =============================================================
-- block 3: notifications writes (mark read, dismiss, no re-scope)
-- =============================================================
do $$
declare
  v_restr uuid := pg_temp.fx('restr');
  v_restr2 uuid := pg_temp.fx('restr2');
  v_ca bigint := pg_temp.fx('ca');
  v_n bigint; v_err text;
begin
  -- mark read on a visible one: ok (own B post context, no client, A)
  v_n := pg_temp.rows_as(v_restr2, $q$update notifications set read_at = now() where metadata->>'tag' in ('A', 'B', 'none')$q$);
  assert v_n = 3, 'restricted_marks_visible_read: ' || v_n;
  v_n := pg_temp.rows_as(v_restr2, $q$update notifications set dismissed_at = now() where metadata->>'tag' = 'B'$q$);
  assert v_n = 1, 'notification_about_own_b_post_dismissable: ' || v_n;
  -- a hidden one is not touched
  v_n := pg_temp.rows_as(v_restr, $q$update notifications set read_at = now() where metadata->>'tag' = 'B'$q$);
  assert v_n = 0, 'restricted_cannot_mark_hidden_read: ' || v_n;
  assert (select read_at from notifications where user_id = v_restr and metadata->>'tag' = 'B') is null,
    'hidden notification stays unread';
  -- cliente_id (or any other column) is not writable: no re-scoping a notification
  v_err := pg_temp.err_as(v_restr, format($q$update notifications set cliente_id = %s where metadata->>'tag' = 'none'$q$, v_ca));
  assert v_err like '42501:%', 'notification_cliente_id_not_writable: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr, $q$update notifications set cliente_id = null where metadata->>'tag' = 'A'$q$);
  assert v_err like '42501:%', 'notification_cliente_id_not_clearable: ' || coalesce(v_err, 'ok');
  -- no INSERT / DELETE path for signed-in users
  v_err := pg_temp.err_as(v_restr, format($q$insert into notifications (workspace_id, user_id, type) values (%L, %L, 'post_message')$q$,
                                           pg_temp.fx('ws'), v_restr));
  assert v_err like '42501:%', 'notification_insert_denied: ' || coalesce(v_err, 'ok');
  v_n := pg_temp.rows_as(v_restr, 'delete from notifications');
  assert v_n = 0, 'notification_delete_denied: ' || v_n;
end $$;

-- =============================================================
-- block 4: team chat unchanged
-- =============================================================
do $$
declare
  v_restr uuid := pg_temp.fx('restr');
  v_restr2 uuid := pg_temp.fx('restr2');
  v_todos uuid := pg_temp.fx('todos');
  v_owner uuid := pg_temp.fx('owner');
  v_ws uuid := pg_temp.fx('ws');
  v_n bigint; v_t text;
begin
  v_n := pg_temp.n_as(v_restr, format('select count(*) from equipe_conversas where id = %s', pg_temp.fx('conv')));
  assert v_n = 1, 'chat_room_member_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr, format('select count(*) from equipe_mensagens where conversa_id = %s', pg_temp.fx('conv')));
  assert v_n = 1, 'chat_room_member_messages_visible: ' || v_n;
  v_n := pg_temp.n_as(v_restr2, format('select count(*) from equipe_conversas where id = %s', pg_temp.fx('conv')));
  assert v_n = 0, 'chat_room_non_member_hidden: ' || v_n;
  -- rooms are by participation, not by client: owner and restricted participant read the same
  foreach v_t in array array['equipe_conversas', 'equipe_conversa_participantes', 'equipe_mensagens'] loop
    v_n := pg_temp.n_as(v_owner, format('select count(*) from %I where conta_id = %L', v_t, v_ws));
    assert v_n = case v_t when 'equipe_conversa_participantes' then 2 else 1 end,
      format('owner_chat_counts_unchanged (%s): %s', v_t, v_n);
    assert pg_temp.n_as(v_restr, format('select count(*) from %I where conta_id = %L', v_t, v_ws)) = v_n,
      format('restricted_participant_chat_counts (%s)', v_t);
  end loop;
  -- membros: todos and restricted read the same roster
  v_n := pg_temp.n_as(v_todos, 'select count(*) from membros');
  assert v_n = (select count(*) from membros where conta_id = v_ws), 'todos_counts_unchanged (membros): ' || v_n;
  v_n := pg_temp.n_as(v_restr, 'select count(*) from membros');
  assert v_n = (select count(*) from membros where conta_id = v_ws), 'restricted_reads_roster (membros): ' || v_n;
end $$;

-- =============================================================
-- block 5: trg_membros_crm_user_scope_lock
-- =============================================================
do $$
declare
  v_ws uuid := pg_temp.fx('ws');
  v_owner uuid := pg_temp.fx('owner');
  v_adm uuid := pg_temp.fx('adm');
  v_radm uuid := pg_temp.fx('radm');
  v_restr uuid := pg_temp.fx('restr');
  v_restr3 uuid := pg_temp.fx('restr3');
  v_restr4 uuid := pg_temp.fx('restr4');
  v_todos2 uuid := pg_temp.fx('todos2');
  v_multi uuid := pg_temp.fx('multi');
  m_restr bigint := pg_temp.fx('m_restr');
  m_free bigint := pg_temp.fx('m_free');
  v_err text; v_m bigint;
begin
  -- direct UPDATE of crm_user_id: not in the column grant (pre-existing)
  v_err := pg_temp.err_as(v_adm, format('update membros set crm_user_id = %L where id = %s', v_restr4, m_free));
  assert v_err like '42501:%', 'membros_crm_user_id_not_column_writable: ' || coalesce(v_err, 'ok');

  -- relink_crm_user_id_of_restricted_by_admin_denied: link an unlinked roster
  -- entry (work assigned in B) to a restricted member
  v_err := pg_temp.err_as(v_adm, format('select set_membro_crm_user(%s, %L)', m_free, v_restr4));
  assert v_err like '%client_scope_owner_only%', 'relink_crm_user_id_of_restricted_by_admin_denied (link): ' || coalesce(v_err, 'ok');
  assert (select crm_user_id from membros where id = m_free) is null, 'link refused, row unchanged';
  -- unlink a restricted member (OLD is restricted)
  v_err := pg_temp.err_as(v_adm, format('select set_membro_crm_user(%s, null)', m_restr));
  assert v_err like '%client_scope_owner_only%', 'relink_crm_user_id_of_restricted_by_admin_denied (unlink): ' || coalesce(v_err, 'ok');
  -- move a restricted member's link to another row
  v_err := pg_temp.err_as(v_adm, format('select set_membro_crm_user(%s, %L)', m_restr, v_todos2));
  assert v_err like '%client_scope_owner_only%', 'relink_crm_user_id_of_restricted_by_admin_denied (swap): ' || coalesce(v_err, 'ok');
  -- a restricted admin linking himself to the roster entry with work in B
  v_err := pg_temp.err_as(v_radm, format('select set_membro_crm_user(%s, %L)', m_free, v_radm));
  assert v_err like '%client_scope_owner_only%', 'restricted_admin_self_link_denied: ' || coalesce(v_err, 'ok');

  -- not over-broad: admin links a 'todos' member, and a member restricted only
  -- in ANOTHER workspace (multi is 'todos' here)
  v_err := pg_temp.err_as(v_adm, format('select set_membro_crm_user(%s, %L)', m_free, v_todos2));
  assert v_err is null, 'admin_links_todos_member_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.err_as(v_adm, format('select set_membro_crm_user(%s, %L)', m_free, v_multi));
  assert v_err is null, 'admin_links_member_restricted_elsewhere_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.err_as(v_adm, format('select set_membro_crm_user(%s, null)', m_free));
  assert v_err is null, 'admin_unlinks_todos_member_ok: ' || coalesce(v_err, '');
  -- other columns of a restricted member's row stay editable by an admin
  v_err := pg_temp.err_as(v_adm, format($q$update membros set nome = 'Restr renomeado' where id = %s$q$, m_restr));
  assert v_err is null, 'admin_edits_restricted_member_name_ok: ' || coalesce(v_err, '');

  -- relink_by_owner_ok
  v_err := pg_temp.err_as(v_owner, format('select set_membro_crm_user(%s, %L)', m_free, v_restr4));
  assert v_err is null, 'relink_by_owner_ok: ' || coalesce(v_err, '');
  assert (select crm_user_id from membros where id = m_free) = v_restr4, 'owner link applied';
  v_err := pg_temp.err_as(v_owner, format('select set_membro_crm_user(%s, null)', m_free));
  assert v_err is null, 'unlink_by_owner_ok: ' || coalesce(v_err, '');

  -- INSERT with crm_user_id of a restricted member: owner only
  v_err := pg_temp.err_as(v_adm, format($q$insert into membros (user_id, conta_id, nome, crm_user_id) values (%L, %L, 'Novo', %L)$q$,
                                         v_adm, v_ws, v_restr3));
  assert v_err like '%client_scope_owner_only%', 'insert_membro_linked_to_restricted_by_admin_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_restr3, format($q$insert into membros (user_id, conta_id, nome, crm_user_id) values (%L, %L, 'Eu', %L)$q$,
                                            v_restr3, v_ws, v_restr3));
  assert v_err like '%client_scope_owner_only%', 'insert_membro_self_link_by_restricted_denied: ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_as(v_adm, format($q$insert into membros (user_id, conta_id, nome) values (%L, %L, 'Sem vínculo')$q$, v_adm, v_ws));
  assert v_err is null, 'insert_membro_unlinked_by_admin_ok: ' || coalesce(v_err, '');
  v_err := pg_temp.err_as(v_owner, format($q$insert into membros (user_id, conta_id, nome, crm_user_id) values (%L, %L, 'Novo', %L)$q$,
                                           v_owner, v_ws, v_restr3));
  assert v_err is null, 'insert_membro_linked_to_restricted_by_owner_ok: ' || coalesce(v_err, '');

  -- no signed-in user (service role: accept_workspace_invite, invite-actions): unaffected
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update membros set crm_user_id = v_restr4 where id = m_free;
  update membros set crm_user_id = null where id = m_free;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- =============================================================
-- block 6: todos pays no per-row scope call; function privileges
-- =============================================================
set local track_functions = 'all';
create or replace function pg_temp.scope_calls() returns bigint language sql as $f$
  select coalesce(sum(calls), 0)::bigint from pg_stat_xact_user_functions
   where funcname in ('can_access_cliente', 'can_see_cliente_context');
$f$;
do $$
declare
  v_todos uuid := pg_temp.fx('todos');
  v_restr uuid := pg_temp.fx('restr');
  c0 bigint; c1 bigint; c2 bigint;
begin
  c0 := pg_temp.scope_calls();
  perform pg_temp.n_as(v_todos, 'select count(*) from notifications');
  perform pg_temp.n_as(pg_temp.fx('owner')::uuid, 'select count(*) from notifications');
  c1 := pg_temp.scope_calls();
  assert c1 - c0 = 0, 'todos_pays_zero_scope_calls (notifications): ' || (c1 - c0);
  perform pg_temp.n_as(v_restr, 'select count(*) from notifications');
  c2 := pg_temp.scope_calls();
  assert c2 > c1, 'track_functions is counting the scope helpers: ' || c2;
end $$;

do $$
begin
  assert not has_function_privilege('authenticated', 'public.guard_membros_crm_user_scope()', 'EXECUTE'),
    'guard_membros_crm_user_scope not executable by authenticated';
  assert not has_function_privilege('anon', 'public.guard_membros_crm_user_scope()', 'EXECUTE'),
    'guard_membros_crm_user_scope not executable by anon';
  assert has_function_privilege('service_role', 'public.guard_membros_crm_user_scope()', 'EXECUTE'),
    'guard_membros_crm_user_scope executable by service_role';
  assert exists (select 1 from pg_trigger where tgname = 'trg_membros_crm_user_scope_lock'
                   and tgrelid = 'public.membros'::regclass and tgenabled = 'O'),
    'trg_membros_crm_user_scope_lock present and enabled';
end $$;

rollback;
\echo 99_acesso_por_cliente_notificacoes_leitura: ok
