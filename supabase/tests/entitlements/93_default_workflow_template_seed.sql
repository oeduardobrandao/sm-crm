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
--
-- Runs the real migration file via `\i` (not an inline copy) so this test can never
-- silently drift from the shipped SQL -- the fix-round rewrite turned the backfill into
-- a `do $$ ... $$` block, which cannot be pasted inside this test's own `do $$ ... $$`
-- (the inner `$$` would terminate the outer body). Fixture ids cross the `\i` boundary
-- via `set_config(..., true)` (transaction-scoped custom GUCs, torn down by the
-- trailing `rollback`), the same technique other tests in this suite already use for
-- `request.jwt.claims`.
--
-- This file has THREE `\i supabase/migrations/20260920000002_...sql` lines (two below,
-- one more in 93-5). All three name the migration by its literal filename -- if that
-- migration is ever renumbered (e.g. at PR-open time, per this repo's migration-version
-- convention), update all three `\i` lines to match, or they fail loudly (psql exits
-- non-zero on a missing \i target under ON_ERROR_STOP) rather than silently skipping.
-- =============================================================
begin;
do $$
declare
  v_ws1    uuid;
  v_ws2    uuid;
  v_owner1 uuid := gen_random_uuid();
  v_owner2 uuid := gen_random_uuid();
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

  perform set_config('t93_4.ws1', v_ws1::text, true);
  perform set_config('t93_4.ws2', v_ws2::text, true);
end $$;

-- Run the real backfill migration file.
\i supabase/migrations/20260920000002_backfill_default_workflow_template.sql

do $$
declare
  v_ws1    uuid := current_setting('t93_4.ws1')::uuid;
  v_ws2    uuid := current_setting('t93_4.ws2')::uuid;
  v_count  int;
  v_nome   text;
  v_etapas jsonb;
begin
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

  raise notice 'PASS 93-4a: backfill seeds ws1 and leaves ws2 untouched';
end $$;

-- Re-run the exact same migration file: idempotent, no duplicate for ws1 or ws2.
\i supabase/migrations/20260920000002_backfill_default_workflow_template.sql

do $$
declare
  v_ws1   uuid := current_setting('t93_4.ws1')::uuid;
  v_ws2   uuid := current_setting('t93_4.ws2')::uuid;
  v_count int;
begin
  select count(*) into v_count from workflow_templates where conta_id = v_ws1;
  assert v_count = 1, format('93-4: expected ws1 to still have exactly 1 row after re-running the backfill, got %', v_count);

  select count(*) into v_count from workflow_templates where conta_id = v_ws2;
  assert v_count = 1, format('93-4: expected ws2 to still have exactly 1 row after re-running the backfill, got %', v_count);

  raise notice 'PASS 93-4b: backfill is idempotent on re-run';
end $$;
rollback;

-- =============================================================
-- 93-5: Backfill isolates one workspace's insert failure from all others. This is the
-- regression test for the fix-round rewrite itself: 20260920000002 used to be a single
-- set-based INSERT...SELECT, so ANY one row's exception (e.g. losing the
-- plan_limit_exceeded race against a concurrent, ordinary user insert -- see the
-- migration's own header comment) aborted the whole statement, and with it the whole
-- migration/db push. The rewrite wraps each workspace's insert in its own
-- BEGIN...EXCEPTION so one failure can never propagate.
--
-- Simulated here with a temporary BEFORE INSERT trigger that raises for one specific
-- conta_id, standing in for "this workspace's insert failed for some reason" without
-- needing an actual concurrent session. The trigger function lives in `public` (not
-- pg_temp) with a name unique to this test; both the trigger and the function are
-- created and dropped inside this same transaction, so nothing outlives the trailing
-- `rollback`.
-- =============================================================
begin;
do $$
declare
  v_ws_poison uuid;
  v_ws_ok     uuid;
  v_owner_p   uuid := gen_random_uuid();
  v_owner_ok  uuid := gen_random_uuid();
begin
  v_ws_poison := et_make_workspace('free');
  insert into auth.users (id) values (v_owner_p);
  update profiles set conta_id = v_ws_poison, role = 'owner', nome = 'Poisoned Owner' where id = v_owner_p;

  v_ws_ok := et_make_workspace('free');
  insert into auth.users (id) values (v_owner_ok);
  update profiles set conta_id = v_ws_ok, role = 'owner', nome = 'OK Owner' where id = v_owner_ok;

  perform set_config('t93_5.ws_poison', v_ws_poison::text, true);
  perform set_config('t93_5.ws_ok', v_ws_ok::text, true);
end $$;

create or replace function public.et_93_5_poison_insert() returns trigger
language plpgsql as $fn$
begin
  if NEW.conta_id = current_setting('t93_5.ws_poison')::uuid then
    raise exception 'simulated_concurrent_insert_loss';
  end if;
  return NEW;
end;
$fn$;

create trigger et_93_5_poison_trigger
  before insert on workflow_templates
  for each row execute function public.et_93_5_poison_insert();

-- Run the real backfill migration file with the poison trigger active.
\i supabase/migrations/20260920000002_backfill_default_workflow_template.sql

do $$
declare
  v_ws_poison uuid := current_setting('t93_5.ws_poison')::uuid;
  v_ws_ok     uuid := current_setting('t93_5.ws_ok')::uuid;
  v_count     int;
begin
  -- The poisoned workspace's insert failed and was caught: 0 templates, not propagated.
  select count(*) into v_count from workflow_templates where conta_id = v_ws_poison;
  assert v_count = 0, format('93-5: expected poisoned workspace to end up with 0 templates (failure caught, not propagated), got %', v_count);

  -- The unrelated, healthy workspace in the SAME run still got its "Padrão" template --
  -- proving one workspace's failure doesn't abort the backfill for everyone else.
  select count(*) into v_count from workflow_templates where conta_id = v_ws_ok;
  assert v_count = 1, format('93-5: expected the unrelated workspace to still get its Padrão template despite the poisoned workspace failing, got %', v_count);

  raise notice 'PASS 93-5: backfill isolates one workspace''s insert failure from all others';
end $$;

drop trigger et_93_5_poison_trigger on workflow_templates;
drop function public.et_93_5_poison_insert();
rollback;
