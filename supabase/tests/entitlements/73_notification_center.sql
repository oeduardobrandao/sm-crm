\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Central de Notificacoes, Fase 1 (migration 20260903000001):
--   (a) notification_inapp_prefs table + RLS
--   (b) post_approved added to notification_email_prefs' CHECK + the
--       claim_notification_emails type array
--   (c) P0: notifications SELECT/UPDATE now require a CURRENT workspace_members
--       row, not just user_id = auth.uid() -- a removed member kept reading
--       (and marking read) their old notifications forever.
--
-- Case numbering follows the task-2 brief 1:1.

-- =====================================================================
-- Case 1 (P0): a member removed from the workspace can no longer read or
-- update notifications that were addressed to them while they were a member.
-- notifications.id is uuid -- every assertion below is scoped to the specific
-- row's id, never to "the latest row" or an unscoped table-wide count.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws       uuid;
  v_a        uuid := gen_random_uuid();
  v_notif_id uuid;
  v_n        int;
  v_rows     int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_a);
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_a, 'agent');

  -- Seed the notification as the table owner (bypasses RLS), like the sibling
  -- suites do -- production writers are SECURITY DEFINER triggers/service role.
  insert into notifications (workspace_id, user_id, type, metadata, link, created_at)
    values (v_ws, v_a, 'post_message', '{}'::jsonb, '/x', now())
    returning id into v_notif_id;

  -- While still a member: full read + update access.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from notifications where id = v_notif_id;
  assert v_n = 1, format('current member must read own notification, saw %s', v_n);

  update notifications set read_at = now() where id = v_notif_id;
  get diagnostics v_rows = row_count;
  assert v_rows = 1,
    format('current member must be able to update own notification, affected %s', v_rows);

  reset role;

  -- Remove A from the workspace (service-role/postgres action, table owner --
  -- also fires trg_notify_member_removed, which is a no-op here since v_ws
  -- has no owner/admin to notify).
  delete from workspace_members where workspace_id = v_ws and user_id = v_a;

  -- As A again: user_id = auth.uid() STILL matches, but the workspace link is
  -- gone -- this is exactly the P0 the new policies close.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from notifications where id = v_notif_id;
  assert v_n = 0, format('P0: ex-membro ainda le notifications, saw %s', v_n);

  update notifications set read_at = null where id = v_notif_id;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('P0: ex-membro ainda atualiza notifications, affected %s', v_rows);

  reset role;
  raise notice 'PASS 73 Case 1 P0 ex-membro bloqueado apos remocao';
end $$;
rollback;

-- =====================================================================
-- Case 2: RLS of notification_inapp_prefs -- same shape as
-- 64_notification_email_prefs.sql Part A for the sibling table.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_n int;
begin
  insert into auth.users (id) values (v_a), (v_b);

  -- A: insert own pref, see exactly 1 row.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into notification_inapp_prefs (user_id, type, enabled) values (v_a, 'mention', false);
  select count(*) into v_n from notification_inapp_prefs;
  assert v_n = 1, format('A must see exactly 1 row (own pref), saw %s', v_n);

  -- B: sees 0 rows (A's row hidden by RLS).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select count(*) into v_n from notification_inapp_prefs;
  assert v_n = 0, format('B must see 0 rows, saw %s', v_n);

  -- B cannot insert a pref for A (WITH CHECK).
  begin
    insert into notification_inapp_prefs (user_id, type, enabled) values (v_a, 'post_message', false);
    assert false, 'B inserting a pref for A must be denied by RLS';
  exception when insufficient_privilege or check_violation then null;
  end;

  reset role;
  raise notice 'PASS 73 Case 2 notification_inapp_prefs RLS';
end $$;
rollback;

-- =====================================================================
-- Case 3: claim_notification_emails now includes post_approved (the 9th
-- eligible type, added by 20260903000001 on top of the 8 from
-- 20260813000005). A settled, unread, active-member post_approved
-- notification is claimed once, then never re-claimed.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws       uuid;
  v_a        uuid := gen_random_uuid();
  v_notif_id uuid;
  v_claimed  int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_a);
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_a, 'admin');

  insert into notifications (workspace_id, user_id, type, metadata, link, created_at)
    values (v_ws, v_a, 'post_approved', '{}'::jsonb, '/x', now() - interval '1 hour')
    returning id into v_notif_id;

  select count(*) into v_claimed
    from claim_notification_emails(now(), now() - interval '1 day', 10)
    where id = v_notif_id;
  assert v_claimed = 1,
    format('post_approved must be claimable by claim_notification_emails, got %s', v_claimed);

  -- Re-running must NOT re-claim: emailed_at is now set.
  select count(*) into v_claimed
    from claim_notification_emails(now(), now() - interval '1 day', 10)
    where id = v_notif_id;
  assert v_claimed = 0,
    format('re-running claim must not re-claim an already-emailed row, got %s', v_claimed);

  raise notice 'PASS 73 Case 3 claim_notification_emails includes post_approved';
