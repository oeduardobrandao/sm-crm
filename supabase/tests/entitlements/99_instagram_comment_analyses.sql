\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Instagram comment analyses (20261114000001_instagram_comment_analyses.sql): read-only for
-- authenticated members of the owning workspace (writes are service_role only), the
-- scope/post-id CHECK, one row per target, ideias.origem_sugestao_id uniqueness per workspace,
-- and the plan flag born false everywhere.

begin;
-- the table's own privileges are under test: keep it out of the hosted-parity grant
select et_grant_hosted_parity(array['instagram_comment_analyses']);

create or replace function pg_temp.erro(p_user uuid, p_sql text) returns text language plpgsql as $f$
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
create or replace function pg_temp.val(p_user uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  return v;
end $f$;
create or replace function pg_temp.usuario(p_ws uuid) returns uuid language plpgsql as $f$
declare v_u uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_u);
  insert into workspace_members (user_id, workspace_id, role) values (v_u, p_ws, 'owner');
  update profiles set conta_id = p_ws, active_workspace_id = p_ws where id = v_u;
  return v_u;
end $f$;
grant execute on all functions in schema pg_temp to authenticated;

do $$
declare
  v_a uuid; v_b uuid; u_a uuid; u_b uuid;
  v_ca bigint; v_cb bigint; v_iga uuid; v_igb uuid;
  v_row_a uuid; v_e text;
