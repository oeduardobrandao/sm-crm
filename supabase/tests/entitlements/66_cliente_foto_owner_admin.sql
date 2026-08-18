\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Regression test for 20260817000001_cliente_foto_manual_upload.sql's three
-- enforcement layers:
--   1. trg_cliente_foto_owner_admin — clientes_update RLS is open to any
--      workspace member, so without this trigger an agent-role user could
--      set foto_url to an arbitrary URL through a direct table update,
--      bypassing the CRM's UI-level workspaceRole gate entirely. Also fires
--      on INSERT (post-review fix): clientes_insert RLS has no role check
--      at all, so the same agent could otherwise set foto_url at row
--      creation time instead of via a later UPDATE. And it must NOT block
--      a trusted service_role caller that has no workspace_members row of
--      its own — the escape hatch (post-review fix) checks auth.role(),
--      not current_user/session_user; see the long comment above the
--      function definition in the migration for why either identity-based
--      check would either silently defeat the whole guard (current_user,
--      under SECURITY DEFINER) or reopen it for any downgraded-from-
--      postgres session (session_user, empirically proven against THIS
--      test file's own Case 1 while developing the fix).
--   2. cliente_photo_insert (storage RLS) — an owner/admin of workspace A
--      must not be able to write to workspace B's client photo path.
--   3. avatars_service_write narrowed to `service_role` — must not have
--      collaterally locked out the edge functions that rely on it (the
--      Instagram-avatar cache, the report-splash art, this feature itself).
--
-- IMPORTANT — impersonates `authenticated`/`service_role`, not just a JWT
-- claim: the table owner bypasses RLS, and a claims-only version would not
-- exercise the same write path an authenticated client actually uses.
--
-- The storage.objects inserts below only set bucket_id/name — every other
-- column in Supabase's standard storage schema is nullable or has a
-- default. If this project's storage.objects has been customized with an
-- additional NOT NULL column, widen these inserts accordingly when Step 4
-- surfaces the failure.

begin;
select et_grant_hosted_parity();

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_owner_a uuid := gen_random_uuid();
  v_owner_b uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_rejected boolean;
  v_foto text;
begin
  -- 'max' plan, not 'start': workspace A needs TWO team members (owner +
  -- agent), and 'start' seeds max_team_members = 1 (supabase/seed.sql),
  -- which aborts the membership insert below with plan_limit_exceeded
  -- before the trigger/RLS logic under test ever runs (confirmed locally).
  -- Matches the precedent in 56_profiles_write_lockdown.sql, which uses
  -- 'max' for the same reason.
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_owner_a), (v_owner_b), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner_a, v_ws_a, 'owner'), (v_owner_b, v_ws_b, 'owner'), (v_agent, v_ws_a, 'agent');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id in (v_owner_a, v_agent);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_owner_b;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner_a, v_ws_a, 'Cliente A', 'CA', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner_b, v_ws_b, 'Cliente B', 'CB', '#000') returning id into v_cli_b;

  -- ---- Case 1: agent-role (member of A, not owner/admin) cannot set foto_url ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    update clientes set foto_url = 'https://evil.example/x.png' where id = v_cli_a;
  exception when others then
    v_rejected := true;
  end;
  assert v_rejected,
    'clientes.foto_url: agent-role update was NOT rejected by trg_cliente_foto_owner_admin';

  -- The trigger is scoped to foto_url only — an agent must still be able to
  -- update an unrelated column on the same row.
  update clientes set telefone = '(85) 90000-0000' where id = v_cli_a;

  execute 'reset role';

  select foto_url into v_foto from clientes where id = v_cli_a;
  assert v_foto is null, 'clientes.foto_url: the rejected update leaked through anyway';

  -- ---- Case 1b: owner of A, same column, must succeed ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  update clientes set foto_url = 'https://cdn.mesaas.com/avatars/clientes/1/foto.png'
   where id = v_cli_a;

  execute 'reset role';

  select foto_url into v_foto from clientes where id = v_cli_a;
  assert v_foto = 'https://cdn.mesaas.com/avatars/clientes/1/foto.png',
    'clientes.foto_url: owner-role update was rejected';

  -- ---- Case 1c: agent-role cannot INSERT a new client with foto_url set ----
  -- (post-review fix: the trigger used to be BEFORE UPDATE only, so an
  -- agent could set foto_url at creation time — clientes_insert RLS has no
  -- role check to stop it.)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    insert into clientes (user_id, conta_id, nome, sigla, cor, foto_url)
      values (v_agent, v_ws_a, 'Cliente C', 'CC', '#000', 'https://evil.example/insert.png');
  exception when others then
    v_rejected := true;
  end;
  assert v_rejected,
    'clientes.foto_url: agent-role INSERT with foto_url set was NOT rejected';

  -- An agent must still be able to create a client that leaves foto_url unset
  -- — the trigger only guards a foto_url that is actually being set.
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_agent, v_ws_a, 'Cliente D', 'CD', '#000');

  execute 'reset role';

  -- ---- Case 1d: owner of A CAN insert a new client with foto_url set ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  insert into clientes (user_id, conta_id, nome, sigla, cor, foto_url)
    values (v_owner_a, v_ws_a, 'Cliente E', 'CE', '#000',
            'https://cdn.mesaas.com/avatars/clientes/5/foto.png')
    returning foto_url into v_foto;
  assert v_foto = 'https://cdn.mesaas.com/avatars/clientes/5/foto.png',
    'clientes.foto_url: owner-role INSERT with foto_url set was rejected';

  execute 'reset role';

  -- ---- Case 1e: service_role bypasses the owner/admin check entirely ----
  -- (post-review fix #2. service_role has no workspace_members row for
  -- either client, so this only passes if the escape hatch actually took —
  -- proves the fix isn't a no-op. The escape hatch checks auth.role() only
  -- — deliberately NOT current_user or session_user; both were tried and
  -- rejected while developing this fix (see the migration's comment above
  -- the function definition): current_user is frozen to the function OWNER
  -- under SECURITY DEFINER regardless of caller, and session_user does not
  -- change with SET LOCAL ROLE, so either would have made this escape fire
  -- for every persona in this file, not just this one — which is exactly
  -- what happened first when session_user was tried: Case 1 above passed
  -- for the wrong reason instead of correctly rejecting the agent.)
  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  update clientes set foto_url = 'https://cdn.mesaas.com/service/backfill.png'
   where id = v_cli_b;
  execute 'reset role';

  select foto_url into v_foto from clientes where id = v_cli_b;
  assert v_foto = 'https://cdn.mesaas.com/service/backfill.png',
    'clientes.foto_url: service_role write was rejected by the owner/admin trigger';

  -- ---- Case 2: owner of A cannot write to B's client photo path ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'clientes/' || v_cli_b || '/foto.png');
  exception when others then
    v_rejected := true;
  end;
  assert v_rejected,
    'storage.objects: owner of workspace A wrote to workspace B''s client photo path';

  -- Owner CAN write to their OWN client's path — proves the policy filters
  -- by ownership rather than denying everything, which would also satisfy
  -- the assertion above for the wrong reason.
  insert into storage.objects (bucket_id, name) values ('avatars', 'clientes/' || v_cli_a || '/foto.png');

  -- ---- Case 2b: the same user cannot write outside clientes/* or workspaces/* at all ----
  -- (proves avatars_service_write's narrowing to service_role actually took —
  -- without it, this bucket-only check would have passed even with the two
  -- new path-scoped policies correctly in place.)
  v_rejected := false;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'arbitrary-path/x.png');
  exception when others then
    v_rejected := true;
  end;
  assert v_rejected,
    'storage.objects: an authenticated user wrote outside clientes/* and workspaces/* — avatars_service_write is still too broad';

  execute 'reset role';

  -- ---- Case 3: service_role can still write anywhere in the bucket ----
  -- (the Instagram-avatar cache and the report-splash art both rely on this;
  -- the narrowing in this migration must not have collaterally broken them.)
  execute 'set local role service_role';
  insert into storage.objects (bucket_id, name) values ('avatars', 'clientes/999/ig-cache.jpg');
  execute 'reset role';

  raise notice 'PASS 66_cliente_foto_owner_admin';
end $$;
rollback;
