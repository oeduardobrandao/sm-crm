-- supabase/tests/entitlements/32_ig_collaborators.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Instagram collaborators (20261019000001_ig_collaborators.sql). Cobre:
-- 32.1 CHECK workflow_posts_ig_collaborators_valid: aceita lista valida; recusa
--      4 itens, NULL (sozinho e junto de outro), maiuscula, espaco, duplicado,
--      nome de 31 caracteres; helper nunca devolve NULL
-- 32.2 CHECK workflow_posts_ig_collab_trial_exclusive
-- 32.3 trigger z5: stories / plataforma sem Instagram limpam a lista
-- 32.4 ig_collaborators_refused: limpo quando a lista muda, mantido caso contrario
-- 32.5 duplicate_post copia a lista (e restaura no re-apply de um quadro sem Instagram)
-- 32.6 claim_posts_for_publishing devolve ig_collaborators; retry pula COLLABORATOR_INVALID
-- 32.7 COLLABORATOR_INVALID gera notificacao (e um codigo retentavel nao)

-- Tenta um comando que deve ser recusado por CHECK. Devolve o nome da constraint
-- que recusou, 'ok' se o comando passou, ou o SQLSTATE de qualquer outro erro.
create or replace function pg_temp.collab_try(p_sql text) returns text
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

create or replace function pg_temp.cl_env(out ws uuid, out usr uuid, out cli bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('pro');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (usr, ws, 'C', 'C', '#000') returning id into cli;
end $$;

-- 32.1 helper + CHECK de validade
begin;
do $$
declare
  e record; v_post bigint; v_arr text[]; v_res text; c text;
  v_ins text;
begin
  e := pg_temp.cl_env();

  -- helper: nunca NULL, falso para qualquer entrada ruim
  assert ig_collaborators_valid('{}') is true, 'vazio e valido';
  assert ig_collaborators_valid('{a,b,c}') is true, 'tres e valido';
  assert ig_collaborators_valid(null) is false, 'NULL deve virar false, nao NULL';
  assert ig_collaborators_valid('{a,b,c,d}') is false, 'quatro e invalido';
  assert ig_collaborators_valid('{NULL}') is false, '{NULL} e invalido';
  assert ig_collaborators_valid('{ok,NULL}') is false, '{ok,NULL} e invalido';
  assert ig_collaborators_valid('{Dra.Julia}') is false, 'maiuscula e invalida';
  assert ig_collaborators_valid('{"dra julia"}') is false, 'espaco e invalido';
  assert ig_collaborators_valid('{@julia}') is false, 'arroba e invalido';
  assert ig_collaborators_valid('{""}') is false, 'string vazia e invalida';
  assert ig_collaborators_valid('{a,a}') is false, 'duplicado e invalido';
  assert ig_collaborators_valid(array[repeat('a', 30)]) is true, '30 caracteres e valido';
  assert ig_collaborators_valid(array[repeat('a', 31)]) is false, '31 caracteres e invalido';
  assert ig_collaborators_valid('{a_b,c.9}') is true, 'underscore, ponto e digito sao validos';
  assert ig_collaborators_valid('{a-b}') is false, 'hifen e invalido';

  -- feed + instagram guarda a lista
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_collaborators)
    values (e.ws, e.cli, 'P', 'feed', 'instagram', '{dra.julia,clinicaviva}')
    returning id into v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = array['dra.julia','clinicaviva'],
    format('lista deve sobreviver em feed+instagram, got %s', v_arr);

  -- default da coluna e vazio, nunca NULL
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo)
    values (e.ws, e.cli, 'P0', 'feed') returning id into v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}' and v_arr is not null, 'default deve ser {}';

  -- cada entrada ruim e recusada pelo CHECK de validade (INSERT)
  foreach c in array array[
    '{a,b,c,d}',
    '{NULL}',
    '{ok,NULL}',
    '{Dra.Julia}',
    '{"dra julia"}',
    '{a,a}',
    '{aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}'   -- 31 caracteres
  ] loop
    v_ins := format(
      'insert into workflow_posts (conta_id, cliente_id, titulo, tipo, ig_collaborators) '
      || 'values (%L, %s, ''bad'', ''feed'', %L)', e.ws, e.cli, c);
    v_res := pg_temp.collab_try(v_ins);
    assert v_res = 'workflow_posts_ig_collaborators_valid',
      format('INSERT de %s deveria ser recusado pelo CHECK de validade, got %s', c, v_res);
  end loop;
  assert length('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') = 31, 'fixture de 31 caracteres';

  -- e no UPDATE
  v_res := pg_temp.collab_try(format(
    'update workflow_posts set ig_collaborators = ''{NULL}'' where id = %s', v_post));
  assert v_res = 'workflow_posts_ig_collaborators_valid',
    format('UPDATE para {NULL} deveria ser recusado, got %s', v_res);
  v_res := pg_temp.collab_try(format(
    'update workflow_posts set ig_collaborators = null where id = %s', v_post));
  assert v_res = '23502', format('NULL e recusado por NOT NULL, got %s', v_res);

  raise notice 'PASS 32.1 ig_collaborators_valid + CHECK';
