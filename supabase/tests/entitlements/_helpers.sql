-- =============================================================
-- et_grant_hosted_parity — make a LOCAL database's table privileges match a
-- hosted Supabase project's, so suites that impersonate `authenticated` test
-- the behaviour under test instead of an environment artifact.
--
-- WHY THIS EXISTS. Hosted Supabase projects carry a `pg_default_acl` that
-- grants ALL on new `public` tables to anon/authenticated/service_role: the
-- production dump shows 70 tables with `GRANT ALL ON TABLE ... TO
-- "authenticated"`, including migration-created ones such as
-- `workspace_members`. The local CLI image's default ACL for role `postgres`
-- grants only `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) — no `arwd`.
-- Migrations run as `postgres`, so locally almost nothing is readable by
-- `authenticated`: the ONLY locally-selectable tables are the four with an
-- explicit `GRANT` in a migration (post_designs, design_asset_refs,
-- ai_image_generations, designs).
--
-- Consequence: `SET LOCAL ROLE authenticated` in a test fails with
-- `permission denied` locally while the same code works in production. That is
-- a false negative, and worse, it silently discourages writing the
-- impersonating tests — which are the only kind that can prove an RLS policy,
-- since the table owner bypasses row security entirely.
--
-- This is a TEST-HARNESS fix, deliberately not a migration. Adding explicit
-- grants to migrations for a couple of tables would single them out while 68
-- others rely on the same implicit mechanism, and would misrepresent an
-- environment difference as a schema defect.
--
-- p_exclude: tables whose privileges are themselves under test. A suite
-- asserting a REVOKE must exclude the affected tables, or this helper would
-- silently undo the very thing being asserted.
-- =============================================================
create or replace function et_grant_hosted_parity(p_exclude text[] default '{}')
returns void language plpgsql as $$
declare r record;
begin
  for r in
    select tablename from pg_tables
    where schemaname = 'public' and not (tablename = any(p_exclude))
  loop
    execute format(
      'grant all on table public.%I to anon, authenticated, service_role',
      r.tablename);
  end loop;

  -- Sequence USAGE too: with table privileges but no sequence privilege an
  -- INSERT still fails, because the column default calls nextval() and that is
  -- checked against the caller's privileges.
  for r in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S'
  loop
    execute format(
      'grant all on sequence public.%I to anon, authenticated, service_role',
      r.relname);
  end loop;
end;
$$;

-- Creates a workspace on a given plan, returns its id. For use inside a tx that is rolled back.
create or replace function et_make_workspace(p_plan_id text, p_overrides jsonb default null)
returns uuid language plpgsql as $$
declare v_ws uuid;
begin
  insert into workspaces (name, plan_id, plan_source)
    values ('ET test ws', p_plan_id, 'manual')
    returning id into v_ws;
  if p_overrides is not null then
    insert into workspace_plan_overrides (workspace_id, resource_overrides)
      values (v_ws, p_overrides);
  end if;
  return v_ws;
end;
$$;
