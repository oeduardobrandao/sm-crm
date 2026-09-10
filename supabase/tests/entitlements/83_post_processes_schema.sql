\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Schema dos processos individuais (migration 20260918000002). Cobre:
-- 83.0 unicidade parcial: um so processo vigente por post
-- 83.1 processo exige post avulso (post_in_workflow)
-- 83.2 FK composta de tenant rejeita post de outra conta
-- 83.3 RLS: membro le a propria conta, nao ve outra, nao escreve
-- 83.4 gate de plano: so bloqueia INSERT novo; execucao existente sobrevive ao downgrade
-- 83.5 unicidade de ordem por processo e uma so etapa ativa
-- 83.6 concluido_em pela trigger
-- 83.7 FK composta de events rejeita processo de OUTRO post da mesma conta
-- 83.8 FK composta de tenant rejeita template/fluxo/responsavel de outra conta; SET NULL por coluna
-- 83.9 checks de estado/motivo_encerramento
-- 83.10 guard de avulso tambem no UPDATE: reabrir processo encerrado com o post em fluxo
-- 83.11 insert de processo ja encerrado para post em fluxo nao levanta erro; ativo<->concluido continua sem reler (regressao 83.6)

-- fixture comum: conta com plano max (flag ligada dentro da transacao)
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

-- 83.0
begin;
do $$
declare f record; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'ativo');
  begin
    insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'concluido');
  exception when unique_violation then v_raised := true;
  end;
  assert v_raised, 'segundo processo vigente para o mesmo post deve violar post_processes_one_vigente_per_post';
  -- um encerrado convive com o vigente
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (f.ws, f.post, '0|Copy|padrao', 'encerrado', 'removido');
  raise notice 'PASS 83.0 um processo vigente por post';
end $$;
rollback;

-- 83.1
begin;
do $$
declare f record; v_wf bigint; v_post_in_wf bigint; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (f.usr, f.ws, f.cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_posts (workflow_id, conta_id, titulo) values (v_wf, f.ws, 'no fluxo') returning id into v_post_in_wf;
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, v_post_in_wf, '0|Copy|padrao');
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_in_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'processo para post em fluxo deve levantar post_in_workflow';
  raise notice 'PASS 83.1 processo exige post avulso';
end $$;
rollback;

-- 83.2
begin;
do $$
declare f record; g record; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  select * into g from pg_temp.et_pp_fixture();
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, g.post, '0|Copy|padrao');
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'post de outra conta deve violar a FK composta (post_id, conta_id)';
  raise notice 'PASS 83.2 FK composta de tenant';
end $$;
rollback;

