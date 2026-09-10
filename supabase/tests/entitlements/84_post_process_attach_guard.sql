\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Guard de attach (migration 20260918000003): um post com execucao vigente
-- nao entra em fluxo por nenhum dos caminhos sancionados.
-- 84.0 attach_posts_to_flow -> post_has_active_process, nada muda
-- 84.1 processo encerrado nao bloqueia
-- 84.2 UPDATE direto com o GUC ligado tambem cai no guard (o guard vale
--      mesmo para quem contorna post_a0_sync_cliente)
-- 84.3 sem processo, o UPDATE com GUC continua passando (nao regride
--      detach/attach)

create or replace function pg_temp.et_pp_ctx(out ws uuid, out usr uuid, out cli bigint, out post bigint, out wf bigint)
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
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (usr, ws, cli, 'WF', 'ativo') returning id into wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (wf, 0, 'Unica', 1);
end $$;

-- 84.0
begin;
do $$
declare c record; v_raised boolean := false; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  insert into post_processes (conta_id, post_id, assinatura) values (c.ws, c.post, '0|Copy|padrao');
  perform set_config('request.jwt.claims', json_build_object('sub', c.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform attach_posts_to_flow(array[c.post], c.wf);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'attach com processo vigente deve levantar post_has_active_process';
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf is null, 'post deve continuar avulso';
  raise notice 'PASS 84.0 attach bloqueado';
end $$;
rollback;

-- 84.1
begin;
do $$
declare c record; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (c.ws, c.post, '0|Copy|padrao', 'encerrado', 'removido');
  perform set_config('request.jwt.claims', json_build_object('sub', c.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform attach_posts_to_flow(array[c.post], c.wf);
  execute 'reset role';
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf = c.wf, 'processo encerrado nao bloqueia o attach';
  raise notice 'PASS 84.1 encerrado nao bloqueia';
end $$;
rollback;

-- 84.2: o guard dispara em qualquer UPDATE que de workflow_id, inclusive o
-- caminho das RPCs de mover (move_posts_core liga o mesmo GUC)
begin;
do $$
declare c record; v_raised boolean := false; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  insert into post_processes (conta_id, post_id, assinatura) values (c.ws, c.post, '0|Copy|padrao');
  perform set_config('app.allow_post_move', 'on', true);
  begin
    update workflow_posts set workflow_id = c.wf where id = c.post;
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_has_active_process', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'UPDATE direto de workflow_id com processo vigente deve cair no guard mesmo com o GUC ligado';
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf is null, 'post deve continuar avulso';
  raise notice 'PASS 84.2 guard independe do GUC';
end $$;
rollback;

-- 84.3: sem processo, o UPDATE com GUC continua passando (nao regredir detach/attach)
begin;
do $$
declare c record; v_wf bigint;
begin
  select * into c from pg_temp.et_pp_ctx();
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = c.wf where id = c.post;
  select workflow_id into v_wf from workflow_posts where id = c.post;
  assert v_wf = c.wf, 'sem processo o attach direto segue funcionando';
  raise notice 'PASS 84.3 sem processo nada muda';
end $$;
rollback;
