\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Fase 3 (Task 2): suite for 20260903000030_workflow_analytics_events.sql, the
-- CREATE OR REPLACE of get_workflow_analytics that layers event-derived
-- metrics (aprovacao_cliente, origem, horizonte, retrabalho) on top of the
-- Fase 2 contract verified by suite 73. Mirrors 73's harness conventions
-- (et_make_workspace, auth.users + workspace_members + profiles for JWT
-- identity, begin/do $$/rollback per section, plain postgres -- no
-- `set local role authenticated` needed since the RPC is SECURITY INVOKER
-- with an explicit conta_id guard, not an RLS-dependent one).
--
-- REAL TRIGGERS, NOT STAND-INS. Coverage item 1 requires driving
-- workflow_posts.status through the actual capture trigger
-- (record_post_status_event, 20260805000001) and the actual client-approval
-- RPC (record_client_approval, 20260606000001) -- not hand-built
-- post_status_events rows. Actor/source resolution follows the trigger's own
-- rules: request.jwt.claims -> auth.uid() gives a 'workspace_user' actor by
-- default; set_config('app.event_source', 'client', true) (directly, or via
-- record_client_approval, which sets it internally) forces 'client';
-- set_config('app.post_approval_id', ...) links a real post_approvals row.
-- Both record_client_approval and record_post_status_event are SECURITY
-- DEFINER and REVOKE ALL FROM PUBLIC / GRANT ... TO service_role -- calling
-- them as the *owner* (postgres, since these suites apply every migration as
-- postgres, matching how `supabase db reset` runs) works regardless: a
-- function's owner always retains EXECUTE, REVOKE FROM PUBLIC notwithstanding.
--
-- GUC HYGIENE. app.event_source / app.post_approval_id set by
-- record_client_approval are transaction-LOCAL but outlive the function call
-- (plpgsql has no sub-transaction scoping for `true`-scoped set_config). Every
-- section that mixes a client-sourced close with a later workspace_user step
-- explicitly clears both back to '' first, or the later step would silently
-- inherit 'client' classification.
--
-- TRANSACTION-NOW() GOTCHA (same as suite 73): now() is transaction_timestamp,
-- fixed for the whole `do $$ ... $$` block. Sections that need distinct,
-- controllable hour deltas for latency math (1) drive the transition through
-- the real trigger to get correct source/actor/post_approval_id resolution,
-- then (2) backdate the ONE resulting post_status_events row via a direct
-- UPDATE (id = the just-inserted row, found by `order by id desc limit 1`
-- scoped to that post). This keeps classification trigger-authentic while
-- making the elapsed-hours arithmetic exact and reproducible. Section 74.9's
-- fixture is the deliberate exception: it leaves both events at the shared
-- transaction now() to exercise the (created_at, id) tiebreaker itself.

