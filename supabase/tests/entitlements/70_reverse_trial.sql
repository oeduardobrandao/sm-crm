\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Teste reverso (migration 20261130000001): elegibilidade, inicio, conversao, fim, pausa do
-- Hub, Financeiro/Contratos so leitura e as RPCs que separam por plano.
--
-- Cada bloco roda numa transacao com rollback. A chave e ligada dentro da transacao.

-- Fixtures criadas no topo (auto-commit): remove as de uma execucao abortada antes.
drop function if exists et_rt_owner();
drop function if exists et_rt_switch_on(timestamptz);
drop function if exists et_rt_as(uuid);
drop function if exists et_rt_trial(interval, interval);

-- Dono novo: o insert em auth.users dispara handle_new_user_workspace, que cria o
-- workspace (plan_id null, plan_source system), o membro owner e o perfil com
-- conta_id/active_workspace_id apontando para ele. Devolve (user_id, workspace_id).
create or replace function et_rt_owner()
returns table (user_id uuid, workspace_id uuid) language plpgsql as $$
declare v_uid uuid := gen_random_uuid(); v_ws uuid;
begin
  insert into auth.users (id, email, email_confirmed_at, last_sign_in_at, raw_user_meta_data)
    values (v_uid, v_uid || '@et.test', now(), now(), '{}'::jsonb);
  select p.conta_id into v_ws from profiles p where p.id = v_uid;
  update profiles set active_workspace_id = v_ws, nome = 'Ana Silva' where id = v_uid;
  update workspaces set name = 'Agencia ' || left(v_uid::text, 8) where id = v_ws;
  return query select v_uid, v_ws;
end $$;

-- Liga a chave com enabled_at no passado (o workspace do fixture nasce em now()).
create or replace function et_rt_switch_on(p_enabled_at timestamptz default now() - interval '1 hour')
returns void language sql as $$
  update platform_settings
     set value = jsonb_build_object('enabled', true, 'enabled_at', p_enabled_at)
   where key = 'reverse_trial_enabled';
$$;

-- Passa a agir como p_user (JWT); o chamador faz `execute 'set local role authenticated'`.
create or replace function et_rt_as(p_user uuid)
returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;

-- 1.1 new_owner_eligible + offer_reports_eligible_and_auto + disabled_switch_returns_disabled
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; v jsonb;
  begin
    select * into f from et_rt_owner();
    -- chave desligada (padrao da migration)
    if reverse_trial_eligible(f.workspace_id, f.user_id, 'signup') then
      raise exception 'disabled_switch: eligible with switch off';
    end if;
    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    v := start_reverse_trial('signup');
    execute 'reset role';
    if (v ->> 'started')::boolean or v ->> 'reason' <> 'disabled' then
      raise exception 'disabled_switch_returns_disabled: %', v;
    end if;

    perform et_rt_switch_on();
    if not reverse_trial_eligible(f.workspace_id, f.user_id, 'signup')
       or not reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
      raise exception 'new_owner_eligible: not eligible';
    end if;
    if reverse_trial_eligible(f.workspace_id, f.user_id, 'other') then
      raise exception 'new_owner_eligible: unknown source accepted';
    end if;

    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    v := reverse_trial_offer();
    execute 'reset role';
    if v <> '{"enabled": true, "eligible": true, "auto": true}'::jsonb then
      raise exception 'offer_reports_eligible_and_auto: %', v;
    end if;
  end $$;
rollback;

-- 1.2 invited_member_not_eligible, manual_comp_not_eligible, demo_not_eligible
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; g record;
  begin
    perform et_rt_switch_on();
    select * into f from et_rt_owner();
    select * into g from et_rt_owner();
    -- o Free so tem 1 usuario: adiciona o membro com o plano Pro e volta para o Free
    update workspaces set plan_id = 'pro' where id = f.workspace_id;
    insert into workspace_members (user_id, workspace_id, role) values (g.user_id, f.workspace_id, 'agent');
    update workspaces set plan_id = null where id = f.workspace_id;
    if reverse_trial_eligible(f.workspace_id, g.user_id, 'nudge') then
      raise exception 'invited_member_not_eligible';
    end if;

    update workspaces set plan_source = 'manual' where id = f.workspace_id;
    if reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
      raise exception 'manual_comp_not_eligible';
    end if;
    update workspaces set plan_source = 'system', plan_id = 'pro' where id = f.workspace_id;
    if reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
      raise exception 'paid_plan_not_eligible';
    end if;
    update workspaces set plan_id = null where id = f.workspace_id;
    if not reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
      raise exception 'manual_comp_not_eligible: inverse failed';
    end if;

    update workspaces set demo_created_at = now() where id = f.workspace_id;
    if reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
      raise exception 'demo_not_eligible';
    end if;
  end $$;
rollback;

-- 1.3 ever_subscribed_not_eligible: cada um dos quatro bracos de paid_ws, no proprio
-- workspace e em outro workspace da mesma pessoa.
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; arm int; v_other uuid;
  begin
    perform et_rt_switch_on();
    for arm in 1..4 loop
      select * into f from et_rt_owner();
      insert into workspace_subscriptions (workspace_id, status, ever_subscribed_at,
                                           stripe_subscription_id, pagarme_subscription_id, provider)
        values (f.workspace_id,
                case when arm = 4 then 'past_due' else 'canceled' end,
                case when arm = 1 then now() end,
                case when arm = 2 then 'sub_' || f.workspace_id end,
                case when arm = 3 then 'pg_' || f.workspace_id end,
                case when arm = 3 then 'pagarme' else 'stripe' end);
      if reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
        raise exception 'ever_subscribed_not_eligible: arm % accepted', arm;
      end if;
      -- outro workspace da mesma pessoa, nunca assinou: recusado pela regra por pessoa
      insert into workspaces (name, created_by, plan_source) values ('outro', f.user_id, 'system')
        returning id into v_other;
      insert into workspace_members (user_id, workspace_id, role) values (f.user_id, v_other, 'owner');
      if reverse_trial_eligible(v_other, f.user_id, 'nudge') then
        raise exception 'ever_subscribed_not_eligible: other workspace of arm % accepted', arm;
      end if;
    end loop;
  end $$;