end $$;
rollback;

-- =====================================================================
-- Case 4: channel independence -- notification_inapp_prefs and
-- notification_email_prefs are separate tables on purpose (see the
-- migration's header comment). Muting a type in-app must NOT silence its
-- email; opting out of the type's email must.
-- =====================================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws      uuid;
  v_a       uuid := gen_random_uuid();
  v_n1      uuid;  -- created after the in-app mute
  v_n2      uuid;  -- created after the email opt-out too
  v_claimed int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_a);
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_a, 'admin');

  -- Mute post_approved in-app only.
  insert into notification_inapp_prefs (user_id, type, enabled) values (v_a, 'post_approved', false);

  insert into notifications (workspace_id, user_id, type, metadata, link, created_at)
    values (v_ws, v_a, 'post_approved', '{}'::jsonb, '/x', now() - interval '1 hour')
    returning id into v_n1;

  select count(*) into v_claimed
    from claim_notification_emails(now(), now() - interval '1 day', 10)
    where id = v_n1;
  assert v_claimed = 1,
    format('in-app mute must NOT block the email claim (channel independence), got %s', v_claimed);

  -- Now also opt out of the email for the same type.
  insert into notification_email_prefs (user_id, type, enabled) values (v_a, 'post_approved', false);

  insert into notifications (workspace_id, user_id, type, metadata, link, created_at)
    values (v_ws, v_a, 'post_approved', '{}'::jsonb, '/x', now() - interval '1 hour')
    returning id into v_n2;

  select count(*) into v_claimed
    from claim_notification_emails(now(), now() - interval '1 day', 10)
    where id = v_n2;
  assert v_claimed = 0,
    format('email opt-out must block the claim, got %s', v_claimed);

  raise notice 'PASS 73 Case 4 inapp/email prefs are independent';
end $$;
rollback;

-- =====================================================================
-- Case 5: claim_notification_emails ACL -- service_role-only. Same
-- has_function_privilege triple technique as 07_workspace_usage.sql,
-- 70_workflow_posts_avulsos.sql and 71_board_ordem.sql. Read-only checks
-- against pg_proc, so no transaction/rollback wrapper needed.
-- =====================================================================
do $$
begin
  assert has_function_privilege('anon', 'public.claim_notification_emails(timestamptz, timestamptz, int)', 'EXECUTE') = false,
    'anon must NOT execute claim_notification_emails';
  assert has_function_privilege('authenticated', 'public.claim_notification_emails(timestamptz, timestamptz, int)', 'EXECUTE') = false,
    'authenticated must NOT execute claim_notification_emails';
  assert has_function_privilege('service_role', 'public.claim_notification_emails(timestamptz, timestamptz, int)', 'EXECUTE') = true,
    'service_role must be able to execute claim_notification_emails';

  raise notice 'PASS 73 Case 5 claim_notification_emails ACL';
end $$;
