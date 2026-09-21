\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- tarefa_series: SELECT-only for authenticated, writes are RPC-only; the
-- guards on tarefas.serie_id and on the cursor. Pattern of 98_cliente_links_rls.
-- tarefa_series is excluded from the parity helper so this suite asserts the
-- migration's REVOKE instead of undoing it.

begin;
select et_grant_hosted_parity(array['tarefa_series']);
-- Defensive, as in 97_crisp_sessions: 92_reorder_fluxos_board.sql calls
-- et_grant_hosted_parity() outside any transaction, so its ALL grants on every
-- public table commit permanently and tarefa_series inherits them in a full
-- harness run. Strip the write privileges the migration also revokes (rolled
-- back with this transaction). Run standalone on a freshly reset DB this line
-- is a no-op and the assertions below test the migration's own REVOKE.
revoke insert, update, delete on public.tarefa_series from anon, authenticated;
-- Hosted projects grant SELECT (and ALL to service_role) through the default
-- ACL; locally we grant exactly that by hand so the REVOKE is what is tested.
grant select on public.tarefa_series to anon, authenticated;
grant all on public.tarefa_series to service_role;

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user uuid := gen_random_uuid();
  v_membro_a bigint; v_membro_b bigint;
  v_cli_a bigint; v_cli_b bigint;
  v_serie_a bigint; v_serie_b bigint;
  v_tarefa_a bigint; v_tarefa_a2 bigint;
  v_seen bigint;
  v_rejected boolean;
  v_state text;
  v_proxima date;
  v_msg text; v_code text;
  v_tag_b bigint; v_tarefa_b bigint; v_tarefa_b2 bigint;
  v_serie_a2 bigint; v_tarefa_new bigint;
