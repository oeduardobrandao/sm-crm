\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Suite for the task history (20261103000002_tarefa_eventos.sql): events written only by
-- the AFTER triggers on tarefas / subtarefas / tarefa_tag_links, tenant-scoped snapshots,
-- triggers that never block a task write, the task cascade, and the one-off backfill.
-- Spec: docs/superpowers/specs/2026-10-28-tarefas-kpis-comentarios-historico-design.md (section 3).
--
-- tarefa_eventos is excluded from the parity helper everywhere, so every block tests the
-- migration's own grants (REVOKE ALL + SELECT).

-- =====================================================================
-- Shared seed (session-temporary; each block rolls back its data)
--   ws A: a (owner, membro Ana), membro m_resp (Rui), cliente cli_a, tag tg_a, series serie_a
--   ws B: bu (owner), membro m_b (Beto), cliente cli_b
-- =====================================================================
create or replace function pg_temp.te_seed() returns jsonb language plpgsql as $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_a uuid := gen_random_uuid(); v_bu uuid := gen_random_uuid();
  v_m_a bigint; v_m_resp bigint; v_m_b bigint;
  v_cli_a bigint; v_cli_b bigint; v_tg_a bigint; v_serie_a bigint;
begin
  v_ws_a := et_make_workspace('max');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_a), (v_bu);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_a, v_ws_a, 'owner'), (v_bu, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_a;
  update profiles set conta_id = v_ws_b, active_workspace_id = v_ws_b where id = v_bu;

  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_a, v_ws_a, 'Ana', v_a) returning id into v_m_a;
  insert into membros (user_id, conta_id, nome) values (v_a, v_ws_a, 'Rui') returning id into v_m_resp;
  insert into membros (user_id, conta_id, nome, crm_user_id) values (v_bu, v_ws_b, 'Beto', v_bu) returning id into v_m_b;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_a, v_ws_a, 'Cliente A', 'CA', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_bu, v_ws_b, 'Cliente B', 'CB', '#000') returning id into v_cli_b;
  insert into tarefa_tags (conta_id, nome, cor) values (v_ws_a, 'Urgente', '#ff0000') returning id into v_tg_a;
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws_a, v_a, 'daily', 'calendario', '2026-01-05', 'Serie') returning id into v_serie_a;

  return jsonb_build_object(
    'ws_a', v_ws_a, 'ws_b', v_ws_b, 'a', v_a, 'bu', v_bu,
    'm_a', v_m_a, 'm_resp', v_m_resp, 'm_b', v_m_b,
    'cli_a', v_cli_a, 'cli_b', v_cli_b, 'tg_a', v_tg_a, 'serie_a', v_serie_a);
end $$;

create or replace function pg_temp.te_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
end $$;

create or replace function pg_temp.te_count(p_tarefa bigint) returns int language sql as $$
  select count(*)::int from tarefa_eventos where tarefa_id = p_tarefa;
$$;

-- =====================================================================
-- insert_logs_criada
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_serie bigint := s->>'serie_a';
  v_t bigint; v_ev tarefa_eventos;