end $$;
rollback;

-- 32.2 reel de teste e colaboradores sao mutuamente exclusivos
begin;
do $$
declare e record; v_post bigint; v_res text;
begin
  e := pg_temp.cl_env();

  v_res := pg_temp.collab_try(format(
    'insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_trial_strategy, ig_collaborators) '
    || 'values (%L, %s, ''t'', ''reels'', ''instagram'', ''auto'', ''{julia}'')', e.ws, e.cli));
  assert v_res = 'workflow_posts_ig_collab_trial_exclusive',
    format('trial + colaborador deveria violar a exclusividade, got %s', v_res);

  -- cada um sozinho passa
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_trial_strategy)
    values (e.ws, e.cli, 'trial', 'reels', 'instagram', 'auto') returning id into v_post;
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_collaborators)
    values (e.ws, e.cli, 'collab', 'reels', 'instagram', '{julia}');

  -- ligar um colaborador num reel de teste e recusado no UPDATE
  v_res := pg_temp.collab_try(format(
    'update workflow_posts set ig_collaborators = ''{julia}'' where id = %s', v_post));
  assert v_res = 'workflow_posts_ig_collab_trial_exclusive',
    format('UPDATE com trial ativo deveria violar a exclusividade, got %s', v_res);

  raise notice 'PASS 32.2 trial exclusive';
end $$;
rollback;

-- 32.3 trigger z5 limpa a lista quando o post deixa de poder ter colaboradores
begin;
do $$
declare e record; v_post bigint; v_arr text[];
begin
  e := pg_temp.cl_env();

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_collaborators)
    values (e.ws, e.cli, 'P', 'feed', 'instagram', '{julia,clinica}') returning id into v_post;

  -- tipo vira stories => limpa no mesmo UPDATE
  update workflow_posts set tipo = 'stories' where id = v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('stories deve limpar a lista, got %s', v_arr);

  -- plataforma so TikTok => limpa
  update workflow_posts set tipo = 'feed', platform = 'instagram', ig_collaborators = '{julia}'
    where id = v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = array['julia'], format('feed+instagram mantem, got %s', v_arr);
  update workflow_posts set platform = 'tiktok' where id = v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('tiktok-only deve limpar a lista, got %s', v_arr);

  -- both mantem
  update workflow_posts set platform = 'both', ig_collaborators = '{julia}' where id = v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = array['julia'], format('both mantem, got %s', v_arr);

  -- INSERT de stories com colaboradores aterrissa vazio (nao e recusado)
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, ig_collaborators)
    values (e.ws, e.cli, 'S', 'stories', '{julia}') returning id into v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('INSERT de stories deve aterrissar vazio, got %s', v_arr);

  -- INSERT tiktok-only idem
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_collaborators)
    values (e.ws, e.cli, 'T', 'feed', 'tiktok', '{julia}') returning id into v_post;
  select ig_collaborators into v_arr from workflow_posts where id = v_post;
  assert v_arr = '{}', format('INSERT tiktok-only deve aterrissar vazio, got %s', v_arr);

  -- a limpeza roda ANTES dos CHECKs: trial ativo + stories nao quebra a exclusividade
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, ig_trial_strategy)
    values (e.ws, e.cli, 'R', 'reels', 'instagram', 'auto') returning id into v_post;
  update workflow_posts set tipo = 'stories' where id = v_post;

  raise notice 'PASS 32.3 trigger clears ig_collaborators';
end $$;
rollback;