-- =====================================================================
-- 1. Cycle pairing end-to-end through the REAL trigger: workspace_user
--    (JWT actor) opens, client closes via record_client_approval AND via a
--    raw set_config + a real post_approvals row (the post_approval_id
--    override), a from=to custom-only move does not open a second cycle,
--    a re-send after correction yields two cycles, and same-transaction
--    open+close (the (created_at,id) tiebreaker) still closes the cycle.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint;
  v_p1 bigint; v_p2 bigint; v_p3 bigint; v_p4 bigint; v_p5 bigint; v_p9 bigint;
  v_appr bigint;
  v_def uuid;
  v_result jsonb;
  v_aprov jsonb;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C1', 'C1', '#000') returning id into v_cli;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- P1: workspace_user opens, client closes via record_client_approval -- 2h.
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_p1;
  update workflow_posts set status = 'enviado_cliente' where id = v_p1;
  update post_status_events set created_at = timestamptz '2026-01-01 00:00:00+00'
    where id = (select id from post_status_events where post_id = v_p1 order by id desc limit 1);

  perform record_client_approval(v_p1, 'tok1', 'aprovado', null, false, 'aprovado_cliente');
  update post_status_events set created_at = timestamptz '2026-01-01 02:00:00+00'
    where id = (select id from post_status_events where post_id = v_p1 order by id desc limit 1);
  perform set_config('app.event_source', '', true);
  perform set_config('app.post_approval_id', '', true);

  -- P2: re-send after correction -- must yield 2 cycles (1 pelo cliente 1h,
  -- 1 resolved internally 1h), not 1.
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_p2;
  update workflow_posts set status = 'enviado_cliente' where id = v_p2;
  update post_status_events set created_at = timestamptz '2026-01-02 00:00:00+00'
    where id = (select id from post_status_events where post_id = v_p2 order by id desc limit 1);

  perform record_client_approval(v_p2, 'tok2a', 'correcao', 'ajusta o texto', false, 'correcao_cliente');
  update post_status_events set created_at = timestamptz '2026-01-02 01:00:00+00'
    where id = (select id from post_status_events where post_id = v_p2 order by id desc limit 1);
  perform set_config('app.event_source', '', true);
  perform set_config('app.post_approval_id', '', true);

  update workflow_posts set status = 'enviado_cliente' where id = v_p2; -- re-send
  update post_status_events set created_at = timestamptz '2026-01-02 03:00:00+00'
    where id = (select id from post_status_events where post_id = v_p2 order by id desc limit 1);

  update workflow_posts set status = 'aprovado_cliente' where id = v_p2; -- closed internally, no client/approval
  update post_status_events set created_at = timestamptz '2026-01-02 04:00:00+00'
    where id = (select id from post_status_events where post_id = v_p2 order by id desc limit 1);

  -- P3: opened, never closed -- pendente.
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_p3;
  update workflow_posts set status = 'enviado_cliente' where id = v_p3;
  update post_status_events set created_at = timestamptz '2026-01-03 00:00:00+00'
    where id = (select id from post_status_events where post_id = v_p3 order by id desc limit 1);

  -- P4: a custom-only move at enviado_cliente (canonical status unchanged)
  -- must audit a from=to row and must NOT open a second cycle.
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_p4;
  update workflow_posts set status = 'enviado_cliente' where id = v_p4;
  update post_status_events set created_at = timestamptz '2026-01-04 00:00:00+00'
    where id = (select id from post_status_events where post_id = v_p4 order by id desc limit 1);

  insert into post_status_definitions (conta_id, nome, behaves_as)
    values (v_ws, 'Enviado (custom)', 'enviado_cliente') returning id into v_def;
  update workflow_posts set custom_status_id = v_def where id = v_p4;

  assert (select from_status from post_status_events where post_id = v_p4 order by id desc limit 1) =
         (select to_status from post_status_events where post_id = v_p4 order by id desc limit 1),
    'setup sanity: the custom-only move must audit a from=to (enviado_cliente -> enviado_cliente) event';

  perform record_client_approval(v_p4, 'tok4', 'aprovado', null, false, 'aprovado_cliente');
  update post_status_events set created_at = timestamptz '2026-01-04 05:00:00+00'
    where id = (select id from post_status_events where post_id = v_p4 order by id desc limit 1);
  perform set_config('app.event_source', '', true);
  perform set_config('app.post_approval_id', '', true);

  -- P5: post_approval_id overrides source -- a workspace_user-sourced close
  -- carrying a real post_approvals row must still classify pelo cliente.
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_p5;
  update workflow_posts set status = 'enviado_cliente' where id = v_p5;
  update post_status_events set created_at = timestamptz '2026-01-05 00:00:00+00'
    where id = (select id from post_status_events where post_id = v_p5 order by id desc limit 1);

  insert into post_approvals (post_id, token, action, is_workspace_user)
    values (v_p5, 'tok5', 'aprovado', true) returning id into v_appr;
  perform set_config('app.event_source', 'workspace_user', true);
  perform set_config('app.post_approval_id', v_appr::text, true);
  update workflow_posts set status = 'aprovado_cliente' where id = v_p5;
  update post_status_events set created_at = timestamptz '2026-01-05 03:00:00+00'
    where id = (select id from post_status_events where post_id = v_p5 order by id desc limit 1);
  perform set_config('app.event_source', '', true);
  perform set_config('app.post_approval_id', '', true);

  -- P9: same-transaction open+close -- both events share this transaction's
  -- now(), so only the (created_at, id) tiebreaker (not created_at alone)
  -- can find the close.
  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws, v_cli, 'rascunho') returning id into v_p9;
  update workflow_posts set status = 'enviado_cliente' where id = v_p9;
  perform record_client_approval(v_p9, 'tok9', 'aprovado', null, false, 'aprovado_cliente');
  perform set_config('app.event_source', '', true);
  perform set_config('app.post_approval_id', '', true);

  assert (select count(distinct created_at) from post_status_events where post_id = v_p9) = 1,
    'setup sanity: P9''s open and close events must share one transaction-time timestamp';

  select get_workflow_analytics(timestamptz '2020-01-01', timestamptz '2027-01-01') into v_result;
  v_aprov := v_result -> 'aprovacao_cliente';

  assert (v_aprov->>'amostras')::int = 5,
    format('expected 5 pelo-cliente cycles (P1, P2''s first cycle, P4, P5, P9), got %s', v_aprov);
  assert (v_aprov->>'mediana_horas')::numeric = 2.0,
    format('median of the 5 latencies [0,1,2,3,5]h must be 2.0, got %s', v_aprov->>'mediana_horas');
  assert (v_aprov->>'pendentes')::int = 1,
    format('P3 must be the only pendente cycle, got %s', v_aprov);
  assert (v_aprov->>'resolvidos_internamente')::int = 1,
    format('P2''s second cycle must be the only internally-resolved one, got %s', v_aprov);

  raise notice 'PASS 74.1 cycle pairing through the real trigger (workspace_user/client actors, from=to guard, re-send=2 cycles, same-tx tiebreaker)';