begin
  perform pg_temp.te_as(v_a);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'Nova') returning id into v_t;
  reset role;

  assert pg_temp.te_count(v_t) = 1, format('an insert must log exactly one event, got %s', pg_temp.te_count(v_t));
  select * into v_ev from tarefa_eventos where tarefa_id = v_t;
  assert v_ev.tipo = 'criada', format('tipo must be criada, got %s', v_ev.tipo);
  assert v_ev.actor_user_id = v_a and v_ev.actor_nome = 'Ana',
    format('actor must be the caller and their membro name, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);
  assert v_ev.de is null and v_ev.para = '{"serie": false}'::jsonb, format('criada para, got %s', v_ev.para);
  assert v_ev.conta_id = v_ws_a and v_ev.txid is not null, 'conta_id and txid must be set';

  -- serie_id is set only by the series RPCs (definer, so not current_user = authenticated);
  -- the owner insert stands in for them. request.jwt.claims still names a.
  insert into tarefas (conta_id, user_id, titulo, serie_id, data_limite)
    values (v_ws_a, v_a, 'Da serie', v_serie, '2026-01-05') returning id into v_t;
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'criada';
  assert v_ev.para = '{"serie": true}'::jsonb, format('criada of a series task, got %s', v_ev.para);
  assert v_ev.actor_user_id = v_a, 'a series task created in a user''s transaction credits that user';

  raise notice 'PASS tarefa_eventos.insert_logs_criada';
end $$;
rollback;

-- =====================================================================
-- update_logs_each_changed_field_only
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_cli_a bigint := s->>'cli_a';
  v_serie bigint := s->>'serie_a';
  v_t bigint; v_n int; v_ev tarefa_eventos;
begin
  perform pg_temp.te_as(v_a);
  insert into tarefas (conta_id, user_id, titulo, descricao, data_limite)
    values (v_ws_a, v_a, 'T', 'd', '2026-11-01') returning id into v_t;
  v_n := pg_temp.te_count(v_t);

  -- status + prazo -> exactly 2 events
  update tarefas set status = 'em_andamento', data_limite = '2026-11-05' where id = v_t;
  assert pg_temp.te_count(v_t) = v_n + 2, format('two changed fields must log 2 events, got %s', pg_temp.te_count(v_t) - v_n);
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'status';
  assert v_ev.de = '"pendente"'::jsonb and v_ev.para = '"em_andamento"'::jsonb,
    format('status values, got %s -> %s', v_ev.de, v_ev.para);
  assert v_ev.actor_user_id = v_a and v_ev.actor_nome = 'Ana', 'field events carry the actor';
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'prazo';
  assert v_ev.de = '"2026-11-01"'::jsonb and v_ev.para = '"2026-11-05"'::jsonb,
    format('prazo values, got %s -> %s', v_ev.de, v_ev.para);
  v_n := pg_temp.te_count(v_t);

  -- re-saving identical values -> 0
  update tarefas
     set status = 'em_andamento', data_limite = '2026-11-05', titulo = 'T', descricao = 'd',
         descricao_rich = null, responsavel_id = null, cliente_id = null
   where id = v_t;
  assert pg_temp.te_count(v_t) = v_n, format('an unchanged save must log nothing, got %s', pg_temp.te_count(v_t) - v_n);

  -- touching only updated_at -> 0
  update tarefas set updated_at = now() + interval '1 minute' where id = v_t;
  assert pg_temp.te_count(v_t) = v_n, format('an updated_at-only write must log nothing, got %s', pg_temp.te_count(v_t) - v_n);

  -- the remaining field tipos and their shapes
  update tarefas set titulo = 'T2' where id = v_t;
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'titulo';
  assert v_ev.de = '"T"'::jsonb and v_ev.para = '"T2"'::jsonb, format('titulo values, got %s -> %s', v_ev.de, v_ev.para);

  update tarefas set descricao_rich = '{"type":"doc"}'::jsonb where id = v_t;
  update tarefas set descricao = 'outra' where id = v_t;
  select count(*) into v_n from tarefa_eventos
   where tarefa_id = v_t and tipo = 'descricao' and de is null and para is null;
  assert v_n = 2, format('descricao or descricao_rich each log one valueless descricao event, got %s', v_n);

  update tarefas set cliente_id = v_cli_a where id = v_t;
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'cliente';
  assert v_ev.de is null and v_ev.para = jsonb_build_object('id', v_cli_a, 'nome', 'Cliente A'),
    format('cliente snapshot, got %s -> %s', v_ev.de, v_ev.para);

  update tarefas set status = 'concluida' where id = v_t;
  select count(*) into v_n from tarefa_eventos where tarefa_id = v_t and tipo = 'status' and para = '"concluida"'::jsonb;
  assert v_n = 1, 'completing logs one status event';
  reset role;

  -- recorrencia: serie_id linked/unlinked (owner stands in for the series RPCs)
  update tarefas set serie_id = v_serie where id = v_t;
  update tarefas set serie_id = null where id = v_t;
  select count(*) into v_n from tarefa_eventos where tarefa_id = v_t and tipo = 'recorrencia';
  assert v_n = 2, format('linking and unlinking a series log 2 recorrencia events, got %s', v_n);
  assert exists (select 1 from tarefa_eventos where tarefa_id = v_t and tipo = 'recorrencia'
                  and de is null and para = to_jsonb(v_serie)),
    'recorrencia link: de null, para = series id';
  assert exists (select 1 from tarefa_eventos where tarefa_id = v_t and tipo = 'recorrencia'
                  and de = to_jsonb(v_serie) and para is null),
    'recorrencia unlink: de = series id, para null';

  raise notice 'PASS tarefa_eventos.update_logs_each_changed_field_only';
end $$;
rollback;

-- =====================================================================
-- responsavel_snapshot
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_m_resp bigint := s->>'m_resp';
  v_t bigint; v_ev tarefa_eventos;
begin
  perform pg_temp.te_as(v_a);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'T') returning id into v_t;
  update tarefas set responsavel_id = v_m_resp where id = v_t;
  update tarefas set responsavel_id = null where id = v_t;
  reset role;

  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'responsavel' order by id limit 1;
  assert v_ev.de is null and v_ev.para = jsonb_build_object('id', v_m_resp, 'nome', 'Rui'),
    format('assigning: de null, para {id, nome}, got %s -> %s', v_ev.de, v_ev.para);
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'responsavel' order by id desc limit 1;
  assert v_ev.de = jsonb_build_object('id', v_m_resp, 'nome', 'Rui') and v_ev.para is null,
    format('unassigning: de {id, nome}, para null, got %s -> %s', v_ev.de, v_ev.para);

  raise notice 'PASS tarefa_eventos.responsavel_snapshot';
