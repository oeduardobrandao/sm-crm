\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Global popups (migration 20260907000010_global_popups.sql, spec 2026-09-04):
--   (a) RLS de global_popups: ativo + janela + targeting (all / plan / workspace),
--       mesmo predicado dos banners.
--   (b) popup_interactions: cada usuario le e insere so as proprias linhas.
--   (c) popup_interaction_counts: invisivel para authenticated.
--   (d) CHECKs: pages vazio, action invalida, require_ack + until_cta,
--       CTA por pagina (migration 20260907000020_popups_page_cta.sql).

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a      uuid;
  v_ws_b      uuid;
  v_ua        uuid := gen_random_uuid();
  v_ub        uuid := gen_random_uuid();
  v_p_all     uuid;
  v_p_ws_a    uuid;
  v_p_plan    uuid;
  v_p_draft   uuid;
  v_p_future  uuid;
  v_p_expired uuid;
  v_ids       uuid[];
  v_rejected  boolean;
  v_n         int;
  v_pages     jsonb := '[{"title":"T","body":"B"}]'::jsonb;
begin
  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('max');
  insert into auth.users (id) values (v_ua), (v_ub);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_ua, v_ws_a, 'owner'), (v_ub, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_ua;
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_ub;

  insert into global_popups (pages, target_mode, status)
    values (v_pages, 'all', 'active') returning id into v_p_all;
  insert into global_popups (pages, target_mode, target_workspace_ids, status)
    values (v_pages, 'workspace', array[v_ws_a], 'active') returning id into v_p_ws_a;
  insert into global_popups (pages, target_mode, target_plan_ids, status)
    values (v_pages, 'plan', array['max'], 'active') returning id into v_p_plan;
  insert into global_popups (pages, target_mode, status)
    values (v_pages, 'all', 'draft') returning id into v_p_draft;
  insert into global_popups (pages, target_mode, status, starts_at)
    values (v_pages, 'all', 'active', now() + interval '1 day') returning id into v_p_future;
  insert into global_popups (pages, target_mode, status, starts_at, ends_at)
    values (v_pages, 'all', 'active', now() - interval '2 day', now() - interval '1 day')
    returning id into v_p_expired;

  -- ---- (a) usuario A (workspace A, plano start) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ua, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_all = any(v_ids), 'A nao ve popup all';
  assert v_p_ws_a = any(v_ids), 'A nao ve popup direcionado ao proprio workspace';
  assert not (v_p_plan = any(v_ids)), 'A (start) ve popup do plano max';
  assert not (v_p_draft = any(v_ids)), 'A ve popup draft';
  assert not (v_p_future = any(v_ids)), 'A ve popup antes de starts_at';
  assert not (v_p_expired = any(v_ids)), 'A ve popup depois de ends_at';

  -- ---- (b) A insere a propria interacao, nao a de B ----
  insert into popup_interactions (popup_id, user_id, action) values (v_p_all, v_ua, 'seen');
  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_all, v_ub, 'seen');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'A conseguiu inserir interacao com user_id de B';

  -- popup que A nao enxerga (draft, plano max, fora da janela): insert rejeitado
  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_draft, v_ua, 'cta');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'A inseriu interacao em popup draft que nao enxerga';

  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_plan, v_ua, 'seen');
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'A inseriu interacao em popup de plano que nao enxerga';

  -- ---- (c) view invisivel para authenticated ----
  v_rejected := false;
  begin
    perform 1 from popup_interaction_counts;
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated conseguiu ler popup_interaction_counts';
  execute 'reset role';

  -- ---- (a) usuario B (workspace B, plano max) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ub, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select coalesce(array_agg(id), '{}') into v_ids from global_popups;
  assert v_p_all = any(v_ids), 'B nao ve popup all';
  assert v_p_plan = any(v_ids), 'B (max) nao ve popup do plano max';
  assert not (v_p_ws_a = any(v_ids)), 'B ve popup direcionado ao workspace A';
  select count(*) into v_n from popup_interactions;
  assert v_n = 0, 'B enxerga interacoes de A';
  execute 'reset role';

  -- ---- (d) CHECKs, como postgres ----
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode) values ('[]'::jsonb, 'all');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'pages vazio foi aceito';

  v_rejected := false;
  begin
    insert into popup_interactions (popup_id, user_id, action) values (v_p_all, v_ua, 'bogus');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'action invalida foi aceita';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, require_ack, frequency, cta_label, cta_url)
      values (v_pages, 'all', true, 'until_cta', 'Ver', '/x');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'require_ack + until_cta foi aceito';

  -- CTA por pagina: until_cta sem CTA global mas com CTA em alguma pagina e aceito
  insert into global_popups (pages, target_mode, frequency)
    values ('[{"title":"T","body":"B","cta_label":"Ver","cta_url":"/x"}]'::jsonb, 'all', 'until_cta');

  -- ... e sem CTA em lugar nenhum continua rejeitado
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, frequency)
      values ('[{"title":"T","body":"B","cta_url":null}]'::jsonb, 'all', 'until_cta');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'until_cta sem CTA global nem de pagina foi aceito';

  -- forma legada de pagina (sem a chave cta_url): tambem rejeitado
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, frequency)
      values (v_pages, 'all', 'until_cta');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'until_cta com paginas sem chave cta_url foi aceito';

  -- pagina com cta_url mas sem cta_label: CTA incompleto, tambem rejeitado
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, frequency)
      values ('[{"title":"T","body":"B","cta_url":"/x"}]'::jsonb, 'all', 'until_cta');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'until_cta com cta_url sem cta_label na pagina foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, cta_label) values (v_pages, 'all', 'Ver');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'cta_label sem cta_url foi aceito';

  -- array vazio (nao NULL): array_length devolve NULL e um CHECK ingenuo passaria
  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, target_plan_ids)
      values (v_pages, 'plan', '{}'::text[]);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'target_mode plan com array vazio foi aceito';

  v_rejected := false;
  begin
    insert into global_popups (pages, target_mode, target_workspace_ids)
      values (v_pages, 'workspace', '{}'::uuid[]);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'target_mode workspace com array vazio foi aceito';
end $$;
rollback;
