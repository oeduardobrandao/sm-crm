\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- public.handle_new_user_workspace() -- migration 20260928000001_workspace_slug_unaccent.sql
-- runs the workspace name through extensions.unaccent() before slugging, so
-- accented letters are transliterated ("Estúdio" -> "estudio") instead of
-- being replaced by a hyphen ("est-dio"). Both slug-building branches are
-- covered: the fresh signup (ELSE branch, writes contas + workspaces) and the
-- invited user whose conta has no workspaces row yet (writes workspaces only).
--
-- Each case is its own begin/rollback block so an early failure doesn't mask
-- the others. See 93_default_workflow_template_seed.sql for the fixture note
-- on bare auth.users inserts firing the trigger.

-- =============================================================
-- 99-1: Fresh signup transliterates accents, contas and workspaces agree.
-- =============================================================
begin;
do $$
declare
  v_cases  text[][] := array[
    array['Estúdio Lumen',         'estudio-lumen'],
    array['Agência Aurora',        'agencia-aurora'],
    array['AGÊNCIA Ação & Cia',    'agencia-acao-cia'],
    array['Ñandú Côté Ïlha Õmega', 'nandu-cote-ilha-omega'],
    array['Pão de Açúcar Mídia',   'pao-de-acucar-midia']
  ];
  v_i      int;
  v_uid    uuid;
  v_conta  uuid;
  v_ws     text;
  v_ct     text;
  v_expect text;
begin
  for v_i in 1 .. array_length(v_cases, 1) loop
    v_uid := gen_random_uuid();
    insert into auth.users (id, email, raw_user_meta_data)
      values (v_uid, format('slug99-%s@example.com', v_i),
              jsonb_build_object('empresa', v_cases[v_i][1]));

    select conta_id into v_conta from profiles where id = v_uid;
    assert v_conta is not null, format('99-1: signup for %L should have created a profile', v_cases[v_i][1]);

    v_expect := v_cases[v_i][2] || '-' || substr(replace(v_conta::text, '-', ''), 1, 8);
    select slug into v_ws from workspaces where id = v_conta;
    select slug into v_ct from contas where id = v_conta;

    assert v_ws = v_expect,
      format('99-1: workspaces.slug for %L: expected %L, got %L', v_cases[v_i][1], v_expect, v_ws);
    assert v_ct = v_expect,
      format('99-1: contas.slug for %L: expected %L, got %L', v_cases[v_i][1], v_expect, v_ct);
  end loop;

  raise notice 'PASS 99-1: fresh signup transliterates accented workspace names';
end $$;
rollback;

-- =============================================================
-- 99-2: A name with nothing slug-able still falls back to "workspace-<8hex>".
-- =============================================================
begin;
do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_conta uuid;
  v_ws    text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_uid, 'slug99-fallback@example.com', jsonb_build_object('empresa', '!!! *** ???'));

  select conta_id into v_conta from profiles where id = v_uid;
  select slug into v_ws from workspaces where id = v_conta;

  assert v_ws = 'workspace-' || substr(replace(v_conta::text, '-', ''), 1, 8),
    format('99-2: expected the workspace-<8hex> fallback, got %L', v_ws);

  raise notice 'PASS 99-2: empty slug still falls back to workspace-<8hex>';
end $$;
rollback;

-- =============================================================
-- 99-3: Invited user onto a conta with no workspaces row yet: the workspaces
-- row the trigger creates gets a transliterated slug built from contas.nome.
-- That branch never writes contas.slug, so it is not asserted here.
-- =============================================================
begin;
do $$
declare
  v_conta   uuid := gen_random_uuid();
  v_owner   uuid := gen_random_uuid();
  v_invited uuid := gen_random_uuid();
  v_ws      text;
  v_expect  text;
begin
  insert into contas (id, nome, slug) values (v_conta, 'Agência Aurora', 'conta-et99');

  insert into auth.users (id, email) values (v_owner, 'slug99-owner@example.com');
  update profiles set conta_id = v_conta, role = 'owner' where id = v_owner;

  insert into invites (conta_id, email, role, invited_by, status, expires_at)
    values (v_conta, 'slug99-invited@example.com', 'agent', v_owner, 'pending', now() + interval '7 days');

  insert into auth.users (id, email, raw_user_meta_data)
    values (v_invited, 'slug99-invited@example.com', jsonb_build_object('conta_id', v_conta));

  v_expect := 'agencia-aurora-' || substr(replace(v_conta::text, '-', ''), 1, 8);
  select slug into v_ws from workspaces where id = v_conta;

  assert v_ws = v_expect, format('99-3: expected workspaces.slug %L, got %L', v_expect, v_ws);

  raise notice 'PASS 99-3: invited-user branch transliterates the slug of the workspace it creates';
end $$;
rollback;