rollback;

-- 1.4 existing_free_workspace_not_auto_eligible: criado antes de enabled_at
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; v jsonb;
  begin
    select * into f from et_rt_owner();
    perform et_rt_switch_on(now() + interval '1 minute');
    if reverse_trial_eligible(f.workspace_id, f.user_id, 'signup') then
      raise exception 'existing_free: signup accepted for a workspace older than enabled_at';
    end if;
    if not reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
      raise exception 'existing_free: nudge refused';
    end if;
    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    v := reverse_trial_offer();
    if v <> '{"enabled": true, "eligible": true, "auto": false}'::jsonb then
      raise exception 'existing_free offer: %', v;
    end if;
    v := start_reverse_trial('signup');
    if (v ->> 'started')::boolean or v ->> 'reason' <> 'not_eligible' then
      raise exception 'existing_free signup start: %', v;
    end if;
    v := start_reverse_trial('nudge');
    execute 'reset role';
    if not (v ->> 'started')::boolean then
      raise exception 'existing_free nudge start: %', v;
    end if;
  end $$;
rollback;

-- 1.5 start_sets_plan_pro_source_trial_ends_14d, start_is_idempotent,
--     start_stamps_profile_and_offer_seen, second_workspace_same_person_not_eligible
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; v jsonb; v2 jsonb; w record; v_other uuid;
  begin
    perform et_rt_switch_on();
    select * into f from et_rt_owner();
    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    v := start_reverse_trial('signup');
    v2 := start_reverse_trial('signup');
    execute 'reset role';
    if not (v ->> 'started')::boolean or (v ->> 'ends_at')::timestamptz <> now() + interval '14 days' then
      raise exception 'start_sets: %', v;
    end if;
    if v2 ->> 'ends_at' <> v ->> 'ends_at' or not (v2 ->> 'started')::boolean then
      raise exception 'start_is_idempotent: % then %', v, v2;
    end if;
    select * into w from workspaces where id = f.workspace_id;
    if w.plan_id <> 'pro' or w.plan_source <> 'trial' or w.reverse_trial_plan_id <> 'pro'
       or w.reverse_trial_started_at <> now() or w.reverse_trial_ends_at <> now() + interval '14 days'
       or w.trial_offer_seen_at is null or w.reverse_trial_outcome is not null then
      raise exception 'start_sets: unexpected workspace %', row_to_json(w);
    end if;
    if (select reverse_trial_used_at from profiles where id = f.user_id) is null then
      raise exception 'start_stamps_profile: reverse_trial_used_at not set';
    end if;
    if reverse_trial_eligible(f.workspace_id, f.user_id, 'nudge') then
      raise exception 'start: running trial still eligible';
    end if;

    -- segundo workspace criado durante o teste: nunca elegivel
    insert into workspaces (name, created_by, plan_source) values ('segundo', f.user_id, 'system')
      returning id into v_other;
    insert into workspace_members (user_id, workspace_id, role) values (f.user_id, v_other, 'owner');
    if reverse_trial_eligible(v_other, f.user_id, 'nudge') or reverse_trial_eligible(v_other, f.user_id, 'signup') then
      raise exception 'second_workspace_same_person_not_eligible';
    end if;
    -- mesmo sem o marcador do perfil, o outro workspace com teste recusa
    update profiles set reverse_trial_used_at = null where id = f.user_id;
    if reverse_trial_eligible(v_other, f.user_id, 'nudge') then
      raise exception 'second_workspace: per-person workspace rule missing';
    end if;
    update profiles set reverse_trial_used_at = now() where id = f.user_id;

    perform et_rt_as(f.user_id);
    update profiles set active_workspace_id = v_other where id = f.user_id;
    execute 'set local role authenticated';
    v := start_reverse_trial('nudge');
    execute 'reset role';
    if (v ->> 'started')::boolean then
      raise exception 'second_workspace: start succeeded %', v;
    end if;
  end $$;
rollback;

-- 1.6 a non-owner member cannot start the workspace trial
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; g record; v jsonb;
  begin
    perform et_rt_switch_on();
    select * into f from et_rt_owner();
    select * into g from et_rt_owner();
    update workspaces set plan_id = 'pro' where id = f.workspace_id;
    insert into workspace_members (user_id, workspace_id, role) values (g.user_id, f.workspace_id, 'admin');
    update workspaces set plan_id = null where id = f.workspace_id;
    update profiles set active_workspace_id = f.workspace_id where id = g.user_id;
    perform et_rt_as(g.user_id);
    execute 'set local role authenticated';
    v := start_reverse_trial('signup');
    execute 'reset role';
    if (v ->> 'started')::boolean then
      raise exception 'member_cannot_start: %', v;
    end if;
    if (select plan_source from workspaces where id = f.workspace_id) <> 'system' then
      raise exception 'member_cannot_start: workspace changed';
    end if;
  end $$;
rollback;

-- 1.7 owner_cannot_update_reverse_trial_columns
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; v_ok boolean;
  begin
    perform et_rt_switch_on();
    select * into f from et_rt_owner();
    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    -- a policy deixa o dono atualizar o workspace (prova que o guard e quem bloqueia)
    update workspaces set name = 'Novo nome' where id = f.workspace_id;
    begin
      update workspaces set reverse_trial_ends_at = now() + interval '90 days' where id = f.workspace_id;
      v_ok := true;
    exception when insufficient_privilege then v_ok := false;
    end;
    if v_ok then raise exception 'owner_cannot_update_reverse_trial_columns: ends_at updated'; end if;
    begin
      update workspaces set plan_id = 'pro', plan_source = 'trial' where id = f.workspace_id;
      v_ok := true;
    exception when insufficient_privilege then v_ok := false;
    end;
    if v_ok then raise exception 'owner_cannot_update_reverse_trial_columns: plan_source trial set'; end if;
    execute 'reset role';
    if (select name from workspaces where id = f.workspace_id) <> 'Novo nome' then
      raise exception 'owner update: name update did not apply (policy setup wrong)';
    end if;
  end $$;
