\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
select et_grant_hosted_parity();
-- Reimpõe a superfície restrita que a migration define e a parity desfez.
revoke all on public.report_documents from anon, authenticated;
grant select on public.report_documents to authenticated;
grant update (layout, title) on public.report_documents to authenticated;
do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws_a uuid; v_ws_b uuid;
  v_cli_a bigint; v_cli_b bigint;
  v_doc_a uuid; v_doc_b uuid;
  v_tpl_1 uuid; v_tpl_2 uuid;
  v_seen int; v_rows int;
  v_layout jsonb := '{"version":1,"blocks":[{"id":"b1","type":"text","size":"full"}]}'::jsonb;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a
   where id = v_user;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_a, 'Cliente A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws_b, 'Cliente B', 'B', '#000') returning id into v_cli_b;

  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_a, v_cli_a, '2026-07-01', '2026-07-31', v_layout) returning id into v_doc_a;
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws_b, v_cli_b, '2026-07-01', '2026-07-31', v_layout) returning id into v_doc_b;

  -- Trigger de validação: layout sem "version" é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-06-01', '2026-06-30', '{"blocks":[]}'::jsonb);
    raise exception 'validate_report_layout aceitou layout sem version';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Trigger de validação: version não inteira (1.5) é rejeitada — jsonb_typeof
  -- diria 'number' e furaria o guard; o check é de igualdade exata com 1.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-05-01', '2026-05-31', '{"version":1.5,"blocks":[]}'::jsonb);
    raise exception 'validate_report_layout aceitou version 1.5';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Trigger de validação: blocks ausente é rejeitado — IS DISTINCT FROM
  -- é NULL-safe, diferente de <>.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-04-01', '2026-04-30', '{"version":1}'::jsonb);
    raise exception 'validate_report_layout aceitou layout sem blocks';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Trigger de validação: block sem id é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31', '{"version":1,"blocks":[{"type":"text","size":"full"}]}'::jsonb);
    raise exception 'validate_report_layout aceitou block sem id';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Trigger de validação: block sem type é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-02-01', '2026-02-28', '{"version":1,"blocks":[{"id":"b1","size":"full"}]}'::jsonb);
    raise exception 'validate_report_layout aceitou block sem type';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Trigger de validação: block sem size é rejeitado — size é OBRIGATÓRIO
  -- (diferente da lógica anterior que fazia COALESCE para 'full').
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-01-01', '2026-01-31', '{"version":1,"blocks":[{"id":"b1","type":"text"}]}'::jsonb);
    raise exception 'validate_report_layout aceitou block sem size';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Hardening PR3: id duplicado é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"blocks":[{"id":"x","type":"text","size":"full"},{"id":"x","type":"divider","size":"full"}]}'::jsonb);
    raise exception 'validate_report_layout aceitou id duplicado';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Hardening PR3: accent com alpha (#rrggbbaa) é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"accent":"#11223344","blocks":[]}'::jsonb);
    raise exception 'validate_report_layout aceitou accent com alpha';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Hardening PR3: text em bloco não-textual é rejeitado.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-03-01', '2026-03-31',
        '{"version":1,"blocks":[{"id":"k1","type":"kpi_reach","size":"third","text":{}}]}'::jsonb);
    raise exception 'validate_report_layout aceitou text em kpi';
  exception when others then
    if sqlerrm not like '%INVALID_LAYOUT%' then raise; end if;
  end;

  -- Hardening PR3: layout válido COM accent e text em bloco ai_ passa.
  declare
    v_doc_valid uuid;
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-02-01', '2026-02-28',
        '{"version":1,"accent":"#9f1239","blocks":[{"id":"a1","type":"ai_summary","size":"full","text":{"type":"doc"}}]}'::jsonb)
      returning id into v_doc_valid;
    -- Cleanup: a inserção é prova de que accent+text passam; deletar antes das assertions de RLS
    delete from report_documents where id = v_doc_valid;
  end;

  -- Bump condicional: update de layout bumpa updated_at; update de pdf_* NÃO.
  -- Postgres now() é transaction_timestamp() (congelado por transação), então não podemos
  -- contar com tempo passando. Ao invés, movemos updated_at pra trás, verificamos o bump
  -- forward no layout update, e verificamos igualdade exata no pdf_* update.
  declare
    v_t0 timestamptz; v_t1 timestamptz; v_t2 timestamptz;
  begin
    -- Mover updated_at pra trás: o trigger condicional não sobrescreve porque
    -- nenhuma coluna de conteúdo muda. (Isso é também uma prova extra de que o trigger funciona.)
    update report_documents set updated_at = updated_at - interval '1 hour' where id = v_doc_a;
    select updated_at into v_t0 from report_documents where id = v_doc_a;

    -- Update de layout: deve fazer bump
    update report_documents
       set layout = '{"version":1,"blocks":[{"id":"b2","type":"divider","size":"full"}]}'::jsonb
     where id = v_doc_a;
    select updated_at into v_t1 from report_documents where id = v_doc_a;
    if v_t1 <= v_t0 then
      raise exception 'update de layout não bumpou updated_at';
    end if;

    -- Update de pdf_*: não deve fazer bump (igualdade exata em transação)
    update report_documents
       set pdf_storage_path = 'docs/x/y.pdf', pdf_generated_at = now(), pdf_renderer_version = 1
     where id = v_doc_a;
    select updated_at into v_t2 from report_documents where id = v_doc_a;
    if v_t2 <> v_t1 then
      raise exception 'update de pdf_* bumpou updated_at (cache do PDF nasce inválido)';
    end if;
  end;

  insert into report_templates (conta_id, name, layout, is_default)
    values (v_ws_a, 'T1', v_layout, true) returning id into v_tpl_1;
  insert into report_templates (conta_id, name, layout)
    values (v_ws_a, 'T2', v_layout) returning id into v_tpl_2;

  -- Índice parcial: segundo default direto no mesmo workspace falha.
  begin
    update report_templates set is_default = true where id = v_tpl_2;
    raise exception 'dois defaults no mesmo workspace foram aceitos';
  exception when unique_violation then null;
  end;

  -- ---- agir como o usuário (workspace ativo = A) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- SELECT: só o workspace ativo.
  select count(*) into v_seen from report_documents;
  assert v_seen = 1, format('report_documents: esperava 1 visivel, veio %s', v_seen);

  -- UPDATE de layout/title no próprio doc funciona.
  update report_documents set title = 'Editado', layout = v_layout where id = v_doc_a;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'update de layout/title no proprio doc falhou';

  -- UPDATE no doc do outro workspace: RLS filtra (0 linhas).
  update report_documents set title = 'HACK' where id = v_doc_b;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'RLS deixou editar doc de outro workspace';

  -- Grant por coluna: status/data_snapshot são invioláveis pelo authenticated.
  begin
    update report_documents set status = 'failed' where id = v_doc_a;
    raise exception 'authenticated conseguiu escrever status';
  exception when insufficient_privilege then null;
  end;
  begin
    update report_documents set data_snapshot = '{}'::jsonb where id = v_doc_a;
    raise exception 'authenticated conseguiu escrever data_snapshot';
  exception when insufficient_privilege then null;
  end;

  -- Sem INSERT nem DELETE para authenticated.
  begin
    insert into report_documents (conta_id, client_id, period_start, period_end, layout)
      values (v_ws_a, v_cli_a, '2026-05-01', '2026-05-31', v_layout);
    raise exception 'authenticated conseguiu inserir report_document';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from report_documents where id = v_doc_a;
    raise exception 'authenticated conseguiu deletar report_document';
  exception when insufficient_privilege then null;
  end;

  -- RPC de default: troca atômica T1 -> T2.
  perform set_default_report_template(v_tpl_2);
  assert (select is_default from report_templates where id = v_tpl_2) = true,
    'RPC nao marcou o novo default';
  assert (select is_default from report_templates where id = v_tpl_1) = false,
    'RPC nao desmarcou o default anterior';

  raise notice 'PASS 66_report_docs';
end $$;
rollback;
