\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- public.handle_new_user_workspace() -- migration 20260920000001_seed_default_workflow_template.sql
-- adds a "Padrão" workflow_templates seed after the workspace_members INSERT,
-- inside the fresh-signup / owner branch only (ELSE branch of the
-- meta_conta_id check). The invited-user branch is untouched.
--
-- Fixture note: inserting into auth.users fires handle_new_user_workspace()
-- (20260317_multi_workspace.sql trigger), which auto-creates a throwaway
-- workspace + profile for ANY auth.users row without a matching pending
-- invite in its raw_user_meta_data.conta_id -- see the same note in
-- 74_invite_role_id.sql. Each case below is its own begin/rollback block so
-- an early failure doesn't mask the others.

-- =============================================================
-- 93-1: Fresh (non-invited) signup seeds exactly one "Padrão" template.
-- =============================================================
begin;
do $$
declare
  v_uid    uuid := gen_random_uuid();
  v_conta  uuid;
  v_count  int;
  v_etapas jsonb;
  v_nome   text;
  v_modo   text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'fresh93a@example.com', jsonb_build_object('empresa', 'Empresa Teste 93A'));

  select conta_id into v_conta from profiles where id = v_uid;
  if v_conta is null then
    raise exception '93-1: signup should have created a profile with a conta_id';
  end if;

  select count(*) into v_count from workflow_templates where conta_id = v_conta;
  assert v_count = 1, format('93-1: expected exactly 1 workflow_templates row, got %', v_count);

  select nome, etapas, modo_prazo into v_nome, v_etapas, v_modo
    from workflow_templates where conta_id = v_conta;

  assert v_nome = 'Padrão', format('93-1: expected nome ''Padrão'', got %', v_nome);
  assert jsonb_array_length(v_etapas) = 5, format('93-1: expected 5 etapas, got %', jsonb_array_length(v_etapas));
  assert v_etapas->0->>'nome' = 'Copy', format('93-1: expected first etapa ''Copy'', got %', v_etapas->0->>'nome');
  assert v_etapas->4->>'nome' = 'Agendamento', format('93-1: expected last etapa ''Agendamento'', got %', v_etapas->4->>'nome');
  assert v_etapas->1->>'tipo' = 'aprovacao_cliente', format('93-1: expected etapas[1].tipo ''aprovacao_cliente'', got %', v_etapas->1->>'tipo');
  assert v_modo = 'padrao', format('93-1: expected modo_prazo ''padrao'', got %', v_modo);

  raise notice 'PASS 93-1: fresh signup seeds one Padrão template';
end $$;
rollback;

-- =============================================================
-- 93-2: Invited-user signup (joins an existing workspace) seeds nothing.
-- =============================================================
begin;
do $$
declare
  v_ws           uuid;
  v_owner        uuid := gen_random_uuid();
  v_invited      uuid := gen_random_uuid();
  v_count_before int;
  v_count_after  int;
begin
  v_ws := et_make_workspace('free');
  insert into auth.users (id) values (v_owner); -- FK target for invites.invited_by

  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_ws, 'invited93b@example.com', 'agent', v_owner, 'pending', now() + interval '7 days');

  select count(*) into v_count_before from workflow_templates where conta_id = v_ws;

  insert into auth.users (id, email, raw_user_meta_data)
    values (v_invited, 'invited93b@example.com', jsonb_build_object('conta_id', v_ws::text));

  -- the invited user's profile should now point at the existing workspace
  if not exists (select 1 from profiles where id = v_invited and conta_id = v_ws) then
    raise exception '93-2: invited user should have joined workspace %', v_ws;
  end if;

  select count(*) into v_count_after from workflow_templates where conta_id = v_ws;
  assert v_count_after = v_count_before,
    format('93-2: invited-user signup should not change workflow_templates count: before=% after=%', v_count_before, v_count_after);
  assert v_count_after = 0, format('93-2: expected 0 workflow_templates for the invited-user workspace, got %', v_count_after);

  raise notice 'PASS 93-2: invited-user signup seeds nothing';
