\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Plataformas por quadro + post_targets (migrations 20260929100001..3).
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md

-- 1. Colunas plataformas: default, CHECK e allowlist de clientes
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid; v_uid uuid := gen_random_uuid(); v_cli bigint; v_wf bigint;
  v_arr text[]; v_rejected boolean;
begin
  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_uid);
  insert into workspace_members (user_id, workspace_id, role) values (v_uid, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_uid;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_uid, v_ws, v_cli, 'W', 'ativo') returning id into v_wf;

  select plataformas into v_arr from workflows where id = v_wf;
  assert v_arr = array['instagram'], format('workflows.plataformas default: %s', v_arr);
  select plataformas_padrao into v_arr from clientes where id = v_cli;
  assert v_arr = array['instagram'], format('clientes.plataformas_padrao default: %s', v_arr);

  v_rejected := false;
  begin update workflows set plataformas = '{}' where id = v_wf;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflows.plataformas vazio foi aceito';

  v_rejected := false;
  begin update workflows set plataformas = array['youtube'] where id = v_wf;
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflows.plataformas com youtube foi aceito';

  v_rejected := false;
  begin insert into workflow_templates (user_id, conta_id, nome, etapas, plataformas)
    values (v_uid, v_ws, 'T', '[]'::jsonb, array['instagram','x']);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'workflow_templates.plataformas invalido foi aceito';

  update workflows set plataformas = array['instagram','geral'] where id = v_wf;

  -- authenticated le a coluna nova direto e pela view
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select plataformas_padrao into v_arr from clientes where id = v_cli;
  assert v_arr = array['instagram'], 'authenticated nao le clientes.plataformas_padrao';
  select plataformas_padrao into v_arr from clientes_v where id = v_cli;
  assert v_arr = array['instagram'], 'clientes_v nao expoe plataformas_padrao';
end $$;
rollback;
