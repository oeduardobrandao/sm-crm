-- supabase/tests/entitlements/99_ig_story_user_tags.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Menções no Stories (20261111000001_ig_story_user_tags.sql). Cobre:
-- 1 CHECK workflow_posts_ig_user_tags_valid: aceita até 10, recusa 11, NULL,
--   maiúscula, duplicado; helper nunca devolve NULL
-- 2 trigger z5: fora de stories / plataforma sem Instagram limpa a lista;
--   colaboradores seguem limpos em stories
-- 3 duplicate_post copia a lista (e restaura no re-apply de um quadro sem Instagram)

create or replace function pg_temp.ut_try(p_sql text) returns text
language plpgsql as $$
declare v_con text;
begin
  execute p_sql;
  return 'ok';
exception
  when check_violation then
    get stacked diagnostics v_con = constraint_name;
    return v_con;
  when others then
    return sqlstate;
end $$;

create or replace function pg_temp.ut_env(out ws uuid, out usr uuid, out cli bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('pro');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
end $$;

-- 1 helper + CHECK
begin;
do $$
declare e record; v_post bigint; v_arr text[]; v_res text; c text;
begin
  e := pg_temp.ut_env();

  assert ig_user_tags_valid('{}') is true, 'vazio e valido';
  assert ig_user_tags_valid('{a,b,c,d,e,f,g,h,i,j}') is true, 'dez e valido';
  assert ig_user_tags_valid('{a,b,c,d,e,f,g,h,i,j,k}') is false, 'onze e invalido';
  assert ig_user_tags_valid(null) is false, 'NULL deve virar false, nao NULL';
  assert ig_user_tags_valid('{ok,NULL}') is false, '{ok,NULL} e invalido';
  assert ig_user_tags_valid('{Dra.Julia}') is false, 'maiuscula e invalida';
  assert ig_user_tags_valid('{a,a}') is false, 'duplicado e invalido';
  assert ig_user_tags_valid(array[repeat('a', 31)]) is false, '31 caracteres e invalido';

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_user_tags)
    values (e.ws, e.cli, 'S', 'stories', 'instagram', '{dra.julia,clinicaviva}')
    returning id into v_post;
  select ig_user_tags into v_arr from workflow_posts where id = v_post;
  assert v_arr = array['dra.julia','clinicaviva'],
    format('lista deve sobreviver em stories+instagram, got %s', v_arr);

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo)
    values (e.ws, e.cli, 'S0', 'stories') returning id into v_post;
  select ig_user_tags into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}' and v_arr is not null, 'default deve ser {}';

  foreach c in array array['{a,b,c,d,e,f,g,h,i,j,k}', '{NULL}', '{Dra.Julia}', '{a,a}'] loop
    v_res := pg_temp.ut_try(format(
      'insert into workflow_posts (conta_id, cliente_id, titulo, tipo, ig_user_tags) '
      || 'values (%L, %s, ''bad'', ''stories'', %L)', e.ws, e.cli, c));
    assert v_res = 'workflow_posts_ig_user_tags_valid',
      format('INSERT de %s deveria ser recusado pelo CHECK, got %s', c, v_res);
  end loop;

  v_res := pg_temp.ut_try(format(
    'update workflow_posts set ig_user_tags = null where id = %s', v_post));
  assert v_res = '23502', format('NULL e recusado por NOT NULL, got %s', v_res);

  raise notice 'PASS 1 ig_user_tags_valid + CHECK';
end $$;
rollback;

-- 2 trigger z5
begin;
do $$
declare e record; v_post bigint; v_arr text[];
begin
  e := pg_temp.ut_env();

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_user_tags)
    values (e.ws, e.cli, 'S', 'stories', 'instagram', '{julia}') returning id into v_post;

  update workflow_posts set tipo = 'feed' where id = v_post;
  select ig_user_tags into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('sair de stories deve limpar a lista, got %s', v_arr);

  update workflow_posts set tipo = 'stories', ig_user_tags = '{julia}' where id = v_post;
  update workflow_posts set platform = 'tiktok' where id = v_post;
  select ig_user_tags into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('tiktok-only deve limpar a lista, got %s', v_arr);

  update workflow_posts set platform = 'both', ig_user_tags = '{julia}' where id = v_post;
  select ig_user_tags into v_arr from workflow_posts where id = v_post;
  assert v_arr = array['julia'], format('both mantem, got %s', v_arr);

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, ig_user_tags)
    values (e.ws, e.cli, 'F', 'feed', '{julia}') returning id into v_post;
  select ig_user_tags into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('INSERT de feed deve aterrissar vazio, got %s', v_arr);

  -- a regra antiga segue: stories nunca guarda colaboradores
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, ig_collaborators, ig_user_tags)
    values (e.ws, e.cli, 'S2', 'stories', '{julia}', '{julia}') returning id into v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('stories ainda limpa colaboradores, got %s', v_arr);
  select ig_user_tags into v_arr from workflow_posts where id = v_post;
  assert v_arr = array['julia'], format('e mantem as mencoes, got %s', v_arr);

  raise notice 'PASS 2 trigger clears ig_user_tags';
end $$;
rollback;

-- 3 duplicate_post (via _clone_post_row)
create or replace function pg_temp.ut_dp_env(
  out ws uuid, out usr uuid, out cli bigint, out wf bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, nome = 'Dona' where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
end $$;

create or replace function pg_temp.ut_as(p_usr uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

begin;
select et_grant_hosted_parity();
update plans set feature_multiplatform = true;
do $$
declare e record; v_src bigint; v_new bigint; v_arr text[]; v_plat text;
begin
  e := pg_temp.ut_dp_env();

  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform, status, ig_user_tags)
    values (e.wf, e.ws, 'Origem', 'stories', 'instagram', 'rascunho', '{dra.julia,clinicaviva}')
    returning id into v_src;

  perform pg_temp.ut_as(e.usr);
  v_new := duplicate_post(v_src, false);
  execute 'reset role';

  select ig_user_tags into v_arr from workflow_posts where id = v_new;
  assert v_arr = array['dra.julia','clinicaviva'],
    format('duplicate_post deve copiar as mencoes, got %s', v_arr);

  -- quadro sem Instagram: o INSERT cai em platform 'other' e o z5 esvazia a
  -- lista; o re-apply do UPDATE a restaura
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform, status, ig_user_tags)
    values (e.wf, e.ws, 'Origem 2', 'stories', 'instagram', 'rascunho', '{julia}')
    returning id into v_src;
  update workflows set plataformas = array['geral'] where id = e.wf;

  perform pg_temp.ut_as(e.usr);
  v_new := duplicate_post(v_src, false);
  execute 'reset role';

  select ig_user_tags, platform into v_arr, v_plat from workflow_posts where id = v_new;
  assert v_plat = 'instagram', format('re-apply devolve o Instagram da origem, got %s', v_plat);
  assert v_arr = array['julia'], format('re-apply deve restaurar as mencoes, got %s', v_arr);

  raise notice 'PASS 3 duplicate_post copies ig_user_tags';
end $$;
rollback;
