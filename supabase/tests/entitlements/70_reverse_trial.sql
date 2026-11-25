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

-- @@TASK2@@

drop function if exists et_rt_owner();
drop function if exists et_rt_switch_on(timestamptz);
drop function if exists et_rt_as(uuid);
