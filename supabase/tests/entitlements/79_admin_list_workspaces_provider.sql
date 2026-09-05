\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

begin;
do $$
declare
  v_stripe uuid; v_pagarme uuid; v_none uuid;
  v jsonb;
begin
  v_stripe  := et_make_workspace('max'); update workspaces set name = 'ET provider stripe'  where id = v_stripe;
  v_pagarme := et_make_workspace('max'); update workspaces set name = 'ET provider pagarme' where id = v_pagarme;
  v_none    := et_make_workspace('max'); update workspaces set name = 'ET provider none'    where id = v_none;

  insert into workspace_subscriptions (workspace_id, status, plan_id, provider, pagarme_subscription_id) values
    (v_stripe,  'active', 'max', 'stripe',  null),
    (v_pagarme, 'active', 'max', 'pagarme', 'sub_et_provider_79');

  execute 'set local role service_role';

  v := admin_list_workspaces(p_search := 'ET provider stripe');
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'provider') = 'stripe',
    format('stripe row: got %s', v -> 'workspaces' -> 0 -> 'subscription');

  v := admin_list_workspaces(p_search := 'ET provider pagarme');
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'provider') = 'pagarme',
    format('pagarme row: got %s', v -> 'workspaces' -> 0 -> 'subscription');

  -- Still carries the keys the Dashboard at-risk card reads (v5 contract untouched).
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'failed_payment_count')::int = 0,
    'failed_payment_count must survive the v6 rewrite';

  v := admin_list_workspaces(p_search := 'ET provider none');
  assert (v -> 'workspaces' -> 0 -> 'subscription' ->> 'provider') is null,
    'workspace without a subscription row must not carry a provider';

  execute 'reset role';
  raise notice 'PASS 79_admin_list_workspaces_provider';
end $$;
rollback;