rollback;

-- 1.8 owner_cannot_update_profile_reverse_trial_used_at (allowlist por coluna de profiles;
-- parity sem profiles para nao desfazer o REVOKE em teste)
begin;
  select et_grant_hosted_parity(array['profiles']);
  do $$
  declare f record; v_ok boolean;
  begin
    select * into f from et_rt_owner();
    if has_column_privilege('authenticated', 'public.profiles', 'reverse_trial_used_at', 'UPDATE') then
      raise exception 'profile: authenticated has UPDATE on reverse_trial_used_at';
    end if;
    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    begin
      update profiles set reverse_trial_used_at = null where id = f.user_id;
      v_ok := true;
    exception when insufficient_privilege then v_ok := false;
    end;
    execute 'reset role';
    if v_ok then raise exception 'owner_cannot_update_profile_reverse_trial_used_at'; end if;
  end $$;
rollback;

-- 1.9 grants: service-role functions are not callable by authenticated/anon
begin;
  do $$
  declare fn text;
  begin
    foreach fn in array array[
      'reverse_trial_eligible(uuid,uuid,text)', '_reverse_trial_switch()', '_workspace_ever_paid(uuid)'
    ] loop
      if has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
         or has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
         or not has_function_privilege('service_role', 'public.' || fn, 'EXECUTE') then
        raise exception 'grants: % has wrong EXECUTE grants', fn;
      end if;
    end loop;
    foreach fn in array array['reverse_trial_offer()', 'start_reverse_trial(text)'] loop
      if has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
         or not has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') then
        raise exception 'grants: % has wrong EXECUTE grants', fn;
      end if;
    end loop;
    if has_table_privilege('authenticated', 'public.platform_settings', 'SELECT') then
      raise exception 'grants: platform_settings readable by authenticated';
    end if;
  end $$;
rollback;

-- 1.10 the switch stamps enabled_at when turned on without one
begin;
  do $$
  declare v jsonb;
  begin
    update platform_settings set value = '{"enabled": true, "enabled_at": null}' where key = 'reverse_trial_enabled';
    select value into v from platform_settings where key = 'reverse_trial_enabled';
    if (v ->> 'enabled_at')::timestamptz <> now() then
      raise exception 'switch stamp: %', v;
    end if;
  end $$;
rollback;

-- ===================== Task 2: conversao, fim e pausa do Hub =====================
-- Workspace em teste gravado direto (como postgres o guard nao bloqueia).
create or replace function et_rt_trial(p_started_ago interval default '1 day', p_ends_in interval default '13 days')
returns table (user_id uuid, workspace_id uuid) language plpgsql as $$
declare f record;
begin
  select * into f from et_rt_owner();
  update workspaces
     set plan_id = 'pro', plan_source = 'trial', reverse_trial_plan_id = 'pro',
         reverse_trial_started_at = now() - p_started_ago,
         reverse_trial_ends_at = now() + p_ends_in
   where id = f.workspace_id;
  update profiles set reverse_trial_used_at = now() - p_started_ago where id = f.user_id;
  return query select f.user_id, f.workspace_id;
end $$;

-- 2.1 convert_from_trial, first_paid_set_once
begin;
  do $$
  declare f record; w record; v text;
  begin
    select * into f from et_rt_trial();
    perform mark_reverse_trial_first_paid(f.workspace_id);
    if (select reverse_trial_first_paid_at from workspaces where id = f.workspace_id) is not null then
      raise exception 'first_paid: set without card_added_at';
    end if;
    v := convert_reverse_trial(f.workspace_id, 'max', 'stripe');
    select * into w from workspaces where id = f.workspace_id;
    if v <> 'converted' or w.plan_id <> 'max' or w.plan_source <> 'stripe'
       or w.reverse_trial_outcome <> 'converted' or w.reverse_trial_ended_at <> now()
       or w.reverse_trial_card_added_at <> now() then
      raise exception 'convert_from_trial: % %', v, row_to_json(w);
    end if;
    perform mark_reverse_trial_first_paid(f.workspace_id);
    update workspaces set reverse_trial_first_paid_at = reverse_trial_first_paid_at - interval '1 hour'
     where id = f.workspace_id;
    perform mark_reverse_trial_first_paid(f.workspace_id);
    if (select reverse_trial_first_paid_at from workspaces where id = f.workspace_id) <> now() - interval '1 hour' then
      raise exception 'first_paid_set_once: overwritten';
    end if;
    -- a second convert on a converted workspace writes nothing
    if convert_reverse_trial(f.workspace_id, 'start', 'stripe') <> 'not_trial' then
      raise exception 'convert: converted workspace converted again';
    end if;
    -- invalid inputs
    if convert_reverse_trial(f.workspace_id, 'free', 'stripe') <> 'not_trial'
       or convert_reverse_trial(f.workspace_id, 'pro', 'manual') <> 'not_trial' then
      raise exception 'convert: invalid input accepted';
    end if;
  end $$;
rollback;

-- 2.2 late_convert_after_downgrade, winback_after_downgrade_keeps_outcome
begin;
  do $$
  declare f record; w record; v text;
  begin
    select * into f from et_rt_trial('14 days', '-1 hour');
    insert into checkout_attempts (workspace_id, stripe_session_id, plan_id, created_at)
      values (f.workspace_id, 'cs_' || f.workspace_id, 'pro', now() - interval '2 hours');
    if not end_reverse_trial(f.workspace_id) then raise exception 'late: end failed'; end if;
    v := convert_reverse_trial(f.workspace_id, 'pro', 'stripe');
    select * into w from workspaces where id = f.workspace_id;
    if v <> 'rewritten_late' or w.plan_id <> 'pro' or w.plan_source <> 'stripe'
       or w.reverse_trial_outcome <> 'converted' or w.reverse_trial_card_added_at is null then
      raise exception 'late_convert_after_downgrade: % %', v, row_to_json(w);
    end if;
    if hub_workspace_paused(f.workspace_id) then raise exception 'late: hub paused'; end if;
  end $$;
