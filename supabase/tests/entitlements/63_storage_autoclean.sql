\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Auto-limpeza de armazenamento (spec 2026-08-10). Pins the three surfaces:
--   1. storage_autoclean_candidates -- the shared predicate (preview == run).
--   2. storage_autoclean_run -- skips, batch cap, deletes, accounting, trail.
--   3. the owner-only column guard on workspaces.
--
-- The candidate cases are the point of the suite: each OUT case is a file that
-- LOOKS deletable but must survive (shared with a draft, idea attachment, hub
-- logo, corrupt published_at, cross-tenant link, plain Arquivos file).

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws       uuid;                       -- workspace under test (free plan, 100MB)
  v_ws_b     uuid;                       -- second tenant
  v_ws_unlim uuid;                       -- unlimited-storage plan
  v_owner    uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_agent    uuid := gen_random_uuid();
  v_stale    uuid := gen_random_uuid();  -- membership deleted, pointer left stale
  v_cli      bigint;
  v_cli_b    bigint;
  v_wf       bigint;
  v_wf_b     bigint;
  p_pub_old    bigint;  -- postado 40 days ago
  p_pub_recent bigint;  -- postado 5 days ago
  p_draft      bigint;  -- rascunho
  p_pub_null   bigint;  -- postado, published_at forced NULL (corrupt/legacy)
  p_b          bigint;  -- postado 40 days ago, tenant B
  f1 bigint; f2 bigint; f3 bigint; f4 bigint; f5 bigint;
  f6 bigint; f7 bigint; f8 bigint; f9 bigint; f10 bigint;
  v_ideia    uuid;
  v_ids      bigint[];
  v_res      jsonb;
  v_n        int;
  v_bytes    bigint;
  v_used0    bigint;
  v_raised   boolean;
