\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- admin_mcp_oauth_grants (migration 20260908000001): nem anon nem authenticated
-- leem ou escrevem. A tabela e de uso exclusivo do service role.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ua       uuid := gen_random_uuid();
  v_n        int  := -1;
  v_rejected boolean;
begin
  insert into auth.users (id) values (v_ua);
  insert into admin_mcp_oauth_grants (user_id, client_id, scopes)
    values (v_ua, 'client-1', array['kb:read']);

  -- authenticated (o proprio dono da linha): sem privilegio de tabela OU zero linhas por RLS.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  v_rejected := false;
  begin
    select count(*) into v_n from admin_mcp_oauth_grants;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected or v_n = 0, 'authenticated leu admin_mcp_oauth_grants';

  v_rejected := false;
  begin
    insert into admin_mcp_oauth_grants (user_id, client_id, scopes)
      values (v_ua, 'client-2', array['kb:read']);
  exception when insufficient_privilege or check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated inseriu em admin_mcp_oauth_grants';

  v_rejected := false;
  begin
    update admin_mcp_oauth_grants set scopes = array['kb:write'] where client_id = 'client-1';
    get diagnostics v_n = row_count;
    v_rejected := (v_n = 0);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated alterou admin_mcp_oauth_grants';

  execute 'reset role';

  -- anon: sem privilegio.
  execute 'set local role anon';
  v_rejected := false;
  begin
    select count(*) into v_n from admin_mcp_oauth_grants;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected or v_n = 0, 'anon leu admin_mcp_oauth_grants';
  execute 'reset role';

  v_rejected := false;
  begin
    insert into global_banners (type, content, target_mode, target_plan_ids, status)
      values ('info', 'x', 'plan', '{}', 'draft');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'banner com target_plan_ids vazio passou no CHECK';
end $$;
rollback;