rollback;

begin;
  do $$
  declare f record; w record; v text;
  begin
    select * into f from et_rt_trial('14 days', '-1 hour');
    perform end_reverse_trial(f.workspace_id);
    -- checkout aberto depois do fim: win-back
    insert into checkout_attempts (workspace_id, stripe_session_id, plan_id, created_at)
      values (f.workspace_id, 'cs_' || f.workspace_id, 'pro', now() + interval '1 minute');
    v := convert_reverse_trial(f.workspace_id, 'pro', 'stripe');
    select * into w from workspaces where id = f.workspace_id;
    if v <> 'not_trial' or w.reverse_trial_outcome <> 'downgraded' or w.plan_source <> 'system' then
      raise exception 'winback_after_downgrade_keeps_outcome: % %', v, row_to_json(w);
    end if;
    -- the caller's normal write makes it paid; the pause never applies to a paid plan
    update workspaces set plan_id = 'pro', plan_source = 'stripe',
                          reverse_trial_ended_at = now() - interval '8 days'
     where id = f.workspace_id;
    if hub_workspace_paused(f.workspace_id) then raise exception 'winback: hub paused on paid plan'; end if;
    -- no checkout at all: also not a late conversion
    update workspaces set plan_id = 'free', plan_source = 'system', reverse_trial_ended_at = now()
     where id = f.workspace_id;
    delete from checkout_attempts where workspace_id = f.workspace_id;
    if convert_reverse_trial(f.workspace_id, 'pro', 'stripe') <> 'not_trial' then
      raise exception 'winback: rewritten without a checkout during the trial';
    end if;
  end $$;
rollback;

-- 2.3 revert_conversion_inside_window, unpaid_conversion_marked_downgraded
begin;
  do $$
  declare f record; w record;
  begin
    select * into f from et_rt_trial();
    perform convert_reverse_trial(f.workspace_id, 'pro', 'stripe');
    if mark_reverse_trial_unpaid(f.workspace_id) then
      raise exception 'unpaid: marked before the original end';
    end if;
    if not revert_reverse_trial_conversion(f.workspace_id) then raise exception 'revert failed'; end if;
    select * into w from workspaces where id = f.workspace_id;
    if w.plan_source <> 'trial' or w.plan_id <> 'pro' or w.reverse_trial_ended_at is not null
       or w.reverse_trial_outcome is not null or w.reverse_trial_card_added_at is null
       or w.reverse_trial_ends_at <> now() + interval '13 days' then
      raise exception 'revert_conversion_inside_window: %', row_to_json(w);
    end if;

    -- after the original end
    perform convert_reverse_trial(f.workspace_id, 'pro', 'stripe');
    update workspaces set reverse_trial_ends_at = now() - interval '1 minute' where id = f.workspace_id;
    if revert_reverse_trial_conversion(f.workspace_id) then raise exception 'revert after end accepted'; end if;
    update workspaces set plan_id = 'free', plan_source = 'stripe' where id = f.workspace_id;
    if not mark_reverse_trial_unpaid(f.workspace_id) then raise exception 'unpaid failed'; end if;
    select * into w from workspaces where id = f.workspace_id;
    if w.reverse_trial_outcome <> 'downgraded' or w.reverse_trial_ended_at <> now() then
      raise exception 'unpaid_conversion_marked_downgraded: %', row_to_json(w);
    end if;

    -- paid once: neither applies
    update workspaces set reverse_trial_outcome = 'converted', reverse_trial_first_paid_at = now()
     where id = f.workspace_id;
    if mark_reverse_trial_unpaid(f.workspace_id) or revert_reverse_trial_conversion(f.workspace_id) then
      raise exception 'unpaid/revert applied to a paying customer';
    end if;
  end $$;
rollback;

-- 2.4 end_noop_when_paid_sub_active, end_sets_system_free_downgraded, end_by_admin_no_pause
begin;
  do $$
  declare f record; g record; w record;
  begin
    select * into f from et_rt_trial('14 days', '-1 minute');
    insert into workspace_subscriptions (workspace_id, status, stripe_subscription_id, provider)
      values (f.workspace_id, 'trialing', 'sub_' || f.workspace_id, 'stripe');
    if end_reverse_trial(f.workspace_id) then raise exception 'end_noop_when_paid_sub_active'; end if;
    if (select plan_source from workspaces where id = f.workspace_id) <> 'trial' then
      raise exception 'end_noop: workspace changed';
    end if;
    update workspace_subscriptions set status = 'canceled' where workspace_id = f.workspace_id;
    if not end_reverse_trial(f.workspace_id) then raise exception 'end after cancel failed'; end if;
    select * into w from workspaces where id = f.workspace_id;
    if w.plan_id <> 'free' or w.plan_source <> 'system' or w.reverse_trial_outcome <> 'downgraded'
       or w.reverse_trial_ended_at <> now() then
      raise exception 'end_sets_system_free_downgraded: %', row_to_json(w);
    end if;
    if end_reverse_trial(f.workspace_id) then raise exception 'end: second call returned true'; end if;
    if end_reverse_trial(f.workspace_id, 'converted') then raise exception 'end: bad outcome accepted'; end if;

    select * into g from et_rt_trial();
    if not end_reverse_trial(g.workspace_id, 'ended_by_admin') then raise exception 'end by admin failed'; end if;
    update workspaces set reverse_trial_ended_at = now() - interval '30 days' where id = g.workspace_id;
    if hub_workspace_paused(g.workspace_id) then raise exception 'end_by_admin_no_pause'; end if;
  end $$;
rollback;

