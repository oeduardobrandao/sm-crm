\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Contatos das automações (migrations 20261009000001/2, spec
-- docs/superpowers/specs/2026-10-07-automation-contacts-design.md).
-- Sends are inserted through claim_automation_send (the only real insert
-- path) as the table owner, standing in for the service-role worker.

-- Shared fixture: one workspace, flag on, two clients, two automations on
-- client A, one on client B.
create or replace function et_iac_fixture(
  out ws uuid, out owner uuid, out cli_a bigint, out cli_b bigint,
  out auto_a1 uuid, out auto_a2 uuid, out auto_b1 uuid)
language plpgsql as $$
begin
  ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (ws, '{"feature_instagram_automation": true}'::jsonb);
  owner := gen_random_uuid();
  insert into auth.users (id) values (owner);
  insert into workspace_members (user_id, workspace_id, role) values (owner, ws, 'owner');
  update profiles set conta_id = ws, active_workspace_id = ws, role = 'owner' where id = owner;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (owner, ws, 'A', 'A', '#000') returning id into cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (owner, ws, 'B', 'B', '#000') returning id into cli_b;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (ws, cli_a, 'A1', array['x'], 'm') returning id into auto_a1;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (ws, cli_a, 'A2', array['x'], 'm') returning id into auto_a2;
  insert into instagram_comment_automations (conta_id, client_id, name, keywords, dm_message)
    values (ws, cli_b, 'B1', array['x'], 'm') returning id into auto_b1;
end $$;

-- Claims a send (cooldown 0 so repeat commenters are 'claimed', not skipped).
create or replace function et_iac_send(
  p_comment text, p_auto uuid, p_ws uuid, p_commenter text, p_username text,
  p_text text, p_at timestamptz)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  select send_id into v_id from claim_automation_send(
    p_comment, p_auto, p_ws, 'media-1', p_commenter, p_username, p_text, p_at, 0);
  return v_id;
end $$;

-- 1. Insert → contact + link; same person on a second automation of the same
--    client → one contact, two links, count 2; same person on client B →
--    separate contact. Rows without commenter_id are ignored.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_n int; v_c record;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'quero', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u1', 'ana', 'eu tb', '2026-10-02 10:00Z');
  perform et_iac_send('c3', f.auto_b1, f.ws, 'u1', 'ana', 'oi', '2026-10-03 10:00Z');
  perform et_iac_send('c4', f.auto_a1, f.ws, null, null, 'anon', '2026-10-03 11:00Z');
  -- cooldown-skipped repeat (24h cooldown, u1 already has an in-window send on A1):
  -- status 'skipped', still an interaction
  perform claim_automation_send('c5', f.auto_a1, f.ws, 'media-1', 'u1', 'ana', 'de novo', '2026-10-02 12:00Z', 24);

  select count(*) into v_n from instagram_automation_contacts where conta_id = f.ws;
  assert v_n = 2, format('expected 2 contacts (A and B), got %s', v_n);

  select * into v_c from instagram_automation_contacts where client_id = f.cli_a and commenter_id = 'u1';
  assert v_c.interactions_count = 3, format('count %s (2 claimed + 1 cooldown-skipped)', v_c.interactions_count);
  assert v_c.first_interaction_at = '2026-10-01 10:00Z' and v_c.last_interaction_at = '2026-10-02 12:00Z', 'first/last';
  assert v_c.last_comment_text = 'de novo' and v_c.last_automation_name = 'A1', 'latest fields';
  assert (select status from instagram_automation_sends where comment_id = 'c5') = 'skipped', 'c5 must be cooldown-skipped';
  assert v_c.reached = false, 'not reached before any DM';

  select count(*) into v_n from instagram_automation_contact_automations where contact_id = v_c.id;
  assert v_n = 2, format('expected 2 links, got %s', v_n);
  raise notice 'PASS 99 iac 1 insert/dedupe/per-client';
end $$;
rollback;

-- 2. Out-of-order insert keeps the newer comment's fields; an older comment
--    fills a NULL username. Duplicate comment_id never double counts.
begin;
do $$
declare f record; v_c record;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', null, 'novo', '2026-10-05 10:00Z');
  perform et_iac_send('c2', f.auto_a1, f.ws, 'u1', 'ana', 'velho', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a1, f.ws, 'u1', 'ana', 'velho', '2026-10-01 10:00Z'); -- redelivery
  select * into v_c from instagram_automation_contacts where client_id = f.cli_a and commenter_id = 'u1';
  assert v_c.last_comment_text = 'novo', format('latest text %s', v_c.last_comment_text);
  assert v_c.commenter_username = 'ana', format('username %s', v_c.commenter_username);
  assert v_c.interactions_count = 2, format('dup counted: %s', v_c.interactions_count);
  raise notice 'PASS 99 iac 2 out-of-order + idempotent';
