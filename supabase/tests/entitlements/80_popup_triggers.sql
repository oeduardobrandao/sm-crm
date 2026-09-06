\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Gatilhos de popup (migration 20260911000001_popup_triggers.sql, spec 2026-09-06):
--   (a) popup_trigger_matches + policy: so o DONO do workspace, e so enquanto a
--       assinatura estiver na situacao do gatilho; popup sem gatilho segue para todos.
--   (b) trial_ending respeita a janela de N dias e some com o teste vencido.
--   (c) popup_interactions: agente nao insere em popup com gatilho que nao ve.
--   (d) a funcao nao e executavel por anon.
--   (e) CHECKs: trigger invalido, trigger_days sem trial_ending (prova o coalesce),
--       trial_ending sem dias, faixa 1..60, frequency daily (com e sem require_ack).

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a     uuid;
  v_ws_b     uuid;
  v_owner_a  uuid := gen_random_uuid();
  v_agent_a  uuid := gen_random_uuid();
  v_owner_b  uuid := gen_random_uuid();
  v_p_plain  uuid;
  v_p_pay    uuid;
  v_p_trial3 uuid;
  v_p_trial1 uuid;
  v_p_down   uuid;
  v_ids      uuid[];
  v_rejected boolean;
  v_match    boolean;
  v_pages    jsonb := '[{"title":"T","body":"B"}]'::jsonb;
begin
  -- 'max' (nao 'start'): ws_a leva dono + agente, e o plano 'start' tem
  -- max_team_members=1 (enforce_plan_count_limit rejeitaria o 2o membro).
  -- O plano em si e irrelevante para o teste, que nao cobre target_mode='plan'.
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_owner_a), (v_agent_a), (v_owner_b);
  -- Membership ANTES do update de profiles: trg_validate_active_workspace recusa
  -- um active_workspace_id do qual o usuario ainda nao e membro.
  insert into workspace_members (user_id, workspace_id, role) values
    (v_owner_a, v_ws_a, 'owner'), (v_agent_a, v_ws_a, 'agent'), (v_owner_b, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
    where id in (v_owner_a, v_agent_a);
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_owner_b;
  insert into workspace_subscriptions (workspace_id, stripe_customer_id, status) values
    (v_ws_a, 'cus_et80_a', 'past_due'), (v_ws_b, 'cus_et80_b', 'active');

  insert into global_popups (pages, target_mode, status)
    values (v_pages, 'all', 'active') returning id into v_p_plain;
  insert into global_popups (pages, target_mode, status, trigger)
    values (v_pages, 'all', 'active', 'payment_pending') returning id into v_p_pay;
  insert into global_popups (pages, target_mode, status, trigger, trigger_days)
    values (v_pages, 'all', 'active', 'trial_ending', 3) returning id into v_p_trial3;
  insert into global_popups (pages, target_mode, status, trigger, trigger_days)
    values (v_pages, 'all', 'active', 'trial_ending', 1) returning id into v_p_trial1;
  insert into global_popups (pages, target_mode, status, trigger)
    values (v_pages, 'all', 'active', 'plan_downgraded') returning id into v_p_down;

  -- ---- (a) dono A, assinatura past_due ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_plain = any(v_ids), 'dono A nao ve popup sem gatilho';
  assert v_p_pay = any(v_ids), 'dono A (past_due) nao ve payment_pending';
  assert not (v_p_trial3 = any(v_ids)), 'dono A (past_due) ve trial_ending';
  assert not (v_p_down = any(v_ids)), 'dono A (past_due) ve plan_downgraded';
  select popup_trigger_matches('payment_pending', null) into v_match;
  assert v_match, 'popup_trigger_matches direto devolve false para o dono em past_due';
  select popup_trigger_matches(null, null) into v_match;
  assert v_match, 'popup_trigger_matches(null) deveria ser true';
  execute 'reset role';

  -- ---- (a) agente A: mesmo workspace, nao e dono ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_plain = any(v_ids), 'agente A nao ve popup sem gatilho';
  assert not (v_p_pay = any(v_ids)), 'agente A ve payment_pending do dono';
  select popup_trigger_matches('payment_pending', null) into v_match;
  assert not v_match, 'popup_trigger_matches direto devolve true para agente';
  -- (c) insert de interacao herda a policy de SELECT
  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_pay, v_agent_a, 'seen');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'agente A inseriu interacao em popup com gatilho que nao ve';
  execute 'reset role';

  -- ---- (a) dono B, assinatura active ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_plain = any(v_ids), 'dono B nao ve popup sem gatilho';
  assert not (v_p_pay = any(v_ids)), 'dono B (active) ve payment_pending';
  assert not (v_p_trial3 = any(v_ids)), 'dono B (active) ve trial_ending';
  assert not (v_p_down = any(v_ids)), 'dono B (active) ve plan_downgraded';
  execute 'reset role';

  -- ---- (b) dono A em teste terminando em 2 dias ----
  update workspace_subscriptions
    set status = 'trialing', current_period_end = now() + interval '2 days'
    where workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_trial3 = any(v_ids), 'dono A (teste em 2 dias) nao ve trial_ending 3';
  assert not (v_p_trial1 = any(v_ids)), 'dono A (teste em 2 dias) ve trial_ending 1';
  assert not (v_p_pay = any(v_ids)), 'dono A (trialing) ve payment_pending';
  execute 'reset role';

  -- (b) teste ja vencido: nenhum gatilho
  update workspace_subscriptions
    set current_period_end = now() - interval '1 hour' where workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert not (v_p_trial3 = any(v_ids)), 'dono A (teste vencido) ve trial_ending 3';
  assert v_p_plain = any(v_ids), 'dono A (teste vencido) perdeu o popup sem gatilho';
  execute 'reset role';

  -- (a) unpaid: so plan_downgraded
  update workspace_subscriptions set status = 'unpaid' where workspace_id = v_ws_a;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_down = any(v_ids), 'dono A (unpaid) nao ve plan_downgraded';
  assert not (v_p_pay = any(v_ids)), 'dono A (unpaid) ve payment_pending';
  execute 'reset role';

  -- ---- (d) anon nao executa a funcao ----
  execute 'set local role anon';
  v_rejected := false;
  begin
    perform popup_trigger_matches('payment_pending', null);
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'anon conseguiu executar popup_trigger_matches';
  execute 'reset role';

  -- ---- (e) CHECKs, como postgres ----
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger) values (v_pages, 'all', 'bogus');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trigger invalido foi aceito';

  -- trigger NULL com dias: sem o coalesce no CHECK isto passaria
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger_days) values (v_pages, 'all', 3);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trigger_days sem gatilho foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger, trigger_days)
      values (v_pages, 'all', 'payment_pending', 3);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trigger_days com payment_pending foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger) values (v_pages, 'all', 'trial_ending');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trial_ending sem trigger_days foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger, trigger_days)
      values (v_pages, 'all', 'trial_ending', 0);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trial_ending com 0 dias foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, trigger, trigger_days)
      values (v_pages, 'all', 'trial_ending', 61);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'trial_ending com 61 dias foi aceito';

  -- daily aceito, com e sem confirmacao obrigatoria
  insert into global_popups (pages, target_mode, frequency) values (v_pages, 'all', 'daily');
  insert into global_popups (pages, target_mode, frequency, require_ack)
    values (v_pages, 'all', 'daily', true);

  -- require_ack + until_cta continua proibido
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, require_ack, frequency, cta_label, cta_url)
      values (v_pages, 'all', true, 'until_cta', 'Ver', '/x');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'require_ack + until_cta foi aceito';
end $$;
rollback;
