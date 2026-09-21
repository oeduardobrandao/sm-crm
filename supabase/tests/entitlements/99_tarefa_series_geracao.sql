\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Generation of occurrences: ao_concluir triggers, delete trigger, resume
-- trigger, calendario generator, RPCs. Spec section "Testing", suite (c).

begin;
select et_grant_hosted_parity(array['tarefa_series']);
grant select on public.tarefa_series to anon, authenticated;
grant all on public.tarefa_series to service_role;

-- helper: count open occurrences of a series
create or replace function pg_temp.et_abertas(p_serie bigint) returns bigint language sql as $$
  select count(*) from public.tarefas where serie_id = p_serie and status <> 'concluida';
$$;

do $$
declare
  v_ws uuid;
  v_user uuid := gen_random_uuid();
  v_membro bigint; v_cli bigint;
  v_tag1 bigint; v_tag2 bigint;
  v_serie bigint; v_t1 bigint; v_t2 bigint; v_t3 bigint;
  v_n bigint; v_date date; v_status text;
  v_rejected boolean;
  v_serie2 bigint;
  v_fn text;
begin
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'M') returning id into v_membro;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 't1') returning id into v_tag1;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 't2') returning id into v_tag2;

  -- weekly Monday, ao_concluir, template with tags, subtasks, responsavel, cliente
  insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, titulo, descricao,
                             responsavel_id, cliente_id, tag_ids, subtarefas)
    values (v_ws, v_user, 'weekly', '{1}', 'ao_concluir', '2026-01-05', 'Relatorio semanal', 'desc',
            v_membro, v_cli, array[v_tag1, v_tag2], '["Coletar dados", "Escrever"]'::jsonb)
    returning id into v_serie;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id, responsavel_id, cliente_id)
    values (v_ws, v_user, 'Relatorio semanal', 'pendente', '2026-01-05', v_serie, v_membro, v_cli)
    returning id into v_t1;

  -- ---- act as the user ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- (b) completing creates the next one from the template
  update tarefas set status = 'concluida' where id = v_t1;
  select id, data_limite into v_t2, v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_t2 is not null, '(b) next occurrence not created';
  assert v_date = '2026-01-12', format('(b) next expected 2026-01-12, got %s', v_date);
  select count(*) into v_n from subtarefas where tarefa_id = v_t2 and concluida = false;
  assert v_n = 2, format('(b) expected 2 unchecked subtasks, got %s', v_n);
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t2;
  assert v_n = 2, format('(b) expected 2 tag links, got %s', v_n);
  perform 1 from tarefas where id = v_t2 and responsavel_id = v_membro and cliente_id = v_cli and status = 'pendente';
  assert found, '(b) template responsavel/cliente/status not copied';

  -- (c) reopen + re-complete does not duplicate
  update tarefas set status = 'pendente' where id = v_t1;
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(c) reopen + re-complete duplicated';

  -- (d) reopen + re-complete with today advanced: open-occurrence guard, no branch
  perform set_config('app.tarefa_hoje', '2026-01-20', true);
  update tarefas set status = 'pendente' where id = v_t1;
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(d) branch created with today advanced';
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  -- (d2) next occurrence dragged earlier than its predecessor, then predecessor completed
  update tarefas set status = 'pendente' where id = v_t1;              -- t1 open again (01-05)
  update tarefas set data_limite = '2026-01-02' where id = v_t2;       -- t2 dragged before t1
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(d2) more than one open occurrence';
  update tarefas set data_limite = '2026-01-12' where id = v_t2;

  -- (e) late completion yields a future date: occurrence 01-12 completed on 01-27 -> 02-02
  perform set_config('app.tarefa_hoje', '2026-01-27', true);
  update tarefas set status = 'concluida' where id = v_t2;
  select id, data_limite into v_t3, v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-02-02', format('(e) expected 2026-02-02, got %s', v_date);

  -- (g) fim cuts off: series ends 2026-02-02, completing the 02-02 occurrence creates nothing
  execute 'reset role';
  update tarefa_series set fim = '2026-02-02' where id = v_serie;
  execute 'set local role authenticated';
  update tarefas set status = 'concluida' where id = v_t3;
  assert pg_temp.et_abertas(v_serie) = 0, '(g) occurrence created past fim';

  -- (j0) series active with ZERO open occurrences (fim cleared alone; an ao_concluir
  --      guard just nulls proxima_data, nothing generates). Today moves to 02-04 so
  --      the next rule date (02-09) is free: at 01-27 it would be 02-02, which the
  --      completed t3 already occupies and ON CONFLICT would hide a broken trigger.
  --      Deleting a COMPLETED occurrence must spawn nothing: a broken
  --      WHEN (OLD.status <> 'concluida') would spawn 02-09 here and fail.
  execute 'reset role';
  perform set_config('app.tarefa_hoje', '2026-02-04', true);
  update tarefa_series set fim = null where id = v_serie;
  assert pg_temp.et_abertas(v_serie) = 0, '(j0) setup: series should have no open occurrence';
  execute 'set local role authenticated';
  delete from tarefas where id = v_t1;                                  -- completed 01-05 occurrence
  assert pg_temp.et_abertas(v_serie) = 0, '(j0) deleting a completed occurrence spawned something';

  -- (f) paused series does not generate; resuming an ao_concluir series with no open occurrence generates
  execute 'reset role';
  update tarefa_series set fim = null, pausada = true where id = v_serie;
  execute 'set local role authenticated';
  update tarefas set status = 'pendente' where id = v_t3;
  update tarefas set status = 'concluida' where id = v_t3;
  assert pg_temp.et_abertas(v_serie) = 0, '(f) paused series generated';
  execute 'reset role';
  perform set_config('app.tarefa_hoje', '2026-02-09', true);   -- a Monday
  update tarefa_series set pausada = false where id = v_serie;
  select data_limite into v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-02-16', format('(f) resume expected 2026-02-16, got %s', v_date);

  -- (h) deleted tag and deleted responsavel before generation do not break it
  delete from tarefa_tags where id = v_tag2;
  delete from membros where id = v_membro;
  execute 'set local role authenticated';
  update tarefas set status = 'concluida' where serie_id = v_serie and status <> 'concluida';
  select id into v_t1 from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_t1 is not null, '(h) generation broke after deletions';
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t1;
  assert v_n = 1, format('(h) expected 1 tag link, got %s', v_n);
  perform 1 from tarefas where id = v_t1 and responsavel_id is null;
  assert found, '(h) responsavel should be NULL after membro deletion';

  -- (j) "Somente esta" delete of the only open occurrence spawns the next;
  --     deleting a completed historical occurrence spawns nothing
  select data_limite into v_date from tarefas where id = v_t1;
  delete from tarefas where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(j) delete of the only open occurrence left the series dormant';
  select id into v_t2 from tarefas where serie_id = v_serie and status <> 'concluida';
  perform 1 from tarefas where id = v_t2 and data_limite > v_date;
  assert found, '(j) spawned occurrence is not after the deleted one';
  select id into v_t3 from tarefas where serie_id = v_serie and status = 'concluida' limit 1;
  delete from tarefas where id = v_t3;
  assert pg_temp.et_abertas(v_serie) = 1, '(j) deleting a completed occurrence spawned something';

  -- (e2) very late completion of an ao_concluir daily series dated 1200+ days ago
  execute 'reset role';
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'ao_concluir', '2022-01-01', 'Old daily') returning id into v_serie;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
    values (v_ws, v_user, 'Old daily', 'pendente', '2022-01-01', v_serie) returning id into v_t1;
  perform set_config('app.tarefa_hoje', '2026-09-21', true);
  execute 'set local role authenticated';
  update tarefas set status = 'concluida' where id = v_t1;
  select data_limite into v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-09-22', format('(e2) expected 2026-09-22, got %s', v_date);
  execute 'reset role';

  -- (l) calendario series: deleting an open occurrence creates nothing (the
  --     delete trigger returns on an unlocked modo pre-check, so it never takes
  --     the series row lock the generator's scan holds)
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-09-21', 'Cal daily') returning id into v_serie2;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
    values (v_ws, v_user, 'Cal daily', 'pendente', '2026-09-21', v_serie2) returning id into v_t1;
  execute 'set local role authenticated';
  delete from tarefas where id = v_t1;
  assert pg_temp.et_abertas(v_serie2) = 0, '(l) deleting a calendario occurrence spawned something';
  perform 1 from tarefa_series where id = v_serie2;
  assert found, '(l) calendario series vanished';
  execute 'reset role';

  -- (m) internal helpers are not callable by tenants (cross-tenant write primitive)
  v_rejected := false;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform tarefa_serie_materializar(v_serie, '2030-01-01');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, '(m) authenticated called tarefa_serie_materializar';
  v_rejected := false;
  begin
    perform tarefa_serie_garantir_aberta(v_serie, '2030-01-01');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, '(m) authenticated called tarefa_serie_garantir_aberta';
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  v_rejected := false;
  begin
    perform tarefa_serie_materializar(v_serie, '2030-01-01');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, '(m) anon called tarefa_serie_materializar';
  v_rejected := false;
  begin
    perform tarefa_serie_garantir_aberta(v_serie, '2030-01-01');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, '(m) anon called tarefa_serie_garantir_aberta';
  execute 'reset role';
  perform 1 from tarefas where serie_id = v_serie and data_limite = '2030-01-01';
  assert not found, '(m) a rejected call still wrote a row';

  -- (n) grant surface of every function this migration adds in section 3
  foreach v_fn in array array[
    'public.tarefa_serie_materializar(bigint, date)',
    'public.tarefa_serie_garantir_aberta(bigint, date)',
    'public.tarefas_serie_ao_concluir_fn()',
    'public.tarefas_serie_ao_excluir_fn()',
    'public.tarefa_series_apos_retomar_fn()'] loop
    assert has_function_privilege('anon', v_fn, 'EXECUTE') = false, format('(n) anon can execute %s', v_fn);
    assert has_function_privilege('authenticated', v_fn, 'EXECUTE') = false, format('(n) authenticated can execute %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE') = true, format('(n) service_role cannot execute %s', v_fn);
  end loop;

  -- (k) DELETE FROM workspaces with a series + open occurrence does not fail
  delete from workspaces where id = v_ws;
  select count(*) into v_n from tarefa_series where conta_id = v_ws;
  assert v_n = 0, '(k) series survived the workspace delete';

  -- RPC_BLOCK (Task 4 appends here)
  -- CALENDARIO_BLOCK (Task 5 appends here)

  raise notice 'PASS 99_tarefa_series_geracao';
end $$;

rollback;