end $$;
rollback;

-- 3. mark_automation_dm_sent → reached on contact and link; a later failed
--    send does not flip it back; a public-reply-only update does not set it.
begin;
do $$
declare f record; v_s1 uuid; v_s2 uuid; v_s3 uuid; v_r boolean; v_lr boolean;
begin
  select * into f from et_iac_fixture();
  v_s1 := et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  v_s3 := et_iac_send('c3', f.auto_a1, f.ws, 'u2', 'bia', 'b', '2026-10-01 10:00Z');
  update instagram_automation_sends set public_reply_status = 'sent' where id = v_s3;
  select reached into v_r from instagram_automation_contacts where commenter_id = 'u2';
  assert v_r = false, 'public reply alone must not set reached';

  perform mark_automation_dm_sent(v_s1, 'text');
  select reached into v_r from instagram_automation_contacts where commenter_id = 'u1';
  select l.reached into v_lr from instagram_automation_contact_automations l
    join instagram_automation_contacts c on c.id = l.contact_id where c.commenter_id = 'u1';
  assert v_r and v_lr, 'reached on contact and link';

  v_s2 := et_iac_send('c2', f.auto_a1, f.ws, 'u1', 'ana', 'de novo', '2026-10-02 10:00Z');
  update instagram_automation_sends set status = 'failed', dm_status = 'failed', error_code = 'dm_permanent' where id = v_s2;
  select reached into v_r from instagram_automation_contacts where commenter_id = 'u1';
  assert v_r, 'a later failure must not unset reached';
  raise notice 'PASS 99 iac 3 reached';
end $$;
rollback;

-- 4. Delete automation → contact and link survive. Rename (as authenticated)
--    → snapshots updated. Delete client (with automations) → contacts gone,
--    and the delete itself succeeds.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_n int; v_name text;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u2', 'bia', 'b', '2026-10-01 10:00Z');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);
  update instagram_comment_automations set name = 'A1 renomeada' where id = f.auto_a1;
  delete from instagram_comment_automations where id = f.auto_a2;
  reset role;

  select last_automation_name into v_name from instagram_automation_contacts where commenter_id = 'u1';
  assert v_name = 'A1 renomeada', format('contact snapshot %s', v_name);
  select automation_name into v_name from instagram_automation_contact_automations where automation_id = f.auto_a1;
  assert v_name = 'A1 renomeada', format('link snapshot %s', v_name);

  select count(*) into v_n from instagram_automation_contact_automations where automation_id = f.auto_a2;
  assert v_n = 1, 'link of the deleted automation must survive';
  select count(*) into v_n from instagram_automation_contacts where commenter_id = 'u2';
  assert v_n = 1, 'contact of the deleted automation must survive';

  delete from clientes where id = f.cli_a;
  select count(*) into v_n from instagram_automation_contacts where client_id = f.cli_a;
  assert v_n = 0, 'client delete cascades contacts';
  select count(*) into v_n from instagram_automation_contact_automations l
    where l.automation_id in (f.auto_a1, f.auto_a2);
  assert v_n = 0, 'client delete cascades links';
  raise notice 'PASS 99 iac 4 retention + rename + client cascade';
end $$;
rollback;

-- 5. Swallowed-error recovery: with the insert trigger disabled, sends land
--    with no contact; deleting the automation snapshots them first.
begin;
do $$
declare f record; v_n int;
begin
  select * into f from et_iac_fixture();
  alter table instagram_automation_sends disable trigger ias_z1_sync_contact_insert;
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  alter table instagram_automation_sends enable trigger ias_z1_sync_contact_insert;
  select count(*) into v_n from instagram_automation_contacts where conta_id = f.ws;
  assert v_n = 0, 'precondition: trigger was off';
  delete from instagram_comment_automations where id = f.auto_a1;
  select count(*) into v_n from instagram_automation_contacts where commenter_id = 'u1';
  assert v_n = 1, 'BEFORE DELETE snapshot must create the contact';
  raise notice 'PASS 99 iac 5 snapshot before delete';
end $$;
rollback;