-- 2.5 pause_false_before_7_days, pause_true_after_7_days, pause_false_after_upgrade
begin;
  do $$
  declare f record;
  begin
    select * into f from et_rt_trial('14 days', '-1 minute');
    if hub_workspace_paused(f.workspace_id) then raise exception 'pause: running trial paused'; end if;
    perform end_reverse_trial(f.workspace_id);
    update workspaces set reverse_trial_ended_at = now() - interval '6 days 23 hours' where id = f.workspace_id;
    if hub_workspace_paused(f.workspace_id) then raise exception 'pause_false_before_7_days'; end if;
    update workspaces set reverse_trial_ended_at = now() - interval '7 days' where id = f.workspace_id;
    if not hub_workspace_paused(f.workspace_id) then raise exception 'pause_true_after_7_days'; end if;
    update workspaces set plan_id = null where id = f.workspace_id;
    if not hub_workspace_paused(f.workspace_id) then raise exception 'pause: null plan_id not treated as Free'; end if;
    update workspaces set plan_id = 'start', plan_source = 'stripe' where id = f.workspace_id;
    if hub_workspace_paused(f.workspace_id) then raise exception 'pause_false_after_upgrade'; end if;
    update workspaces set plan_id = 'free', plan_source = 'manual' where id = f.workspace_id;
    if hub_workspace_paused(f.workspace_id) then raise exception 'pause: comp still paused'; end if;
    if hub_workspace_paused(gen_random_uuid()) then raise exception 'pause: unknown workspace paused'; end if;
  end $$;
rollback;

-- 2.6 grant_pagarme_converts_trial
begin;
  do $$
  declare f record; w record; n int;
  begin
    select * into f from et_rt_trial();
    insert into workspace_subscriptions (workspace_id, status, pagarme_subscription_id, provider)
      values (f.workspace_id, 'pending', 'pg_' || f.workspace_id, 'pagarme');
    n := grant_pagarme_plan(f.workspace_id, 'pro', 'pg_' || f.workspace_id, 'pending');
    if n <> 0 or (select plan_source from workspaces where id = f.workspace_id) <> 'trial' then
      raise exception 'grant_pagarme: trial touched by a status not in force';
    end if;
    update workspace_subscriptions set status = 'active' where workspace_id = f.workspace_id;
    n := grant_pagarme_plan(f.workspace_id, 'pro', 'pg_' || f.workspace_id, 'active');
    select * into w from workspaces where id = f.workspace_id;
    if n <> 1 or w.plan_source <> 'pagarme' or w.reverse_trial_outcome <> 'converted'
       or w.reverse_trial_card_added_at is null then
      raise exception 'grant_pagarme_converts_trial: % %', n, row_to_json(w);
    end if;
    -- a normal Free workspace keeps the plain write
    select * into f from et_rt_owner();
    insert into workspace_subscriptions (workspace_id, status, pagarme_subscription_id, provider)
      values (f.workspace_id, 'active', 'pg_' || f.workspace_id, 'pagarme');
    n := grant_pagarme_plan(f.workspace_id, 'start', 'pg_' || f.workspace_id, 'active');
    select * into w from workspaces where id = f.workspace_id;
    if n <> 1 or w.plan_id <> 'start' or w.plan_source <> 'pagarme' or w.reverse_trial_outcome is not null then
      raise exception 'grant_pagarme plain write: % %', n, row_to_json(w);
    end if;
  end $$;
rollback;

-- 2.6b grant_pagarme_plan: cancel of a never-paid conversion reverts inside the window,
--      marks downgraded after it
begin;
  do $$
  declare f record; w record; n int;
  begin
    select * into f from et_rt_trial();
    insert into workspace_subscriptions (workspace_id, status, pagarme_subscription_id, provider)
      values (f.workspace_id, 'active', 'pg_' || f.workspace_id, 'pagarme');
    perform grant_pagarme_plan(f.workspace_id, 'pro', 'pg_' || f.workspace_id, 'active');
    update workspace_subscriptions set status = 'canceled' where workspace_id = f.workspace_id;
    n := grant_pagarme_plan(f.workspace_id, 'free', 'pg_' || f.workspace_id, 'canceled');
    select * into w from workspaces where id = f.workspace_id;
    if n <> 1 or w.plan_source <> 'trial' or w.plan_id <> 'pro' or w.reverse_trial_outcome is not null then
      raise exception 'grant_pagarme cancel inside window: % %', n, row_to_json(w);
    end if;

    update workspace_subscriptions set status = 'active' where workspace_id = f.workspace_id;
    perform grant_pagarme_plan(f.workspace_id, 'pro', 'pg_' || f.workspace_id, 'active');
    update workspaces set reverse_trial_ends_at = now() - interval '1 minute' where id = f.workspace_id;
    update workspace_subscriptions set status = 'canceled' where workspace_id = f.workspace_id;
    n := grant_pagarme_plan(f.workspace_id, 'free', 'pg_' || f.workspace_id, 'canceled');
    select * into w from workspaces where id = f.workspace_id;
    if n <> 1 or w.plan_id <> 'free' or w.reverse_trial_outcome <> 'downgraded' or w.reverse_trial_ended_at <> now() then
      raise exception 'grant_pagarme cancel after end: % %', n, row_to_json(w);
    end if;
  end $$;
rollback;

-- 2.8 admin_extend_reverse_trial: only while running, future, <= start + 30 days
begin;
  do $$
  declare f record; g record;
  begin
    select * into f from et_rt_trial('1 day', '13 days');
    if admin_extend_reverse_trial(f.workspace_id, now() - interval '1 minute') then
      raise exception 'extend: past date accepted';
    end if;
    if admin_extend_reverse_trial(f.workspace_id, now() - interval '1 day' + interval '30 days 1 minute') then
      raise exception 'extend: beyond start + 30 days accepted';
    end if;
    if not admin_extend_reverse_trial(f.workspace_id, now() - interval '1 day' + interval '30 days') then
      raise exception 'extend: valid date refused';
    end if;
    if (select reverse_trial_ends_at from workspaces where id = f.workspace_id)
       <> now() - interval '1 day' + interval '30 days' then
      raise exception 'extend: ends_at not written';
    end if;
    perform convert_reverse_trial(f.workspace_id, 'pro', 'stripe');
    if admin_extend_reverse_trial(f.workspace_id, now() + interval '20 days') then
      raise exception 'extend_refused_after_conversion';
    end if;
    select * into g from et_rt_trial();
    perform end_reverse_trial(g.workspace_id);
    if admin_extend_reverse_trial(g.workspace_id, now() + interval '20 days') then
      raise exception 'extend_refused_when_ended';
    end if;
    if has_function_privilege('authenticated', 'public.admin_extend_reverse_trial(uuid,timestamptz)', 'EXECUTE')
       or not has_function_privilege('service_role', 'public.admin_extend_reverse_trial(uuid,timestamptz)', 'EXECUTE') then
      raise exception 'extend: wrong grants';
    end if;
  end $$;
