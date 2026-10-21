\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Interações com popups no histórico do workspace
-- (migration 20261004000001_audit_log_popup_interactions.sql):
--   (a) insert de authenticated em popup_interactions grava em audit_log com o
--       conta_id do usuário, action popup-<acao> e o título do popup.
--   (b) o título sobrevive à exclusão do popup (cascade em popup_interactions).
--   (c) usuário sem profile (sem workspace resolvível) não gera linha de
--       audit_log e o insert em popup_interactions segue ok.
--   (d) a função de trigger não é executável por anon/authenticated.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a   uuid;
  v_ua     uuid := gen_random_uuid();
  v_un     uuid := gen_random_uuid();
  v_popup  uuid;
  v_action text;
  v_n      int;
  v_row    audit_log%rowtype;
begin
  v_ws_a := et_make_workspace('start');
  insert into auth.users (id) values (v_ua), (v_un);
  insert into workspace_members (user_id, workspace_id, role) values (v_ua, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_ua;
  -- profiles.conta_id é NOT NULL: o caso sem workspace é o usuário sem profile.
  delete from profiles where id = v_un;

  insert into global_popups (pages, target_mode, status)
    values ('[{"title":"Novidades","body":"B"}]'::jsonb, 'all', 'active')
    returning id into v_popup;

  -- ---- (a) as quatro ações, inseridas por authenticated ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  foreach v_action in array array['seen', 'closed', 'cta', 'ack'] loop
    insert into popup_interactions (popup_id, user_id, action) values (v_popup, v_ua, v_action);
  end loop;
  execute 'reset role';

  select count(*) into v_n from audit_log
    where conta_id = v_ws_a and resource_type = 'popup' and resource_id = v_popup::text;
  assert v_n = 4, format('esperava 4 linhas de audit_log, veio %s', v_n);

  select * into v_row from audit_log
    where conta_id = v_ws_a and action = 'popup-cta' and resource_id = v_popup::text;
  assert v_row.actor_user_id = v_ua, 'actor_user_id não é o usuário da interação';
  assert v_row.metadata->>'title' = 'Novidades', 'título do popup ausente no metadata';
  assert v_row.metadata->>'popup_id' = v_popup::text, 'popup_id ausente no metadata';

  -- ---- (b) exclusão do popup preserva o histórico ----
  delete from global_popups where id = v_popup;
  select count(*) into v_n from audit_log
    where conta_id = v_ws_a and resource_id = v_popup::text
      and metadata->>'title' = 'Novidades';
  assert v_n = 4, 'histórico do popup sumiu após excluir o popup';

  -- ---- (c) usuário sem profile ----
  insert into global_popups (pages, target_mode, status)
    values ('[{"title":"Outro","body":"B"}]'::jsonb, 'all', 'active')
    returning id into v_popup;
  insert into popup_interactions (popup_id, user_id, action) values (v_popup, v_un, 'seen');
  select count(*) into v_n from popup_interactions where user_id = v_un;
  assert v_n = 1, 'interação de usuário sem profile não foi gravada';
  select count(*) into v_n from audit_log where actor_user_id = v_un;
  assert v_n = 0, 'usuário sem profile gerou linha de audit_log';

  -- ---- (d) grants ----
  assert has_function_privilege('anon', 'trg_audit_popup_interaction()', 'EXECUTE') = false,
    'anon executa trg_audit_popup_interaction';
  assert has_function_privilege('authenticated', 'trg_audit_popup_interaction()', 'EXECUTE') = false,
    'authenticated executa trg_audit_popup_interaction';

  raise notice 'PASS 99_audit_popup_interactions';
end $$;
rollback;
