\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Fotos de perfil da equipe (20261022000001_fotos_perfil_equipe.sql).
-- Spec: docs/superpowers/specs/2026-10-21-fotos-de-perfil-da-equipe-design.md
--
-- Covers the four enforcement layers of that migration:
--   1. set_member_photo(): the ONLY writer of profiles.avatar_url /
--      membros.avatar_url. Self target vs membro target, equipe:editar,
--      path prefix per target, object must exist in storage with the caller
--      as owner, URL built from the Vault project_url, sync to the person's
--      membros only in the contas they are still in.
--   2. trg_membros_avatar_insert: a client INSERT can never carry an
--      avatar_url (forced NULL); service_role keeps it, '' becomes NULL.
--   3. membros UPDATE grant no longer includes avatar_url.
--   4. trg_membros_link_photo: link / relink / unlink of crm_user_id keeps
--      the membro row a copy of the profile photo, and a relink never pushes
--      the previous person's face onto the new person's profile.
--   5. Storage INSERT policies for profiles/{uid}/ and membros/{id}/.
--
-- membros is EXCLUDED from et_grant_hosted_parity(): this suite asserts the
-- migration's column-level UPDATE revoke, and the helper's table-level
-- GRANT ALL would hide it (_helpers.sql). INSERT/DELETE (and SELECT) are
-- granted back explicitly; UPDATE is re-granted only on the migration's own
-- column list. Everything runs inside one begin/rollback so no GRANT leaks
-- into later suites.
--
-- Seeding happens as postgres (table owner, whitelisted by the INSERT
-- trigger, so seeded avatar_url values survive); each case then impersonates
-- with request.jwt.claims + SET LOCAL ROLE, never claims alone.
--
-- Vault: CI's database already carries project_url (seeded with the local
-- host by 20260324_schedule_instagram_sync_cron.sql), so no value is assumed:
-- it is read once and every expected URL is built from it.
--
-- storage.objects seed rows set `owner` (the column the RPC checks). The
-- local storage-api was observed to populate both owner and owner_id on a
-- real upload, so owner is what production rows carry too.

begin;
select et_grant_hosted_parity('{membros}');
grant select, insert, delete on public.membros to authenticated;
grant select, insert, delete on public.membros to service_role;
grant update (nome, cargo, tipo, custo_mensal, data_pagamento) on public.membros to authenticated;

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_oa uuid := gen_random_uuid();   -- owner of A
  v_ob uuid := gen_random_uuid();   -- owner of B
  v_u  uuid := gen_random_uuid();   -- agent in A and B, linked membro in each
  v_v  uuid := gen_random_uuid();   -- unrelated login
  v_ag uuid := gen_random_uuid();   -- agent of A, no custom role
  v_cr uuid := gen_random_uuid();   -- agent of A with custom role equipe:editar
  v_w  uuid := gen_random_uuid();   -- link cases: has a profile photo
  v_x  uuid := gen_random_uuid();   -- link cases: no photo, member of A and B
  v_y  uuid := gen_random_uuid();   -- link cases: no photo
  v_z  uuid := gen_random_uuid();   -- link cases: not a member of A
  v_z2 uuid := gen_random_uuid();   -- link cases: not a member of A
  v_zp uuid := gen_random_uuid();   -- link cases: not a member of A, has a profile photo
  v_q  uuid := gen_random_uuid();   -- link cases: member of A, no photo (legacy url)
  v_r  uuid := gen_random_uuid();   -- link cases: member of A, no photo (other folder)
  v_role uuid;
  v_m bigint; v_ma_u bigint; v_mb_u bigint;
  v_l1 bigint; v_l2 bigint; v_l4 bigint; v_xb bigint;
  v_l3 bigint; v_l3b bigint; v_l5 bigint; v_url_l2 text;
  v_base text; v_pub text;
  v_ret text; v_got text; v_got2 text; v_got3 text;
  v_err text; v_state text;
  v_url1 text; v_url2 text; v_url_l text; v_url_b text; v_url_y text; v_url_cr text;
  v_pw text := 'https://cdn.example/profile-w.jpg';