rollback;

-- 2.7 grants
begin;
  do $$
  declare fn text;
  begin
    foreach fn in array array[
      'convert_reverse_trial(uuid,text,text)', 'end_reverse_trial(uuid,text)',
      'mark_reverse_trial_unpaid(uuid)', 'revert_reverse_trial_conversion(uuid)',
      'mark_reverse_trial_first_paid(uuid)', 'hub_workspace_paused(uuid)',
      'grant_pagarme_plan(uuid,text,text,text)'
    ] loop
      if has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
         or has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
         or not has_function_privilege('service_role', 'public.' || fn, 'EXECUTE') then
        raise exception 'grants: % has wrong EXECUTE grants', fn;
      end if;
    end loop;
  end $$;
rollback;

-- ===================== Task 3: Financeiro e Contratos so leitura =====================
-- 3.1 free_workspace_cannot_update_contrato / transacao / recorrente,
--     free_workspace_can_select_contratos, pro_workspace_can_update_contrato
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; v_cli bigint; v_con bigint; v_tr bigint; v_rec bigint; v_ok boolean; n int;
  begin
    select * into f from et_rt_owner();
    update workspaces set plan_id = 'pro' where id = f.workspace_id;
    insert into clientes (user_id, conta_id, nome, sigla, cor)
      values (f.user_id, f.workspace_id, 'Cliente', 'C', '#000') returning id into v_cli;
    insert into contratos (user_id, conta_id, cliente_id, titulo, data_inicio, data_fim, valor_total)
      values (f.user_id, f.workspace_id, v_cli, 'Contrato', '2026-01-01', '2026-12-31', 1000)
      returning id into v_con;
    insert into transacoes (user_id, conta_id, data, tipo, valor)
      values (f.user_id, f.workspace_id, '2026-11-01', 'entrada', 100) returning id into v_tr;
    insert into transacoes_recorrentes (conta_id, user_id, tipo, descricao, valor, dia, inicio)
      values (f.workspace_id, f.user_id, 'saida', 'Aluguel', 50, 5, '2026-11-01') returning id into v_rec;

    -- Pro: edits work
    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    update contratos set titulo = 'Contrato Pro' where id = v_con;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 1 then raise exception 'pro_workspace_can_update_contrato: % rows', n; end if;

    -- Free: read works, every edit refused
    update workspaces set plan_id = null, plan_source = 'system',
                          reverse_trial_outcome = 'downgraded', reverse_trial_ended_at = now()
     where id = f.workspace_id;
    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    select count(*) into n from contratos where id = v_con;
    if n <> 1 then raise exception 'free_workspace_can_select_contratos: % rows', n; end if;
    select count(*) into n from transacoes where id = v_tr;
    if n <> 1 then raise exception 'free_workspace_can_select_transacoes: % rows', n; end if;
    begin
      update contratos set titulo = 'x' where id = v_con; v_ok := true;
    exception when raise_exception then v_ok := false;
    end;
    if v_ok then raise exception 'free_workspace_cannot_update_contrato'; end if;
    begin
      update transacoes set valor = 1 where id = v_tr; v_ok := true;
    exception when raise_exception then v_ok := false;
    end;
    if v_ok then raise exception 'free_workspace_cannot_update_transacao'; end if;
    begin
      update transacoes_recorrentes set valor = 1 where id = v_rec; v_ok := true;
    exception when raise_exception then v_ok := false;
    end;
    if v_ok then raise exception 'free_workspace_cannot_update_recorrente'; end if;
    execute 'reset role';
  end $$;
rollback;

-- 3.2 deleting_client_with_contratos_on_free_still_cascades, service_role_update_on_free_allowed
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; v_cli bigint; v_con bigint; v_tr bigint; n int;
  begin
    select * into f from et_rt_owner();
    update workspaces set plan_id = 'pro' where id = f.workspace_id;
    insert into clientes (user_id, conta_id, nome, sigla, cor)
      values (f.user_id, f.workspace_id, 'Cliente', 'C', '#000') returning id into v_cli;
    insert into contratos (user_id, conta_id, cliente_id, titulo, data_inicio, data_fim, valor_total)
      values (f.user_id, f.workspace_id, v_cli, 'Contrato', '2026-01-01', '2026-12-31', 1000)
      returning id into v_con;
    insert into transacoes (user_id, conta_id, data, tipo, valor, cliente_id)
      values (f.user_id, f.workspace_id, '2026-11-01', 'entrada', 100, v_cli) returning id into v_tr;
    update workspaces set plan_id = null where id = f.workspace_id;

    perform et_rt_as(f.user_id);
    execute 'set local role authenticated';
    delete from clientes where id = v_cli;
    get diagnostics n = row_count;
    execute 'reset role';
    if n <> 1 then raise exception 'deleting_client: client not deleted (% rows)', n; end if;
    if (select cliente_id from contratos where id = v_con) is not null
       or (select cliente_id from transacoes where id = v_tr) is not null then
      raise exception 'deleting_client: SET NULL did not cascade';
    end if;

    perform set_config('request.jwt.claims', '', true);
    execute 'set local role service_role';
    update contratos set titulo = 'service' where id = v_con;
    update transacoes set valor = 2 where id = v_tr;
    execute 'reset role';
    if (select titulo from contratos where id = v_con) <> 'service' then
      raise exception 'service_role_update_on_free_allowed';
    end if;
  end $$;
rollback;