end $$;
rollback;

-- =====================================================================
-- 4. aprovacao_cliente.etapas counts only post-less workflows (the
--    complement to the post-cycle stats).
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint;
  v_wf_noposts bigint; v_wf_withpost bigint;
  v_result jsonb;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- Workflow WITHOUT any posts: its aprovacao_cliente etapa counts toward
  -- the complement.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF sem posts', 'ativo') returning id into v_wf_noposts;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, status, iniciado_em, concluido_em)
    values (v_wf_noposts, 1, 'Aprovação do cliente', 3, 'aprovacao_cliente', 'concluido',
            timestamptz '2026-02-01 00:00:00+00', timestamptz '2026-02-01 08:00:00+00');

  -- Workflow WITH a post attached: an identically-shaped aprovacao_cliente
  -- etapa must be EXCLUDED from the complement.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF com posts', 'ativo') returning id into v_wf_withpost;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, status, iniciado_em, concluido_em)
    values (v_wf_withpost, 1, 'Aprovação do cliente', 3, 'aprovacao_cliente', 'concluido',
            timestamptz '2026-02-05 00:00:00+00', timestamptz '2026-02-05 12:00:00+00');
  insert into workflow_posts (conta_id, cliente_id, workflow_id, status)
    values (v_ws, v_cli, v_wf_withpost, 'rascunho');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  select get_workflow_analytics(timestamptz '2026-02-01', timestamptz '2026-03-01') into v_result;

  assert (v_result->'aprovacao_cliente'->'etapas'->>'amostras')::int = 1,
    format('only the post-less workflow''s aprovacao_cliente etapa must count, got %s', v_result->'aprovacao_cliente'->'etapas');
  assert (v_result->'aprovacao_cliente'->'etapas'->>'mediana_horas')::numeric = 8.0,
    format('the one counted etapa took exactly 8h, got %s', v_result->'aprovacao_cliente'->'etapas'->>'mediana_horas');

  raise notice 'PASS 74.4 aprovacao_cliente.etapas counts only post-less workflows';
end $$;
rollback;