-- 6. Rebuild reproduces trigger state and is non-destructive.
begin;
do $$
declare f record; v_before jsonb; v_after jsonb; v_n int;
begin
  select * into f from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u1', null, 'b', '2026-10-02 10:00Z');
  perform et_iac_send('c3', f.auto_a1, f.ws, 'u2', 'bia', 'c', '2026-10-03 10:00Z');
  select jsonb_agg(to_jsonb(c) - 'updated_at' - 'created_at' order by commenter_id) into v_before
    from instagram_automation_contacts c where conta_id = f.ws;
  perform rebuild_instagram_automation_contacts(f.ws);
  select jsonb_agg(to_jsonb(c) - 'updated_at' - 'created_at' order by commenter_id) into v_after
    from instagram_automation_contacts c where conta_id = f.ws;
  assert v_before = v_after, format('rebuild drift: %s vs %s', v_before, v_after);

  delete from instagram_comment_automations where id = f.auto_a2;
  perform rebuild_instagram_automation_contacts(f.ws);
  select count(*) into v_n from instagram_automation_contact_automations where automation_id = f.auto_a2;
  assert v_n = 1, 'rebuild must keep links of deleted automations';
  select interactions_count into v_n from instagram_automation_contacts where commenter_id = 'u1';
  assert v_n = 2, format('rebuild must keep the deleted automation''s interactions, got %s', v_n);
  raise notice 'PASS 99 iac 6 rebuild';
end $$;
rollback;

-- 7. Security: other workspace sees nothing; authenticated cannot write;
--    composite FK rejects a cross-workspace link; authenticated cannot run
--    rebuild. The two new tables are EXCLUDED from the parity helper: their
--    grants are what this section asserts.
begin;
select et_grant_hosted_parity(array['instagram_automation_contacts', 'instagram_automation_contact_automations']);
do $$
declare f record; g record; v_n int; v_rejected boolean; v_contact uuid;
begin
  select * into f from et_iac_fixture();
  select * into g from et_iac_fixture();
  perform et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  select id into v_contact from instagram_automation_contacts where conta_id = f.ws;

  v_rejected := false;
  begin
    insert into instagram_automation_contact_automations
      (contact_id, conta_id, automation_id, automation_name, first_interaction_at, last_interaction_at)
      values (v_contact, g.ws, g.auto_a1, 'x', now(), now());
  exception when foreign_key_violation then v_rejected := true;
  end;
  assert v_rejected, 'composite FK must reject a cross-workspace link';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', g.owner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from instagram_automation_contacts;
  assert v_n = 0, format('other workspace saw %s contacts', v_n);

  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);
  select count(*) into v_n from instagram_automation_contacts;
  assert v_n = 1, format('owner should see 1, saw %s', v_n);

  v_rejected := false;
  begin
    update instagram_automation_contacts set reached = true;
    get diagnostics v_n = row_count;
    v_rejected := v_n = 0;
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not update contacts';

  v_rejected := false;
  begin
    delete from instagram_automation_contacts;
    get diagnostics v_n = row_count;
    v_rejected := v_n = 0;
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not delete contacts';

  v_rejected := false;
  begin
    perform rebuild_instagram_automation_contacts(f.ws);
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not execute rebuild';
  reset role;

  -- Regression: workspace B reuses workspace A's DELETED automation uuid and
  -- renames it; A's surviving link rows must keep their name.
  delete from instagram_comment_automations where id = f.auto_a1;
  insert into instagram_comment_automations (id, conta_id, client_id, name, keywords, dm_message)
    values (f.auto_a1, g.ws, g.cli_a, 'B reusou', array['x'], 'm');
  update instagram_comment_automations set name = 'B renomeou' where id = f.auto_a1;
  assert (select automation_name from instagram_automation_contact_automations
           where conta_id = f.ws and automation_id = f.auto_a1) = 'A1',
    'rename in another workspace must not touch this workspace''s link rows';
  raise notice 'PASS 99 iac 7 security';
end $$;
rollback;