-- ===================== Task 4: RPCs que separam por plano =====================
-- 4.1 nurture_skips_running_trial, nurture_flags_ex_trial
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; n int; v_t timestamptz := '2026-11-10 13:00:00+00';
  begin
    select * into f from et_rt_owner();
    update auth.users set created_at = v_t - interval '4 days' where id = f.user_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 1 then raise exception 'nurture fixture: % rows, expected 1', n; end if;
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.ex_reverse_trial then raise exception 'nurture: plain free flagged ex trial'; end if;

    update workspaces set plan_id = 'pro', plan_source = 'trial', reverse_trial_plan_id = 'pro',
                          reverse_trial_started_at = now(), reverse_trial_ends_at = now() + interval '14 days'
     where id = f.workspace_id;
    select count(*) into n from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'nurture_skips_running_trial: % rows', n; end if;

    perform end_reverse_trial(f.workspace_id);
    select * into r from get_nurture_candidates(v_t) c where c.workspace_id = f.workspace_id;
    if r.workspace_id is null or not r.ex_reverse_trial then
      raise exception 'nurture_flags_ex_trial: %', row_to_json(r);
    end if;
  end $$;
rollback;

-- 4.2 welcome reverse_trial_offer, trial reminder reverse_trial_conversion
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record;
  begin
    select * into f from et_rt_owner();
    select * into r from get_welcome_email_candidates() c where c.user_id = f.user_id;
    if r.user_id is null or r.reverse_trial_offer then
      raise exception 'welcome offer with switch off: %', row_to_json(r);
    end if;
    perform et_rt_switch_on();
    select * into r from get_welcome_email_candidates() c where c.user_id = f.user_id;
    if not r.reverse_trial_offer then raise exception 'welcome_offer_variant_before_trial_started'; end if;
    -- trial already started by the first visit: still the 14-day variant
    update workspaces set plan_id = 'pro', plan_source = 'trial', reverse_trial_plan_id = 'pro',
                          reverse_trial_started_at = now(), reverse_trial_ends_at = now() + interval '14 days'
     where id = f.workspace_id;
    select * into r from get_welcome_email_candidates() c where c.user_id = f.user_id;
    if not r.reverse_trial_offer then raise exception 'welcome offer after start'; end if;

    insert into workspace_subscriptions (workspace_id, status, stripe_subscription_id, provider,
                                         current_period_end, plan_id)
      values (f.workspace_id, 'trialing', 'sub_' || f.workspace_id, 'stripe', now() + interval '5 days', 'pro');
    select * into r from get_trial_reminder_candidates() c where c.workspace_id = f.workspace_id;
    if r.workspace_id is null or r.reverse_trial_conversion then
      raise exception 'trial reminder before conversion: %', row_to_json(r);
    end if;
    perform convert_reverse_trial(f.workspace_id, 'pro', 'stripe');
    select * into r from get_trial_reminder_candidates() c where c.workspace_id = f.workspace_id;
    if not r.reverse_trial_conversion then raise exception 'trial reminder reverse_trial_conversion'; end if;
  end $$;
rollback;

-- 4.3 admin_list_filter_teste_sem_cartao
begin;
  do $$
  declare f record; g record; v jsonb;
  begin
    select * into f from et_rt_trial();
    select * into g from et_rt_owner();
    update workspaces set name = 'ET rt list A' where id = f.workspace_id;
    update workspaces set name = 'ET rt list B' where id = g.workspace_id;
    execute 'set local role service_role';
    v := admin_list_workspaces('ET rt list', null, 0, 50, null, 'teste_sem_cartao');
    execute 'reset role';
    if (v ->> 'total')::int <> 1 or (v -> 'workspaces' -> 0 ->> 'id')::uuid <> f.workspace_id then
      raise exception 'admin_list_filter_teste_sem_cartao: %', v;
    end if;
    if (v -> 'workspaces' -> 0 ->> 'reverse_trial_ends_at')::timestamptz <> now() + interval '13 days'
       or not (v -> 'workspaces' -> 0) ? 'reverse_trial_outcome' then
      raise exception 'admin_list keys: %', v -> 'workspaces' -> 0;
    end if;
    execute 'set local role service_role';
    v := admin_list_workspaces('ET rt list', null, 0, 50, null, 'teste_sem_cartao,sem_assinatura');
    execute 'reset role';
    if (v ->> 'total')::int <> 2 then raise exception 'admin_list multi status: %', v ->> 'total'; end if;
  end $$;
rollback;