begin
  v_a := et_make_workspace('max');
  v_b := et_make_workspace('max');
  u_a := pg_temp.usuario(v_a);
  u_b := pg_temp.usuario(v_b);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_a, v_a, 'Cli A', 'CA', '#000') returning id into v_ca;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (u_b, v_b, 'Cli B', 'CB', '#000') returning id into v_cb;
  insert into instagram_accounts (client_id, instagram_user_id) values (v_ca, 'ig-a') returning id into v_iga;
  insert into instagram_accounts (client_id, instagram_user_id) values (v_cb, 'ig-b') returning id into v_igb;

  insert into instagram_comment_analyses
    (conta_id, instagram_account_id, ig_user_id, scope, instagram_post_id, comments_analyzed,
     comments_count_at_analysis, result, model)
    values (v_a, v_iga, 'ig-a', 'post', 'media-1', 10, 12, '{}'::jsonb, 'gemini-2.5-flash-lite')
    returning id into v_row_a;
  insert into instagram_comment_analyses
    (conta_id, instagram_account_id, ig_user_id, scope, instagram_post_id, comments_analyzed,
     comments_count_at_analysis, result, model)
    values (v_b, v_igb, 'ig-b', 'post', 'media-1', 10, 12, '{}'::jsonb, 'gemini-2.5-flash-lite');

  -- ---------- isolation ----------
  assert pg_temp.val(u_a, 'select count(*) from public.instagram_comment_analyses')::int = 1,
    'member of A sees exactly its own row';
  assert pg_temp.val(u_a, format('select count(*) from public.instagram_comment_analyses where id = %L', v_row_a))::int = 1,
    'member of A reads A''s row';
  assert pg_temp.val(u_b, format('select count(*) from public.instagram_comment_analyses where id = %L', v_row_a))::int = 0,
    'member of B does not see A''s row';
  raise notice 'PASS isolation';

  -- ---------- authenticated cannot write ----------
  v_e := pg_temp.erro(u_a, format(
    'insert into public.instagram_comment_analyses (conta_id, instagram_account_id, ig_user_id, scope, comments_analyzed, comments_count_at_analysis, result, model) values (%L, %L, ''ig-a'', ''account'', 1, 1, ''{}''::jsonb, ''m'')',
    v_a, v_iga));
  assert v_e like '42501:%', 'authenticated insert refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('update public.instagram_comment_analyses set comments_analyzed = 99 where id = %L', v_row_a));
  assert v_e like '42501:%', 'authenticated update refused: ' || coalesce(v_e, 'null');
  v_e := pg_temp.erro(u_a, format('delete from public.instagram_comment_analyses where id = %L', v_row_a));
  assert v_e like '42501:%', 'authenticated delete refused: ' || coalesce(v_e, 'null');
  assert not has_table_privilege('anon', 'public.instagram_comment_analyses', 'SELECT'), 'anon cannot read';
  assert has_table_privilege('service_role', 'public.instagram_comment_analyses', 'INSERT'), 'service_role writes';
  assert (select comments_analyzed from public.instagram_comment_analyses where id = v_row_a) = 10, 'row untouched';
  raise notice 'PASS authenticated_read_only';

  -- ---------- CHECK and unique target ----------
  begin
    insert into instagram_comment_analyses
      (conta_id, instagram_account_id, ig_user_id, scope, instagram_post_id, comments_analyzed,
       comments_count_at_analysis, result, model)
      values (v_a, v_iga, 'ig-a', 'post', null, 1, 1, '{}'::jsonb, 'm');
    assert false, 'scope post without instagram_post_id should fail';
  exception when check_violation then null;
  end;
  begin
    insert into instagram_comment_analyses
      (conta_id, instagram_account_id, ig_user_id, scope, instagram_post_id, comments_analyzed,
       comments_count_at_analysis, result, model)
      values (v_a, v_iga, 'ig-a', 'account', 'media-9', 1, 1, '{}'::jsonb, 'm');
    assert false, 'scope account with instagram_post_id should fail';
  exception when check_violation then null;
  end;
  begin
    insert into instagram_comment_analyses
      (conta_id, instagram_account_id, ig_user_id, scope, instagram_post_id, comments_analyzed,
       comments_count_at_analysis, result, model)
      values (v_a, v_iga, 'ig-a', 'post', 'media-1', 1, 1, '{}'::jsonb, 'm');
    assert false, 'duplicate post target should fail';
  exception when unique_violation then null;
  end;
  insert into instagram_comment_analyses
    (conta_id, instagram_account_id, ig_user_id, scope, comments_analyzed, comments_count_at_analysis, result, model)
    values (v_a, v_iga, 'ig-a', 'account', 1, 1, '{}'::jsonb, 'm');
  begin
    insert into instagram_comment_analyses
      (conta_id, instagram_account_id, ig_user_id, scope, comments_analyzed, comments_count_at_analysis, result, model)
      values (v_a, v_iga, 'ig-a', 'account', 2, 2, '{}'::jsonb, 'm');
    assert false, 'duplicate account target should fail (NULLS NOT DISTINCT)';
  exception when unique_violation then null;
  end;
  raise notice 'PASS check_and_unique';

  -- ---------- ideias.origem_sugestao_id ----------
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem)
    values (v_a, v_ca, 'I1', 'd', 'agencia');
  update ideias set origem_sugestao_id = 'sug-1' where workspace_id = v_a;
  begin
    insert into ideias (workspace_id, cliente_id, titulo, descricao, origem, origem_sugestao_id)
      values (v_a, v_ca, 'I2', 'd', 'agencia', 'sug-1');
    assert false, 'same origem_sugestao_id in one workspace should fail';
  exception when unique_violation then null;
  end;
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem, origem_sugestao_id)
    values (v_b, v_cb, 'I3', 'd', 'agencia', 'sug-1');
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem)
    values (v_a, v_ca, 'I4', 'd', 'agencia'), (v_a, v_ca, 'I5', 'd', 'agencia');
  raise notice 'PASS ideias_origem_sugestao_id';

  -- ---------- flag born false everywhere ----------
  assert (select count(*) from plans where feature_instagram_comments_ai) = 0,
    'feature_instagram_comments_ai is false on every plan';
  assert (select count(*) from plans) > 0, 'plans seeded';
  raise notice 'PASS flag_default_false';
end $$;

rollback;