begin
  -- ================= fixture =================
  -- 'max' (unlimited seats) + a 100MB storage override: the free plan's
  -- max_team_members=1 would block the 4-member fixture, and the threshold
  -- cases need a finite, known quota.
  v_ws       := et_make_workspace('max', '{"storage_quota_bytes": 104857600}'::jsonb);
  v_ws_b     := et_make_workspace('max');
  -- No seeded plan has NULL storage_quota_bytes; the no_quota case needs one.
  insert into plans (id, name) values ('et-unlim-63', 'ET unlimited');
  v_ws_unlim := et_make_workspace('et-unlim-63');

  insert into auth.users (id) values (v_owner), (v_admin), (v_agent), (v_stale);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner, v_ws, 'owner'),
    (v_admin, v_ws, 'admin'),
    (v_agent, v_ws, 'agent'),
    (v_stale, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
   where id in (v_owner, v_admin, v_agent, v_stale);
  -- Stale pointer: membership gone, active_workspace_id still points at v_ws.
  delete from workspace_members where user_id = v_stale;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'ET Cliente', 'ET', '#000000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws_b, 'ET Cliente B', 'EB', '#000000') returning id into v_cli_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo)
    values (v_owner, v_ws, v_cli, 'ET WF') returning id into v_wf;
  insert into workflows (user_id, conta_id, cliente_id, titulo)
    values (v_owner, v_ws_b, v_cli_b, 'ET WF B') returning id into v_wf_b;

  insert into workflow_posts (workflow_id, conta_id, titulo, status, published_at)
    values (v_wf, v_ws, 'pub old', 'postado', now() - interval '40 days')
    returning id into p_pub_old;
  insert into workflow_posts (workflow_id, conta_id, titulo, status, published_at)
    values (v_wf, v_ws, 'pub recent', 'postado', now() - interval '5 days')
    returning id into p_pub_recent;
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (v_wf, v_ws, 'draft', 'rascunho') returning id into p_draft;
  -- postado + published_at NULL is impossible through DML (the BEFORE trigger
  -- stamps it); disable the trigger to build the corrupt/legacy shape the
  -- predicate's IS NULL branch defends against.
  alter table workflow_posts disable trigger workflow_posts_set_published_at;
  insert into workflow_posts (workflow_id, conta_id, titulo, status)
    values (v_wf, v_ws, 'pub null', 'postado') returning id into p_pub_null;
  alter table workflow_posts enable trigger workflow_posts_set_published_at;
  insert into workflow_posts (workflow_id, conta_id, titulo, status, published_at)
    values (v_wf_b, v_ws_b, 'pub B', 'postado', now() - interval '40 days')
    returning id into p_b;

  -- Files (all tenant A; ids ascend in insertion order).
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f1.png', 'f1', 'image', 'image/png', 1000)
    returning id into f1;   -- linked only to p_pub_old            => IN
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f2.png', 'f2', 'image', 'image/png', 2000)
    returning id into f2;   -- shared with p_draft                 => OUT
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f3.png', 'f3', 'image', 'image/png', 4000)
    returning id into f3;   -- published 5d ago: OUT at 30d, IN at 0d
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f4.png', 'f4', 'image', 'image/png', 8000)
    returning id into f4;   -- also an idea attachment             => OUT
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f5.png', 'f5', 'image', 'image/png', 16000)
    returning id into f5;   -- plain Arquivos file, no links       => OUT
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f6.png', 'f6', 'image', 'image/png', 32000)
    returning id into f6;   -- linked to the corrupt postado       => OUT
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f7.png', 'f7', 'image', 'image/png', 64000)
    returning id into f7;   -- hub_brand logo                      => OUT
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f8.png', 'f8', 'image', 'image/png', 128000)
    returning id into f8;   -- inflated reference_count            => IN anyway
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f9.png', 'f9', 'image', 'image/png', 256000)
    returning id into f9;   -- malformed cross-tenant LINK         => OUT
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes)
    values (v_ws, 'contas/'||v_ws||'/files/f10.png', 'f10', 'image', 'image/png', 512000)
    returning id into f10;  -- linked to a tenant-B POST           => OUT

  insert into post_file_links (post_id, file_id, conta_id) values
    (p_pub_old,    f1, v_ws),
    (p_pub_old,    f2, v_ws), (p_draft, f2, v_ws),
    (p_pub_recent, f3, v_ws),
    (p_pub_old,    f4, v_ws),
    (p_pub_null,   f6, v_ws),
    (p_pub_old,    f7, v_ws),
    (p_pub_old,    f8, v_ws),
    (p_pub_old,    f9, v_ws_b),   -- malformed: link labeled tenant B
    (p_b,          f10, v_ws);    -- post belongs to tenant B

  insert into ideias (workspace_id, cliente_id, titulo, descricao)
    values (v_ws, v_cli, 'ET ideia', 'x') returning id into v_ideia;
  insert into ideia_files (ideia_id, file_id, conta_id) values (v_ideia, f4, v_ws);

  insert into hub_brand (cliente_id, logo_file_id) values (v_cli, f7);

  -- Estúdio-drop shape: reference_count permanently inflated. The predicate
  -- must count real link rows, not this column.
  update files set reference_count = 99 where id = f8;

  -- ================= 1. candidate predicate =================
  select array_agg(c.file_id order by c.file_id), coalesce(sum(c.size_bytes), 0)
    into v_ids, v_bytes
    from storage_autoclean_candidates(v_ws, now() - interval '30 days') c;
  assert v_ids = array[f1, f8],
    format('candidates at 30d must be exactly {f1,f8}, got %s', v_ids);
  assert v_bytes = 129000, format('candidate bytes must be 129000, got %s', v_bytes);

  -- delay 0 ("imediatamente"): the 5-day-old publish now qualifies too.
  select array_agg(c.file_id order by c.file_id)
    into v_ids
    from storage_autoclean_candidates(v_ws, now()) c;
  assert v_ids = array[f1, f3, f8],
    format('candidates at 0d must be exactly {f1,f3,f8}, got %s', v_ids);

  -- Tenant B sees nothing: its only post's file belongs to tenant A.
  select count(*) into v_n
    from storage_autoclean_candidates(v_ws_b, now()) c;
  assert v_n = 0, format('tenant B must have 0 candidates, got %s', v_n);

  -- ================= 2. preview (impersonated) =================
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := storage_autoclean_preview(30);
  reset role;
  assert (v_res->>'files_count')::int = 2 and (v_res->>'bytes_total')::bigint = 129000,
    format('owner preview(30) must see {2, 129000}, got %s', v_res);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := storage_autoclean_preview(0);
  reset role;
  assert (v_res->>'files_count')::int = 3,
    format('owner preview(0) must see 3 files, got %s', v_res);

  -- Stale pointer (membership row deleted): the recheck must return {}.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stale, 'role', 'authenticated')::text, true);
  v_res := storage_autoclean_preview(30);
  reset role;
  assert v_res = '{}'::jsonb,
    format('stale-pointer user must get an empty preview, got %s', v_res);

  -- ================= 3. executor =================
  -- Clear the impersonated JWT claim: set_config(..., is_local=true) outlives
  -- `reset role` (it is transaction-scoped), and a lingering sub would make
  -- auth.uid() non-NULL inside the guard trigger for the "as postgres" writes.
  perform set_config('request.jwt.claims', '', true);

  -- Disabled policy: skip, touch nothing.
  v_res := storage_autoclean_run(v_ws);
  assert v_res->>'skipped' = 'disabled', format('expected skipped=disabled, got %s', v_res);

  -- Enable as postgres (auth.uid() IS NULL passes the guard).
  update workspaces
     set storage_autoclean_enabled = true,
         storage_autoclean_delay_days = 30,
         storage_autoclean_threshold_pct = 75,
         storage_used_bytes = 10 * 1024 * 1024   -- 10MB of the free 100MB
   where id = v_ws;

  -- Below threshold: skip.
  v_res := storage_autoclean_run(v_ws);
  assert v_res->>'skipped' = 'below_threshold',
    format('expected skipped=below_threshold, got %s', v_res);

  -- Unlimited quota + threshold: percentage undefined, fail-safe skip.
  update workspaces
     set storage_autoclean_enabled = true, storage_autoclean_threshold_pct = 50
   where id = v_ws_unlim;
  v_res := storage_autoclean_run(v_ws_unlim);
  assert v_res->>'skipped' = 'no_quota', format('expected skipped=no_quota, got %s', v_res);

  -- Over threshold: run for real, capped at 1 file -> deletes only f1 (lowest id).
  update workspaces set storage_used_bytes = 80 * 1024 * 1024 where id = v_ws;
  select storage_used_bytes into v_used0 from workspaces where id = v_ws;
  v_res := storage_autoclean_run(v_ws, 1);
  assert (v_res->>'files_deleted')::int = 1 and (v_res->>'bytes_freed')::bigint = 1000,
    format('capped run must delete exactly f1 (1000 bytes), got %s', v_res);
  assert not exists (select 1 from files where id = f1), 'f1 must be gone';
  assert exists (select 1 from files where id = f8), 'f8 must survive the capped run';
  assert exists (select 1 from file_deletions where r2_key like '%/f1.png'),
    'f1 r2_key must be queued for R2 reclamation';
  select storage_used_bytes into v_bytes from workspaces where id = v_ws;
  assert v_bytes = v_used0 - 1000,
    format('storage_used_bytes must drop by 1000 (trigger), got %s -> %s', v_used0, v_bytes);
  assert (select media_autocleaned_at from workflow_posts where id = p_pub_old) is not null,
    'p_pub_old must be stamped media_autocleaned_at';
  assert (select media_autocleaned_at from workflow_posts where id = p_draft) is null,
    'p_draft must NOT be stamped';
  assert (select storage_autoclean_last_files from workspaces where id = v_ws) = 1,
    'last_files must record the capped run';
  select count(*) into v_n from notifications
   where workspace_id = v_ws and type = 'storage_autoclean_report';
  assert v_n = 2, format('owner+admin must be notified (2 rows), got %s', v_n);
  assert not exists (
    select 1 from notifications
     where workspace_id = v_ws and type = 'storage_autoclean_report' and user_id = v_agent),
    'agents must not receive the report';
  select count(*) into v_n from audit_log
   where conta_id = v_ws and action = 'storage_autoclean'
     and (metadata->>'bytes_freed')::bigint = 1000;
  assert v_n = 1, format('capped run must write 1 audit_log row, got %s', v_n);

  -- Second, uncapped run drains the remaining candidate (f8) and nothing else.
  v_res := storage_autoclean_run(v_ws);
  assert (v_res->>'files_deleted')::int = 1 and (v_res->>'bytes_freed')::bigint = 128000,
    format('second run must delete exactly f8 (128000 bytes), got %s', v_res);
  assert not exists (select 1 from files where id = f8), 'f8 must be gone';
  select count(*) into v_n from files
   where id in (f2, f3, f4, f5, f6, f7, f9, f10);
  assert v_n = 8, format('all 8 protected files must survive, got %s', v_n);

  -- Third run: nothing left, no notification/audit spam.
  select count(*) into v_n from notifications
   where workspace_id = v_ws and type = 'storage_autoclean_report';
  v_res := storage_autoclean_run(v_ws);
  assert (v_res->>'files_deleted')::int = 0,
    format('third run must delete nothing, got %s', v_res);
  select count(*) - v_n into v_n from notifications
   where workspace_id = v_ws and type = 'storage_autoclean_report';
  assert v_n = 0, 'a zero-file run must not notify';

  -- ================= 4. owner-only column guard =================
  -- Admin flips a policy column: P0001. (RLS lets admins UPDATE workspaces;
  -- the guard trigger is what narrows these three columns to owners.)
  v_raised := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    update workspaces set storage_autoclean_enabled = false where id = v_ws;
    reset role;
  exception when sqlstate 'P0001' then
    reset role;
    assert sqlerrm like '%only_owner_can_change_storage_autoclean%',
      format('wrong guard message: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'admin change of storage_autoclean_enabled must raise P0001';

  -- Admin touching an UNRELATED column still works (guard must not over-block).
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  update workspaces set name = 'ET renamed by admin' where id = v_ws;
  reset role;
  assert (select name from workspaces where id = v_ws) = 'ET renamed by admin',
    'admin must still update unrelated workspaces columns';

  -- Owner flips policy columns: allowed.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  update workspaces
     set storage_autoclean_delay_days = 7, storage_autoclean_threshold_pct = null
   where id = v_ws;
  reset role;
  assert (select storage_autoclean_delay_days from workspaces where id = v_ws) = 7,
    'owner must be able to change the policy';

  raise notice 'PASS 63_storage_autoclean: predicate in/out, preview parity + stale-pointer '
               'denial, skips (disabled/below_threshold/no_quota), capped + full runs, '
               'accounting + audit + notifications, owner-only guard';
end $$;
rollback;