begin
  -- ---------------------------------------------------------------- setup
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('max');

  insert into auth.users (id) values
    (v_oa), (v_ob), (v_u), (v_v), (v_ag), (v_cr), (v_w), (v_x), (v_y), (v_z),
    (v_z2), (v_zp), (v_q), (v_r);

  insert into workspace_roles (conta_id, nome, permissions)
    values (v_ws_a, 'ET67 equipe editar', '{"equipe":"editar"}'::jsonb)
    returning id into v_role;

  insert into workspace_members (user_id, workspace_id, role) values
    (v_oa, v_ws_a, 'owner'), (v_ob, v_ws_b, 'owner'),
    (v_u, v_ws_a, 'agent'), (v_u, v_ws_b, 'agent'),
    (v_ag, v_ws_a, 'agent'),
    (v_w, v_ws_a, 'agent'), (v_x, v_ws_a, 'agent'), (v_x, v_ws_b, 'agent'),
    (v_y, v_ws_a, 'agent'), (v_q, v_ws_a, 'agent'), (v_r, v_ws_a, 'agent');
  insert into workspace_members (user_id, workspace_id, role, role_id)
    values (v_cr, v_ws_a, 'agent', v_role);

  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id in (v_oa, v_u, v_ag, v_cr, v_w, v_x, v_y, v_q, v_r);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_ob;
  update profiles set avatar_url = v_pw where id = v_w;
  update profiles set avatar_url = 'https://cdn.example/profile-zp.jpg' where id = v_zp;

  insert into membros (user_id, conta_id, nome) values (v_oa, v_ws_a, 'Sem login')
    returning id into v_m;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_oa, v_ws_a, 'U em A', v_u)
    returning id into v_ma_u;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_ob, v_ws_b, 'U em B', v_u)
    returning id into v_mb_u;

  select rtrim(decrypted_secret, '/') into v_base
    from vault.decrypted_secrets where name = 'project_url';
  if v_base is null then
    perform vault.create_secret('http://127.0.0.1:54321', 'project_url');
    v_base := 'http://127.0.0.1:54321';
  end if;
  v_pub := v_base || '/storage/v1/object/public/avatars/';

  insert into storage.objects (bucket_id, name, owner) values
    ('avatars', 'profiles/' || v_u || '/x.jpg', v_u),
    ('avatars', 'profiles/' || v_u || '/x2.jpg', v_u),
    ('avatars', 'profiles/' || v_u || '/foreign.jpg', v_v),
    ('post-media', 'profiles/' || v_u || '/otherbucket.jpg', v_u),
    ('avatars', 'membros/' || v_m || '/y.jpg', v_oa),
    ('avatars', 'membros/' || v_m || '/cr.jpg', v_cr),
    ('avatars', 'membros/' || v_m || '/x.jpg', v_u),
    ('avatars', 'membros/' || v_ma_u || '/l.jpg', v_oa),
    ('avatars', 'membros/' || v_mb_u || '/b.jpg', v_ob);

  -- ------------------------------------------------------- self ok
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(null::bigint, v_u, 'profiles/' || v_u || '/x.jpg');
  execute 'reset role';

  v_url1 := v_pub || 'profiles/' || v_u || '/x.jpg';
  if v_ret is distinct from v_url1 then
    raise exception 'self ok: returned %, expected %', v_ret, v_url1;
  end if;
  select avatar_url into v_got from profiles where id = v_u;
  select avatar_url into v_got2 from membros where id = v_ma_u;
  select avatar_url into v_got3 from membros where id = v_mb_u;
  if v_got is distinct from v_url1 or v_got2 is distinct from v_url1
     or v_got3 is distinct from v_url1 then
    raise exception 'self ok: profile=% membroA=% membroB=%, expected all %',
      v_got, v_got2, v_got3, v_url1;
  end if;

  -- ------------------------------------------- self sync skips left conta
  delete from workspace_members where user_id = v_u and workspace_id = v_ws_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(null::bigint, v_u, 'profiles/' || v_u || '/x2.jpg');
  execute 'reset role';

  v_url2 := v_pub || 'profiles/' || v_u || '/x2.jpg';
  select avatar_url into v_got from profiles where id = v_u;
  select avatar_url into v_got2 from membros where id = v_ma_u;
  select avatar_url into v_got3 from membros where id = v_mb_u;
  if v_got is distinct from v_url2 or v_got2 is distinct from v_url2 then
    raise exception 'self sync skips left conta: profile=% membroA=%, expected %',
      v_got, v_got2, v_url2;
  end if;
  if v_got3 is distinct from v_url1 then
    raise exception 'self sync skips left conta: membro in the conta U left changed to % (expected %)',
      v_got3, v_url1;
  end if;

  -- ------------------------------------------- self other user denied
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null;
  begin
    perform set_member_photo(null::bigint, v_v, 'profiles/' || v_v || '/a.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'Insufficient permissions' then
    raise exception 'self other user denied: got %', coalesce(v_err, '<no error>');
  end if;

  -- invalid_target: both or neither target
  v_err := null;
  begin
    perform set_member_photo(v_ma_u, v_u, 'profiles/' || v_u || '/x.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'invalid_target' then
    raise exception 'invalid_target (both): got %', coalesce(v_err, '<no error>');
  end if;
  v_err := null;
  begin
    perform set_member_photo(null::bigint, null::uuid, 'profiles/' || v_u || '/x.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'invalid_target' then
    raise exception 'invalid_target (neither): got %', coalesce(v_err, '<no error>');
  end if;
  execute 'reset role';

  -- ------------------------------------------- editor ok, no login
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(v_m, null::uuid, 'membros/' || v_m || '/y.jpg');
  execute 'reset role';

  v_url_y := v_pub || 'membros/' || v_m || '/y.jpg';
  select avatar_url into v_got from membros where id = v_m;
  select avatar_url into v_got2 from profiles where id = v_u;
  select avatar_url into v_got3 from membros where id = v_ma_u;
  if v_ret is distinct from v_url_y or v_got is distinct from v_url_y then
    raise exception 'editor ok, no login: returned % / stored %, expected %', v_ret, v_got, v_url_y;
  end if;
  if v_got2 is distinct from v_url2 or v_got3 is distinct from v_url2 then
    raise exception 'editor ok, no login: touched someone else (profile U=%, membro U em A=%)',
      v_got2, v_got3;
  end if;

  -- ------------------------------------------- editor ok, linked
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(v_ma_u, null::uuid, 'membros/' || v_ma_u || '/l.jpg');
  execute 'reset role';

  v_url_l := v_pub || 'membros/' || v_ma_u || '/l.jpg';
  select avatar_url into v_got from profiles where id = v_u;
  select avatar_url into v_got2 from membros where id = v_ma_u;
  select avatar_url into v_got3 from membros where id = v_mb_u;
  if v_got is distinct from v_url_l or v_got2 is distinct from v_url_l then
    raise exception 'editor ok, linked: profile=% membro=%, expected %', v_got, v_got2, v_url_l;
  end if;
  if v_got3 is distinct from v_url1 then
    raise exception 'editor ok, linked: synced into the conta U left (%)', v_got3;
  end if;

  -- ------------------------------- left-conta editor writes membro only
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(v_mb_u, null::uuid, 'membros/' || v_mb_u || '/b.jpg');
  execute 'reset role';

  v_url_b := v_pub || 'membros/' || v_mb_u || '/b.jpg';
  select avatar_url into v_got from membros where id = v_mb_u;
  select avatar_url into v_got2 from profiles where id = v_u;
  select avatar_url into v_got3 from membros where id = v_ma_u;
  if v_got is distinct from v_url_b then
    raise exception 'left-conta editor: membro=%, expected %', v_got, v_url_b;
  end if;
  if v_got2 is distinct from v_url_l or v_got3 is distinct from v_url_l then
    raise exception 'left-conta editor reached the global photo: profile=% membroA=%', v_got2, v_got3;
  end if;

  -- ------------------------------------------- agent denied
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ag, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null;
  begin
    perform set_member_photo(v_m, null::uuid, 'membros/' || v_m || '/y.jpg');
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  if v_err is distinct from 'Insufficient permissions' then
    raise exception 'agent denied: got %', coalesce(v_err, '<no error>');
  end if;

  -- ------------------------------- custom role with equipe:editar ok
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(v_m, null::uuid, 'membros/' || v_m || '/cr.jpg');
  execute 'reset role';
  v_url_cr := v_pub || 'membros/' || v_m || '/cr.jpg';
  select avatar_url into v_got from membros where id = v_m;
  if v_got is distinct from v_url_cr then
    raise exception 'custom role equipe:editar: membro=%, expected %', v_got, v_url_cr;
  end if;

  -- ------------------------------------------- other conta denied
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null;
  begin
    perform set_member_photo(v_m, null::uuid, 'membros/' || v_m || '/y.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'Insufficient permissions' then
    raise exception 'other conta denied: got %', coalesce(v_err, '<no error>');
  end if;
  -- nonexistent membro: same error, no existence oracle
  v_err := null;
  begin
    perform set_member_photo(-1::bigint, null::uuid, 'membros/-1/y.jpg');
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  if v_err is distinct from 'Insufficient permissions' then
    raise exception 'nonexistent membro: got %', coalesce(v_err, '<no error>');
  end if;

  -- ------------------------------------------- wrong prefix denied
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null;
  begin
    perform set_member_photo(null::bigint, v_u, 'membros/' || v_m || '/x.jpg');
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  if v_err is distinct from 'invalid_photo_path' then
    raise exception 'wrong prefix (self with membros/): got %', coalesce(v_err, '<no error>');
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null;
  begin
    perform set_member_photo(v_m, null::uuid, 'profiles/' || v_u || '/x.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'invalid_photo_path' then
    raise exception 'wrong prefix (editor with profiles/): got %', coalesce(v_err, '<no error>');
  end if;
  -- another membro's folder
  v_err := null;
  begin
    perform set_member_photo(v_m, null::uuid, 'membros/' || v_ma_u || '/l.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'invalid_photo_path' then
    raise exception 'wrong prefix (other membro folder): got %', coalesce(v_err, '<no error>');
  end if;
  -- nested segment / traversal
  v_err := null;
  begin
    perform set_member_photo(v_m, null::uuid, 'membros/' || v_m || '/../' || v_ma_u || '/l.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'invalid_photo_path' then
    raise exception 'wrong prefix (traversal): got %', coalesce(v_err, '<no error>');
  end if;

  -- ------------------------------------------- missing object denied
  v_err := null;
  begin
    perform set_member_photo(v_m, null::uuid, 'membros/' || v_m || '/missing.jpg');
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  if v_err is distinct from 'photo_not_found' then
    raise exception 'missing object denied: got %', coalesce(v_err, '<no error>');
  end if;

  -- ------------------------------- object of another owner denied
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null;
  begin
    perform set_member_photo(null::bigint, v_u, 'profiles/' || v_u || '/foreign.jpg');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is distinct from 'photo_not_found' then
    raise exception 'object of another owner denied: got %', coalesce(v_err, '<no error>');
  end if;
  -- same name, but in another bucket
  v_err := null;
  begin
    perform set_member_photo(null::bigint, v_u, 'profiles/' || v_u || '/otherbucket.jpg');
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  if v_err is distinct from 'photo_not_found' then
    raise exception 'object in another bucket denied: got %', coalesce(v_err, '<no error>');
  end if;

  -- ------------------------------------------- remove
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(v_m, null::uuid, null);
  execute 'reset role';
  select avatar_url into v_got from membros where id = v_m;
  if v_ret is not null or v_got is not null then
    raise exception 'remove (editor): returned % / stored %, expected NULL', v_ret, v_got;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_ret := set_member_photo(null::bigint, v_u, null);
  execute 'reset role';
  select avatar_url into v_got from profiles where id = v_u;
  select avatar_url into v_got2 from membros where id = v_ma_u;
  select avatar_url into v_got3 from membros where id = v_mb_u;
  if v_ret is not null or v_got is not null or v_got2 is not null then
    raise exception 'remove (self): returned %, profile=%, membroA=%, expected NULL', v_ret, v_got, v_got2;
  end if;
  if v_got3 is distinct from v_url_b then
    raise exception 'remove (self): reached the conta U left (%)', v_got3;
  end if;

  -- ------------------------------------------- insert forces null
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into membros (user_id, conta_id, nome, avatar_url)
    values (v_oa, v_ws_a, 'Evil', 'https://evil.example/a.jpg')
    returning avatar_url into v_got;
  execute 'reset role';
  if v_got is not null then
    raise exception 'insert forces null (authenticated): avatar_url=%', v_got;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
  insert into membros (user_id, conta_id, nome, avatar_url)
    values (v_oa, v_ws_a, 'SR vazio', '')
    returning avatar_url into v_got;
  insert into membros (user_id, conta_id, nome, avatar_url)
    values (v_oa, v_ws_a, 'SR url', 'https://cdn.example/sr.jpg')
    returning avatar_url into v_got2;
  execute 'reset role';
  if v_got is not null then
    raise exception 'insert forces null (service_role, empty string): avatar_url=%', v_got;
  end if;
  if v_got2 is distinct from 'https://cdn.example/sr.jpg' then
    raise exception 'insert (service_role, url) was not kept: %', v_got2;
  end if;

  -- ------------------------------------------- direct update denied
  if has_column_privilege('authenticated', 'public.membros', 'avatar_url', 'UPDATE') then
    raise exception 'direct update denied: authenticated still holds UPDATE on membros.avatar_url';
  end if;
  if not has_column_privilege('authenticated', 'public.membros', 'nome', 'UPDATE') then
    raise exception 'direct update: UPDATE on membros.nome was lost';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin
    update membros set avatar_url = 'x' where id = v_m;
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'direct update denied: expected 42501, got %', coalesce(v_state, '<no error>');
  end if;
  -- positive control: the rest of the column grant is intact
  update membros set nome = 'Sem login (editado)' where id = v_m;
  execute 'reset role';
  select nome into v_got from membros where id = v_m;
  if v_got is distinct from 'Sem login (editado)' then
    raise exception 'direct update: nome update did not apply (%)', v_got;
  end if;

  -- ------------------------------------------- link copies profile photo
  insert into membros (user_id, conta_id, nome, avatar_url)
    values (v_oa, v_ws_a, 'L1', 'https://cdn.example/l1.jpg') returning id into v_l1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l1, v_w);
  execute 'reset role';
  select avatar_url into v_got from membros where id = v_l1;
  select avatar_url into v_got2 from profiles where id = v_w;
  if v_got is distinct from v_pw or v_got2 is distinct from v_pw then
    raise exception 'link copies profile photo: membro=% profile=%, expected %', v_got, v_got2, v_pw;
  end if;

  -- ---------------- link raises membro photo when profile empty
  insert into membros (user_id, conta_id, nome, crm_user_id)
    values (v_ob, v_ws_b, 'X em B', v_x) returning id into v_xb;
  -- Only a URL set_member_photo could have produced for THIS row
  -- ({project_url}/storage/v1/object/public/avatars/membros/{id}/...) is
  -- raised; seeded as postgres, since a client can no longer write it.
  insert into membros (user_id, conta_id, nome)
    values (v_oa, v_ws_a, 'L2') returning id into v_l2;
  v_url_l2 := v_pub || 'membros/' || v_l2 || '/p.jpg';
  update membros set avatar_url = v_url_l2 where id = v_l2;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l2, v_x);
  execute 'reset role';
  select avatar_url into v_got from profiles where id = v_x;
  select avatar_url into v_got2 from membros where id = v_xb;
  select avatar_url into v_got3 from membros where id = v_l2;
  if v_got is distinct from v_url_l2
     or v_got2 is distinct from v_url_l2
     or v_got3 is distinct from v_url_l2 then
    raise exception 'link raises membro photo: profile=% other membro=% membro=%', v_got, v_got2, v_got3;
  end if;

  -- ---------------- legacy external url not raised on link
  -- A value written before this migration closed the UPDATE grant (any
  -- agent could set any host) stays on the row and never reaches a profile.
  insert into membros (user_id, conta_id, nome, avatar_url)
    values (v_oa, v_ws_a, 'L3 legado', 'https://evil.example/legacy.jpg') returning id into v_l3;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l3, v_q);
  execute 'reset role';
  select avatar_url into v_got from profiles where id = v_q;
  select avatar_url into v_got2 from membros where id = v_l3;
  if v_got is not null then
    raise exception 'legacy external url not raised on link: profile got %', v_got;
  end if;
  if v_got2 is distinct from 'https://evil.example/legacy.jpg' then
    raise exception 'legacy external url: the row''s own value changed to %', v_got2;
  end if;

  -- our own host, but another membro's folder: not raised either
  insert into membros (user_id, conta_id, nome)
    values (v_oa, v_ws_a, 'L3b outra pasta') returning id into v_l3b;
  update membros set avatar_url = v_pub || 'membros/' || v_l2 || '/p.jpg' where id = v_l3b;
  update membros set crm_user_id = v_r where id = v_l3b;
  select avatar_url into v_got from profiles where id = v_r;
  if v_got is not null then
    raise exception 'url from another membro''s folder raised on link: profile got %', v_got;
  end if;

  -- ---------------- link to non-member copies nothing
  -- Login not in the membro's conta (set_membro_crm_user does not check):
  -- the membro photo does not reach their profile, and their profile photo
  -- does not land in a conta they are not in.
  insert into membros (user_id, conta_id, nome)
    values (v_oa, v_ws_a, 'L4') returning id into v_l4;
  update membros set avatar_url = v_pub || 'membros/' || v_l4 || '/own.jpg' where id = v_l4;
  update membros set crm_user_id = v_z where id = v_l4;
  select avatar_url into v_got from profiles where id = v_z;
  select avatar_url into v_got2 from membros where id = v_l4;
  if v_got is not null then
    raise exception 'link to a non-member raised the membro photo to their profile (%)', v_got;
  end if;
  if v_got2 is distinct from v_pub || 'membros/' || v_l4 || '/own.jpg' then
    raise exception 'link to a non-member: first link changed the row''s own photo to %', v_got2;
  end if;

  insert into membros (user_id, conta_id, nome)
    values (v_oa, v_ws_a, 'L5') returning id into v_l5;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l5, v_zp);
  execute 'reset role';
  select avatar_url into v_got from membros where id = v_l5;
  select avatar_url into v_got2 from profiles where id = v_zp;
  if v_got is not null then
    raise exception 'link to non-member copies nothing: membro got the profile photo %', v_got;
  end if;
  if v_got2 is distinct from 'https://cdn.example/profile-zp.jpg' then
    raise exception 'link to non-member: their profile changed to %', v_got2;
  end if;

  -- relink to a non-member: NULL (neither the previous person's face nor
  -- the new person's photo)
  update membros set crm_user_id = v_z2 where id = v_l4;
  select avatar_url into v_got from membros where id = v_l4;
  if v_got is not null then
    raise exception 'relink to non-member: membro kept %', v_got;
  end if;

  -- ------------------------------------- relink does not raise old photo
  -- L1 carries W's copy; relinking it to Y (no photo) must not hand W's
  -- face to Y.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l1, v_y);
  execute 'reset role';
  select avatar_url into v_got from membros where id = v_l1;
  select avatar_url into v_got2 from profiles where id = v_y;
  select avatar_url into v_got3 from profiles where id = v_w;
  if v_got is not null or v_got2 is not null then
    raise exception 'relink does not raise old photo: membro=% new profile=%, expected NULL', v_got, v_got2;
  end if;
  if v_got3 is distinct from v_pw then
    raise exception 'relink changed the previous person''s profile (%)', v_got3;
  end if;

  -- relink to someone WITH a photo copies it
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l1, v_w);
  execute 'reset role';
  select avatar_url into v_got from membros where id = v_l1;
  if v_got is distinct from v_pw then
    raise exception 'relink to a person with a photo: membro=%, expected %', v_got, v_pw;
  end if;

  -- ------------------------------------------- unlink keeps copy
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l1, null);
  execute 'reset role';
  select avatar_url into v_got from membros where id = v_l1;
  if v_got is distinct from v_pw then
    raise exception 'unlink keeps copy: membro=%, expected %', v_got, v_pw;
  end if;

  -- ------------------------------------ same-value relink is a no-op
  update membros set avatar_url = 'https://cdn.example/manual.jpg' where id = v_l2;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_membro_crm_user(v_l2, v_x);
  execute 'reset role';
  select avatar_url into v_got from membros where id = v_l2;
  if v_got is distinct from 'https://cdn.example/manual.jpg' then
    raise exception 'same-value relink is a no-op: membro=%', v_got;
  end if;

  -- ------------------------------------------- storage policy
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name) values ('avatars', 'profiles/' || v_u || '/z.jpg');

  v_state := null;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'profiles/' || v_v || '/z.jpg');
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'storage: U wrote into V''s profiles/ folder (sqlstate %)', coalesce(v_state, '<none>');
  end if;

  v_state := null;
  begin
    insert into storage.objects (bucket_id, name) values ('post-media', 'profiles/' || v_u || '/z.jpg');
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'storage: profiles/ policy is not scoped to the avatars bucket (sqlstate %)', coalesce(v_state, '<none>');
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name) values ('avatars', 'membros/' || v_m || '/z.jpg');
  v_state := null;
  begin
    insert into storage.objects (bucket_id, name) values ('post-media', 'membros/' || v_m || '/z.jpg');
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'storage: membros/ policy is not scoped to the avatars bucket (sqlstate %)', coalesce(v_state, '<none>');
  end if;
  v_state := null;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'membros/abc/z.jpg');
  exception when others then v_state := sqlstate;
  end;
  if v_state is distinct from '42501' then
    raise exception 'storage: non-numeric membros/ folder was not cleanly denied (sqlstate %)', coalesce(v_state, '<none>');
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cr, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into storage.objects (bucket_id, name) values ('avatars', 'membros/' || v_m || '/z-cr.jpg');
  execute 'reset role';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ag, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'membros/' || v_m || '/z-ag.jpg');
  exception when others then v_state := sqlstate;
  end;
  execute 'reset role';
  if v_state is distinct from '42501' then
    raise exception 'storage: agent without equipe:editar wrote membros/ (sqlstate %)', coalesce(v_state, '<none>');
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ob, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin
    insert into storage.objects (bucket_id, name) values ('avatars', 'membros/' || v_m || '/z-ob.jpg');
  exception when others then v_state := sqlstate;
  end;
  execute 'reset role';
  if v_state is distinct from '42501' then
    raise exception 'storage: owner of B wrote into A''s membros/ folder (sqlstate %)', coalesce(v_state, '<none>');
  end if;

  -- ------------------------------------------- project_url missing
  delete from vault.secrets where name = 'project_url';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_err := null;
  begin
    perform set_member_photo(v_m, null::uuid, 'membros/' || v_m || '/y.jpg');
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  if v_err is distinct from 'project_url_missing' then
    raise exception 'project_url missing: got %', coalesce(v_err, '<no error>');
  end if;

  raise notice 'PASS 67_fotos_perfil_equipe';
end $$;
rollback;