-- =====================================================================
-- 5. Retrabalho attribution (voltou_de vs fallback to the event's own
--    etapa_nome) and kpis.retrabalho_pct math -- driven through the real
--    workflow_etapas trigger's two-write revert pattern.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint;
  v_ma bigint; v_mb bigint;
  v_wf bigint; v_wf_norev bigint;
  v_e1 bigint; v_e2 bigint; v_e3 bigint; v_e4 bigint;
  v_result jsonb;
  v_etapas jsonb;
  v_equipe jsonb;
  v_from timestamptz := now() - interval '1 hour';
  v_to timestamptz := now() + interval '1 hour';
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_user, v_ws, 'Membro A', v_user) returning id into v_ma;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'Membro B') returning id into v_mb;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF retrabalho', 'ativo') returning id into v_wf;

  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id)
    values (v_wf, 1, 'Roteiro', 3, 'padrao', v_mb) returning id into v_e1;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id)
    values (v_wf, 2, 'Edição', 3, 'padrao', v_mb) returning id into v_e2;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id)
    values (v_wf, 3, 'Revisão interna', 3, 'padrao', v_ma) returning id into v_e3;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id)
    values (v_wf, 4, 'Aprovação do cliente', 3, 'aprovacao_cliente', v_mb) returning id into v_e4;

  -- E1 Roteiro: completed once, never touched again.
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = v_e1;
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_e1;

  -- E2 Edição: completed once (will be reopened and re-closed by the revert below).
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = v_e2;
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_e2;

  -- E3 Revisão interna: started, not yet concluded.
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = v_e3;

  -- Revert case (a): back out of E3 to reopen E2. The trigger's own two-write
  -- pattern -- the later etapa (E3) first goes ativo->pendente ("nothing"),
  -- then the earlier etapa (E2) goes concluido->ativo (etapa_revertida). The
  -- resulting event's metadata.voltou_de must name E3 ("Revisão interna"),
  -- the etapa actually backed out of -- NOT E2's own etapa_nome ("Edição").
  update workflow_etapas set status = 'pendente' where id = v_e3;
  update workflow_etapas set status = 'ativo' where id = v_e2;

  assert (select metadata->>'voltou_de' from workflow_events
          where workflow_id = v_wf and event_type = 'etapa_revertida' and etapa_id = v_e2) = 'Revisão interna',
    'setup sanity: reverting E2 must attribute voltou_de to Revisão interna (E3), the etapa backed out of';

  -- Bring Edição and Revisão interna back to concluido so both have a
  -- denominator in the Fase 2 etapas[] array (etapas_agg only reflects the
  -- CURRENT row state).
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_e2;
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = v_e3;
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_e3;

  -- Revert case (b): E4 (the LAST etapa by ordem) reverted directly, with no
  -- etapa after it -- the metadata lookup finds nothing, so attribution must
  -- fall back to the event's own etapa_nome ("Aprovação do cliente").
  update workflow_etapas set status = 'ativo', iniciado_em = now() where id = v_e4;
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_e4;
  update workflow_etapas set status = 'ativo' where id = v_e4;

  assert (select metadata ? 'voltou_de' from workflow_events
          where workflow_id = v_wf and event_type = 'etapa_revertida' and etapa_id = v_e4) = false,
    'setup sanity: reverting the last etapa (E4) must carry no voltou_de metadata';

  -- Re-conclude E4 so it too has a current 'concluido' row (a denominator).
  update workflow_etapas set status = 'concluido', concluido_em = now() where id = v_e4;

  -- Second workflow with activity but zero reverts: gives kpis.retrabalho_pct
  -- a real (non-100%) denominator.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF sem retrabalho', 'ativo') returning id into v_wf_norev;

  select get_workflow_analytics(v_from, v_to) into v_result;
  v_etapas := v_result -> 'etapas';
  v_equipe := v_result -> 'equipe';

  assert (v_result->'kpis'->>'retrabalho_pct')::int = 50,
    format('1 of 2 workflows with events in the window had a revert -> retrabalho_pct 50, got %s', v_result->'kpis'->>'retrabalho_pct');

  assert (select (e->>'retrabalho_pct')::int from jsonb_array_elements(v_etapas) e where e->>'nome' = 'Revisão interna') = 100,
    format('Revisão interna: 1 revert attributed to it via voltou_de over 1 conclusion -> 100, got %s', v_etapas);
  assert (select (e->>'retrabalho_pct')::int from jsonb_array_elements(v_etapas) e where e->>'nome' = 'Aprovação do cliente') = 50,
    format('Aprovação do cliente: 1 revert (fallback to its own etapa_nome) over 2 conclusions -> 50, got %s', v_etapas);
  assert (select (e->>'retrabalho_pct')::int from jsonb_array_elements(v_etapas) e where e->>'nome' = 'Edição') = 0,
    format('Edição: concluded with zero reverts naming it -> 0 (measured, not null), got %s', v_etapas);
  assert (select (e->>'retrabalho_pct')::int from jsonb_array_elements(v_etapas) e where e->>'nome' = 'Roteiro') = 0,
    format('Roteiro: concluded once with zero reverts -> 0, got %s', v_etapas);

  assert (select (m->>'retrabalho')::int from jsonb_array_elements(v_equipe) m where (m->>'membro_id')::bigint = v_ma) = 1,
    format('Membro A (responsavel of E3, the etapa named in voltou_de) must show retrabalho 1, got %s', v_equipe);
  assert (select (m->>'retrabalho')::int from jsonb_array_elements(v_equipe) m where (m->>'membro_id')::bigint = v_mb) = 0,
    format('Membro B (responsavel of E1/E2/E4, none named as a voltou_de target) must show retrabalho 0, got %s', v_equipe);

  raise notice 'PASS 74.5 retrabalho attribution (voltou_de + fallback to etapa_nome) and kpis.retrabalho_pct math';
end $$;
rollback;