end $$;
rollback;

-- =============================================================
-- 93-3: A workspace with no resolvable plan limit does not break signup.
--
-- Deviation from the brief's literal repro: `update plans set is_default =
-- false` (zeroing ALL plans' default flag) was tried first and empirically
-- makes effective_plan_limit() return 0 for EVERY limit_key on the new
-- (NULL plan_id) workspace -- not just max_workflow_templates. That also
-- zeroes max_team_members, and the pre-existing (untouched-by-this-task)
-- `INSERT INTO workspace_members` a few lines above the new seed block is
-- NOT wrapped in a BEGIN/EXCEPTION -- it raises plan_limit_exceeded first
-- and aborts the whole signup before the new template-seed block is ever
-- reached. That is a real, separate gap in handle_new_user_workspace()
-- (out of scope for this task, which only touches the block after
-- workspace_members), and it means the brief's literal repro cannot isolate
-- the thing this test is meant to prove.
--
-- Instead: leave `free` as the is_default plan (so workspace_members'
-- max_team_members resolves normally to free's limit of 1 and that INSERT
-- succeeds), and zero out free.max_workflow_templates specifically. This is
-- the "malformed/zero workspace override" failure mode the migration's own
-- comment anticipates, applied at the plan level instead: a resolvable
-- plan whose column value for this one resource is 0.
-- effective_plan_limit(ws_id, 'max_workflow_templates') then returns 0,
-- trg_limit_templates raises plan_limit_exceeded:max_workflow_templates
-- (0 >= 0) on the seed INSERT specifically, and the migration's
-- BEGIN/EXCEPTION WHEN OTHERS block must catch it -- signup itself must
-- still succeed. This is the regression test for the signup-must-never-fail
-- constraint; it is the most important test in this file.
-- =============================================================
begin;
do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_conta uuid;
  v_count int;
begin
  update plans set max_workflow_templates = 0 where id = 'free';

  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'fresh93c@example.com', jsonb_build_object('empresa', 'Empresa Teste 93C'));

  select conta_id into v_conta from profiles where id = v_uid;
  assert v_conta is not null, '93-3: signup should still succeed (profile created) even when the template seed fails closed';

  select count(*) into v_count from workflow_templates where conta_id = v_conta;
  assert v_count = 0, format('93-3: seed should have failed closed and been caught, got % rows', v_count);

  raise notice 'PASS 93-3: signup succeeds even when the default-template seed fails closed (max_workflow_templates = 0)';
end $$;
rollback;

-- =============================================================
-- 93-4: Backfill (20260920000002_backfill_default_workflow_template.sql) seeds
-- "Padrão" only into a workspace with zero workflow_templates, is idempotent on
-- re-run, and never touches a workspace that already has ANY template (even a
-- user-made one).
-- =============================================================
begin;
do $$
declare
  v_ws1    uuid;
  v_ws2    uuid;
  v_owner1 uuid := gen_random_uuid();
  v_owner2 uuid := gen_random_uuid();
  v_count  int;
  v_nome   text;
  v_etapas jsonb;
begin
  -- Workspace 1: zero templates, has a resolvable owner profile.
  -- Bare `insert into auth.users` fires handle_new_user_workspace() (see the fixture
  -- note at the top of this file), which auto-creates its own throwaway workspace +
  -- profile row for v_owner1 (id conflict on a second INSERT into profiles) -- so
  -- re-point that auto-created profile at v_ws1 with an UPDATE instead of inserting a
  -- second row.
  v_ws1 := et_make_workspace('free'); -- max_workflow_templates = 1
  insert into auth.users (id) values (v_owner1);
  update profiles set conta_id = v_ws1, role = 'owner', nome = 'Owner One' where id = v_owner1;

  -- Workspace 2: already has one user-made template before the backfill runs.
  v_ws2 := et_make_workspace('free');
  insert into auth.users (id) values (v_owner2);
  update profiles set conta_id = v_ws2, role = 'owner', nome = 'Owner Two' where id = v_owner2;
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
    values (v_owner2, v_ws2, 'Meu Template', '[]'::jsonb, 'padrao');

  -- Run the backfill INSERT verbatim (20260920000002_backfill_default_workflow_template.sql).
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
  select
    coalesce(
      (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'
        order by p.created_at limit 1),
      w.created_by
    ),
    w.id,
    'Padrão',
    '[
      {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
      {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
      {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
      {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
      {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
    ]'::jsonb,
    'padrao'
  from workspaces w
  where not exists (select 1 from workflow_templates t where t.conta_id = w.id)
    and coalesce(
          (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'
            order by p.created_at limit 1),
          w.created_by
        ) is not null
    and (
          effective_plan_limit(w.id, 'max_workflow_templates') is null
          or effective_plan_limit(w.id, 'max_workflow_templates') > 0
        );

  -- ws1 now has exactly one "Padrão" template with 5 etapas.
  select count(*) into v_count from workflow_templates where conta_id = v_ws1;
  assert v_count = 1, format('93-4: expected exactly 1 workflow_templates row for ws1 after backfill, got %', v_count);

  select nome, etapas into v_nome, v_etapas from workflow_templates where conta_id = v_ws1;
  assert v_nome = 'Padrão', format('93-4: expected nome ''Padrão'' for ws1, got %', v_nome);
  assert jsonb_array_length(v_etapas) = 5, format('93-4: expected 5 etapas for ws1, got %', jsonb_array_length(v_etapas));

  -- ws2 (pre-existing template) is untouched: still exactly its one original row.
  select count(*) into v_count from workflow_templates where conta_id = v_ws2;
  assert v_count = 1, format('93-4: expected ws2 to remain at exactly 1 row (pre-existing template), got %', v_count);

  select nome into v_nome from workflow_templates where conta_id = v_ws2;
  assert v_nome = 'Meu Template', format('93-4: expected ws2''s template to remain ''Meu Template'' (untouched), got %', v_nome);

  -- Re-run the exact same backfill INSERT: idempotent, no duplicate for ws1 or ws2.
  insert into workflow_templates (user_id, conta_id, nome, etapas, modo_prazo)
  select
    coalesce(
      (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'
        order by p.created_at limit 1),
      w.created_by
    ),
    w.id,
    'Padrão',
    '[
      {"nome":"Copy","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
      {"nome":"Aprovação da Copy","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
      {"nome":"Mídia","prazo_dias":3,"tipo_prazo":"uteis","tipo":"padrao"},
      {"nome":"Aprovação da Mídia","prazo_dias":2,"tipo_prazo":"corridos","tipo":"aprovacao_cliente"},
      {"nome":"Agendamento","prazo_dias":1,"tipo_prazo":"uteis","tipo":"padrao"}
    ]'::jsonb,
    'padrao'
  from workspaces w
  where not exists (select 1 from workflow_templates t where t.conta_id = w.id)
    and coalesce(
          (select p.id from profiles p where p.conta_id = w.id and p.role = 'owner'
            order by p.created_at limit 1),
          w.created_by
        ) is not null
    and (
          effective_plan_limit(w.id, 'max_workflow_templates') is null
          or effective_plan_limit(w.id, 'max_workflow_templates') > 0
        );

  select count(*) into v_count from workflow_templates where conta_id = v_ws1;
  assert v_count = 1, format('93-4: expected ws1 to still have exactly 1 row after re-running the backfill, got %', v_count);

  select count(*) into v_count from workflow_templates where conta_id = v_ws2;
  assert v_count = 1, format('93-4: expected ws2 to still have exactly 1 row after re-running the backfill, got %', v_count);

  raise notice 'PASS 93-4: backfill is idempotent and selective';
end $$;
rollback;
