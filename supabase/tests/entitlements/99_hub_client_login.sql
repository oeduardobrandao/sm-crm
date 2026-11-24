\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Login do cliente no Hub (migration 20261129000001, spec 2026-11-23-hub-client-login-design).
-- RPCs do CRM (hub_people_*, hub_set_require_login): guarda de workspace, escopo e
-- configuracoes:editar, invariantes e audit_log. RPCs de serviço (hub_login_*,
-- hub_access_context, hub_session_*): código de uso único, teto de tentativas, código
-- preso ao cliente, sessão por e-mail. Autoria do cliente em post_approvals/mensagens
-- (só service role grava) e client_person_name no feed.

begin;
-- As quatro tabelas novas ficam fora: o ACL fechado delas é o que está sob teste.
select et_grant_hosted_parity(array['hub_client_people', 'hub_client_settings', 'hub_login_codes', 'hub_sessions']);

-- Roda p_sql como p_user (authenticated) e devolve a primeira coluna como texto.
create or replace function pg_temp.as_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

-- Como as_user, mas devolve 'SQLSTATE:mensagem' do erro, ou null quando não falhou.
create or replace function pg_temp.err_user(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    execute p_sql;
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end $f$;

-- Roda p_sql como service_role, sem claims (auth.uid() nulo de verdade).
create or replace function pg_temp.svc(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role service_role';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;

do $$
declare
  v_ws  uuid := et_make_workspace('max');
  v_wsb uuid := et_make_workspace('max');
  v_owner  uuid := gen_random_uuid();
  v_agent  uuid := gen_random_uuid();
  v_restr  uuid := gen_random_uuid();
  v_ownerb uuid := gen_random_uuid();
  v_role_cfg uuid;
  c bigint; c2 bigint; c3 bigint; c4 bigint; c5 bigint;
  v_wf bigint; v_post1 bigint; v_post2 bigint;
  v_p1 uuid; v_p4 uuid; v_p5 uuid; v_px uuid;
  v_list jsonb; v_res jsonb; v_err text; v_txt text; v_n bigint;
  v_ts timestamptz;
  v_appr1 bigint; v_appr2 bigint; v_appr_auth bigint; v_appr_svc bigint;
  v_msg_auth bigint; v_msg_svc bigint; v_msg_feed bigint;
  v_rec record;
  v_hash_a text := repeat('a', 64);
  v_hash_b text := repeat('b', 64);
  v_hash_c text := repeat('c', 64);
  v_hash_d text := repeat('d', 64);
  v_fn text;
  i int;
begin
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
  values (v_ws, '{"feature_mensagens": true}'::jsonb);
  insert into auth.users (id, email) values
    (v_owner, 'owner@hcl.test'), (v_agent, 'agent@hcl.test'),
    (v_restr, 'restr@hcl.test'), (v_ownerb, 'ownerb@hcl.test');
  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws, 'Config', '{"configuracoes": "editar"}'::jsonb) returning id into v_role_cfg;
  insert into workspace_members (user_id, workspace_id, role, role_id) values
    (v_owner, v_ws, 'owner', null), (v_agent, v_ws, 'agent', null),
    (v_restr, v_ws, 'agent', v_role_cfg), (v_ownerb, v_wsb, 'owner', null);
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_owner, v_agent, v_restr);
  update profiles set conta_id = v_wsb, active_workspace_id = v_wsb where id = v_ownerb;

  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws, 'C1', 'C1', '#000') returning id into c;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws, 'C2', 'C2', '#000') returning id into c2;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws, 'C3', 'C3', '#000') returning id into c3;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws, 'C4', 'C4', '#000') returning id into c4;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_owner, v_ws, 'C5', 'C5', '#000') returning id into c5;
  -- restrito: papel com configuracoes:editar, escopo atribuidos e nenhuma atribuição
  update workspace_members set client_scope = 'atribuidos' where workspace_id = v_ws and user_id = v_restr;

  -- owner_adds_and_lists
  v_p1 := pg_temp.as_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c, ' Marina Costa ', ' Marina@Clinica.com '))::uuid;
  v_list := pg_temp.as_user(v_owner, format('select public.hub_people_list(%s)', c))::jsonb;
  assert v_list->'people'->0->>'email' = 'marina@clinica.com'
     and v_list->'people'->0->>'nome' = 'Marina Costa'
     and (v_list->'people'->0->>'id')::uuid = v_p1
     and v_list->>'require_login' = 'false'
     and jsonb_array_length(v_list->'people') = 1, 'owner_adds_and_lists: ' || v_list::text;

  -- duplicate
  v_err := pg_temp.err_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c, 'Outra', 'MARINA@clinica.com'));
  assert v_err like '%duplicate%', 'duplicate: ' || coalesce(v_err, 'ok');

  -- invalid
  v_err := pg_temp.err_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c, '  ', 'a@b.com'));
  assert v_err like '%invalid%', 'invalid (empty name): ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c, repeat('x', 81), 'a@b.com'));
  assert v_err like '%invalid%', 'invalid (81 chars): ' || coalesce(v_err, 'ok');
  v_err := pg_temp.err_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c, 'Nome', 'not-an-email'));
  assert v_err like '%invalid%', 'invalid (email): ' || coalesce(v_err, 'ok');

  -- limit
  for i in 1..20 loop
    perform pg_temp.as_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c3, 'P' || i, 'p' || i || '@x.com'));
  end loop;
  v_err := pg_temp.err_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c3, 'P21', 'p21@x.com'));
  assert v_err like '%limit%', 'limit: ' || coalesce(v_err, 'ok');
  select id into v_px from hub_client_people where cliente_id = c3 and email = 'p1@x.com';

  -- no_people
  v_err := pg_temp.err_user(v_owner, format('select public.hub_set_require_login(%s, true)', c2));
  assert v_err like '%no_people%', 'no_people: ' || coalesce(v_err, 'ok');

  -- last_person
  v_p4 := pg_temp.as_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c4, 'Unica', 'unica@x.com'))::uuid;
  perform pg_temp.as_user(v_owner, format('select public.hub_set_require_login(%s, true)', c4));
  v_err := pg_temp.err_user(v_owner, format('select public.hub_people_remove(%L::uuid)', v_p4));
  assert v_err like '%last_person%', 'last_person (switch on): ' || coalesce(v_err, 'ok');
  perform pg_temp.as_user(v_owner, format('select public.hub_set_require_login(%s, false)', c4));
  v_err := pg_temp.err_user(v_owner, format('select public.hub_people_remove(%L::uuid)', v_p4));
  assert v_err is null and not exists (select 1 from hub_client_people where id = v_p4),
    'last_person (switch off): ' || coalesce(v_err, 'ok');

  -- agent_forbidden
  foreach v_txt in array array[
    format('select public.hub_people_list(%s)', c),
    format('select public.hub_people_add(%s, %L, %L)', c, 'Nova', 'nova@x.com'),
    format('select public.hub_people_remove(%L::uuid)', v_p1),
    format('select public.hub_set_require_login(%s, false)', c)
  ] loop
    v_err := pg_temp.err_user(v_agent, v_txt);
    assert v_err like '%forbidden%', 'agent_forbidden: ' || v_txt || ' -> ' || coalesce(v_err, 'ok');
  end loop;

  -- other_workspace_not_found
  foreach v_txt in array array[
    format('select public.hub_people_list(%s)', c),
    format('select public.hub_people_add(%s, %L, %L)', c, 'Nova', 'nova@x.com'),
    format('select public.hub_people_remove(%L::uuid)', v_p1),
    format('select public.hub_set_require_login(%s, false)', c)
  ] loop
    v_err := pg_temp.err_user(v_ownerb, v_txt);
    assert v_err like '%not_found%', 'other_workspace_not_found: ' || v_txt || ' -> ' || coalesce(v_err, 'ok');
  end loop;

  -- restricted_member_not_found
  foreach v_txt in array array[
    format('select public.hub_people_list(%s)', c),
    format('select public.hub_people_add(%s, %L, %L)', c, 'Nova', 'nova@x.com'),
    format('select public.hub_people_remove(%L::uuid)', v_p1),
    format('select public.hub_set_require_login(%s, false)', c)
  ] loop
    v_err := pg_temp.err_user(v_restr, v_txt);
    assert v_err like '%not_found%', 'restricted_member_not_found: ' || v_txt || ' -> ' || coalesce(v_err, 'ok');
  end loop;

  -- audit_written (add, remove, switch), with conta_id
  assert exists (select 1 from audit_log where conta_id = v_ws and action = 'hub_people.add'
                    and resource_type = 'hub_client_people' and metadata->>'email' = 'marina@clinica.com'
                    and (metadata->>'cliente_id')::bigint = c)
     and exists (select 1 from audit_log where conta_id = v_ws and action = 'hub_people.remove'
                    and resource_type = 'hub_client_people' and (metadata->>'cliente_id')::bigint = c4)
     and exists (select 1 from audit_log where conta_id = v_ws and action = 'hub_login.require'
                    and resource_type = 'hub_client_people' and (metadata->>'cliente_id')::bigint = c4),
    'audit_written: missing rows';

  -- acl_closed
  foreach v_txt in array array['hub_client_people', 'hub_client_settings', 'hub_login_codes', 'hub_sessions'] loop
    v_err := pg_temp.err_user(v_owner, format('select 1 from public.%I', v_txt));
    assert v_err like '42501:%', 'acl_closed: ' || v_txt || ' -> ' || coalesce(v_err, 'readable');
  end loop;
  foreach v_fn in array array[
    'public.hub_login_verify(bigint,text,text,text)',
    'public.hub_access_context(bigint,text)',
    'public.hub_login_issue(bigint,text,text)',
    'public.hub_session_touch(text)',
    'public.hub_session_delete(text)',
    'public.hub_login_cleanup()'
  ] loop
    assert not has_function_privilege('authenticated', v_fn, 'execute')
       and not has_function_privilege('anon', v_fn, 'execute')
       and has_function_privilege('service_role', v_fn, 'execute'), 'acl_closed: ' || v_fn;
  end loop;
  foreach v_fn in array array[
    'public.hub_people_list(bigint)',
    'public.hub_people_add(bigint,text,text)',
    'public.hub_people_remove(uuid)',
    'public.hub_set_require_login(bigint,boolean)'
  ] loop
    assert has_function_privilege('authenticated', v_fn, 'execute')
       and not has_function_privilege('anon', v_fn, 'execute'), 'acl_closed (crm rpc): ' || v_fn;
  end loop;

  -- issue_only_for_listed
  assert pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, 'nobody@x.com', '111111')) = 'false',
    'issue_only_for_listed: unlisted returned true';
  assert not exists (select 1 from hub_login_codes), 'issue_only_for_listed: unlisted wrote a code';
  assert pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, ' Marina@Clinica.com ', '111111')) = 'true',
    'issue_only_for_listed: listed returned false';
  assert exists (select 1 from hub_login_codes where cliente_id = c and email = 'marina@clinica.com'
                   and code_hash <> '111111' and salt <> ''), 'issue_only_for_listed: no row for listed';

  -- verify_happy
  perform pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, 'marina@clinica.com', '482913'));
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, ' Marina@Clinica.com ', '482913', v_hash_a))::jsonb;
  assert v_res->>'ok' = 'true', 'verify_happy: ' || v_res::text;
  assert exists (select 1 from hub_sessions where token_hash = v_hash_a and email = 'marina@clinica.com'
                   and expires_at between now() + interval '90 days' - interval '1 minute'
                                      and now() + interval '90 days' + interval '1 minute'),
    'verify_happy: session row';
  assert (select last_login_at from hub_client_people where id = v_p1) is not null, 'verify_happy: last_login_at';
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, 'marina@clinica.com', '482913', v_hash_b))::jsonb;
  assert v_res->>'ok' = 'false', 'verify_happy: single use ' || v_res::text;

  -- attempts_cap
  perform pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, 'marina@clinica.com', '482913'));
  for i in 1..5 loop
    v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, 'marina@clinica.com', '000000', v_hash_b))::jsonb;
    assert v_res->>'ok' = 'false', 'attempts_cap: wrong code ' || i || ' ' || v_res::text;
  end loop;
  assert (select attempts from hub_login_codes where cliente_id = c and used_at is null
           order by created_at desc limit 1) = 5, 'attempts_cap: attempts not persisted';
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, 'marina@clinica.com', '482913', v_hash_b))::jsonb;
  assert v_res->>'ok' = 'false', 'attempts_cap: right code after 5 misses ' || v_res::text;

  -- expired
  perform pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, 'marina@clinica.com', '333333'));
  update hub_login_codes set expires_at = now() - interval '1 second'
   where cliente_id = c and email = 'marina@clinica.com' and used_at is null;
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, 'marina@clinica.com', '333333', v_hash_b))::jsonb;
  assert v_res->>'ok' = 'false', 'expired: ' || v_res::text;

  -- reissue_invalidates
  perform pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, 'marina@clinica.com', '111111'));
  perform pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, 'marina@clinica.com', '222222'));
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, 'marina@clinica.com', '111111', v_hash_b))::jsonb;
  assert v_res->>'ok' = 'false', 'reissue_invalidates: old code ' || v_res::text;
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, 'marina@clinica.com', '222222', v_hash_b))::jsonb;
  assert v_res->>'ok' = 'true', 'reissue_invalidates: new code ' || v_res::text;

  -- code_bound_to_client
  v_p5 := pg_temp.as_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c5, 'Marina Costa', 'marina@clinica.com'))::uuid;
  perform pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c, 'marina@clinica.com', '444444'));
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c5, 'marina@clinica.com', '444444', v_hash_c))::jsonb;
  assert v_res->>'ok' = 'false', 'code_bound_to_client: verified on the other client ' || v_res::text;
  perform pg_temp.svc(format('select public.hub_login_issue(%s, %L, %L)', c5, 'marina@clinica.com', '555555'));
  assert exists (select 1 from hub_login_codes where cliente_id = c and email = 'marina@clinica.com' and used_at is null),
    'code_bound_to_client: issuing on B marked A''s code used';
  v_res := pg_temp.svc(format('select public.hub_login_verify(%s, %L, %L, %L)', c, 'marina@clinica.com', '444444', v_hash_c))::jsonb;
  assert v_res->>'ok' = 'true', 'code_bound_to_client: A''s code no longer works ' || v_res::text;

  -- access_context
  v_res := pg_temp.svc(format('select public.hub_access_context(%s, null)', c2))::jsonb;
  assert v_res->>'require_login' = 'false' and v_res->'person' = 'null'::jsonb, 'access_context: no settings row ' || v_res::text;
  v_res := pg_temp.svc(format('select public.hub_access_context(%s, %L)', c, v_hash_a))::jsonb;
  assert v_res->'person'->>'nome' = 'Marina Costa' and v_res->'person'->>'email' = 'marina@clinica.com'
     and (v_res->'person'->>'id')::uuid = v_p1, 'access_context: person on A ' || v_res::text;
  v_res := pg_temp.svc(format('select public.hub_access_context(%s, %L)', c2, v_hash_a))::jsonb;
  assert v_res->'person' = 'null'::jsonb, 'access_context: person on client without the email ' || v_res::text;
  update hub_sessions set expires_at = now() - interval '1 second' where token_hash = v_hash_c;
  v_res := pg_temp.svc(format('select public.hub_access_context(%s, %L)', c, v_hash_c))::jsonb;
  assert v_res->'person' = 'null'::jsonb, 'access_context: expired session ' || v_res::text;
  v_res := pg_temp.svc(format('select public.hub_access_context(%s, %L)', c5, v_hash_a))::jsonb;
  assert (v_res->'person'->>'id')::uuid = v_p5, 'access_context: person on C5 before removal ' || v_res::text;
  perform pg_temp.as_user(v_owner, format('select public.hub_people_remove(%L::uuid)', v_p5));
  v_res := pg_temp.svc(format('select public.hub_access_context(%s, %L)', c5, v_hash_a))::jsonb;
  assert v_res->'person' = 'null'::jsonb, 'access_context: removed person ' || v_res::text;

  -- approval_person
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_owner, v_ws, c, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (v_wf, v_ws, 'Post 1', 'enviado_cliente') returning id into v_post1;
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (v_wf, v_ws, 'Post 2', 'enviado_cliente') returning id into v_post2;
  v_appr1 := pg_temp.svc(format(
    'select approval_id from public.record_client_approval_with_notes(p_post_id => %s, p_conta_id => %L::uuid, '
    'p_cliente_id => %s, p_token => %L, p_action => %L, p_comentario => null, p_new_status => %L, p_motivo => null)',
    v_post1, v_ws, c, 'tok', 'aprovado', 'aprovado_cliente'))::bigint;
  assert (select hub_person_id is null and hub_person_nome is null from post_approvals where id = v_appr1),
    'approval_person: old named call';
  v_appr2 := pg_temp.svc(format(
    'select approval_id from public.record_client_approval_with_notes(p_post_id => %s, p_conta_id => %L::uuid, '
    'p_cliente_id => %s, p_token => %L, p_action => %L, p_comentario => %L, p_new_status => %L, p_motivo => %L, '
    'p_hub_person_id => %L::uuid, p_hub_person_nome => %L)',
    v_post2, v_ws, c, 'tok', 'correcao', 'Ajusta', 'correcao_cliente', 'texto', v_p1, 'Marina Costa'))::bigint;
  assert (select hub_person_id = v_p1 and hub_person_nome = 'Marina Costa' from post_approvals where id = v_appr2),
    'approval_person: person columns';
  -- a remoção pelo CRM (usuário autenticado, switch desligado) dispara o ON DELETE SET NULL
  perform pg_temp.as_user(v_owner, format('select public.hub_people_remove(%L::uuid)', v_p1));
  assert (select hub_person_id is null and hub_person_nome = 'Marina Costa' from post_approvals where id = v_appr2),
    'approval_person: after removal';

  -- authorship_not_forgeable
  v_appr_auth := pg_temp.as_user(v_owner, format(
    'insert into public.post_approvals (post_id, action, comentario, is_workspace_user, author_user_id, hub_person_id, hub_person_nome) '
    'values (%s, %L, %L, true, %L::uuid, %L::uuid, %L) returning id', v_post1, 'mensagem', 'oi', v_owner, v_px, 'Fake'))::bigint;
  assert (select hub_person_id is null and hub_person_nome is null from post_approvals where id = v_appr_auth),
    'authorship_not_forgeable: post_approvals as authenticated';
  v_msg_auth := pg_temp.as_user(v_owner, format(
    'insert into public.mensagens (conta_id, cliente_id, content, is_workspace_user, author_user_id, hub_person_id, hub_person_nome) '
    'values (%L::uuid, %s, %L, true, %L::uuid, %L::uuid, %L) returning id', v_ws, c, 'oi', v_owner, v_px, 'Fake'))::bigint;
  assert (select hub_person_id is null and hub_person_nome is null from mensagens where id = v_msg_auth),
    'authorship_not_forgeable: mensagens as authenticated';
  perform set_config('request.jwt.claims', '', true);
  assert auth.uid() is null, 'authorship_not_forgeable: claims not cleared';
  v_appr_svc := pg_temp.svc(format(
    'insert into public.post_approvals (post_id, action, comentario, is_workspace_user, hub_person_id, hub_person_nome) '
    'values (%s, %L, %L, false, %L::uuid, %L) returning id', v_post1, 'mensagem', 'oi', v_px, 'Fake'))::bigint;
  assert (select hub_person_id = v_px and hub_person_nome = 'Fake' from post_approvals where id = v_appr_svc),
    'authorship_not_forgeable: post_approvals as service role';
  v_msg_svc := pg_temp.svc(format(
    'insert into public.mensagens (conta_id, cliente_id, content, is_workspace_user, hub_person_id, hub_person_nome) '
    'values (%L::uuid, %s, %L, false, %L::uuid, %L) returning id', v_ws, c, 'oi', v_px, 'Fake'))::bigint;
  assert (select hub_person_id = v_px and hub_person_nome = 'Fake' from mensagens where id = v_msg_svc),
    'authorship_not_forgeable: mensagens as service role';

  -- feed_person_name
  v_msg_feed := pg_temp.svc(format(
    'insert into public.mensagens (conta_id, cliente_id, content, is_workspace_user, hub_person_nome) '
    'values (%L::uuid, %s, %L, false, %L) returning id', v_ws, c, 'Olá', 'Marina Costa'))::bigint;
  perform set_config('request.jwt.claims', '', true);
  for v_rec in select * from public.get_mensagens_feed(p_conta_id => v_ws, p_cliente_id => c) loop
    if (v_rec.source = 'post_feedback' and v_rec.item_id = v_appr2)
       or (v_rec.source = 'mensagem' and v_rec.item_id = v_msg_feed) then
      assert v_rec.client_person_name = 'Marina Costa',
        'feed_person_name: ' || v_rec.source || ' ' || v_rec.item_id || ' -> ' || coalesce(v_rec.client_person_name, 'null');
    elsif (v_rec.source = 'post_feedback' and v_rec.item_id in (v_appr1, v_appr_auth))
       or (v_rec.source = 'mensagem' and v_rec.item_id = v_msg_auth) then
      assert v_rec.client_person_name is null,
        'feed_person_name: expected null for ' || v_rec.source || ' ' || v_rec.item_id;
    end if;
  end loop;
  select count(*) into v_n from public.get_mensagens_feed(p_conta_id => v_ws, p_cliente_id => c)
   where (source = 'post_feedback' and item_id in (v_appr1, v_appr2, v_appr_auth))
      or (source = 'mensagem' and item_id in (v_msg_auth, v_msg_feed));
  assert v_n = 5, 'feed_person_name: expected 5 rows, got ' || v_n;

  -- touch_once_a_day
  insert into hub_sessions (token_hash, email, last_used_at, expires_at)
    values (v_hash_d, 'marina@clinica.com', now() - interval '2 days', now() + interval '1 day');
  perform pg_temp.svc(format('select public.hub_session_touch(%L)', v_hash_d));
  assert (select expires_at between now() + interval '90 days' - interval '1 minute'
                                and now() + interval '90 days' + interval '1 minute'
             and last_used_at = now()
            from hub_sessions where token_hash = v_hash_d), 'touch_once_a_day: first touch';
  v_ts := '2099-01-01 00:00:00+00';
  update hub_sessions set expires_at = v_ts where token_hash = v_hash_d;
  perform pg_temp.svc(format('select public.hub_session_touch(%L)', v_hash_d));
  assert (select expires_at from hub_sessions where token_hash = v_hash_d) = v_ts,
    'touch_once_a_day: second touch moved expires_at';

  -- session_delete
  perform pg_temp.svc(format('select public.hub_session_delete(%L)', v_hash_d));
  assert not exists (select 1 from hub_sessions where token_hash = v_hash_d), 'session_delete';

  -- audit_written (no code in any metadata)
  assert not exists (select 1 from audit_log where conta_id = v_ws
                       and metadata::text ~ '(111111|222222|333333|444444|555555|482913|000000)'),
    'audit_written: a code reached audit_log';

  -- remove_ends_sessions
  -- (a) pessoa em um cliente só: removê-la encerra as sessões do e-mail, e só as dele
  v_px := pg_temp.as_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c2, 'Solo', 'solo@x.com'))::uuid;
  insert into hub_sessions (token_hash, email, expires_at) values
    (repeat('e', 64), 'solo@x.com', now() + interval '1 day'),
    (repeat('f', 64), 'outra@x.com', now() + interval '1 day');
  perform pg_temp.as_user(v_owner, format('select public.hub_people_remove(%L::uuid)', v_px));
  assert not exists (select 1 from hub_sessions where email = 'solo@x.com'),
    'remove_ends_sessions: session survived removal from the only client';
  assert exists (select 1 from hub_sessions where token_hash = repeat('f', 64)),
    'remove_ends_sessions: removal ended another email''s session';
  -- (b) mesmo e-mail em dois clientes: remover de um mantém a sessão
  v_px := pg_temp.as_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c2, 'Dupla', 'dupla@x.com'))::uuid;
  v_p4 := pg_temp.as_user(v_owner, format('select public.hub_people_add(%s, %L, %L)', c4, 'Dupla', 'dupla@x.com'))::uuid;
  insert into hub_sessions (token_hash, email, expires_at) values (repeat('0', 64), 'dupla@x.com', now() + interval '1 day');
  perform pg_temp.as_user(v_owner, format('select public.hub_people_remove(%L::uuid)', v_px));
  assert exists (select 1 from hub_sessions where token_hash = repeat('0', 64)),
    'remove_ends_sessions: session ended while the email is still listed on another client';
  perform pg_temp.as_user(v_owner, format('select public.hub_people_remove(%L::uuid)', v_p4));
  assert not exists (select 1 from hub_sessions where email = 'dupla@x.com'),
    'remove_ends_sessions: session survived removal from the last client';

  raise notice 'PASS 99_hub_client_login';
end $$;
rollback;