end $$;
rollback;

-- =====================================================================
-- snapshot_is_tenant_scoped
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a';
  v_m_b bigint := s->>'m_b'; v_cli_b bigint := s->>'cli_b';
  v_t bigint; v_ev tarefa_eventos;
begin
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'T') returning id into v_t;

  -- service-role write (no JWT subject) pointing A's task at B's membro and cliente:
  -- the single-column FKs allow it, the service_role bypass policy skips WITH CHECK.
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
  update tarefas set responsavel_id = v_m_b, cliente_id = v_cli_b where id = v_t;
  reset role;

  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'responsavel';
  assert v_ev.para ? 'nome' and v_ev.para->>'nome' is null and (v_ev.para->>'id')::bigint = v_m_b,
    format('a foreign membro must be stored as {id, nome: null}, got %s', v_ev.para);
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'cliente';
  assert v_ev.para ? 'nome' and v_ev.para->>'nome' is null and (v_ev.para->>'id')::bigint = v_cli_b,
    format('a foreign cliente must be stored as {id, nome: null}, got %s', v_ev.para);
  assert v_ev.actor_user_id is null and v_ev.actor_nome is null,
    'a service-role update has no actor (rendered as Automação)';

  raise notice 'PASS tarefa_eventos.snapshot_is_tenant_scoped';
end $$;
rollback;

-- =====================================================================
-- subtask_and_tag_events
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_tg bigint := s->>'tg_a';
  v_t bigint; v_sub bigint; v_tipos text[]; v_n int;
begin
  perform pg_temp.te_as(v_a);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'T') returning id into v_t;
  insert into subtarefas (tarefa_id, conta_id, titulo) values (v_t, v_ws_a, 'Passo 1') returning id into v_sub;
  update subtarefas set concluida = true where id = v_sub;
  update subtarefas set ordem = 5 where id = v_sub;   -- not tracked
  update subtarefas set concluida = false where id = v_sub;
  delete from subtarefas where id = v_sub;
  insert into tarefa_tag_links (tarefa_id, tag_id, conta_id) values (v_t, v_tg, v_ws_a);
  delete from tarefa_tag_links where tarefa_id = v_t and tag_id = v_tg;
  reset role;

  select array_agg(tipo order by id) into v_tipos from tarefa_eventos where tarefa_id = v_t and tipo <> 'criada';
  assert v_tipos = array['subtarefa_adicionada', 'subtarefa_concluida', 'subtarefa_reaberta',
                         'subtarefa_removida', 'tag_adicionada', 'tag_removida'],
    format('expected the six subtask/tag tipos in order, got %s', v_tipos);

  select count(*) into v_n from tarefa_eventos
   where tarefa_id = v_t and tipo like 'subtarefa_%' and de is null and para = '{"titulo": "Passo 1"}'::jsonb
     and actor_user_id = v_a and actor_nome = 'Ana';
  assert v_n = 4, format('subtask events: para {titulo}, actor set, got %s', v_n);
  select count(*) into v_n from tarefa_eventos
   where tarefa_id = v_t and tipo like 'tag_%' and de is null
     and para = jsonb_build_object('id', v_tg, 'nome', 'Urgente', 'cor', '#ff0000');
  assert v_n = 2, format('tag events: para {id, nome, cor}, got %s', v_n);

  raise notice 'PASS tarefa_eventos.subtask_and_tag_events';
