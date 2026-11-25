\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- USD billing (migration 20261205000002): the e-mail candidate RPCs and
-- admin_list_workspaces carry the workspace currency and the matching price.
-- One transaction, rolled back.
begin;
do $$
declare
  v_uid uuid := gen_random_uuid();
  v_ws uuid;
  r record;
  v jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data)
    values (v_uid, v_uid || '@et.test', now(), now(), '{}'::jsonb);
  select p.conta_id into v_ws from profiles p where p.id = v_uid;
  update workspaces set name = 'ET usd cand ' || left(v_uid::text, 8) where id = v_ws;
  update plans set price_usd = 2900, price_usd_annual = 29000 where id = 'pro';

  -- Reverse trial ending e-mail: BRL workspace reads price_brl, USD workspace price_usd.
  update workspaces
     set plan_id = 'pro', plan_source = 'trial', reverse_trial_plan_id = 'pro',
         reverse_trial_started_at = now() - interval '12 days',
         reverse_trial_ends_at = now() + interval '2 days'
   where id = v_ws;
  select * into r from get_reverse_trial_email_candidates() c where c.workspace_id = v_ws;
  assert r.currency = 'brl' and r.price_cents = (select price_brl from plans where id = 'pro'),
    format('brl reverse trial candidate: %s', row_to_json(r));

  update workspaces set billing_currency = 'usd' where id = v_ws;
  select * into r from get_reverse_trial_email_candidates() c where c.workspace_id = v_ws;
  assert r.currency = 'usd' and r.price_cents = 2900,
    format('usd reverse trial candidate: %s', row_to_json(r));

  -- Trial reminder: currency comes from the subscription row.
  insert into workspace_subscriptions (workspace_id, status, stripe_subscription_id, provider,
                                       current_period_end, plan_id, amount_cents, currency)
    values (v_ws, 'trialing', 'sub_' || v_ws, 'stripe', now() + interval '5 days', 'pro', 2900, 'usd');
  select * into r from get_trial_reminder_candidates() c where c.workspace_id = v_ws;
  assert r.workspace_id is not null and r.currency = 'usd' and r.amount_cents = 2900,
    format('usd trial reminder: %s', row_to_json(r));

  -- admin_list_workspaces: without amount_cents the fallback follows the workspace currency.
  update workspace_subscriptions set amount_cents = null where workspace_id = v_ws;
  execute 'set local role service_role';
  v := admin_list_workspaces('ET usd cand', null, 0, 10);
  execute 'reset role';
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'currency') = 'usd'
     and (v -> 'workspaces' -> 0 -> 'subscription' ->> 'amount_cents')::int = 2900,
    format('usd admin list fallback: %s', v -> 'workspaces' -> 0 -> 'subscription');

  update workspaces set billing_currency = 'brl' where id = v_ws;
  execute 'set local role service_role';
  v := admin_list_workspaces('ET usd cand', null, 0, 10);
  execute 'reset role';
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'currency') = 'brl'
     and (v -> 'workspaces' -> 0 -> 'subscription' ->> 'amount_cents')::int
         = (select price_brl from plans where id = 'pro'),
    format('brl admin list fallback: %s', v -> 'workspaces' -> 0 -> 'subscription');

  raise notice 'PASS 99_usd_billing_candidates';
end $$;
rollback;
