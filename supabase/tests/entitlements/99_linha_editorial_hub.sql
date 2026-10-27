\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Linha editorial Hub RPCs and notifications (20261031000003_linha_editorial_hub_notifications.sql):
-- record_linha_decision / record_linha_comment are scoped by the token's conta AND cliente,
-- need status enviada and the flag; create_linha_notification targets owner/admin plus the
-- sender while still a member, deduped; the two new types reach the type checks and the
-- e-mail digest. All three are service_role only.

begin;
select et_grant_hosted_parity(array['linhas_editoriais','linha_editorial_colunas','linha_editorial_itens','linha_editorial_respostas']);

-- 'SQLSTATE:message' of the error p_sql raises as service_role, or NULL on success
create or replace function pg_temp.erro_sr(p_sql text) returns text language plpgsql as $f$
begin
  execute 'set local role service_role';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
-- first column of p_sql's first row, as text, run as service_role; errors propagate
create or replace function pg_temp.val_sr(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  execute 'set local role service_role';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
-- same as erro_sr, as an authenticated user
create or replace function pg_temp.erro_auth(p_user uuid, p_sql text) returns text language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  return null;
exception when others then
  execute 'reset role';
  return sqlstate || ':' || sqlerrm;
end $f$;
create or replace function pg_temp.usuario(p_ws uuid, p_role text) returns uuid language plpgsql as $f$
declare v_u uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_u);
  insert into workspace_members (user_id, workspace_id, role) values (v_u, p_ws, p_role);
  update profiles set conta_id = p_ws, active_workspace_id = p_ws where id = v_u;
  return v_u;