end $$;
rollback;

-- =====================================================================
-- cascade_delete_clean
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_tg bigint := s->>'tg_a';
  v_t bigint; v_n int;
begin
  perform pg_temp.te_as(v_a);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'T') returning id into v_t;
  insert into subtarefas (tarefa_id, conta_id, titulo) values (v_t, v_ws_a, 'Passo 1'), (v_t, v_ws_a, 'Passo 2');
  insert into tarefa_tag_links (tarefa_id, tag_id, conta_id) values (v_t, v_tg, v_ws_a);
  assert pg_temp.te_count(v_t) = 4, format('precondition: 4 events, got %s', pg_temp.te_count(v_t));

  delete from tarefas where id = v_t;
  reset role;

  assert not exists (select 1 from tarefas where id = v_t), 'the task must be deleted';
  select count(*) into v_n from tarefa_eventos where tarefa_id = v_t;
  assert v_n = 0, format('no events may survive the task, got %s', v_n);
  select count(*) into v_n from subtarefas where tarefa_id = v_t;
  assert v_n = 0, 'subtasks cascade';

  raise notice 'PASS tarefa_eventos.cascade_delete_clean';
end $$;
rollback;

-- =====================================================================
-- trigger_error_never_blocks
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_tg bigint := s->>'tg_a';
  v_t bigint; v_t2 bigint; v_n int; v_titulo text;
begin
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'T') returning id into v_t;
  v_n := pg_temp.te_count(v_t);

  alter table tarefa_eventos add constraint te_test_block check (false) not valid;

  perform pg_temp.te_as(v_a);
  update tarefas set titulo = 'T2', status = 'concluida' where id = v_t;
  insert into subtarefas (tarefa_id, conta_id, titulo) values (v_t, v_ws_a, 'Passo');
  insert into tarefa_tag_links (tarefa_id, tag_id, conta_id) values (v_t, v_tg, v_ws_a);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'Outra') returning id into v_t2;
  reset role;

  select titulo into v_titulo from tarefas where id = v_t;
  assert v_titulo = 'T2', 'the task write must succeed while history cannot be written';
  assert v_t2 is not null, 'a task insert must succeed while history cannot be written';
  assert pg_temp.te_count(v_t) = v_n, 'the failing history write leaves no event';

  alter table tarefa_eventos drop constraint te_test_block;

  raise notice 'PASS tarefa_eventos.trigger_error_never_blocks';
end $$;
rollback;

-- =====================================================================
-- foreign_workspace_cannot_read
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a'; v_bu uuid := s->>'bu';
  v_t bigint; v_n int;
begin
  perform pg_temp.te_as(v_a);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'T') returning id into v_t;
  update tarefas set titulo = 'T2' where id = v_t;
  select count(*) into v_n from tarefa_eventos where tarefa_id = v_t;
  assert v_n = 2, format('a member of A reads the task''s history, got %s', v_n);

  perform pg_temp.te_as(v_bu);
  select count(*) into v_n from tarefa_eventos;
  assert v_n = 0, format('a member of B must read 0 of A''s events, got %s', v_n);
  reset role;

  raise notice 'PASS tarefa_eventos.foreign_workspace_cannot_read';
end $$;
rollback;

-- =====================================================================
-- authenticated_cannot_write
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a';
  v_t bigint; v_state text; v_op text; v_fn text;