-- =====================================================================
-- 10. A malformed metadata.voltou_de_etapa_id (1.5, a non-numeric string,
--     1e300, JSON null) must not raise -- the RPC returns a normal payload
--     and only the well-formed revert counts.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_m bigint;
  v_wf bigint; v_etapa bigint;
  v_result jsonb;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'M') returning id into v_m;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user, v_ws, v_cli, 'WF guard', 'ativo') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id)
    values (v_wf, 1, 'Alvo', 3, 'padrao', v_m) returning id into v_etapa;

  -- Four malformed etapa_revertida events, inserted directly (the real
  -- trigger, 20260826000001, never itself writes a non-integer here -- this
  -- proves the guard is total against a future writer/import/backfill, not
  -- that today's trigger produces bad data).
  insert into workflow_events (workflow_id, conta_id, event_type, etapa_id, etapa_nome, source, metadata) values
    (v_wf, v_ws, 'etapa_revertida', v_etapa, 'Alvo', 'workspace_user', jsonb_build_object('voltou_de_etapa_id', 1.5)),
    (v_wf, v_ws, 'etapa_revertida', v_etapa, 'Alvo', 'workspace_user', jsonb_build_object('voltou_de_etapa_id', 'nao-e-numero')),
    (v_wf, v_ws, 'etapa_revertida', v_etapa, 'Alvo', 'workspace_user', jsonb_build_object('voltou_de_etapa_id', 1e300)),
    (v_wf, v_ws, 'etapa_revertida', v_etapa, 'Alvo', 'workspace_user', jsonb_build_object('voltou_de_etapa_id', null));

  -- One well-formed event: the only one that must actually count.
  insert into workflow_events (workflow_id, conta_id, event_type, etapa_id, etapa_nome, source, metadata) values
    (v_wf, v_ws, 'etapa_revertida', v_etapa, 'Alvo', 'workspace_user', jsonb_build_object('voltou_de_etapa_id', v_etapa));

  update workflow_etapas set status = 'concluido', iniciado_em = now(), concluido_em = now() where id = v_etapa;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  select get_workflow_analytics(now() - interval '1 hour', now() + interval '1 hour') into v_result;

  assert v_result is not null,
    'a malformed voltou_de_etapa_id (1.5 / string / 1e300 / null) must not crash the whole RPC';

  assert (select (m->>'retrabalho')::int from jsonb_array_elements(v_result->'equipe') m
          where (m->>'membro_id')::bigint = v_m) = 1,
    format('exactly the one well-formed revert must count -- the four malformed ones must be silently skipped, got %s', v_result->'equipe');

  raise notice 'PASS 74.10 malformed voltou_de_etapa_id (1.5/string/1e300/null) does not raise, malformed rows are skipped';
end $$;
rollback;

-- =====================================================================
-- 6. horizonte: min(created_at) per source, unwindowed, and strictly
--    tenant-isolated.
-- =====================================================================
begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user_a uuid := gen_random_uuid(); v_user_b uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_wf_a1 bigint; v_wf_a2 bigint; v_wf_b bigint;
  v_post_a bigint; v_post_b bigint;
  v_result_a jsonb; v_result_b jsonb;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user_a), (v_user_b);
  insert into workspace_members (user_id, workspace_id, role) values (v_user_a, v_ws_a, 'owner');
  insert into workspace_members (user_id, workspace_id, role) values (v_user_b, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user_a;
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_user_b;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user_a, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user_b, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  -- Workspace A: workflow_events minimum 2026-03-01 (a newer 2026-05-01 row
  -- must not win the MIN); post_status_events minimum 2026-04-01.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user_a, v_ws_a, v_cli_a, 'A1', 'ativo') returning id into v_wf_a1;
  update workflow_events set created_at = timestamptz '2026-03-01' where workflow_id = v_wf_a1;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user_a, v_ws_a, v_cli_a, 'A2', 'ativo') returning id into v_wf_a2;
  update workflow_events set created_at = timestamptz '2026-05-01' where workflow_id = v_wf_a2;

  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_a, v_cli_a, 'rascunho') returning id into v_post_a;
  update workflow_posts set status = 'enviado_cliente' where id = v_post_a;
  update post_status_events set created_at = timestamptz '2026-04-01' where post_id = v_post_a;

  -- Workspace B: much older minima -- the canary for any cross-tenant leak.
  insert into workflows (user_id, conta_id, cliente_id, titulo, status)
    values (v_user_b, v_ws_b, v_cli_b, 'B1', 'ativo') returning id into v_wf_b;
  update workflow_events set created_at = timestamptz '2020-06-15' where workflow_id = v_wf_b;

  insert into workflow_posts (conta_id, cliente_id, status) values (v_ws_b, v_cli_b, 'rascunho') returning id into v_post_b;
  update workflow_posts set status = 'enviado_cliente' where id = v_post_b;
  update post_status_events set created_at = timestamptz '2020-07-20' where post_id = v_post_b;

  -- Deliberately narrow, unrelated window: horizonte is documented as
  -- unwindowed, so it must reflect the true minima above regardless of
  -- [p_from, p_to).
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_a)::text, true);
  select get_workflow_analytics(timestamptz '2026-08-01', timestamptz '2026-09-01') into v_result_a;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user_b)::text, true);
  select get_workflow_analytics(timestamptz '2026-08-01', timestamptz '2026-09-01') into v_result_b;

  assert (v_result_a->'horizonte'->>'workflow_events_since') = '2026-03-01T00:00:00+00:00',
    format('workspace A workflow_events_since must be its own oldest event (2026-03-01), unwindowed, got %s', v_result_a->'horizonte');
  assert (v_result_a->'horizonte'->>'post_events_since') = '2026-04-01T00:00:00+00:00',
    format('workspace A post_events_since must be 2026-04-01, got %s', v_result_a->'horizonte');

  assert (v_result_b->'horizonte'->>'workflow_events_since') = '2020-06-15T00:00:00+00:00',
    format('workspace B must see its own much-older minimum -- no leak from/into A, got %s', v_result_b->'horizonte');
  assert (v_result_b->'horizonte'->>'post_events_since') = '2020-07-20T00:00:00+00:00',
    format('workspace B post_events_since must be 2020-07-20, got %s', v_result_b->'horizonte');

  raise notice 'PASS 74.6 horizonte per-source minima, unwindowed and tenant-isolated';
