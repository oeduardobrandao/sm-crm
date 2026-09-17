\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Valida 20260924000001_post_approvals_motivo.sql e
-- 20260924000002_post_status_events_send_snapshot.sql.
--   A.1 uma unica record_client_approval existe (7 args); chamada com 6 args nao e ambigua
--   A.2 correcao com motivo grava motivo e move o status; evento liga post_approval_id
--   A.3 fase 1: correcao sem motivo ainda e aceita (motivo null) -- a obrigatoriedade chega na fase 3
--   A.4 motivo fora dos quatro valores viola o CHECK (23514)
--   A.5 EXECUTE: service_role sim, authenticated/anon nao
--   B.1 transicao para enviado_cliente grava snapshot do texto de NEW
--   B.2 transicao para aprovado_cliente nao grava snapshot
--   B.3 update que muda texto E status no mesmo statement grava o texto novo

create or replace function pg_temp.pah_fixture(out ws uuid, out usr uuid, out cli bigint, out post bigint)
language plpgsql as $$
begin
  ws := et_make_workspace('max');
  usr := gen_random_uuid();
  insert into auth.users (id) values (usr);
  insert into workspace_members (user_id, workspace_id, role) values (usr, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws where id = usr;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (usr, ws, 'C', 'C', '#000') returning id into cli;
  insert into workflow_posts (conta_id, cliente_id, titulo, status, ig_caption, conteudo_plain)
    values (ws, cli, 'post historico', 'enviado_cliente', 'legenda v1', 'texto v1') returning id into post;
end $$;

-- A.1
begin;
do $$
declare f record; v_count int; v_id bigint;
begin
  select * into f from pg_temp.pah_fixture();
  select count(*) into v_count from pg_proc where proname = 'record_client_approval';
  assert v_count = 1, format('esperava 1 record_client_approval, achou %s', v_count);
  select record_client_approval(f.post, 'tok', 'aprovado', null, false, 'aprovado_cliente') into v_id;
  assert v_id is not null, 'chamada com 6 args deve resolver';
  assert (select motivo from post_approvals where id = v_id) is null, 'aprovado sem motivo fica null';
  assert (select status from workflow_posts where id = f.post) = 'aprovado_cliente';
end $$;
rollback;

-- A.2
begin;
do $$
declare f record; v_id bigint; v_ev record;
begin
  select * into f from pg_temp.pah_fixture();
  select record_client_approval(f.post, 'tok', 'correcao', 'trocar imagem', false, 'correcao_cliente', 'imagem_video') into v_id;
  assert (select motivo from post_approvals where id = v_id) = 'imagem_video';
  assert (select status from workflow_posts where id = f.post) = 'correcao_cliente';
  select * into v_ev from post_status_events where post_id = f.post order by created_at desc, id desc limit 1;
  assert v_ev.post_approval_id = v_id, 'evento de status deve apontar para a aprovacao';
  assert v_ev.to_status = 'correcao_cliente';
  assert v_ev.source = 'client';
end $$;
rollback;

-- A.3
begin;
do $$
declare f record; v_id bigint;
begin
  select * into f from pg_temp.pah_fixture();
  select record_client_approval(f.post, 'tok', 'correcao', 'sem motivo', false, 'correcao_cliente') into v_id;
  assert v_id is not null, 'fase 1: correcao sem motivo (hub-approve antigo) deve continuar funcionando';
  assert (select motivo from post_approvals where id = v_id) is null;
end $$;
rollback;

-- A.4
begin;
do $$
declare f record; v_id bigint; v_state text;
begin
  select * into f from pg_temp.pah_fixture();
  begin
    select record_client_approval(f.post, 'tok', 'correcao', 'x', false, 'correcao_cliente', 'preco') into v_id;
    v_state := 'none';
  exception when others then
    v_state := sqlstate;
  end;
  assert v_state = '23514', format('esperava check_violation, veio %s', v_state);
end $$;
rollback;

-- A.5
begin;
do $$
begin
  assert has_function_privilege('service_role', 'record_client_approval(bigint, text, text, text, boolean, text, text)', 'execute'),
    'service_role deve poder executar';
  assert not has_function_privilege('authenticated', 'record_client_approval(bigint, text, text, text, boolean, text, text)', 'execute'),
    'authenticated nao pode executar';
  assert not has_function_privilege('anon', 'record_client_approval(bigint, text, text, text, boolean, text, text)', 'execute'),
    'anon nao pode executar';
end $$;
rollback;