-- 4.4 Loops and Crisp segment running trials on their own
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record;
  begin
    select * into f from et_rt_trial();
    update profiles set marketing_opt_in = true where id = f.user_id;
    select * into r from get_loops_trait_candidates() c where c.user_id = f.user_id;
    if not r.any_reverse_trial or r.any_free or r.reverse_trial_ends_at <> now() + interval '13 days' then
      raise exception 'loops traits: %', row_to_json(r);
    end if;
    select * into r from get_crisp_sync_candidates() c where c.user_id = f.user_id;
    if not ('teste_sem_cartao' = any(r.segments)) or 'pagante' = any(r.segments)
       or 'trial' = any(r.segments) or 'free' = any(r.segments)
       or r.reverse_trial_ends_at <> to_char((now() + interval '13 days') at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') then
      raise exception 'crisp segments: %', row_to_json(r);
    end if;
    perform end_reverse_trial(f.workspace_id);
    select * into r from get_crisp_sync_candidates() c where c.user_id = f.user_id;
    if 'teste_sem_cartao' = any(r.segments) or not ('free' = any(r.segments)) or r.reverse_trial_ends_at is not null then
      raise exception 'crisp segments after downgrade: %', row_to_json(r);
    end if;
  end $$;
rollback;

-- 4.5 reverse_trial_ending + ledger by ref_at
begin;
  do $$
  declare f record; r record; n int;
  begin
    select * into f from et_rt_trial('12 days', '2 days');
    select * into r from get_reverse_trial_email_candidates() c where c.workspace_id = f.workspace_id;
    if r.email_type <> 'reverse_trial_ending' or r.ref_at <> now() + interval '2 days'
       or r.user_id <> f.user_id or r.plan_name <> 'Pro'
       or r.price_cents <> (select price_brl from plans where id = 'pro')
       or r.attempts <> 0 or r.hub_pause_at is not null or r.email <> f.user_id || '@et.test' then
      raise exception 'ending: %', row_to_json(r);
    end if;
    update workspaces set reverse_trial_ends_at = now() + interval '4 days' where id = f.workspace_id;
    select count(*) into n from get_reverse_trial_email_candidates() c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'ending: candidate 4 days before the end'; end if;
    update workspaces set reverse_trial_ends_at = now() + interval '2 days' where id = f.workspace_id;
    insert into lifecycle_emails (email_type, workspace_id, sent_at, delivered_at, attempts, ref_at)
      values ('reverse_trial_ending', f.workspace_id, now(), now(), 1, now() + interval '2 days');
    select count(*) into n from get_reverse_trial_email_candidates() c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'ending: delivered row not skipped'; end if;
    update workspaces set reverse_trial_ends_at = now() + interval '3 days' where id = f.workspace_id;
    select * into r from get_reverse_trial_email_candidates() c where c.workspace_id = f.workspace_id;
    if r.email_type is distinct from 'reverse_trial_ending' or r.attempts <> 0 then
      raise exception 'ending: moved ref_at not a candidate again: %', row_to_json(r);
    end if;
  end $$;
rollback;

-- 4.6 reverse_trial_ended (states the pause date), skip_ended_email_after_late_convert
begin;
  do $$
  declare f record; r record; n int;
  begin
    select * into f from et_rt_trial('14 days', '-1 minute');
    insert into checkout_attempts (workspace_id, stripe_session_id, plan_id, created_at)
      values (f.workspace_id, 'cs_' || f.workspace_id, 'pro', now() - interval '1 hour');
    perform end_reverse_trial(f.workspace_id);
    select * into r from get_reverse_trial_email_candidates() c where c.workspace_id = f.workspace_id;
    if r.email_type is distinct from 'reverse_trial_ended' or r.ref_at <> now()
       or r.ended_at <> now() or r.hub_pause_at <> now() + interval '7 days' then
      raise exception 'ended: %', row_to_json(r);
    end if;
    perform convert_reverse_trial(f.workspace_id, 'pro', 'stripe');
    select count(*) into n from get_reverse_trial_email_candidates() c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'skip_ended_email_after_late_convert: % rows', n; end if;
  end $$;
rollback;

-- 4.7 hub_pausing_only_with_tokens, ended email stops at the pause
begin;
  select et_grant_hosted_parity();
  do $$
  declare f record; r record; n int; v_cli bigint;
  begin
    select * into f from et_rt_trial('14 days', '-1 minute');
    perform end_reverse_trial(f.workspace_id);
    insert into lifecycle_emails (email_type, workspace_id, sent_at, delivered_at, attempts, ref_at)
      select 'reverse_trial_ended', f.workspace_id, now(), now(), 1, reverse_trial_ended_at
        from workspaces where id = f.workspace_id;
    update workspaces set reverse_trial_ended_at = now() - interval '6 days 2 hours' where id = f.workspace_id;
    -- no Hub link: nothing (ended row's ref_at moved with ended_at, so the ended email is due
    -- again in this artificial setup; only hub_pausing is asserted)
    select count(*) into n from get_reverse_trial_email_candidates() c
     where c.workspace_id = f.workspace_id and c.email_type = 'reverse_trial_hub_pausing';
    if n <> 0 then raise exception 'hub_pausing_only_with_tokens: sent without tokens'; end if;

    update workspaces set plan_id = 'pro' where id = f.workspace_id;
    insert into clientes (user_id, conta_id, nome, sigla, cor)
      values (f.user_id, f.workspace_id, 'Cliente', 'C', '#000') returning id into v_cli;
    insert into client_hub_tokens (cliente_id, conta_id) values (v_cli, f.workspace_id);
    update workspaces set plan_id = 'free' where id = f.workspace_id;
    select * into r from get_reverse_trial_email_candidates() c
     where c.workspace_id = f.workspace_id and c.email_type = 'reverse_trial_hub_pausing';
    if r.workspace_id is null or r.ref_at <> now() - interval '6 days 2 hours' + interval '7 days' then
      raise exception 'hub_pausing: %', row_to_json(r);
    end if;
    -- inactive token: nothing
    update client_hub_tokens set is_active = false where conta_id = f.workspace_id;
    select count(*) into n from get_reverse_trial_email_candidates() c
     where c.workspace_id = f.workspace_id and c.email_type = 'reverse_trial_hub_pausing';
    if n <> 0 then raise exception 'hub_pausing: inactive token counted'; end if;

    -- after the pause: neither ended nor hub_pausing
    update client_hub_tokens set is_active = true where conta_id = f.workspace_id;
    update workspaces set reverse_trial_ended_at = now() - interval '7 days' where id = f.workspace_id;
    select count(*) into n from get_reverse_trial_email_candidates() c where c.workspace_id = f.workspace_id;
    if n <> 0 then raise exception 'emails after the pause: % rows', n; end if;
  end $$;
rollback;

-- 4.8 grants of the redefined and new service-role RPCs
begin;
  do $$
  declare fn text;
  begin
    foreach fn in array array[
      'get_nurture_candidates(timestamptz)', 'get_welcome_email_candidates()',
      'get_trial_reminder_candidates()', 'get_loops_trait_candidates()',
      'get_crisp_sync_candidates()', 'get_reverse_trial_email_candidates(timestamptz)',
      'admin_list_workspaces(text,text,int,int,timestamptz,text,boolean,text,timestamptz,text,text)'
    ] loop
      if has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE')
         or has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
         or not has_function_privilege('service_role', 'public.' || fn, 'EXECUTE') then
        raise exception 'grants: % has wrong EXECUTE grants', fn;
      end if;
    end loop;
  end $$;
rollback;


drop function if exists et_rt_owner();
drop function if exists et_rt_switch_on(timestamptz);
drop function if exists et_rt_as(uuid);
drop function if exists et_rt_trial(interval, interval);