begin
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner'), (v_user, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;

  insert into membros (user_id, conta_id, nome) values (v_user, v_ws_a, 'MA') returning id into v_membro_a;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws_b, 'MB') returning id into v_membro_b;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  -- ---- as owner: template CHECKs ----
  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '{}'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas {} aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '[1]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas [1] aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '[""]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas [""] aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x',
              (select jsonb_agg(to_jsonb('s' || g::text)) from generate_series(1, 51) g));
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas com 51 itens aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, tag_ids)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', array[1, null]::bigint[]);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'tag_ids com NULL aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', '   ');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'titulo em branco aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, descricao_rich)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '[]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'descricao_rich [] aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'weekly', 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'weekly sem dias_semana aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, titulo)
      values (v_ws_a, v_user, 'weekly', '{1,1}', 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'weekly com dia repetido aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, dia_mes, modo, inicio, titulo)
      values (v_ws_a, v_user, 'daily', 15, 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'daily com dia_mes aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'monthly', 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'monthly sem dia_mes aceito';

  -- ---- as owner: valid rows, cursor derived on INSERT (forged value ignored) ----
  insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, titulo, proxima_data)
    values (v_ws_a, v_user, 'weekly', '{1}', 'calendario', '2026-01-05', 'Serie A', '1999-01-01')
    returning id, proxima_data into v_serie_a, v_proxima;
  assert v_proxima = '2026-01-12', format('INSERT derived proxima_data expected 2026-01-12, got %s', v_proxima);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws_b, v_user, 'daily', 'ao_concluir', '2026-01-05', 'Serie B CONFIDENTIAL')
    returning id into v_serie_b;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_b;
  assert v_proxima is null, 'ao_concluir must have NULL proxima_data';

  -- past fim on INSERT -> NULL cursor
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', '2026-01-05', 'ends today')
    returning proxima_data into v_proxima;
  assert v_proxima is null, 'cursor past fim must be NULL on INSERT';

  -- occurrences as owner (serie_id allowed for the owner)
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
    values (v_ws_a, v_user, 'A1', 'pendente', '2026-01-05', v_serie_a) returning id into v_tarefa_a;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite)
    values (v_ws_a, v_user, 'A standalone', 'pendente', '2026-01-06') returning id into v_tarefa_a2;

  -- tarefas_serie_exige_prazo and tarefas_serie_data_uq
  v_rejected := false;
  begin
    insert into tarefas (conta_id, user_id, titulo, status, serie_id)
      values (v_ws_a, v_user, 'no date', 'pendente', v_serie_a);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'occurrence without data_limite accepted';
  v_rejected := false;
  begin
    insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
      values (v_ws_a, v_user, 'dup', 'pendente', '2026-01-05', v_serie_a);
  exception when unique_violation then v_rejected := true; end;
  assert v_rejected, 'duplicate (serie_id, data_limite) accepted';

  -- ---- guard as service_role (direct writer besides the owner) ----
  execute 'set local role service_role';
  update tarefa_series set titulo = 'Serie A renamed', proxima_data = '2030-01-01' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-12', format('unrelated UPDATE moved the cursor to %s', v_proxima);

  -- cursor writer flag: the cron path
  perform set_config('app.tarefa_cursor_writer', 'on', true);
  update tarefa_series set proxima_data = '2026-01-19' where id = v_serie_a;
  perform set_config('app.tarefa_cursor_writer', '', true);
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-19', 'flagged cursor UPDATE was not kept';

  -- rule change recomputes from greatest(inicio, today = 2026-01-05)
  update tarefa_series set dias_semana = '{3}' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', format('rule change: expected 2026-01-07, got %s', v_proxima);

  -- pause keeps, resume recomputes from greatest(inicio, today - 1) so today counts
  perform set_config('app.tarefa_hoje', '2026-01-14', true);
  update tarefa_series set pausada = true where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', 'pausing moved the cursor';
  update tarefa_series set pausada = false where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-14', format('resume: expected 2026-01-14 (today, Wed), got %s', v_proxima);
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  -- modo -> ao_concluir clears the cursor
  update tarefa_series set modo = 'ao_concluir' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'modo ao_concluir must clear proxima_data';
  update tarefa_series set modo = 'calendario' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', format('modo back to calendario: expected 2026-01-07, got %s', v_proxima);

  -- cursor normalization against fim (a cursor past fim is never stored)
  update tarefa_series set fim = '2026-01-06' where id = v_serie_a;        -- shorten below the cursor (01-07)
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'shortening fim below the cursor did not null it';
  update tarefa_series set fim = '2026-12-31' where id = v_serie_a;        -- extend: revives
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', format('extending fim did not revive the cursor, got %s', v_proxima);
  update tarefa_series set dias_semana = '{1}', fim = '2026-01-10' where id = v_serie_a; -- rule edit whose next (01-12) passes fim
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'rule edit past fim did not null the cursor';
  update tarefa_series set pausada = true where id = v_serie_a;
  update tarefa_series set pausada = false where id = v_serie_a;           -- resume past fim stays NULL
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'resume past fim revived the cursor';
  update tarefa_series set fim = null where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-12', format('fim cleared: expected 2026-01-12, got %s', v_proxima);

  -- encerrada_em is one-way
  update tarefa_series set encerrada_em = now() where id = v_serie_b;
  v_rejected := false;
  begin
    update tarefa_series set encerrada_em = null where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'clearing encerrada_em accepted';
  v_rejected := false;
  begin
    update tarefa_series set encerrada_em = now() - interval '1 day' where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'moving encerrada_em back accepted';

  -- identity is immutable
  v_rejected := false;
  begin
    update tarefa_series set conta_id = v_ws_a where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'conta_id change accepted';
  v_rejected := false;
  begin
    update tarefa_series set user_id = gen_random_uuid() where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'user_id change accepted';
  execute 'reset role';

  -- ---- as authenticated: SELECT-only, writes are permission denied ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_seen from tarefa_series;
  assert v_seen = 2, format('authenticated: expected 2 visible series, got %s', v_seen);
  select count(*) into v_seen from tarefa_series where titulo like '%CONFIDENTIAL%';
  assert v_seen = 0, 'series of another workspace visible';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'direct');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct INSERT on tarefa_series was not permission denied';

  v_rejected := false;
  begin
    update tarefa_series set proxima_data = '2030-01-01' where id = v_serie_a;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct UPDATE on tarefa_series was not permission denied';

  v_rejected := false;
  begin
    delete from tarefa_series where id = v_serie_a;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct DELETE on tarefa_series was not permission denied';

  -- tarefas.serie_id guard: link, relink, unlink all raise for authenticated
  v_rejected := false;
  begin
    update tarefas set serie_id = v_serie_a where id = v_tarefa_a2;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'authenticated linked a task to a series directly';
  v_rejected := false;
  begin
    insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
      values (v_ws_a, v_user, 'forged', 'pendente', '2026-02-01', v_serie_a);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'authenticated inserted a task with serie_id directly';
  v_rejected := false;
  begin
    update tarefas set serie_id = null where id = v_tarefa_a;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'authenticated unlinked an occurrence directly';
  -- ...but an ordinary write to an occurrence still works
  update tarefas set titulo = 'A1 renamed' where id = v_tarefa_a;
  get diagnostics v_seen = row_count;
  assert v_seen = 1, 'authenticated could not update its own occurrence';

  execute 'reset role';

  -- ---- anon reads nothing ----
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into v_seen from tarefa_series;
  assert v_seen = 0, 'anon can read tarefa_series';
  execute 'reset role';

  -- ---- RPC grants ----
  foreach v_state in array array[
    'public.tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint)',
    'public.tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean)',
    'public.tarefa_serie_definir_estado(bigint, text)',
    'public.tarefa_serie_excluir(bigint)'
  ] loop
    assert has_function_privilege('authenticated', v_state, 'EXECUTE'), format('authenticated must execute %s', v_state);
    assert has_function_privilege('anon', v_state, 'EXECUTE') = false, format('anon must not execute %s', v_state);
  end loop;
  foreach v_state in array array[
    'public.tarefa_serie_materializar(bigint, date)',
    'public.tarefa_serie_garantir_aberta(bigint, date)',
    'public.tarefa_serie_validar_refs(uuid, bigint, bigint)',
    'public.tarefa_serie_parse_dias_semana(jsonb)'
  ] loop
    assert has_function_privilege('authenticated', v_state, 'EXECUTE') = false, format('authenticated must not execute %s', v_state);
    assert has_function_privilege('anon', v_state, 'EXECUTE') = false, format('anon must not execute %s', v_state);
    assert has_function_privilege('service_role', v_state, 'EXECUTE'), format('service_role must execute %s', v_state);
  end loop;

  -- foreign-workspace fixtures (as owner): a tag, a standalone task and an occurrence in workspace B
  insert into tarefa_tags (conta_id, nome) values (v_ws_b, 'foreign') returning id into v_tag_b;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite)
    values (v_ws_b, v_user, 'B standalone', 'pendente', '2026-01-06') returning id into v_tarefa_b;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
    values (v_ws_b, v_user, 'B occurrence', 'pendente', '2026-01-05', v_serie_b) returning id into v_tarefa_b2;

  -- ---- RPC tenant scoping, as authenticated (active workspace = A) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- foreign responsavel raises
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', v_membro_b, 'cliente_id', null, 'data_limite', '2026-01-05'),
      '{}'::bigint[], '{}'::text[]);
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'criar accepted a responsavel from another workspace';
  assert v_msg = 'Responsável não encontrado neste workspace.', format('unexpected error for foreign responsavel: %s', v_msg);

  -- foreign cliente raises
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', v_cli_b, 'data_limite', '2026-01-05'),
      '{}'::bigint[], '{}'::text[]);
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'criar accepted a cliente from another workspace';
  assert v_msg = 'Cliente não encontrado neste workspace.', format('unexpected error for foreign cliente: %s', v_msg);

  -- past inicio raises
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-04'),
      '{}'::bigint[], '{}'::text[]);
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'criar accepted a past inicio';
  assert v_msg = 'Para repetir, o prazo precisa ser hoje ou depois.', format('unexpected error for past inicio: %s', v_msg);

  -- a malformed dias_semana payload is rejected by the RPC's own validation
  -- (SQLSTATE 22023), not by a cast failure (22P02) inside a helper
  foreach v_state in array array['["x"]', '[1.5]', '[7]', '"1"', '[[1]]', '[null]', '[true]'] loop
    v_rejected := false; v_code := null;
    begin
      perform public.tarefa_serie_criar(
        format('{"freq":"weekly","intervalo":1,"dias_semana":%s,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}', v_state)::jsonb,
        jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                           'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
        '{}'::bigint[], '{}'::text[]);
    exception when others then v_rejected := true; v_code := sqlstate; end;
    assert v_rejected, format('criar accepted dias_semana %s', v_state);
    assert v_code = '22023', format('dias_semana %s raised %s instead of 22023', v_state, v_code);
  end loop;

  -- a tag of another workspace is dropped silently (no link, not stored in the template)
  select serie_id, tarefa_id into v_serie_a2, v_tarefa_new from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'tag scope', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-07'),
    array[v_tag_b], '{}'::text[]);
  select count(*) into v_seen from tarefa_tag_links where tarefa_id = v_tarefa_new; assert v_seen = 0, 'criar linked a foreign tag';
  perform 1 from tarefa_series where id = v_serie_a2 and tag_ids = '{}'; assert found, 'criar stored a foreign tag in the template';

  -- promotion cannot take a task of another workspace
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'B standalone', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
      '{}'::bigint[], '{}'::text[], v_tarefa_b);
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'criar promoted a task from another workspace';
  assert v_msg = 'Tarefa não encontrada neste workspace.', format('unexpected error promoting foreign task: %s', v_msg);

  -- other workspace's rows are "not found" for edit / state / delete
  v_rejected := false;
  begin
    perform public.tarefa_serie_definir_estado(v_serie_b, 'pausar');
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'definir_estado touched another workspace''s series';
  assert v_msg = 'Série não encontrada neste workspace.', format('unexpected error for foreign series: %s', v_msg);
  v_rejected := false;
  begin
    perform public.tarefa_serie_excluir(v_serie_b);
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'excluir touched another workspace''s series';
  assert v_msg = 'Série não encontrada neste workspace.', format('unexpected error for foreign series: %s', v_msg);
  v_rejected := false;
  begin
    perform public.tarefa_serie_aplicar_edicao(v_tarefa_b2,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
      '{}'::bigint[],
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      false);
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'aplicar_edicao edited an occurrence from another workspace';
  assert v_msg = 'Tarefa não encontrada neste workspace.', format('unexpected error editing foreign occurrence: %s', v_msg);
  v_rejected := false;
  begin
    perform public.tarefa_serie_aplicar_edicao(v_tarefa_a2,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
      '{}'::bigint[],
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      false);
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'aplicar_edicao accepted a standalone task';
  assert v_msg = 'Esta tarefa não pertence a uma série.', format('unexpected error for standalone task: %s', v_msg);

  -- a state outside the enum raises
  v_rejected := false;
  begin
    perform public.tarefa_serie_definir_estado(v_serie_a, 'apagar');
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected and v_msg = 'Estado inválido.', 'definir_estado accepted an unknown state';

  -- a write to tarefas.serie_id from inside a DEFINER RPC passes the guard
  -- (promotion of the standalone task), while the same as authenticated raised above
  perform public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'A standalone', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
    '{}'::bigint[], '{}'::text[], v_tarefa_a2);
  perform 1 from tarefas where id = v_tarefa_a2 and serie_id is not null;
  assert found, 'promotion through the RPC did not link the task';
  execute 'reset role';

  -- a session with no workspace raises
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin
    perform public.tarefa_serie_definir_estado(v_serie_a, 'pausar');
  exception when others then v_rejected := true; v_msg := sqlerrm; end;
  assert v_rejected, 'RPC ran without an active workspace';
  assert v_msg = 'Sessao sem workspace ativo.', format('unexpected error without a workspace: %s', v_msg);
  execute 'reset role';

  raise notice 'PASS 99_tarefa_series_rls';
end $$;

rollback;
