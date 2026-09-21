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
  v_code text;
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

  -- ---- RPCs (fresh workspace: the previous one was deleted in (k)) ----
  -- Case (m) above left request.jwt.claims on role anon; every block below runs
  -- as the workspace user again, so re-set claims before anything else.
  v_ws := et_make_workspace('start');
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'M2') returning id into v_membro;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C2', 'C2', '#000') returning id into v_cli;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 'u1') returning id into v_tag1;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 'u2') returning id into v_tag2;
  perform set_config('app.tarefa_hoje', '2026-01-05', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  assert auth.uid() = v_user, 'RPC block: auth.uid() is not the workspace user after re-setting claims';

  -- (a) criar: series + first occurrence with tags and subtasks in one call
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Semanal', 'descricao', 'd', 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', v_membro, 'cliente_id', v_cli, 'data_limite', '2026-01-05'),
    array[v_tag1, v_tag2], array['Passo 1', 'Passo 2']);
  assert v_serie is not null and v_t1 is not null, '(a) criar returned nulls';
  perform 1 from tarefas where id = v_t1 and serie_id = v_serie and data_limite = '2026-01-05' and status = 'pendente';
  assert found, '(a) first occurrence not linked or wrong date';
  select count(*) into v_n from subtarefas where tarefa_id = v_t1; assert v_n = 2, '(a) subtasks not created';
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t1; assert v_n = 2, '(a) tag links not created';
  perform 1 from tarefa_series where id = v_serie and subtarefas = '["Passo 1", "Passo 2"]'::jsonb and tag_ids = array[v_tag1, v_tag2];
  assert found, '(a) template not stored';

  -- (a) promotion links an existing open standalone task and snapshots its subtasks
  insert into tarefas (conta_id, user_id, titulo, status, data_limite) values (v_ws, v_user, 'Solta', 'pendente', '2026-01-06') returning id into v_t2;
  insert into subtarefas (tarefa_id, conta_id, titulo, ordem) values (v_t2, v_ws, 'Existente', 0);
  select serie_id into v_n from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":2,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"calendario","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Solta', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
    '{}'::bigint[], '{}'::text[], v_t2);
  perform 1 from tarefas where id = v_t2 and serie_id = v_n;
  assert found, '(a) promotion did not link';
  perform 1 from tarefa_series where id = v_n and subtarefas = '["Existente"]'::jsonb and inicio = '2026-01-06' and proxima_data = '2026-01-08';
  assert found, '(a) promotion did not snapshot subtasks / cursor';

  -- (a) promotion rejects a concluida task and a task already in a series
  insert into tarefas (conta_id, user_id, titulo, status, data_limite) values (v_ws, v_user, 'Feita', 'concluida', '2026-01-06') returning id into v_t3;
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'Feita', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
      '{}'::bigint[], '{}'::text[], v_t3);
  exception when others then v_rejected := true; end;
  assert v_rejected, '(a) promotion accepted a concluida task';
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'Solta', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
      '{}'::bigint[], '{}'::text[], v_t2);
  exception when others then v_rejected := true; end;
  assert v_rejected, '(a) promotion accepted a task that is already an occurrence';

  -- (n) aplicar_edicao that completes and changes the template creates the next from the NEW template
  perform public.tarefa_serie_aplicar_edicao(v_t1,
    jsonb_build_object('titulo', 'Semanal v2', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    array[v_tag1],
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select id, data_limite into v_t3, v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-01-12', format('(n) expected next 2026-01-12, got %s', v_date);
  perform 1 from tarefas where id = v_t3 and titulo = 'Semanal v2' and responsavel_id is null;
  assert found, '(n) next occurrence not built from the new template';
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t3; assert v_n = 1, '(n) new tag set not applied';

  -- (n) "Somente esta" change (direct update) then aplicar_edicao promotes that state
  update tarefas set titulo = 'Semanal v3' where id = v_t3;
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Semanal v3', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-12'),
    array[v_tag1],
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  perform 1 from tarefa_series where id = v_serie and titulo = 'Semanal v3';
  assert found, '(n) template did not take the occurrence state';

  -- (n) moving the due date re-anchors inicio; fim before it is rejected
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Semanal v3', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-14'),
    array[v_tag1],
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  perform 1 from tarefa_series where id = v_serie and inicio = '2026-01-14';
  assert found, '(n) inicio not re-anchored on the new due date';
  v_rejected := false;
  begin
    perform public.tarefa_serie_aplicar_edicao(v_t3,
      jsonb_build_object('titulo', 'Semanal v3', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-14'),
      array[v_tag1],
      '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":"2026-01-13"}'::jsonb,
      false);
  exception when others then v_rejected := true; end;
  assert v_rejected, '(n) fim before the due date accepted';

  -- (n) a malformed dias_semana on edit raises 22023 from the RPC's own validation
  v_rejected := false; v_code := null;
  begin
    perform public.tarefa_serie_aplicar_edicao(v_t3,
      jsonb_build_object('titulo', 'Semanal v3', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-14'),
      array[v_tag1],
      '{"freq":"weekly","intervalo":1,"dias_semana":["x"],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      false);
  exception when others then v_rejected := true; v_code := sqlstate; end;
  assert v_rejected and v_code = '22023', format('(n) malformed dias_semana on edit: rejected=%s code=%s', v_rejected, v_code);

  -- (o) re-anchoring on a clamped date keeps dia_mes/mes (cases 19/20 end to end)
  select serie_id, tarefa_id into v_n, v_t2 from public.tarefa_serie_criar(
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-31'),
    '{}'::bigint[], '{}'::text[]);
  update tarefas set status = 'concluida' where id = v_t2;            -- spawns 2026-02-28
  select id, data_limite into v_t3, v_date from tarefas where serie_id = v_n and status <> 'concluida';
  assert v_date = '2026-02-28', format('(o) expected 2026-02-28, got %s', v_date);
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-02-28'),
    '{}'::bigint[],
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select data_limite into v_date from tarefas where serie_id = v_n and status <> 'concluida';
  assert v_date = '2026-03-31', format('(o) expected 2026-03-31 after re-anchoring on 02-28, got %s', v_date);

  -- (n) completing with p_encerrar creates nothing and detaches the occurrence.
  -- v_t3 (the 02-28 occurrence) is concluida from (o): reopen it first through
  -- the same RPC, then complete it with p_encerrar.
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-02-28'),
    '{}'::bigint[],
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select serie_id into v_serie from tarefas where id = v_t3;
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-02-28'),
    '{}'::bigint[],
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    true);
  perform 1 from tarefas where id = v_t3 and serie_id is null and status = 'concluida';
  assert found, '(n) p_encerrar did not detach the occurrence';
  perform 1 from tarefa_series where id = v_serie and encerrada_em is not null;
  assert found, '(n) p_encerrar did not end the series';
  select count(*) into v_n from tarefas where serie_id = v_serie and status <> 'concluida' and data_limite > '2026-03-31';
  assert v_n = 0, '(n) p_encerrar spawned an occurrence';

  -- (n2) definir_estado per the states table; encerrar twice raises
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Diaria', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[], '{}'::text[]);
  perform public.tarefa_serie_definir_estado(v_serie, 'pausar');
  perform 1 from tarefa_series where id = v_serie and pausada; assert found, '(n2) pausar failed';
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 0, '(n2) paused series generated';
  perform public.tarefa_serie_definir_estado(v_serie, 'retomar');
  assert pg_temp.et_abertas(v_serie) = 1, '(n2) resume did not generate';
  perform public.tarefa_serie_definir_estado(v_serie, 'encerrar');
  perform 1 from tarefa_series where id = v_serie and encerrada_em is not null; assert found, '(n2) encerrar failed';
  v_rejected := false;
  begin
    perform public.tarefa_serie_definir_estado(v_serie, 'encerrar');
  exception when others then v_rejected := true; end;
  assert v_rejected, '(n2) encerrar twice did not raise';

  -- (j) excluir deletes open occurrences, keeps completed ones unlinked, spawns nothing
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Apagar', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[], '{}'::text[]);
  update tarefas set status = 'concluida' where id = v_t1;            -- spawns 01-06
  perform public.tarefa_serie_excluir(v_serie);
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 0, '(j) rows still linked after excluir';
  perform 1 from tarefas where id = v_t1 and serie_id is null and status = 'concluida';
  assert found, '(j) completed occurrence was deleted or stayed linked';
  select count(*) into v_n from tarefas where titulo = 'Apagar' and status <> 'concluida'; assert v_n = 0, '(j) open occurrence survived excluir';
  perform 1 from tarefa_series where id = v_serie; assert not found, '(j) series row survived excluir';

  -- (p) an ao_concluir series whose last occurrence is completed and past fim
  --     is revived by aplicar_edicao clearing fim (no dormant series)
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":"2026-01-05"}'::jsonb,
    jsonb_build_object('titulo', 'Com fim', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[], '{}'::text[]);
  update tarefas set status = 'concluida' where id = v_t1;            -- next 01-06 is past fim: nothing
  assert pg_temp.et_abertas(v_serie) = 0, '(p) setup: occurrence created past fim';
  perform public.tarefa_serie_aplicar_edicao(v_t1,
    jsonb_build_object('titulo', 'Com fim', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[],
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select data_limite into v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-01-06', format('(p) extending fim did not revive the series (got %s)', v_date);

  -- (p2) calendario -> ao_concluir switch with every occurrence already completed:
  --      the completion trigger saw calendario, so aplicar_edicao must create the open one
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"calendario","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Troca de modo', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[], '{}'::text[]);
  update tarefas set status = 'concluida' where id = v_t1;            -- calendario: nothing spawns
  assert pg_temp.et_abertas(v_serie) = 0, '(p2) setup: calendario completion spawned';
  perform public.tarefa_serie_aplicar_edicao(v_t1,
    jsonb_build_object('titulo', 'Troca de modo', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[],
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select data_limite into v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-01-06', format('(p2) modo switch left the series dormant (got %s)', v_date);
  perform 1 from tarefa_series where id = v_serie and modo = 'ao_concluir' and proxima_data is null;
  assert found, '(p2) cursor not cleared on the switch to ao_concluir';

  -- (p3) aplicar_edicao on a paused series does not generate; resume does
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Pausada', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[], '{}'::text[]);
  perform public.tarefa_serie_definir_estado(v_serie, 'pausar');
  update tarefas set status = 'concluida' where id = v_t1;
  perform public.tarefa_serie_aplicar_edicao(v_t1,
    jsonb_build_object('titulo', 'Pausada v2', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[],
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  assert pg_temp.et_abertas(v_serie) = 0, '(p3) editing a paused series generated';

  execute 'reset role';
  -- ---- calendario generator (as the owner: the job runs as postgres) ----
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  -- (i) cursor on INSERT strictly after inicio
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-05', 'Cal daily') returning id into v_serie;
  select proxima_data into v_date from tarefa_series where id = v_serie;
  assert v_date = '2026-01-06', format('(i) cursor expected 2026-01-06, got %s', v_date);

  -- (i) cursor 10 days back: only the most recent due date, cursor moves past today.
  -- Assertions count per series: the promoted "Solta" calendario series from (a)
  -- is also due on this run, so the function's total is not what is under test.
  perform set_config('app.tarefa_hoje', '2026-01-16', true);
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie;
  assert v_n = 1, format('(i) expected 1 occurrence, got %s', v_n);
  select data_limite into v_date from tarefas where serie_id = v_serie;
  assert v_date = '2026-01-16', format('(i) expected the occurrence on 2026-01-16, got %s', v_date);
  select proxima_data into v_date from tarefa_series where id = v_serie;
  assert v_date = '2026-01-17', format('(i) cursor expected 2026-01-17, got %s', v_date);
  -- second call creates 0
  select ocorrencias_criadas into v_n from public.generate_recurring_tarefas();
  assert v_n = 0, format('(i) second run created %s', v_n);

  -- (i) cursor 3 years back (daily): exactly one occurrence, instantly
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2023-01-01', 'Old cal') returning id into v_serie;
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, format('(i) 3-year catch-up expected 1, got %s', v_n);
  select data_limite into v_date from tarefas where serie_id = v_serie; assert v_date = '2026-01-16', '(i) 3-year catch-up wrong date';

  -- (i) fim -> proxima_data NULL after the last eligible date
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-16', '2026-01-17', 'Ends soon') returning id into v_serie;
  perform set_config('app.tarefa_hoje', '2026-01-17', true);
  perform public.generate_recurring_tarefas();
  select proxima_data into v_date from tarefa_series where id = v_serie;
  assert v_date is null, format('(i) cursor should be NULL past fim, got %s', v_date);
  select count(*) into v_n from tarefas where serie_id = v_serie and data_limite = '2026-01-17'; assert v_n = 1, '(i) last date before fim missing';

  -- (i) recovery after fim: daily, fim 01-31, cursor 01-25, first run on 02-02 -> exactly 01-31, cursor NULL
  perform set_config('app.tarefa_hoje', '2026-01-24', true);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-24', '2026-01-31', 'Recover') returning id into v_serie;
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date = '2026-01-25', '(i) recover: cursor setup';
  perform set_config('app.tarefa_hoje', '2026-02-02', true);
  select ocorrencias_criadas into v_n from public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, format('(i) recover: expected 1 occurrence, got %s', v_n);
  select data_limite into v_date from tarefas where serie_id = v_serie; assert v_date = '2026-01-31', format('(i) recover: expected 2026-01-31, got %s', v_date);
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) recover: cursor not NULL';
  select ocorrencias_criadas into v_n from public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, '(i) recover: second run created more';

  -- (i) recovery after fim, weekly Monday with fim between rule dates: last rule date <= fim
  perform set_config('app.tarefa_hoje', '2026-01-05', true);
  insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'weekly', '{1}', 'calendario', '2026-01-05', '2026-01-21', 'Recover weekly') returning id into v_serie;
  perform set_config('app.tarefa_hoje', '2026-02-10', true);
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, '(i) recover weekly: expected 1';
  select data_limite into v_date from tarefas where serie_id = v_serie; assert v_date = '2026-01-19', format('(i) recover weekly: expected 2026-01-19, got %s', v_date);
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) recover weekly: cursor not NULL';

  -- (i) fim before the run day but cursor == fim still materializes it
  perform set_config('app.tarefa_hoje', '2026-01-05', true);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-05', '2026-01-06', 'Cursor is fim') returning id into v_serie;
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date = '2026-01-06', '(i) cursor==fim setup';
  perform set_config('app.tarefa_hoje', '2026-01-09', true);
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie and data_limite = '2026-01-06'; assert v_n = 1, '(i) cursor==fim not materialized';
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) cursor==fim: cursor not NULL';

  -- (i) a hand-forced bad row (cursor past fim, written with the cron flag as the
  -- owner) is exhausted without raising, and another due series in the same run
  -- is still processed
  perform set_config('app.tarefa_hoje', '2026-03-01', true);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-03-01', '2026-03-03', 'Bad row') returning id into v_serie;
  perform set_config('app.tarefa_cursor_writer', 'on', true);
  update tarefa_series set proxima_data = '2026-03-08' where id = v_serie;   -- > fim, bypasses normalization on purpose
  perform set_config('app.tarefa_cursor_writer', '', true);
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date = '2026-03-08', '(i) bad row setup';
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-03-01', 'Good row') returning id into v_n;
  perform set_config('app.tarefa_hoje', '2026-03-10', true);
  perform public.generate_recurring_tarefas();                                -- must not raise
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) bad row not exhausted';
  select count(*) into v_n from tarefas where serie_id = v_n; assert v_n = 1, '(i) good row not processed in the same run as the bad row';

  -- (l) cursor recompute on pause/resume/rule change and (m) the tarefas CHECK
  -- and UNIQUE are covered in 99_tarefa_series_rls.

  raise notice 'PASS 99_tarefa_series_geracao';
end $$;

rollback;