end $$;
rollback;

-- =====================================================================
-- 7. Superset: every Fase 2 field is still present and correct on the same
--    kind of fixture (spot-check kpis + etapas + equipe), alongside the new
--    Fase 3 keys.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_m bigint;
  v_wf bigint;
  v_result jsonb;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'M') returning id into v_m;

  insert into workflows (user_id, conta_id, cliente_id, titulo, status, concluido_em)
    values (v_user, v_ws, v_cli, 'WF super', 'concluido', timestamptz '2026-06-15 10:00:00+00') returning id into v_wf;
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id, status, iniciado_em, concluido_em)
    values (v_wf, 1, 'Etapa Super', 3, 'padrao', v_m, 'concluido',
            timestamptz '2026-06-10 10:00:00+00', timestamptz '2026-06-12 10:00:00+00');

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  select get_workflow_analytics(timestamptz '2026-06-01', timestamptz '2026-07-01') into v_result;

  assert (v_result->'kpis'->>'concluidos')::int = 1, format('Fase 2 kpis.concluidos must survive, got %s', v_result->'kpis');
  assert (v_result->'kpis'->>'tempo_medio_dias')::numeric = 5.0,
    format('Fase 2 kpis.tempo_medio_dias must survive at 5.0, got %s', v_result->'kpis'->>'tempo_medio_dias');
  assert jsonb_array_length(v_result->'etapas') = 1, format('Fase 2 etapas[] must still carry the one etapa, got %s', v_result->'etapas');
  assert v_result->'etapas'->0->>'nome' = 'Etapa Super', format('etapas[0].nome must survive, got %s', v_result->'etapas');
  assert (v_result->'etapas'->0->>'media_dias')::numeric = 2.0, format('etapas[0].media_dias must survive at 2.0, got %s', v_result->'etapas');
  assert jsonb_array_length(v_result->'equipe') = 1, format('Fase 2 equipe[] must still carry the one membro, got %s', v_result->'equipe');
  assert (v_result->'equipe'->0->>'membro_id')::bigint = v_m, format('equipe[0].membro_id must survive, got %s', v_result->'equipe');
  assert (v_result->'equipe'->0->>'concluidas')::int = 1, format('equipe[0].concluidas must survive at 1, got %s', v_result->'equipe');

  -- The new Fase 3 keys must be present alongside the untouched Fase 2 ones.
  assert v_result ? 'horizonte', 'horizonte key must be present';
  assert v_result ? 'aprovacao_cliente', 'aprovacao_cliente key must be present';
  assert v_result ? 'origem', 'origem key must be present';
  assert v_result->'kpis' ? 'retrabalho_pct', 'kpis.retrabalho_pct must be present';
  assert v_result->'kpis' ? 'retrabalho_prev', 'kpis.retrabalho_prev must be present';
  assert v_result->'kpis' ? 'etapas_avaliadas_prev', 'kpis.etapas_avaliadas_prev must be present';
  assert v_result->'etapas'->0 ? 'retrabalho_pct', 'etapas[].retrabalho_pct must be present';
  assert v_result->'equipe'->0 ? 'retrabalho', 'equipe[].retrabalho must be present';
  assert v_result->'equipe'->0 ? 'atividade', 'equipe[].atividade must be present';

  raise notice 'PASS 74.7 superset: every Fase 2 field still present and correct alongside the new Fase 3 fields';
