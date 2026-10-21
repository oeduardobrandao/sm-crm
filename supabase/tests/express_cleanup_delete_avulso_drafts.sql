\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- express_cleanup_delete_avulso_drafts (migration 20260918000004): delete
-- atomico do passo 3 do express-post-cleanup-cron. Cobre:
-- E.0 rascunho avulso com processo ativo e poupado; sem processo e apagado
-- E.1 ids que nao sao rascunho avulso express sao ignorados
-- E.2 processo concluido poupa o rascunho; encerrado continua nao poupando
-- E.3 p_ids vazio/NULL devolve {}
-- E.4 EXECUTE negado para authenticated

-- fixture: mesma da suite 83 (post_processes_schema), copiada aqui porque
-- \i nao expoe funcoes de pg_temp de outro arquivo dentro do mesmo processo
-- psql (cada arquivo desta suite roda como conexao/transacao propria via
-- test-entitlements.sh).
create or replace function pg_temp.et_pp_fixture(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  update plans set feature_post_processes = true where id = (select plan_id from workspaces where id = ws);
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (ws, cli, 'avulso') returning id into post;
end $$;

-- E.0
begin;
do $$
declare
  f record;
  v_free_post bigint; v_proc bigint; v_deleted bigint[];
begin
  select * into f from pg_temp.et_pp_fixture();
  -- segundo rascunho avulso express antigo, sem processo.
  insert into workflow_posts (conta_id, cliente_id, titulo, is_express, status, created_at)
    values (f.ws, f.cli, 'sem processo', true, 'rascunho', now() - interval '10 days') returning id into v_free_post;
  update workflow_posts set is_express = true, status = 'rascunho', created_at = now() - interval '10 days' where id = f.post;
  insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'ativo') returning id into v_proc;

  select public.express_cleanup_delete_avulso_drafts(array[f.post, v_free_post]) into v_deleted;
  assert v_deleted = array[v_free_post], format('esperava so o id sem processo, veio %s', v_deleted);
  assert exists (select 1 from workflow_posts where id = f.post), 'rascunho com processo ativo deve continuar existindo';
  assert not exists (select 1 from workflow_posts where id = v_free_post), 'rascunho sem processo deve ser apagado';
  assert exists (select 1 from post_processes where id = v_proc), 'processo ativo do rascunho poupado deve continuar existindo';
  raise notice 'PASS E.0 poupa rascunho com processo ativo, apaga o sem processo';
end $$;
rollback;

-- E.1
begin;
do $$
declare
  f record;
  v_wf bigint; v_in_wf bigint; v_enviado bigint; v_nao_express bigint;
  v_deleted bigint[];
begin
  select * into f from pg_temp.et_pp_fixture();
  update workflow_posts set is_express = true, status = 'rascunho', created_at = now() - interval '10 days' where id = f.post;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (f.usr, f.ws, f.cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo, is_express, status, created_at)
    values (v_wf, f.ws, 'no fluxo', true, 'rascunho', now() - interval '10 days') returning id into v_in_wf;
  insert into workflow_posts (conta_id, cliente_id, titulo, is_express, status, created_at)
    values (f.ws, f.cli, 'enviado ao cliente', true, 'enviado_cliente', now() - interval '10 days') returning id into v_enviado;
  insert into workflow_posts (conta_id, cliente_id, titulo, is_express, status, created_at)
    values (f.ws, f.cli, 'nao express', false, 'rascunho', now() - interval '10 days') returning id into v_nao_express;

  select public.express_cleanup_delete_avulso_drafts(array[f.post, v_in_wf, v_enviado, v_nao_express]) into v_deleted;
  assert v_deleted = array[f.post], format('so o rascunho avulso express deve ser apagado, veio %s', v_deleted);
  assert exists (select 1 from workflow_posts where id = v_in_wf), 'post com workflow_id preenchido deve ser ignorado';
  assert exists (select 1 from workflow_posts where id = v_enviado), 'post com status diferente de rascunho deve ser ignorado';
  assert exists (select 1 from workflow_posts where id = v_nao_express), 'post sem is_express deve ser ignorado';
  raise notice 'PASS E.1 ignora ids que nao sao rascunho avulso express';
