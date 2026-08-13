\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- grant_pagarme_plan: the pagarme-webhook's atomic, lock-serialized plan grant
-- (20260813000002). It is SECURITY DEFINER with no in-body caller check, so its GRANT is the
-- entire security boundary, and its `where ... for update` is the entire correctness boundary
-- against out-of-order Pagar.me deliveries. This suite pins both so a later edit cannot silently
-- regress them (the webhook's own Deno tests mock the RPC and cannot see the SQL).

begin;

-- 1. Security boundary. REVOKE FROM PUBLIC alone would leave anon/authenticated with the default
--    EXECUTE grant Supabase hands new public functions -- a free plan-set bypass, since any
--    authenticated user can read their own subscription row and supply a matching p_sub/p_status.
do $$
begin
  if has_function_privilege('anon',
       'public.grant_pagarme_plan(uuid, text, text, text)', 'execute') then
    raise exception 'SECURITY: anon must not have EXECUTE on grant_pagarme_plan';
  end if;
  if has_function_privilege('authenticated',
       'public.grant_pagarme_plan(uuid, text, text, text)', 'execute') then
    raise exception 'SECURITY: authenticated must not have EXECUTE on grant_pagarme_plan';
  end if;
  if not has_function_privilege('service_role',
       'public.grant_pagarme_plan(uuid, text, text, text)', 'execute') then
    raise exception 'service_role must retain EXECUTE on grant_pagarme_plan';
  end if;
end $$;

-- 2. Correctness: a matching subscription writes; every mismatch and a manual comp write 0 rows;
--    a NULL plan_source is still writable.
do $$
declare
  v_ws   uuid;
  v_n    int;
  v_plan text;
  v_src  text;
begin
  v_ws := et_make_workspace('free');
  -- et_make_workspace stamps plan_source='manual'; reset it so the write cases are not blocked by
  -- the comp guard (which case (e) tests deliberately).
  update public.workspaces set plan_source = 'system' where id = v_ws;

  insert into public.workspace_subscriptions
    (workspace_id, provider, pagarme_customer_id, pagarme_subscription_id, status)
    values (v_ws, 'pagarme', 'cus_et_gp', 'sub_et_gp', 'active');

  -- (a) matching provider+sub+status: writes, returns 1, plan + source updated.
  select public.grant_pagarme_plan(v_ws, 'max', 'sub_et_gp', 'active') into v_n;
  if v_n <> 1 then raise exception '(a) matching grant expected 1 row, got %', v_n; end if;
  select plan_id, plan_source into v_plan, v_src from public.workspaces where id = v_ws;
  if v_plan <> 'max' or v_src <> 'pagarme' then
    raise exception '(a) plan/source not updated: % / %', v_plan, v_src;
  end if;

  -- (b) status mismatch (sub is active, guard asks for canceled): 0 rows, plan unchanged.
  select public.grant_pagarme_plan(v_ws, 'free', 'sub_et_gp', 'canceled') into v_n;
  if v_n <> 0 then raise exception '(b) status mismatch expected 0 rows, got %', v_n; end if;
  select plan_id into v_plan from public.workspaces where id = v_ws;
  if v_plan <> 'max' then raise exception '(b) plan wrongly changed to %', v_plan; end if;

  -- (c) sub-id mismatch: 0 rows.
  select public.grant_pagarme_plan(v_ws, 'free', 'sub_OTHER', 'active') into v_n;
  if v_n <> 0 then raise exception '(c) sub-id mismatch expected 0 rows, got %', v_n; end if;

  -- (d) provider mismatch (the cross-provider Stripe reclaim): a pagarme grant must not touch it.
  update public.workspace_subscriptions set provider = 'stripe' where workspace_id = v_ws;
  select public.grant_pagarme_plan(v_ws, 'free', 'sub_et_gp', 'active') into v_n;
  if v_n <> 0 then raise exception '(d) provider mismatch expected 0 rows, got %', v_n; end if;
  update public.workspace_subscriptions set provider = 'pagarme' where workspace_id = v_ws;

  -- (e) manual comp preserved: server-side guard writes 0 rows, plan untouched.
  update public.workspaces set plan_source = 'manual' where id = v_ws;
  select public.grant_pagarme_plan(v_ws, 'free', 'sub_et_gp', 'active') into v_n;
  if v_n <> 0 then raise exception '(e) manual comp expected 0 rows, got %', v_n; end if;
  select plan_id into v_plan from public.workspaces where id = v_ws;
  if v_plan <> 'max' then raise exception '(e) manual comp was overridden to %', v_plan; end if;

  -- (f) NULL plan_source is still writable (is distinct from 'manual').
  update public.workspaces set plan_source = null where id = v_ws;
  select public.grant_pagarme_plan(v_ws, 'free', 'sub_et_gp', 'active') into v_n;
  if v_n <> 1 then raise exception '(f) NULL plan_source expected 1 row, got %', v_n; end if;
  select plan_id into v_plan from public.workspaces where id = v_ws;
  if v_plan <> 'free' then raise exception '(f) NULL-source grant did not write: %', v_plan; end if;

  raise notice 'pagarme_grant_plan: boundary + guard OK (match writes, mismatches/manual no-op, null writable)';
end $$;

rollback;
