\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- demo_workspace_seed / demo_workspace_discard (migration 20261030000002_demo_workspace_seed.sql).
-- Obs: 'max' local nao liga feature_agenda (so prod, por update), entao os casos que esperam o
-- evento ligam via override.
-- Fixture: um auth.users com meta empresa dispara handle_new_user_workspace (conta + workspace +
-- template "Padrao"). O plano sobe para 'max' com plan_source = 'demo'.

create or replace function pg_temp.mk_demo(p_email text, p_overrides jsonb default null)
returns table (uid uuid, conta uuid) language plpgsql as $$
declare v_uid uuid := gen_random_uuid(); v_conta uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, p_email, jsonb_build_object('empresa', 'Agência Teste'));
  select conta_id into v_conta from profiles where id = v_uid;
  update workspaces set plan_id = 'max', plan_source = 'demo' where id = v_conta;
  if p_overrides is not null then
    insert into workspace_plan_overrides (workspace_id, resource_overrides, feature_overrides)
      values (v_conta, p_overrides -> 'r', p_overrides -> 'f');
  end if;
  return query select v_uid, v_conta;
end $$;

-- 99s-1: plano completo.
begin;
do $$
declare
  v_uid uuid; v_conta uuid; r jsonb; n int; v_cam bigint;
begin
  select * into v_uid, v_conta from pg_temp.mk_demo('seed99s1@example.com', '{"r":null,"f":{"feature_agenda":true}}'::jsonb);
  r := public.demo_workspace_seed(v_conta, v_uid);
  if r <> '{"membros":1,"clientes":1,"workflows":1,"posts":4,"ideias":3,"leads":3,"eventos":1}'::jsonb then
    raise exception '99s-1: contagens: %', r;
  end if;
  select count(*) into n from membros where conta_id = v_conta;       if n <> 1 then raise exception '99s-1 membros %', n; end if;
  select count(*) into n from clientes where conta_id = v_conta;      if n <> 1 then raise exception '99s-1 clientes %', n; end if;
  select count(*) into n from workflows where conta_id = v_conta;     if n <> 1 then raise exception '99s-1 workflows %', n; end if;
  select count(*) into n from workflow_posts where conta_id = v_conta; if n <> 4 then raise exception '99s-1 posts %', n; end if;
  select count(*) into n from ideias where workspace_id = v_conta;    if n <> 3 then raise exception '99s-1 ideias %', n; end if;
  select count(*) into n from leads where conta_id = v_conta;         if n <> 3 then raise exception '99s-1 leads %', n; end if;
  select count(*) into n from agenda_eventos where conta_id = v_conta; if n <> 1 then raise exception '99s-1 eventos %', n; end if;

  if exists (select 1 from clientes where conta_id = v_conta and nome not like '%(exemplo)')
     or exists (select 1 from membros where conta_id = v_conta and nome not like '%(exemplo)')
     or exists (select 1 from leads where conta_id = v_conta and nome not like '%(exemplo)')
     or exists (select 1 from workflows where conta_id = v_conta and titulo not like '%(exemplo)') then
    raise exception '99s-1: nome sem (exemplo)';
  end if;
  if exists (select 1 from workflow_posts where conta_id = v_conta
             and status in ('agendado','postado','falha_publicacao')) then
    raise exception '99s-1: status de publicacao proibido';
  end if;
  select id into v_cam from membros where conta_id = v_conta;
  if not exists (select 1 from workflow_etapas e join workflows w on w.id = e.workflow_id
                  where w.conta_id = v_conta and e.nome = 'Mídia' and e.status = 'ativo'
                    and e.responsavel_id = v_cam) then
    raise exception '99s-1: etapa Midia nao esta ativa com a Camila';
  end if;
  select count(*) into n from agenda_ocorrencias o join agenda_eventos ev on ev.id = o.evento_id
   where ev.conta_id = v_conta;
  if n < 1 then raise exception '99s-1: evento nao materializado'; end if;
  raise notice 'PASS 99s-1';
end $$;
rollback;