-- 8. list RPC: filters, link-level values, escaping, clamp, keyset, empty.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_s uuid; v_n int; r record; v_last record;
begin
  select * into f from et_iac_fixture();
  v_s := et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana_1', 'a1 text', '2026-10-01 10:00Z');
  perform mark_automation_dm_sent(v_s, 'text');
  perform et_iac_send('c2', f.auto_a2, f.ws, 'u1', 'ana_1', 'a2 text', '2026-10-05 10:00Z');
  perform et_iac_send('c3', f.auto_a1, f.ws, 'u2', 'bia%x', 'b', '2026-10-03 10:00Z');
  perform et_iac_send('c4', f.auto_b1, f.ws, 'u3', 'caio', 'c', '2026-10-04 10:00Z');
  -- now() is constant inside the transaction: stagger created_at so the keyset
  -- leg on created_at is actually exercised.
  update instagram_automation_contacts
     set created_at = created_at - make_interval(mins => (case commenter_id when 'u1' then 2 when 'u2' then 1 else 0 end))
   where conta_id = f.ws;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);

  select count(*) into v_n from list_instagram_automation_contacts();
  assert v_n = 1, format('default reached_only: 1 row, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false);
  assert v_n = 3, format('all: 3, got %s', v_n);

  select * into r from list_instagram_automation_contacts(p_reached_only => false) limit 1;
  assert r.total_count = 3 and r.commenter_username = 'ana_1', 'order by last_interaction desc + total';

  select * into r from list_instagram_automation_contacts(
    p_automation_id => f.auto_a1, p_reached_only => false) where id = (
      select id from instagram_automation_contacts where commenter_id = 'u1');
  assert r.last_comment_text = 'a1 text' and r.last_interaction_at = '2026-10-01 10:00Z'
    and r.automation_name = 'A1' and r.interactions_count = 1, 'link-level values when filtered';

  select count(*) into v_n from list_instagram_automation_contacts(p_client_id => f.cli_b, p_reached_only => false);
  assert v_n = 1, 'client filter';

  select count(*) into v_n from list_instagram_automation_contacts(
    p_reached_only => false, p_from => '2026-10-03 00:00Z', p_to => '2026-10-04 00:00Z');
  assert v_n = 1, format('[from,to) range, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_search => '_');
  assert v_n = 1, format('_ must be literal, got %s', v_n);
  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_search => '%');
  assert v_n = 1, format('%% must be literal, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_limit => 100000);
  assert v_n = 3, 'clamp does not drop rows below 500';
  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false, p_limit => 0);
  assert v_n = 1, 'limit clamps up to 1';

  -- keyset: first page of 2, then the rest after the cursor
  select * into v_last from (
    select * from list_instagram_automation_contacts(p_reached_only => false, p_export => true, p_limit => 2)
  ) x order by created_at desc, id desc limit 1;
  select count(*) into v_n from list_instagram_automation_contacts(
    p_reached_only => false, p_export => true, p_limit => 2,
    p_cursor_at => v_last.created_at, p_cursor_id => v_last.id);
  assert v_n = 1, format('keyset remainder 1, got %s', v_n);

  select count(*) into v_n from list_instagram_automation_contacts(p_search => 'ninguem');
  assert v_n = 0, 'empty result returns no rows';

  reset role;
  delete from instagram_comment_automations where id = f.auto_a2;
  set local role authenticated;
  select automation_deleted into r from list_instagram_automation_contacts(
    p_automation_id => f.auto_a2, p_reached_only => false);
  assert r.automation_deleted, 'deleted automation flagged';
  reset role;
  raise notice 'PASS 99 iac 8 list rpc';
end $$;
rollback;

-- 9. counts RPC + grants + custom role without automacoes 'ver'.
begin;
select et_grant_hosted_parity();
do $$
declare f record; v_s uuid; r record; v_rejected boolean; v_n int;
  v_none uuid := gen_random_uuid(); v_role uuid;
begin
  select * into f from et_iac_fixture();
  insert into auth.users (id) values (v_none);
  insert into workspace_roles (conta_id, nome, permissions)
    values (f.ws, 'IAC sem automacoes', '{"automacoes":"none"}'::jsonb) returning id into v_role;
  insert into workspace_members (user_id, workspace_id, role, role_id)
    values (v_none, f.ws, 'agent', v_role);
  update profiles set conta_id = f.ws, active_workspace_id = f.ws where id = v_none;
  v_s := et_iac_send('c1', f.auto_a1, f.ws, 'u1', 'ana', 'a', '2026-10-01 10:00Z');
  perform mark_automation_dm_sent(v_s, 'text');
  perform et_iac_send('c2', f.auto_a1, f.ws, 'u2', 'bia', 'b', '2026-10-02 10:00Z');

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', f.owner, 'role', 'authenticated')::text, true);
  select * into r from instagram_automation_contact_counts() where automation_id = f.auto_a1;
  assert r.reached_count = 1 and r.total_count = 2 and r.client_id = f.cli_a
    and r.automation_name = 'A1' and not r.automation_deleted, format('counts %s', row_to_json(r));
  reset role;

  set local role anon;
  v_rejected := false;
  begin
    perform * from list_instagram_automation_contacts();
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'anon must not execute list';
  v_rejected := false;
  begin
    perform * from instagram_automation_contact_counts();
  exception when insufficient_privilege then v_rejected := true;
  end;
  assert v_rejected, 'anon must not execute counts';
  reset role;

  -- Custom role with automacoes = 'none' sees nothing (table nor RPC).
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_none, 'role', 'authenticated')::text, true);
  select count(*) into v_n from instagram_automation_contacts;
  assert v_n = 0, format('no-permission role saw %s contacts', v_n);
  select count(*) into v_n from list_instagram_automation_contacts(p_reached_only => false);
  assert v_n = 0, format('no-permission role saw %s rows via RPC', v_n);
  reset role;
  raise notice 'PASS 99 iac 9 counts + grants';
end $$;
rollback;