end $f$;
-- a linha as the agency left it after "Enviar" (rodada 1), with one item
create or replace function pg_temp.linha(p_conta uuid, p_cliente bigint, p_periodo date, p_status text,
                                         p_sender uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.linhas_editoriais (conta_id, cliente_id, periodo, status, rodada, enviada_por, enviada_at)
    values (p_conta, p_cliente, p_periodo, p_status, 1, p_sender, now()) returning id into v;
  insert into public.linha_editorial_itens (linha_id, conta_id, data, tipo, titulo, ordem)
    values (v, p_conta, p_periodo + 2, 'feed', 'Item', 0);
  return v;
end $f$;
grant execute on all functions in schema pg_temp to authenticated, service_role;

do $$
declare
  v_a uuid; v_b uuid; u_o uuid; u_adm uuid; u_ag uuid; u_ag2 uuid; u_b uuid;
  v_c1 bigint; v_c2 bigint;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_l4 uuid; v_l5 uuid; v_l6 uuid; v_l7 uuid;
  v_item uuid; v_item_outro uuid; v_resp uuid;
  v_res jsonb; v_e text; v_n bigint; v_users uuid[]; v_meta jsonb; v_link text;
  v_ids uuid[]; v_claimed uuid[];
  v_dec constant text := 'select public.record_linha_decision(%L, %L, %s, ''tok-1'', %L, %L)';
  v_com constant text := 'select public.record_linha_comment(%L, %L, %L, %s, ''tok-1'', %L)';
begin
  -- ---------- fixture ----------
  v_a := et_make_workspace('max');
  v_b := et_make_workspace('max');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_a, '{"feature_linha_editorial": true}');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_b, '{"feature_linha_editorial": true}');
  u_o := pg_temp.usuario(v_a, 'owner');
  u_adm := pg_temp.usuario(v_a, 'admin');
  u_ag := pg_temp.usuario(v_a, 'agent');
  u_ag2 := pg_temp.usuario(v_a, 'agent');
  u_b := pg_temp.usuario(v_b, 'owner');
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_o, v_a, 'Clínica Sol', 'CS', '#000') returning id into v_c1;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_o, v_a, 'Outro', 'OU', '#000') returning id into v_c2;
  v_l1 := pg_temp.linha(v_a, v_c1, '2026-11-01', 'enviada', u_o);
  v_l2 := pg_temp.linha(v_a, v_c1, '2026-12-01', 'rascunho', u_o);
  v_l4 := pg_temp.linha(v_a, v_c1, '2027-01-01', 'enviada', u_o);
  v_l5 := pg_temp.linha(v_a, v_c1, '2027-02-01', 'enviada', u_o);
  select id into v_item from linha_editorial_itens where linha_id = v_l1;
  select id into v_item_outro from linha_editorial_itens where linha_id = v_l4;

  -- ---------- decision_other_cliente_refused ----------
  v_e := pg_temp.erro_sr(format(v_dec, v_l1, v_a, v_c2, 'aprovado', null));
  assert v_e = 'P0001:nao_encontrada', 'decision with another client''s token: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_dec, v_l1, v_b, v_c1, 'aprovado', null));
  assert v_e = 'P0001:nao_encontrada', 'decision with another conta''s token: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_com, v_l1, null, v_a, v_c2, 'oi'));
  assert v_e = 'P0001:nao_encontrada', 'comment with another client''s token: ' || coalesce(v_e, 'null');
  assert (select status = 'enviada' and decidida_at is null from linhas_editoriais where id = v_l1), 'linha untouched';
  assert not exists (select 1 from linha_editorial_respostas where linha_id = v_l1), 'no resposta written';
  raise notice 'PASS decision_other_cliente_refused';

  -- ---------- decision_requires_enviada ----------
  v_e := pg_temp.erro_sr(format(v_dec, v_l2, v_a, v_c1, 'aprovado', null));
  assert v_e = 'P0001:status_invalido', 'decision on a rascunho: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_dec, v_l1, v_a, v_c1, 'comentario', 'x'));
  assert v_e = 'P0001:acao_invalida', 'decision with acao comentario: ' || coalesce(v_e, 'null');
  raise notice 'PASS decision_requires_enviada';

  -- ---------- ajustes_requires_comment_unless_rodada_has_comments ----------
  v_e := pg_temp.erro_sr(format(v_dec, v_l1, v_a, v_c1, 'ajustes', null));
  assert v_e = 'P0001:comentario_obrigatorio', 'ajustes without a comment: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_dec, v_l1, v_a, v_c1, 'ajustes', '   '));
  assert v_e = 'P0001:comentario_obrigatorio', 'ajustes with a blank comment: ' || coalesce(v_e, 'null');
  -- a team reply does not count, nor a client comment of an earlier rodada
  insert into linha_editorial_respostas (conta_id, linha_id, acao, comentario, is_workspace_user, author_user_id)
    values (v_a, v_l1, 'comentario', 'resposta da equipe', true, u_o);
  v_l3 := pg_temp.linha(v_a, v_c1, '2027-03-01', 'enviada', u_o);
  insert into linha_editorial_respostas (conta_id, linha_id, acao, comentario, is_workspace_user, token)
    values (v_a, v_l3, 'comentario', 'rodada antiga', false, 'tok-1');
  update linhas_editoriais set rodada = 2 where id = v_l3;
  v_e := pg_temp.erro_sr(format(v_dec, v_l1, v_a, v_c1, 'ajustes', null));
  assert v_e = 'P0001:comentario_obrigatorio', 'a team reply does not satisfy ajustes: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_dec, v_l3, v_a, v_c1, 'ajustes', null));
  assert v_e = 'P0001:comentario_obrigatorio', 'an earlier rodada''s comment does not count: ' || coalesce(v_e, 'null');
  -- a client comment in this rodada does
  v_e := pg_temp.erro_sr(format(v_com, v_l1, v_item, v_a, v_c1, 'Troca a data'));
  assert v_e is null, 'client comment: ' || coalesce(v_e, '');
  v_res := pg_temp.val_sr(format(v_dec, v_l1, v_a, v_c1, 'ajustes', null))::jsonb;
  assert v_res = '{"status": "ajustes", "comentarios": 1}'::jsonb, 'ajustes result: ' || v_res;
  assert (select status = 'ajustes' and decidida_at is not null from linhas_editoriais where id = v_l1), 'linha in ajustes';
  assert (select count(*) from linha_editorial_respostas
           where linha_id = v_l1 and acao = 'ajustes' and comentario is null and item_id is null
             and rodada = 1 and not is_workspace_user and author_user_id is null and token = 'tok-1') = 1,
    'decision row written with the rodada and the token';
  raise notice 'PASS ajustes_requires_comment_unless_rodada_has_comments';

  -- ---------- aprovado_sets_status_and_decidida_at ----------
  v_res := pg_temp.val_sr(format(v_dec, v_l4, v_a, v_c1, 'aprovado', ' Perfeito '))::jsonb;
  assert v_res = '{"status": "aprovada", "comentarios": 1}'::jsonb, 'aprovado with a comment: ' || v_res;
  assert (select status = 'aprovada' and decidida_at is not null from linhas_editoriais where id = v_l4), 'linha aprovada';
  assert (select comentario from linha_editorial_respostas where linha_id = v_l4 and acao = 'aprovado') = 'Perfeito',
    'comment stored trimmed';
  v_res := pg_temp.val_sr(format(v_dec, v_l5, v_a, v_c1, 'aprovado', ''))::jsonb;
  assert v_res = '{"status": "aprovada", "comentarios": 0}'::jsonb, 'aprovado without a comment: ' || v_res;
  assert (select comentario is null from linha_editorial_respostas where linha_id = v_l5 and acao = 'aprovado'),
    'empty comment stored as null';
  v_e := pg_temp.erro_sr(format(v_dec, v_l4, v_a, v_c1, 'aprovado', null));
  assert v_e = 'P0001:status_invalido', 'a second decision is refused: ' || coalesce(v_e, 'null');
  raise notice 'PASS aprovado_sets_status_and_decidida_at';

  -- ---------- comment_item_must_belong_to_linha ----------
  v_l6 := pg_temp.linha(v_a, v_c1, '2027-04-01', 'enviada', u_o);
  v_e := pg_temp.erro_sr(format(v_com, v_l6, v_item_outro, v_a, v_c1, 'oi'));
  assert v_e = 'P0001:nao_encontrada', 'comment on an item of another linha: ' || coalesce(v_e, 'null');
  v_resp := pg_temp.val_sr(format(v_com, v_l6, (select id from linha_editorial_itens where linha_id = v_l6), v_a, v_c1, 'Esse item'))::uuid;
  assert (select item_id = (select id from linha_editorial_itens where linha_id = v_l6)
            from linha_editorial_respostas where id = v_resp), 'comment attached to its item';
  raise notice 'PASS comment_item_must_belong_to_linha';

  -- ---------- comment_null_item_allowed ----------
  v_resp := pg_temp.val_sr(format(v_com, v_l6, null, v_a, v_c1, '  Geral  '))::uuid;
  assert (select item_id is null and acao = 'comentario' and comentario = 'Geral' and rodada = 1
                 and not is_workspace_user and token = 'tok-1' and author_user_id is null
            from linha_editorial_respostas where id = v_resp), 'linha-level client comment';
  assert (select status from linhas_editoriais where id = v_l6) = 'enviada', 'a comment does not change the status';
  raise notice 'PASS comment_null_item_allowed';

  -- ---------- comment_requires_enviada ----------
  v_e := pg_temp.erro_sr(format(v_com, v_l2, null, v_a, v_c1, 'oi'));
  assert v_e = 'P0001:status_invalido', 'comment on a rascunho: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_com, v_l4, null, v_a, v_c1, 'oi'));
  assert v_e = 'P0001:status_invalido', 'comment on an aprovada: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_com, v_l6, null, v_a, v_c1, '  '));
  assert v_e = 'P0001:comentario_obrigatorio', 'blank comment: ' || coalesce(v_e, 'null');
  raise notice 'PASS comment_requires_enviada';

  -- ---------- notification_targets_owner_admin_and_sender_deduped ----------
  -- v_l1: sent by the owner, ajustes with 1 client comment
  v_e := pg_temp.erro_sr(format('select public.create_linha_notification(%L, ''ajustes'')', v_l1));
  assert v_e is null, 'create_linha_notification: ' || coalesce(v_e, '');
  select array_agg(user_id order by user_id), min(link), (array_agg(metadata))[1] into v_users, v_link, v_meta
    from notifications where workspace_id = v_a and type = 'linha_editorial_ajustes';
  assert v_users = (select array_agg(u order by u) from unnest(array[u_o, u_adm]) u),
    'owner (also the sender) once and the admin, never the agent: ' || coalesce(v_users::text, 'null');
  assert v_link = format('/entregas?view=linha&clientes=%s&mes=2026-11', v_c1), 'link: ' || coalesce(v_link, 'null');
  assert v_meta = jsonb_build_object('linha_id', v_l1, 'cliente_id', v_c1, 'cliente_nome', 'Clínica Sol',
                                     'periodo', '2026-11-01', 'comentarios', 1),
    'metadata: ' || coalesce(v_meta::text, 'null');
  assert jsonb_typeof(v_meta->'comentarios') = 'number', 'comentarios is a number';
  -- an agent sender is appended
  update linhas_editoriais set enviada_por = u_ag where id = v_l4;
  v_e := pg_temp.erro_sr(format('select public.create_linha_notification(%L, ''aprovado'')', v_l4));
  assert v_e is null, 'create_linha_notification aprovado: ' || coalesce(v_e, '');
  select array_agg(user_id order by user_id) into v_users
    from notifications where workspace_id = v_a and type = 'linha_editorial_aprovada';
  assert v_users = (select array_agg(u order by u) from unnest(array[u_o, u_adm, u_ag]) u),
    'the agent who sent it is notified too: ' || coalesce(v_users::text, 'null');
  v_e := pg_temp.erro_sr(format('select public.create_linha_notification(%L, ''comentario'')', v_l4));
  assert v_e is null and (select count(*) from notifications where workspace_id = v_a and type like 'linha_editorial_%') = 5,
    'an unknown acao notifies nobody: ' || coalesce(v_e, '');
  raise notice 'PASS notification_targets_owner_admin_and_sender_deduped';

  -- ---------- sender_removed_from_workspace_not_notified ----------
  update linhas_editoriais set enviada_por = u_ag2 where id = v_l5;
  delete from workspace_members where user_id = u_ag2 and workspace_id = v_a;
  delete from notifications where workspace_id = v_a;
  v_e := pg_temp.erro_sr(format('select public.create_linha_notification(%L, ''aprovado'')', v_l5));
  assert v_e is null, 'create_linha_notification: ' || coalesce(v_e, '');
  select array_agg(user_id order by user_id) into v_users from notifications where workspace_id = v_a;
  assert v_users = (select array_agg(u order by u) from unnest(array[u_o, u_adm]) u),
    'a sender no longer in the workspace is not notified: ' || coalesce(v_users::text, 'null');
  raise notice 'PASS sender_removed_from_workspace_not_notified';

  -- ---------- hub_rpcs_refused_when_flag_off ----------
  delete from workspace_plan_overrides where workspace_id = v_a;
  v_e := pg_temp.erro_sr(format(v_dec, v_l6, v_a, v_c1, 'aprovado', null));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off: decision: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_com, v_l6, null, v_a, v_c1, 'oi'));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag off: comment: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro_sr(format(v_dec, gen_random_uuid(), v_a, v_c1, 'aprovado', null));
  assert v_e = 'P0001:feature_disabled:feature_linha_editorial', 'flag checked before the lookup: ' || coalesce(v_e, 'null');
  assert (select status from linhas_editoriais where id = v_l6) = 'enviada', 'flag off: nothing decided';
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values (v_a, '{"feature_linha_editorial": true}');
  raise notice 'PASS hub_rpcs_refused_when_flag_off';

  -- ---------- authenticated_cannot_execute_hub_rpcs ----------
  assert not has_function_privilege('authenticated', 'public.record_linha_decision(uuid, uuid, bigint, text, text, text)', 'EXECUTE'), 'authenticated: decision';
  assert not has_function_privilege('authenticated', 'public.record_linha_comment(uuid, uuid, uuid, bigint, text, text)', 'EXECUTE'), 'authenticated: comment';
  assert not has_function_privilege('authenticated', 'public.create_linha_notification(uuid, text)', 'EXECUTE'), 'authenticated: notification';
  assert not has_function_privilege('anon', 'public.record_linha_decision(uuid, uuid, bigint, text, text, text)', 'EXECUTE'), 'anon: decision';
  assert not has_function_privilege('anon', 'public.record_linha_comment(uuid, uuid, uuid, bigint, text, text)', 'EXECUTE'), 'anon: comment';
  assert not has_function_privilege('anon', 'public.create_linha_notification(uuid, text)', 'EXECUTE'), 'anon: notification';
  assert has_function_privilege('service_role', 'public.record_linha_decision(uuid, uuid, bigint, text, text, text)', 'EXECUTE'), 'service_role: decision';
  assert has_function_privilege('service_role', 'public.record_linha_comment(uuid, uuid, uuid, bigint, text, text)', 'EXECUTE'), 'service_role: comment';
  assert has_function_privilege('service_role', 'public.create_linha_notification(uuid, text)', 'EXECUTE'), 'service_role: notification';
  v_e := pg_temp.erro_auth(u_o, format(v_dec, v_l6, v_a, v_c1, 'aprovado', null));
  assert v_e like '42501:%', 'an agency user cannot decide for the client: ' || coalesce(v_e, 'null');
  raise notice 'PASS authenticated_cannot_execute_hub_rpcs';

  -- ---------- claim_notification_emails_includes_new_types ----------
  delete from notifications where workspace_id = v_a;
  insert into notifications (workspace_id, user_id, type, metadata, link, created_at) values
    (v_a, u_o, 'linha_editorial_aprovada', '{}', '/entregas', now() - interval '1 hour'),
    (v_a, u_o, 'linha_editorial_ajustes', '{}', '/entregas', now() - interval '1 hour');
  select array_agg(id) into v_ids from notifications where workspace_id = v_a;
  select array_agg(c.id) into v_claimed
    from public.claim_notification_emails(now(), now() - interval '1 day', 1000) c;
  assert v_ids <@ coalesce(v_claimed, '{}'), 'both linha types are claimed by the e-mail digest';
  insert into notification_email_prefs (user_id, type, enabled) values (u_o, 'linha_editorial_aprovada', false), (u_o, 'linha_editorial_ajustes', true);
  insert into notification_inapp_prefs (user_id, type, enabled) values (u_o, 'linha_editorial_aprovada', false), (u_o, 'linha_editorial_ajustes', true);
  raise notice 'PASS claim_notification_emails_includes_new_types';
end $$;

rollback;