-- 32.4 ig_collaborators_refused
begin;
do $$
declare e record; v_post bigint; v_ref text[]; v_res text;
begin
  e := pg_temp.cl_env();

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, ig_collaborators)
    values (e.ws, e.cli, 'P', 'feed', 'instagram', 'agendado', '{julia,clinicaviva}')
    returning id into v_post;
  select ig_collaborators_refused into v_ref from workflow_posts where id = v_post;
  assert v_ref = '{}' and v_ref is not null, 'refused default e {}';

  -- o caminho de falha grava refused sem mexer na lista: fica
  update workflow_posts set ig_collaborators_refused = '{clinicaviva}' where id = v_post;
  select ig_collaborators_refused into v_ref from workflow_posts where id = v_post;
  assert v_ref = array['clinicaviva'], format('refused gravado sem mudar a lista fica, got %s', v_ref);

  -- UPDATE que muda so o status mantem refused
  update workflow_posts set status = 'falha_publicacao' where id = v_post;
  select ig_collaborators_refused into v_ref from workflow_posts where id = v_post;
  assert v_ref = array['clinicaviva'], format('UPDATE de status mantem refused, got %s', v_ref);

  -- reescrever a mesma lista nao e mudanca
  update workflow_posts set ig_collaborators = '{julia,clinicaviva}' where id = v_post;
  select ig_collaborators_refused into v_ref from workflow_posts where id = v_post;
  assert v_ref = array['clinicaviva'], format('mesma lista mantem refused, got %s', v_ref);

  -- mudar a lista limpa refused
  update workflow_posts set ig_collaborators = '{julia}' where id = v_post;
  select ig_collaborators_refused into v_ref from workflow_posts where id = v_post;
  assert v_ref = '{}', format('mudar a lista deve limpar refused, got %s', v_ref);

  -- esvaziar a lista (incl. por self-heal para stories) tambem limpa
  update workflow_posts set ig_collaborators_refused = '{julia}' where id = v_post;
  update workflow_posts set tipo = 'stories' where id = v_post;
  select ig_collaborators_refused into v_ref from workflow_posts where id = v_post;
  assert v_ref = '{}', format('limpeza pelo trigger tambem limpa refused, got %s', v_ref);

  raise notice 'PASS 32.4 ig_collaborators_refused';
end $$;
rollback;

-- 32.5 duplicate_post (via _clone_post_row)
create or replace function pg_temp.dp_env(
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

create or replace function pg_temp.dp_as(p_usr uuid) returns void
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
declare
  e record; v_src bigint; v_new bigint; v_arr text[]; v_ref text[]; v_plat text;
begin
  e := pg_temp.dp_env();

  -- quadro com Instagram: a copia leva a lista, nunca o refused
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform, status,
                              ig_collaborators)
    values (e.wf, e.ws, 'Origem', 'feed', 'instagram', 'rascunho', '{dra.julia,clinicaviva}')
    returning id into v_src;
  update workflow_posts set ig_collaborators_refused = '{clinicaviva}' where id = v_src;

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_src, false);
  execute 'reset role';

  select ig_collaborators, ig_collaborators_refused into v_arr, v_ref
    from workflow_posts where id = v_new;
  assert v_arr = array['dra.julia','clinicaviva'],
    format('duplicate_post deve copiar os colaboradores, got %s', v_arr);
  assert v_ref = '{}', format('refused nunca e copiado, got %s', v_ref);
  assert (select ig_collaborators_refused from workflow_posts where id = v_src) = array['clinicaviva'],
    'origem intocada';

  -- quadro sem Instagram: o INSERT cai em platform 'other' e o z5 esvazia a
  -- lista; o re-apply do UPDATE (Instagram da origem de volta) a restaura
  insert into workflow_posts (workflow_id, conta_id, titulo, tipo, platform, status,
                              ig_collaborators)
    values (e.wf, e.ws, 'Origem 2', 'feed', 'instagram', 'rascunho', '{julia}')
    returning id into v_src;
  update workflows set plataformas = array['geral'] where id = e.wf;
  assert (select plataformas from workflows where id = e.wf) = array['geral'],
    'fixture: quadro sem Instagram';
  assert (select platform from workflow_posts where id = v_src) = 'instagram',
    'fixture: a origem segue com Instagram';

  perform pg_temp.dp_as(e.usr);
  v_new := duplicate_post(v_src, false);
  execute 'reset role';

  select ig_collaborators, platform into v_arr, v_plat from workflow_posts where id = v_new;
  assert v_plat = 'instagram', format('re-apply devolve o Instagram da origem, got %s', v_plat);
  assert v_arr = array['julia'],
    format('re-apply deve restaurar os colaboradores, got %s', v_arr);

  raise notice 'PASS 32.5 duplicate_post copies ig_collaborators';
end $$;
rollback;

-- 32.6 claim_posts_for_publishing
begin;
do $$
declare
  e record; v_post bigint; v_post_none bigint; v_bad bigint; v_ok bigint;
  v_arr text[];