-- 83.3
begin;
do $$
declare f record; g record; v_proc bigint; v_seen int; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  select * into g from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, estado) values (f.ws, v_proc, 0, 'Copy', 'ativo');
  insert into post_process_events (conta_id, post_id, process_id, evento) values (f.ws, f.post, v_proc, 'aplicado');
  perform et_grant_hosted_parity();

  -- membro da conta f le
  perform set_config('request.jwt.claims', json_build_object('sub', f.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from post_processes;
  assert v_seen = 1, format('membro deve ver 1 processo, viu %s', v_seen);
  select count(*) into v_seen from post_process_steps;
  assert v_seen = 1, 'membro deve ver a etapa';
  select count(*) into v_seen from post_process_events;
  assert v_seen = 1, 'membro deve ver o evento';
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, 'x');
    v_raised := false;
  exception when others then v_raised := true; -- RLS (42501) ou grant: o que importa e falhar
  end;
  assert v_raised, 'authenticated nao pode inserir em post_processes';
  begin
    update post_processes set estado = 'concluido' where id = v_proc;
    get diagnostics v_seen = row_count;
  end;
  assert v_seen = 0, 'authenticated nao pode atualizar post_processes (0 linhas)';
  execute 'reset role';

  -- membro da conta g nao ve nada de f
  perform set_config('request.jwt.claims', json_build_object('sub', g.usr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_seen from post_processes;
  assert v_seen = 0, format('outra conta deve ver 0, viu %s', v_seen);
  execute 'reset role';
  raise notice 'PASS 83.3 RLS';
end $$;
rollback;

-- 83.4
begin;
do $$
declare f record; v_proc bigint; v_post2 bigint; v_seen int; v_ts timestamptz; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  -- flag ligada: processo nasce normalmente, guarda o id.
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  update plans set feature_post_processes = false where id = (select plan_id from workspaces where id = f.ws);

  -- (a) flag desligada bloqueia INSERT novo.
  begin
    insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao2');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_post_processes%', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'flag false deve bloquear INSERT em post_processes';

  -- (b) o gate e so BEFORE INSERT: a execucao existente sobrevive ao downgrade.
  update post_processes set estado = 'concluido' where id = v_proc;
  get diagnostics v_seen = row_count;
  assert v_seen = 1, format('UPDATE em processo existente deve afetar 1 linha mesmo com flag off, afetou %s', v_seen);
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is not null, 'UPDATE com flag off ainda deve disparar set_post_process_concluido_em';

  -- override libera o INSERT de novo (post separado: f.post ja tem o v_proc concluido ocupando o indice parcial).
  update workspace_plan_overrides set feature_overrides = coalesce(feature_overrides, '{}'::jsonb) || '{"feature_post_processes": true}'::jsonb where workspace_id = f.ws;
  if not found then
    insert into workspace_plan_overrides (workspace_id, plan_id, feature_overrides)
      values (f.ws, (select plan_id from workspaces where id = f.ws), '{"feature_post_processes": true}'::jsonb);
  end if;
  insert into workflow_posts (conta_id, cliente_id, titulo) values (f.ws, f.cli, 'avulso2') returning id into v_post2;
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, v_post2, '0|Copy|padrao3');
  raise notice 'PASS 83.4 gate de plano com override';
end $$;
rollback;

-- 83.5
begin;
do $$
declare f record; v_proc bigint; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  insert into post_process_steps (conta_id, process_id, ordem, nome, estado) values (f.ws, v_proc, 0, 'Copy', 'ativo');
  begin
    insert into post_process_steps (conta_id, process_id, ordem, nome) values (f.ws, v_proc, 0, 'Copy de novo');
  exception when unique_violation then v_raised := true;
  end;
  assert v_raised, 'ordem repetida no mesmo processo deve violar unique';
  v_raised := false;
  begin
    insert into post_process_steps (conta_id, process_id, ordem, nome, estado) values (f.ws, v_proc, 1, 'Design', 'ativo');
  exception when unique_violation then v_raised := true;
  end;
  assert v_raised, 'segunda etapa ativa no mesmo processo deve violar post_process_steps_one_active';
  raise notice 'PASS 83.5 unicidade de ordem e de etapa ativa';
end $$;
rollback;

-- 83.6
begin;
do $$
declare f record; v_proc bigint; v_ts timestamptz;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  update post_processes set estado = 'concluido' where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is not null, 'concluido deve carimbar concluido_em';
  update post_processes set estado = 'ativo' where id = v_proc;
  select concluido_em into v_ts from post_processes where id = v_proc;
  assert v_ts is null, 'reabrir deve limpar concluido_em';
  raise notice 'PASS 83.6 concluido_em';
end $$;
rollback;

-- 83.7
begin;
do $$
declare f record; v_post2 bigint; v_proc1 bigint; v_proc2 bigint; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into workflow_posts (conta_id, cliente_id, titulo) values (f.ws, f.cli, 'avulso2') returning id into v_post2;
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc1;
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, v_post2, '0|Copy|padrao') returning id into v_proc2;
  begin
    insert into post_process_events (conta_id, post_id, process_id, evento) values (f.ws, f.post, v_proc2, 'aplicado');
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'evento com post_id do 1o post e process_id do processo do 2o post deve violar a FK composta (process_id, conta_id, post_id)';
  insert into post_process_events (conta_id, post_id, process_id, evento) values (f.ws, f.post, v_proc1, 'aplicado');
  raise notice 'PASS 83.7 FK composta de events amarra process_id ao mesmo post';
end $$;
rollback;

-- 83.8
begin;
do $$
declare
  f record; g record;
  v_tmpl_g bigint; v_wf_g bigint; v_membro_g bigint; v_tmpl_f bigint; v_proc bigint;
  v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  select * into g from pg_temp.et_pp_fixture();

  -- template_id de outra conta
  insert into workflow_templates (user_id, conta_id, nome) values (g.usr, g.ws, 'Template G') returning id into v_tmpl_g;
  begin
    insert into post_processes (conta_id, post_id, assinatura, template_id) values (f.ws, f.post, '0|Copy|padrao', v_tmpl_g);
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'template_id de outra conta deve violar post_processes_template_same_tenant';

  -- origem_workflow_id de outra conta
  v_raised := false;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (g.usr, g.ws, g.cli, 'WF G', 'ativo') returning id into v_wf_g;
  begin
    insert into post_processes (conta_id, post_id, assinatura, origem_workflow_id) values (f.ws, f.post, '0|Copy|padrao', v_wf_g);
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'origem_workflow_id de outra conta deve violar post_processes_origem_same_tenant';

  -- responsavel_id de outra conta
  v_raised := false;
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao') returning id into v_proc;
  insert into membros (user_id, conta_id, nome) values (g.usr, g.ws, 'Membro G') returning id into v_membro_g;
  begin
    insert into post_process_steps (conta_id, process_id, ordem, nome, responsavel_id) values (f.ws, v_proc, 0, 'Copy', v_membro_g);
  exception when foreign_key_violation then v_raised := true;
  end;
  assert v_raised, 'responsavel_id de outra conta deve violar post_process_steps_responsavel_same_tenant';

  -- SET NULL por coluna: apagar o template da propria conta zera so template_id.
  insert into workflow_templates (user_id, conta_id, nome) values (f.usr, f.ws, 'Template F') returning id into v_tmpl_f;
  update post_processes set template_id = v_tmpl_f where id = v_proc;
  delete from workflow_templates where id = v_tmpl_f;
  perform 1 from post_processes where id = v_proc and template_id is null and conta_id = f.ws;
  assert found, 'apagar o template deve zerar so template_id (SET NULL por coluna) e manter conta_id';

  raise notice 'PASS 83.8 FK composta de tenant para template/fluxo/responsavel';
end $$;
rollback;

-- 83.9
begin;
do $$
declare f record; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  begin
    insert into post_processes (conta_id, post_id, assinatura, estado) values (f.ws, f.post, '0|Copy|padrao', 'encerrado');
  exception when check_violation then v_raised := true;
  end;
  assert v_raised, 'estado encerrado sem motivo_encerramento deve violar post_processes_encerrado_motivo';

  v_raised := false;
  begin
    insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (f.ws, f.post, '0|Copy|padrao', 'ativo', 'removido');
  exception when check_violation then v_raised := true;
  end;
  assert v_raised, 'estado ativo com motivo_encerramento preenchido deve violar post_processes_encerrado_motivo';

  raise notice 'PASS 83.9 check encerrado/motivo_encerramento';
end $$;
rollback;

-- 83.10
begin;
do $$
declare f record; v_wf bigint; v_proc bigint; v_raised boolean := false;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (f.usr, f.ws, f.cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (v_wf, 0, 'Unica', 1);
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (f.ws, f.post, '0|Copy|padrao', 'encerrado', 'vinculado') returning id into v_proc;
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = v_wf where id = f.post;

  begin
    update post_processes set estado = 'ativo', motivo_encerramento = null where id = v_proc;
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'post_in_workflow', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'reabrir processo encerrado com post em fluxo deve levantar post_in_workflow';
  perform 1 from post_processes where id = v_proc and estado = 'encerrado';
  assert found, 'processo deve continuar encerrado depois do UPDATE rejeitado';

  -- post de volta a avulso: o mesmo UPDATE passa
  update workflow_posts set workflow_id = null where id = f.post;
  update post_processes set estado = 'ativo', motivo_encerramento = null where id = v_proc;
  perform 1 from post_processes where id = v_proc and estado = 'ativo' and motivo_encerramento is null;
  assert found, 'com o post avulso de novo, reabrir o processo deve passar';
  raise notice 'PASS 83.10 guard de avulso tambem no UPDATE (reabrir)';
end $$;
rollback;

-- 83.11
begin;
do $$
declare f record; v_wf bigint; v_proc bigint; v_proc2 bigint; v_ts timestamptz;
begin
  select * into f from pg_temp.et_pp_fixture();
  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (f.usr, f.ws, f.cli, 'WF', 'ativo') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias) values (v_wf, 0, 'Unica', 1);
  perform set_config('app.allow_post_move', 'on', true);
  update workflow_posts set workflow_id = v_wf where id = f.post;

  -- inserir ja encerrado para um post EM FLUXO nao levanta erro (o guard so exige avulso para vigente)
  insert into post_processes (conta_id, post_id, assinatura, estado, motivo_encerramento) values (f.ws, f.post, '0|Copy|padrao', 'encerrado', 'removido') returning id into v_proc;

  -- ativo<->concluido em processo de post avulso continua passando sem reler nada (regressao 83.6)
  update workflow_posts set workflow_id = null where id = f.post;
  insert into post_processes (conta_id, post_id, assinatura) values (f.ws, f.post, '0|Copy|padrao2') returning id into v_proc2;
  update post_processes set estado = 'concluido' where id = v_proc2;
  select concluido_em into v_ts from post_processes where id = v_proc2;
  assert v_ts is not null, 'ativo->concluido deve continuar carimbando concluido_em (regressao 83.6)';
  update post_processes set estado = 'ativo' where id = v_proc2;
  select concluido_em into v_ts from post_processes where id = v_proc2;
  assert v_ts is null, 'concluido->ativo deve continuar limpando concluido_em (regressao 83.6)';
  raise notice 'PASS 83.11 insert encerrado com post em fluxo, e ativo<->concluido continuam passando';
end $$;
rollback;