end $$;
rollback;

-- E.2
begin;
do $$
declare
  f record; g record;
  v_proc bigint; v_proc2 bigint; v_deleted bigint[];
begin
  select * into f from pg_temp.et_pp_fixture();
  select * into g from pg_temp.et_pp_fixture();
  update workflow_posts set is_express = true, status = 'rascunho', created_at = now() - interval '10 days' where id = f.post;
  update workflow_posts set is_express = true, status = 'rascunho', created_at = now() - interval '10 days' where id = g.post;

  insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'concluido') returning id into v_proc;
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (g.ws, g.post, '0|Copy|padrao', 'encerrado', 'removido') returning id into v_proc2;

  -- concluido POUPA: a fase 2 cria o unico caminho para chegar a concluido e
  -- nenhum comando de processo tira o post de 'rascunho' (spec 5.5 e 6.2),
  -- entao sem esta regra o cron apagaria o trabalho e o historico inteiros.
  select public.express_cleanup_delete_avulso_drafts(array[f.post]) into v_deleted;
  assert v_deleted = '{}'::bigint[], format('processo concluido deve poupar o rascunho, veio %s', v_deleted);
  assert exists (select 1 from workflow_posts where id = f.post), 'rascunho com processo concluido deve continuar existindo';
  assert exists (select 1 from post_processes where id = v_proc), 'o processo concluido continua no banco';

  -- encerrado NAO poupa: removido ou vinculado, o post voltou a Sem processo.
  select public.express_cleanup_delete_avulso_drafts(array[g.post]) into v_deleted;
  assert v_deleted = array[g.post], format('processo encerrado nao deve poupar, veio %s', v_deleted);
  assert not exists (select 1 from workflow_posts where id = g.post), 'rascunho com processo encerrado deve ser apagado';
  assert not exists (select 1 from post_processes where id = v_proc2), 'processo encerrado deve ir no cascade do post';
  raise notice 'PASS E.2 concluido poupa, encerrado nao';
end $$;
rollback;

-- E.3
begin;
do $$
declare v_deleted bigint[];
begin
  select public.express_cleanup_delete_avulso_drafts(array[]::bigint[]) into v_deleted;
  assert v_deleted = '{}'::bigint[], format('array vazio deve devolver {}, veio %s', v_deleted);
  select public.express_cleanup_delete_avulso_drafts(null) into v_deleted;
  assert v_deleted = '{}'::bigint[], format('NULL deve devolver {}, veio %s', v_deleted);
  raise notice 'PASS E.3 p_ids vazio/NULL devolve {}';
end $$;
rollback;

-- E.4
begin;
do $$
declare
  f record; v_raised boolean := false;
  function_oid oid := 'public.express_cleanup_delete_avulso_drafts(bigint[])'::regprocedure;
begin
  select * into f from pg_temp.et_pp_fixture();
  update workflow_posts set is_express = true, status = 'rascunho', created_at = now() - interval '10 days' where id = f.post;
  perform et_grant_hosted_parity();

  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.express_cleanup_delete_avulso_drafts(array[f.post]);
  exception when others then
    assert sqlstate = '42501', format('esperava 42501, veio %s: %s', sqlstate, sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'authenticated nao pode executar a RPC';
  execute 'reset role';

  assert exists (select 1 from workflow_posts where id = f.post), 'nada deve ter sido apagado';

  assert exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
    where p.oid = function_oid and a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'), 'service role explicit grant';
  assert not exists (select 1 from pg_proc p, lateral aclexplode(p.proacl) a
    where p.oid = function_oid and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
    and a.privilege_type = 'EXECUTE'), 'no client or PUBLIC execution';
  raise notice 'PASS E.4 EXECUTE negado para authenticated';
end $$;
rollback;
