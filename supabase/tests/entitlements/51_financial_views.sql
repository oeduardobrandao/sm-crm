\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Masking, tenant isolation and write-denial on membros_v / clientes_v.

begin;
do $$
declare
  v_ws_a  uuid; v_ws_b uuid;
  v_owner uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_val   numeric;
  v_rows  bigint;
  v_ok    boolean;
  v_acl   text;
  v_view  text;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values (v_owner), (v_admin);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws_a, 'owner'),
    (v_admin, v_ws_a, 'admin');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_owner, v_admin);

  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_owner, v_ws_a, 'Fulano', 'Designer', 'clt', 5000, '');
  insert into membros (user_id, conta_id, nome, cargo, tipo, custo_mensal, avatar_url)
    values (v_owner, v_ws_b, 'Outro WS', 'Dev', 'clt', 9999, '');
  insert into clientes (user_id, conta_id, nome, sigla, cor, valor_mensal)
    values (v_owner, v_ws_a, 'Cliente A', 'CA', '#000', 3000);

  -- authorized admin sees the real membros_v value
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select custo_mensal into v_val from public.membros_v where nome = 'Fulano';
  reset role;
  if v_val is distinct from 5000 then
    raise exception 'authorized admin should read custo_mensal=5000, got %', v_val;
  end if;

  -- authorized admin sees the real clientes_v value (done before the flag
  -- flips below, so this exercises the un-masked CASE branch — the one-sided
  -- "restricted -> NULL" check further down cannot tell a real mask from a
  -- hard-coded `NULL AS valor_mensal` or a broken predicate; this can)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select valor_mensal into v_val from public.clientes_v where nome = 'Cliente A';
  reset role;
  if v_val is distinct from 3000 then
    raise exception 'authorized admin should read valor_mensal=3000, got %', v_val;
  end if;

  -- restricted admin sees NULL, but still sees the ROW
  update workspace_members set can_see_financials = false
   where user_id = v_admin and workspace_id = v_ws_a;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select custo_mensal, count(*) over () into v_val, v_rows
    from public.membros_v where nome = 'Fulano';
  reset role;
  -- A zero-row SELECT INTO leaves BOTH v_val and v_rows NULL, and
  -- `NULL <> 1` evaluates to NULL — which PL/pgSQL's IF treats as false, so an
  -- unguarded `if v_rows <> 1` never fires in exactly the case (the view
  -- hiding the row instead of masking the column) it exists to catch.
  -- coalesce() forces the zero-row case to a value the <> can actually catch.
  if coalesce(v_rows, 0) <> 1 then
    raise exception 'restricted admin must still SEE the member row, got % rows', v_rows;
  end if;
  if v_val is not null then
    raise exception 'restricted admin should read custo_mensal=NULL, got %', v_val;
  end if;

  -- clientes_v masks the same way, and the restricted read still proves the
  -- row is visible (not hidden) via the same coalesce()'d row-count guard
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select valor_mensal, count(*) over () into v_val, v_rows
    from public.clientes_v where nome = 'Cliente A';
  reset role;
  if coalesce(v_rows, 0) <> 1 then
    raise exception 'restricted admin must still SEE the client row, got % rows', v_rows;
  end if;
  if v_val is not null then
    raise exception 'restricted admin should read valor_mensal=NULL, got %', v_val;
  end if;

  -- Direct ACL assertions, mirroring the behavioural write-denial checks
  -- above. NEITHER form actually proves the migration's enumerated
  -- `REVOKE ... FROM PUBLIC, anon, authenticated, service_role` is necessary
  -- (as opposed to a narrower `REVOKE ... FROM PUBLIC`) in THIS suite: the
  -- behavioural cases pass either way because the local default ACL on a
  -- freshly created view never grants `authenticated` INSERT/UPDATE in the
  -- first place, and these relacl assertions below have the identical local
  -- weakness for the same reason -- `et_grant_hosted_parity()` (used
  -- elsewhere in this file to backfill hosted-parity grants) iterates
  -- `pg_tables`, so it never touches `membros_v`/`clientes_v` at all, and
  -- isn't even called in this file; there is nothing here that would
  -- re-grant a view the way a reduced REVOKE would leave it. Both forms of
  -- assertion remain useful regression coverage for the CURRENT grant state,
  -- just not proof that the wider enumeration in the REVOKE was required.
  --
  -- What actually proves that is Migration A's own post-condition `DO` block
  -- (supabase/migrations/20260728000001_financial_visibility_a_additive.sql,
  -- the `FOREACH v IN ARRAY ARRAY['membros_v', 'clientes_v']` block at the
  -- end of the file), which reads relacl the same way but runs immediately
  -- after the migration applies -- including on hosted, where the default
  -- ACL actually does grant authenticated/anon/service_role broadly, so a
  -- too-narrow REVOKE there would leave a real grant behind for that block
  -- to catch.
  foreach v_view in array array['membros_v', 'clientes_v'] loop
    select array_to_string(c.relacl, ',') into v_acl
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_view;

    if v_acl is null or v_acl !~ 'authenticated=r/' then
      raise exception '%: authenticated lacks SELECT — acl=%', v_view, v_acl;
    end if;
    -- 'a' = INSERT, 'w' = UPDATE, 'd' = DELETE.
    if v_acl ~ 'authenticated=[rwad]*[awd]' then
      raise exception '%: authenticated retains write privilege — acl=%', v_view, v_acl;
    end if;
    if v_acl like '%anon=%' then
      raise exception '%: anon retains privilege — acl=%', v_view, v_acl;
    end if;
    if v_acl like '%service_role=%' then
      raise exception '%: service_role retains privilege — acl=%', v_view, v_acl;
    end if;
    -- PUBLIC renders as a grantee-less aclitem (`=X/postgres`): first in the
    -- string with no leading comma, or after another entry with one.
    if v_acl like '=%' or v_acl like '%,=%' then
      raise exception '%: PUBLIC retains privilege — acl=%', v_view, v_acl;
    end if;
  end loop;

  -- tenant isolation: workspace B's member is invisible through the view
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from public.membros_v where nome = 'Outro WS';
  reset role;
  if v_rows <> 0 then
    raise exception 'view leaked workspace B rows: % found', v_rows;
  end if;

  -- stale pointer: membership deleted while active_workspace_id still points there
  delete from workspace_members where user_id = v_admin and workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_rows from public.membros_v;
  reset role;
  if v_rows <> 0 then
    raise exception 'stale active_workspace_id must yield 0 rows, got %', v_rows;
  end if;

  -- writes through the view are denied for authenticated
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_ok := false;
  set local role authenticated;
  begin
    insert into public.membros_v (nome, cargo, tipo, conta_id, avatar_url)
      values ('Injetado', 'X', 'clt', v_ws_b, '');
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'INSERT through membros_v must be denied for authenticated';
  end if;

  v_ok := false;
  set local role authenticated;
  begin
    update public.membros_v set conta_id = v_ws_b where nome = 'Fulano';
  exception when insufficient_privilege then
    v_ok := true;
  end;
  reset role;
  if not v_ok then
    raise exception 'UPDATE through membros_v must be denied for authenticated';
  end if;

  raise notice '51_financial_views: all view cases passed';
end $$;
rollback;