begin
  e := pg_temp.cl_env();
  insert into instagram_accounts (client_id, instagram_user_id, encrypted_access_token)
    values (e.cli, 'ig_user_collab', 'enc');

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, scheduled_at,
                              ig_collaborators)
    values (e.ws, e.cli, 'com-collab', 'feed', 'instagram', 'agendado', now() + interval '30 minutes',
            '{dra.julia,clinicaviva}')
    returning id into v_post;
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, scheduled_at)
    values (e.ws, e.cli, 'sem-collab', 'feed', 'instagram', 'agendado', now() + interval '31 minutes')
    returning id into v_post_none;

  create temp table collab_claim_container on commit drop as
    select * from claim_posts_for_publishing('container', 1000);

  select ig_collaborators into v_arr from collab_claim_container where post_id = v_post;
  assert v_arr = array['dra.julia','clinicaviva'],
    format('claim deve devolver ig_collaborators, got %s', v_arr);
  select ig_collaborators into v_arr from collab_claim_container where post_id = v_post_none;
  assert v_arr = '{}', format('post sem colaboradores devolve {}, got %s', v_arr);

  -- retry: COLLABORATOR_INVALID e nao retentavel; o controle positivo volta
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, scheduled_at,
                              publish_error_code, publish_retry_count, ig_collaborators)
    values (e.ws, e.cli, 'falha-collab', 'feed', 'instagram', 'falha_publicacao',
            now() - interval '1 hour', 'COLLABORATOR_INVALID', 1, '{julia}')
    returning id into v_bad;
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, scheduled_at,
                              publish_error_code, publish_retry_count)
    values (e.ws, e.cli, 'falha-retentavel', 'feed', 'instagram', 'falha_publicacao',
            now() - interval '1 hour', 'API_ERROR', 1)
    returning id into v_ok;

  create temp table collab_claim_retry on commit drop as
    select * from claim_posts_for_publishing('retry', 1000);

  assert not exists (select 1 from collab_claim_retry where post_id = v_bad),
    'COLLABORATOR_INVALID nao deve voltar na fase retry';
  assert exists (select 1 from collab_claim_retry where post_id = v_ok),
    'controle positivo: erro retentavel volta na fase retry';

  raise notice 'PASS 32.6 claim_posts_for_publishing';
end $$;
rollback;

-- 32.7 notificacao de falha de publicacao
begin;
do $$
declare
  e record; v_admin uuid := gen_random_uuid(); v_post bigint; v_post2 bigint;
  v_notif record;
begin
  e := pg_temp.cl_env();
  insert into auth.users (id) values (v_admin);
  insert into workspace_members (user_id, workspace_id, role) values (v_admin, e.ws, 'admin');

  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, scheduled_at,
                              ig_collaborators)
    values (e.ws, e.cli, 'collab-falha', 'feed', 'instagram', 'agendado', now() - interval '1 hour',
            '{julia}')
    returning id into v_post;

  update workflow_posts
     set status = 'falha_publicacao', publish_error_code = 'COLLABORATOR_INVALID',
         publish_retry_count = 1, ig_collaborators_refused = '{julia}'
   where id = v_post;

  select * into v_notif from notifications
   where workspace_id = e.ws and type = 'post_publish_failed'
     and (metadata->>'post_id')::bigint = v_post;
  assert v_notif.id is not null, 'COLLABORATOR_INVALID deve gerar notificacao';
  assert v_notif.metadata->>'publish_error_code' = 'COLLABORATOR_INVALID',
    format('metadata deve carregar o codigo, got %s', v_notif.metadata);

  -- um dos tres codigos que tinham o mesmo furo
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, scheduled_at)
    values (e.ws, e.cli, 'cap', 'feed', 'instagram', 'agendado', now() - interval '1 hour')
    returning id into v_post2;
  update workflow_posts
     set status = 'falha_publicacao', publish_error_code = 'CAPTION_TOO_LONG', publish_retry_count = 1
   where id = v_post2;
  assert exists (select 1 from notifications
                  where workspace_id = e.ws and type = 'post_publish_failed'
                    and (metadata->>'post_id')::bigint = v_post2),
    'CAPTION_TOO_LONG deve gerar notificacao';

  -- um codigo retentavel com retry_count 1 continua sem notificar
  insert into workflow_posts (conta_id, cliente_id, titulo, tipo, platform, status, scheduled_at)
    values (e.ws, e.cli, 'retentavel', 'feed', 'instagram', 'agendado', now() - interval '1 hour')
    returning id into v_post2;
  update workflow_posts
     set status = 'falha_publicacao', publish_error_code = 'API_ERROR', publish_retry_count = 1
   where id = v_post2;
  assert not exists (select 1 from notifications
                      where workspace_id = e.ws and type = 'post_publish_failed'
                        and (metadata->>'post_id')::bigint = v_post2),
    'codigo retentavel com retry_count 1 nao notifica';

  raise notice 'PASS 32.7 publish-failed notification';
end $$;
rollback;

\echo PASS 32_ig_collaborators
