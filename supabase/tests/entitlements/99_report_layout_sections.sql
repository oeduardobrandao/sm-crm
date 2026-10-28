\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Seções por plataforma no layout do relatório (spec 2026-10-28-report-platform-sections,
-- migration 20261103000003). O trigger validate_report_layout() tem de aceitar exatamente
-- o que validateLayout (TS) aceita sobre as MESMAS fixtures, em report_documents e em
-- report_templates. O runner roda da raiz do repo, então o caminho do cat é relativo a ela.
\set fixtures `cat supabase/tests/fixtures/report_section_layouts.json`

begin;
-- psql não substitui :'fixtures' dentro de DO $$ ... $$: a fixture entra por tabela temp.
create temp table fx_section_layouts as select :'fixtures'::jsonb as data;

do $$
declare
  v_user uuid := gen_random_uuid();
  v_ws uuid;
  v_cli bigint;
  v_doc uuid;
  v_tpl uuid;
  v_fixtures jsonb;
  v_case jsonb;
  v_table text;
  v_ok boolean;
  v_rows int;
  v_n int := 0;
  v_content jsonb;
  v_with_markers jsonb;
  v_generated jsonb;
  v_base jsonb := '{"version":1,"blocks":[{"id":"b1","type":"text","size":"full"}]}'::jsonb;
begin
  select data into v_fixtures from fx_section_layouts;
  assert jsonb_typeof(v_fixtures) = 'array' and jsonb_array_length(v_fixtures) > 0,
    'fixtures de report_section_layouts.json não carregaram';

  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'Cliente S', 'S', '#000') returning id into v_cli;
  insert into report_documents (conta_id, client_id, period_start, period_end, layout)
    values (v_ws, v_cli, '2026-10-01', '2026-10-31', v_base) returning id into v_doc;
  insert into report_templates (conta_id, name, layout)
    values (v_ws, 'Modelo seções', v_base) returning id into v_tpl;

  -- Casos gerados (além das fixtures): legado com exatamente 200 blocos de conteúdo, e o
  -- mesmo com 12 marcadores Geral intercalados (o primeiro bloco é um marcador). Mais as
  -- duas bordas: 201 de conteúdo (com e sem marcadores) e 13 marcadores.
  select jsonb_agg(jsonb_build_object('id', 'c' || i, 'type', 'text', 'size', 'full') order by i)
    into v_content from generate_series(0, 199) as i;
  select jsonb_agg(blk order by ord) into v_with_markers from (
    select (i * 2)::numeric as ord,
           jsonb_build_object('id', 'c' || i, 'type', 'text', 'size', 'full') as blk
      from generate_series(0, 199) as i
    union all
    select (i * 17 * 2 - 1)::numeric,
           jsonb_build_object('id', 's' || i, 'type', 'section', 'size', 'full')
      from generate_series(0, 11) as i
  ) t;
  assert jsonb_array_length(v_with_markers) = 212, 'gerador: esperava 212 blocos';
  assert v_with_markers -> 0 ->> 'type' = 'section', 'gerador: primeiro bloco tem de ser seção';

  v_generated := jsonb_build_array(
    jsonb_build_object('name', 'generated: legacy 200 content blocks', 'valid', true,
      'layout', jsonb_build_object('version', 1, 'blocks', v_content)),
    jsonb_build_object('name', 'generated: 200 content blocks + 12 Geral markers', 'valid', true,
      'layout', jsonb_build_object('version', 1, 'blocks', v_with_markers)),
    jsonb_build_object('name', 'generated: legacy 201 content blocks', 'valid', false,
      'layout', jsonb_build_object('version', 1, 'blocks',
        v_content || '[{"id":"extra","type":"divider","size":"full"}]'::jsonb)),
    jsonb_build_object('name', 'generated: 201 content blocks + 12 markers', 'valid', false,
      'layout', jsonb_build_object('version', 1, 'blocks',
        v_with_markers || '[{"id":"extra","type":"divider","size":"full"}]'::jsonb)),
    jsonb_build_object('name', 'generated: 13 Geral markers', 'valid', false,
      'layout', jsonb_build_object('version', 1, 'blocks', (
        select jsonb_agg(jsonb_build_object('id', 's' || i, 'type', 'section', 'size', 'full')
                         order by i)
          from generate_series(0, 12) as i)))
  );

  foreach v_table in array array['report_documents', 'report_templates'] loop
    for v_case in select value from jsonb_array_elements(v_fixtures || v_generated) loop
      v_ok := true;
      begin
        if v_table = 'report_documents' then
          update report_documents set layout = v_case -> 'layout' where id = v_doc;
        else
          update report_templates set layout = v_case -> 'layout' where id = v_tpl;
        end if;
        get diagnostics v_rows = row_count;
        assert v_rows = 1, format('%s / %s: update não tocou a linha', v_table, v_case ->> 'name');
      exception when others then
        if sqlerrm not like '%INVALID_LAYOUT%' then
          raise exception '% / %: erro inesperado: %', v_table, v_case ->> 'name', sqlerrm;
        end if;
        v_ok := false;
      end;
      if v_ok <> (v_case ->> 'valid')::boolean then
        raise exception '% / %: esperado valid=%, trigger deu valid=%',
          v_table, v_case ->> 'name', v_case ->> 'valid', v_ok;
      end if;
      v_n := v_n + 1;
    end loop;
  end loop;

  raise notice 'PASS 99_report_layout_sections (% casos)', v_n;
end $$;
rollback;