end $$;
rollback;

-- =====================================================================
-- 8. Grants: still locked after the Fase 3 CREATE OR REPLACE (Supabase's
--    default ACL reapplies EXECUTE for anon/authenticated on every REPLACE,
--    which is exactly why the migration re-runs the revoke/grant triple).
-- =====================================================================
begin;
do $$
begin
  assert has_function_privilege(
      'authenticated',
      'public.get_workflow_analytics(timestamptz,timestamptz,text,bigint,bigint,bigint)', 'EXECUTE') = true,
    'authenticated must retain EXECUTE after the Fase 3 CREATE OR REPLACE';
  assert has_function_privilege(
      'service_role',
      'public.get_workflow_analytics(timestamptz,timestamptz,text,bigint,bigint,bigint)', 'EXECUTE') = true,
    'service_role must retain EXECUTE after the Fase 3 CREATE OR REPLACE';
  assert has_function_privilege(
      'anon',
      'public.get_workflow_analytics(timestamptz,timestamptz,text,bigint,bigint,bigint)', 'EXECUTE') = false,
    'anon must still be locked out after the Fase 3 CREATE OR REPLACE';

  raise notice 'PASS 74.8 grants still locked after CREATE OR REPLACE (anon revoked, authenticated/service_role retained)';
end $$;
rollback;