begin
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'T') returning id into v_t;

  perform pg_temp.te_as(v_a);
  foreach v_op in array array['insert', 'update', 'delete'] loop
    v_state := null;
    begin
      case v_op
        when 'insert' then
          insert into tarefa_eventos (conta_id, tarefa_id, tipo) values (v_ws_a, v_t, 'titulo');
        when 'update' then
          update tarefa_eventos set tipo = 'titulo' where tarefa_id = v_t;
        when 'delete' then
          delete from tarefa_eventos where tarefa_id = v_t;
      end case;
    exception when insufficient_privilege then v_state := sqlstate;
    end;
    assert v_state = '42501', format('authenticated %s on tarefa_eventos must raise 42501, got %s', v_op, v_state);
  end loop;
  reset role;

  assert has_table_privilege('authenticated', 'public.tarefa_eventos', 'select'),
    'authenticated must select tarefa_eventos';
  assert not has_table_privilege('authenticated', 'public.tarefa_eventos', 'insert'),
    'authenticated must not hold INSERT';
  assert not has_table_privilege('authenticated', 'public.tarefa_eventos', 'update'),
    'authenticated must not hold UPDATE';
  assert not has_table_privilege('authenticated', 'public.tarefa_eventos', 'delete'),
    'authenticated must not hold DELETE';
  assert not has_table_privilege('anon', 'public.tarefa_eventos', 'select'),
    'anon must not read tarefa_eventos';
  assert pg_temp.te_count(v_t) = 1, 'nothing was written or removed';

  foreach v_fn in array array[
    'public._tarefa_evento_registrar(uuid,bigint,text,jsonb,jsonb,uuid)',
    'public._tarefa_eventos_backfill()'
  ] loop
    assert not has_function_privilege('anon', v_fn, 'execute'), format('anon must not execute %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'execute'), format('authenticated must not execute %s', v_fn);
    assert not has_function_privilege('service_role', v_fn, 'execute'), format('service_role must not execute %s', v_fn);
  end loop;

  raise notice 'PASS tarefa_eventos.authenticated_cannot_write';
end $$;
rollback;

-- =====================================================================
-- criada_with_gone_creator
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a';
  v_t bigint; v_t2 bigint; v_ev tarefa_eventos;
begin
  -- service-role writes (the MCP): no JWT subject
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'service_role', true);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, gen_random_uuid(), 'Orfa') returning id into v_t;
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'Pelo MCP') returning id into v_t2;
  reset role;

  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'criada';
  assert v_ev.id is not null, 'a task whose creator is not in auth.users still logs criada';
  assert v_ev.actor_user_id is null and v_ev.actor_nome is null,
    format('the gone creator must leave the actor NULL, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);

  select * into v_ev from tarefa_eventos where tarefa_id = v_t2 and tipo = 'criada';
  assert v_ev.actor_user_id = v_a and v_ev.actor_nome = 'Ana',
    format('an MCP-created task credits its existing creator, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);

  raise notice 'PASS tarefa_eventos.criada_with_gone_creator';
end $$;
rollback;

-- =====================================================================
-- actor_without_membro_row
--   A workspace user with no membros row (an owner who never added themselves to the team)
--   is named from profiles.nome, live and in the backfill. One with no name anywhere keeps
--   actor_user_id with a NULL actor_nome (the UI says "Usuário removido", not "Automação").
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a';
  v_c uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
  v_t bigint; v_t2 bigint; v_ev tarefa_eventos;
begin
  insert into auth.users (id) values (v_c), (v_x);
  insert into workspace_members (user_id, workspace_id, role) values
    (v_c, v_ws_a, 'admin'), (v_x, v_ws_a, 'admin');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a, nome = 'Carla' where id = v_c;
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a, nome = null where id = v_x;
  assert not exists (select 1 from membros where crm_user_id in (v_c, v_x)),
    'precondition: neither user has a membros row';

  perform pg_temp.te_as(v_c);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_c, 'Da Carla') returning id into v_t;
  update tarefas set titulo = 'Da Carla 2' where id = v_t;
  reset role;

  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'criada';
  assert v_ev.actor_user_id = v_c and v_ev.actor_nome = 'Carla',
    format('criada by a user without membro must use profiles.nome, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'titulo';
  assert v_ev.actor_user_id = v_c and v_ev.actor_nome = 'Carla',
    format('field event by a user without membro must use profiles.nome, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);

  perform pg_temp.te_as(v_x);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_x, 'Sem nome') returning id into v_t2;
  reset role;
  select * into v_ev from tarefa_eventos where tarefa_id = v_t2 and tipo = 'criada';
  assert v_ev.actor_user_id = v_x and v_ev.actor_nome is null,
    format('a user with no name anywhere keeps the actor id and a NULL name, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);

  -- the backfill resolves the same way
  delete from tarefa_eventos where tarefa_id in (v_t, v_t2);
  perform _tarefa_eventos_backfill();
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'criada';
  assert v_ev.actor_user_id = v_c and v_ev.actor_nome = 'Carla',
    format('backfilled criada must use profiles.nome, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);
  select * into v_ev from tarefa_eventos where tarefa_id = v_t2 and tipo = 'criada';
  assert v_ev.actor_user_id = v_x and v_ev.actor_nome is null,
    format('backfilled criada with no name anywhere, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);

  raise notice 'PASS tarefa_eventos.actor_without_membro_row';
end $$;
rollback;

-- =====================================================================
-- profile_fallback_is_tenant_scoped
--   tarefas.user_id is client-supplied and unchecked by RLS. A task in ws A naming a user of
--   ws B (no membro, no workspace_members row in A) must not copy that user's profile name
--   into A's history, live or backfilled.
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_bu uuid := s->>'bu';
  v_t bigint; v_ev tarefa_eventos;
begin
  update profiles set nome = 'Beto Perfil' where id = v_bu;
  assert not exists (select 1 from workspace_members where user_id = v_bu and workspace_id = v_ws_a),
    'precondition: bu is not a member of ws A';

  -- no JWT subject: criada falls back to tarefas.user_id
  perform set_config('request.jwt.claims', '', true);
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_bu, 'Alheia') returning id into v_t;

  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'criada';
  assert v_ev.actor_nome is null,
    format('a live criada must not take an outsider''s profile name, got %s', v_ev.actor_nome);

  delete from tarefa_eventos where tarefa_id = v_t;
  perform _tarefa_eventos_backfill();
  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'criada';
  assert v_ev.id is not null, 'the task is still backfilled';
  assert v_ev.actor_nome is null,
    format('a backfilled criada must not take an outsider''s profile name, got %s', v_ev.actor_nome);

  raise notice 'PASS tarefa_eventos.profile_fallback_is_tenant_scoped';
end $$;
rollback;

-- =====================================================================
-- backfill_shape
-- =====================================================================
begin;
select et_grant_hosted_parity(array['tarefa_eventos']);
do $$
declare
  s jsonb := pg_temp.te_seed();
  v_ws_a uuid := s->>'ws_a'; v_a uuid := s->>'a';
  v_t bigint; v_t_gone bigint; v_open bigint; v_ev tarefa_eventos; v_n int;
  v_created timestamptz; v_concluida timestamptz;
begin
  insert into tarefas (conta_id, user_id, titulo, status, created_at)
    values (v_ws_a, v_a, 'Feita', 'concluida', now() - interval '3 days')
    returning id, created_at, concluida_em into v_t, v_created, v_concluida;
  insert into tarefas (conta_id, user_id, titulo, created_at)
    values (v_ws_a, gen_random_uuid(), 'Sem dono', now() - interval '2 days') returning id into v_t_gone;
  insert into tarefas (conta_id, user_id, titulo) values (v_ws_a, v_a, 'Aberta') returning id into v_open;
  delete from tarefa_eventos where tarefa_id in (v_t, v_t_gone, v_open);

  perform _tarefa_eventos_backfill();

  select count(*) into v_n from tarefa_eventos where tarefa_id = v_t;
  assert v_n = 2, format('a concluded task gets criada + status, got %s events', v_n);

  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'criada';
  assert v_ev.created_at = v_created, format('criada at the task''s created_at, got %s', v_ev.created_at);
  assert v_ev.actor_user_id = v_a and v_ev.actor_nome = 'Ana',
    format('criada actor = the existing creator, got %s / %s', v_ev.actor_user_id, v_ev.actor_nome);
  assert v_ev.de is null and v_ev.para = '{"serie": false}'::jsonb, format('criada para, got %s', v_ev.para);

  select * into v_ev from tarefa_eventos where tarefa_id = v_t and tipo = 'status';
  assert v_ev.de is null and v_ev.para = '"concluida"'::jsonb,
    format('status: de null, para "concluida", got %s -> %s', v_ev.de, v_ev.para);
  assert v_ev.actor_user_id is null and v_ev.actor_nome is null, 'the backfilled status event has no actor';
  assert v_ev.created_at = v_concluida, format('status at concluida_em, got %s', v_ev.created_at);

  select * into v_ev from tarefa_eventos where tarefa_id = v_t_gone;
  assert v_ev.tipo = 'criada' and v_ev.actor_user_id is null,
    'a task whose creator is gone is backfilled with a NULL actor';
  select count(*) into v_n from tarefa_eventos where tarefa_id = v_open;
  assert v_n = 1, format('an open task gets only criada, got %s', v_n);

  -- re-running adds nothing
  perform _tarefa_eventos_backfill();
  select count(*) into v_n from tarefa_eventos where tarefa_id in (v_t, v_t_gone, v_open);
  assert v_n = 4, format('the backfill is idempotent, got %s events', v_n);

  raise notice 'PASS tarefa_eventos.backfill_shape';
end $$;
rollback;