-- 99s-2: features desligadas.
begin;
do $$
declare v_uid uuid; v_conta uuid; r jsonb;
begin
  select * into v_uid, v_conta from pg_temp.mk_demo('seed99s2@example.com',
    '{"r":null,"f":{"feature_leads":false,"feature_ideas":false,"feature_agenda":false}}'::jsonb);
  r := public.demo_workspace_seed(v_conta, v_uid);
  if (r->>'leads')::int <> 0 or (r->>'ideias')::int <> 0 or (r->>'eventos')::int <> 0 then
    raise exception '99s-2: %', r;
  end if;
  if (r->>'clientes')::int <> 1 or (r->>'posts')::int <> 4 then raise exception '99s-2 base: %', r; end if;
  raise notice 'PASS 99s-2';
end $$;
rollback;

-- 99s-3: limite de posts por fluxo.
begin;
do $$
declare v_uid uuid; v_conta uuid; r jsonb;
begin
  select * into v_uid, v_conta from pg_temp.mk_demo('seed99s3@example.com',
    '{"r":{"max_posts_per_workflow":2},"f":{"feature_agenda":true}}'::jsonb);
  r := public.demo_workspace_seed(v_conta, v_uid);
  if (r->>'posts')::int <> 2 then raise exception '99s-3: %', r; end if;
  raise notice 'PASS 99s-3';
end $$;
rollback;

-- 99s-4: discard + delete do usuario.
begin;
do $$
declare
  v_uid uuid; v_conta uuid; r jsonb; t text; n int;
begin
  select * into v_uid, v_conta from pg_temp.mk_demo('seed99s4@example.com', '{"r":null,"f":{"feature_agenda":true}}'::jsonb);
  r := public.demo_workspace_seed(v_conta, v_uid);
  perform public.demo_workspace_discard(v_conta);
  delete from auth.users where id = v_uid;

  foreach t in array array[
    'agenda_ocorrencias:SELECT count(*) FROM agenda_ocorrencias o JOIN agenda_eventos e ON e.id = o.evento_id WHERE e.conta_id = $1',
    'agenda_eventos:SELECT count(*) FROM agenda_eventos WHERE conta_id = $1',
    'workflow_posts:SELECT count(*) FROM workflow_posts WHERE conta_id = $1',
    'workflow_etapas:SELECT count(*) FROM workflow_etapas e JOIN workflows w ON w.id = e.workflow_id WHERE w.conta_id = $1',
    'workflows:SELECT count(*) FROM workflows WHERE conta_id = $1',
    'workflow_templates:SELECT count(*) FROM workflow_templates WHERE conta_id = $1',
    'ideias:SELECT count(*) FROM ideias WHERE workspace_id = $1',
    'leads:SELECT count(*) FROM leads WHERE conta_id = $1',
    'clientes:SELECT count(*) FROM clientes WHERE conta_id = $1',
    'membros:SELECT count(*) FROM membros WHERE conta_id = $1',
    'workspace_plan_overrides:SELECT count(*) FROM workspace_plan_overrides WHERE workspace_id = $1',
    'affiliate_referrals:SELECT count(*) FROM affiliate_referrals WHERE workspace_id = $1',
    'workspace_members:SELECT count(*) FROM workspace_members WHERE workspace_id = $1',
    'profiles:SELECT count(*) FROM profiles WHERE conta_id = $1',
    'workspaces:SELECT count(*) FROM workspaces WHERE id = $1',
    'contas:SELECT count(*) FROM contas WHERE id = $1'
  ] loop
    execute split_part(t, ':', 2) into n using v_conta;
    if n <> 0 then raise exception '99s-4: % ainda tem % linha(s)', split_part(t, ':', 1), n; end if;
  end loop;
  raise notice 'PASS 99s-4';
end $$;
rollback;

-- 99s-5: authenticated nao executa.
do $$
begin
  if has_function_privilege('authenticated', 'public.demo_workspace_seed(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public.demo_workspace_seed(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.demo_workspace_discard(uuid)', 'execute')
     or has_function_privilege('anon', 'public.demo_workspace_discard(uuid)', 'execute') then
    raise exception '99s-5: funcao executavel por authenticated/anon';
  end if;
  raise notice 'PASS 99s-5';
end $$;