-- =====================================================================
-- 11. Ordered-array determinism under ties: calling the RPC repeatedly with
--     identical arguments must return byte-identical array order every time,
--     the tie must resolve via the documented canonical tiebreaker
--     (membro_id ASC / nome ASC), and -- the part a pure output comparison on
--     a 2-row tie cannot prove -- the deployed function's SOURCE must still
--     carry the tiebreaker fragment of ALL FOUR ordered arrays: equipe[],
--     etapas[], aprovacao_cliente.por_cliente[] and origem[].
--
--     The behavioural half below exercises equipe[]/etapas[] only; the other
--     two are covered by the source guard. That is deliberate and not a gap
--     in disguise: por_cliente needs post_status_events cycle fixtures to
--     tie at all, and per the note below the source check is what actually
--     catches removal anyway -- the behavioural half cannot, on ties this
--     small. por_cliente is also the one where the stakes are highest:
--     pendente-only clientes all tie at NULL and the frontend slices the
--     top 8, so losing the tiebreaker changes WHICH clientes are shown.
--
--     WHY THE SOURCE CHECK, NOT JUST BEHAVIOUR (fix round 1 finding): on a
--     tiny, uncommitted (begin;/rollback;) 2-row tie like this one, Postgres
--     plans etapas_agg/equipe as a GroupAggregate over an explicit `Sort Key:
--     e.nome` / `Sort Key: e.responsavel_id` (confirmed with EXPLAIN
--     ANALYZE against this exact fixture) -- table stats for rows that were
--     never committed are always stale, so the planner never has the row
--     counts that would make it switch to HashAggregate. That Sort is
--     ASCENDING by construction, so it independently reproduces nome-ASC /
--     membro_id-ASC for the tied rows regardless of whether the outer
--     `ORDER BY ..., ea.nome` / `ORDER BY ..., eq.membro_id` fragment is
--     even still there. Concretely: stripping `, ea.nome` or `, eq.membro_id`
--     from the migration still passed every assertion below when this
--     section only compared behaviour -- confirmed by reapplying both
--     mutations and rerunning. No choice of tied *values* fixes this for
--     etapas (the coincidental sort key literally IS `nome`, so alphabetical
--     is alphabetical no matter which two names are picked); the explicit,
--     id-diverging-from-insertion-order membros fixture below is kept as
--     real defense against a wrong-direction mutation (ASC -> DESC, which
--     the behavioural assertions genuinely do catch), not as the guard
--     against outright removal -- that guard is the `pg_get_functiondef`
--     substring check.
-- =====================================================================
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid();
  v_cli bigint; v_m1 bigint; v_m2 bigint;
  v_id_lo bigint; v_id_hi bigint;
  v_wf bigint;
  v_result1 jsonb; v_result2 jsonb;
  v_src text;
  i int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- Explicit ids, HIGHER assigned to the row inserted FIRST: insertion order
  -- (Zeta then Alfa) deliberately diverges from membro_id ASC (Alfa's id is
  -- lower despite being inserted second). A regression to "whatever order
  -- the join happens to produce" instead of the documented `eq.membro_id`
  -- tiebreak -- e.g. a direction flip -- shows up as a real diff here.
  v_id_lo := nextval('membros_id_seq');
  v_id_hi := nextval('membros_id_seq');
  insert into membros (id, user_id, conta_id, nome) values (v_id_hi, v_user, v_ws, 'Zeta') returning id into v_m1;
  insert into membros (id, user_id, conta_id, nome) values (v_id_lo, v_user, v_ws, 'Alfa') returning id into v_m2;
  assert v_m1 > v_m2, 'setup sanity: Zeta (inserted first) must hold the higher id, diverging from insertion order';

  insert into workflows (user_id, conta_id, cliente_id, titulo, status) values (v_user, v_ws, v_cli, 'WF tie', 'ativo') returning id into v_wf;

  -- Two etapas with equal media_dias (tie); two membros each with exactly
  -- one concluded etapa (concluidas tie).
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id, status, iniciado_em, concluido_em)
    values (v_wf, 1, 'Zebra', 3, 'padrao', v_m1, 'concluido', now() - interval '2 days', now());
  insert into workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo, responsavel_id, status, iniciado_em, concluido_em)
    values (v_wf, 2, 'Alpha', 3, 'padrao', v_m2, 'concluido', now() - interval '2 days', now());

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  for i in 1..10 loop
    select get_workflow_analytics(now() - interval '1 hour', now() + interval '1 hour') into v_result2;
    if i = 1 then
      v_result1 := v_result2;
    else
      assert v_result1->'equipe' = v_result2->'equipe',
        format('equipe[] order must be stable across identical calls (call %s differed): %s vs %s', i, v_result1->'equipe', v_result2->'equipe');
      assert v_result1->'etapas' = v_result2->'etapas',
        format('etapas[] order must be stable across identical calls (call %s differed): %s vs %s', i, v_result1->'etapas', v_result2->'etapas');
    end if;
  end loop;

  assert (v_result1->'equipe'->0->>'membro_id')::bigint = least(v_m1, v_m2),
    format('tied equipe[] must break ties by membro_id ASC, got %s', v_result1->'equipe');
  assert v_result1->'etapas'->0->>'nome' = 'Alpha',
    format('tied etapas[] must break ties by nome ASC (Alpha before Zebra), got %s', v_result1->'etapas');

  -- The deterministic guard against silent removal (fix round 1): the
  -- deployed function's own source must still carry both ORDER BY
  -- tiebreaker fragments verbatim. pg_get_functiondef returns a
  -- LANGUAGE sql function's body essentially verbatim (confirmed: it
  -- reproduces this migration's exact text byte-for-byte here), so this is
  -- not a fuzzy/heuristic match.
  select pg_get_functiondef('get_workflow_analytics(timestamptz,timestamptz,text,bigint,bigint,bigint)'::regprocedure)
    into v_src;

  assert position('ORDER BY eq.concluidas DESC, eq.membro_id)' in v_src) > 0,
    'equipe[]''s ORDER BY must still carry the eq.membro_id tiebreaker in the deployed function source';
  assert position('ORDER BY ea.media_dias DESC NULLS LAST, ea.nome)' in v_src) > 0,
    'etapas[]''s ORDER BY must still carry the ea.nome tiebreaker in the deployed function source';

  -- Final fix wave: the other two ordered arrays get the same guard.
  -- por_cliente matters most of the three -- clientes with only pendentes
  -- ALL tie at mediana_horas NULL, and the frontend slices the top 8, so
  -- without the tiebreaker WHICH clientes are shown can change between
  -- identical requests, not merely their order.
  assert position('ORDER BY s.mediana_horas DESC NULLS LAST, s.cliente_id)' in v_src) > 0,
    'aprovacao_cliente.por_cliente[]''s ORDER BY must still carry the s.cliente_id tiebreaker in the deployed function source';
  assert position('ORDER BY concluidos DESC, origem)' in v_src) > 0,
    'origem[]''s ORDER BY must still carry the origem tiebreaker in the deployed function source';

  raise notice 'PASS 74.11 equipe[]/etapas[]/por_cliente[]/origem[] array order is deterministic under ties (10 identical calls + source-level tiebreaker guard on all four)';
end $$;
rollback;
