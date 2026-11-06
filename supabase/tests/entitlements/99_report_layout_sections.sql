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
  v_content_201_s11 jsonb;
  v_content_199_s13 jsonb;
  f_geral bigint;
  f_ig bigint;
  v_links int;
  v_rc int;
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

  -- Tetos exatos ALÉM do guarda de 212 entradas: os dois casos abaixo têm 212 entradas,
  -- então só o FILTER de conteúdo (201 > 200) ou o de marcadores (13 > 12) os barra.
  select jsonb_agg(e order by o) || '[{"id":"extra","type":"divider","size":"full"}]'::jsonb
    into v_content_201_s11
    from jsonb_array_elements(v_with_markers) with ordinality as t(e, o)
   where e ->> 'id' <> 's11';
  select jsonb_agg(e order by o) || '[{"id":"s12","type":"section","size":"full"}]'::jsonb
    into v_content_199_s13
    from jsonb_array_elements(v_with_markers) with ordinality as t(e, o)
   where e ->> 'id' <> 'c199';
  assert jsonb_array_length(v_content_201_s11) = 212, 'gerador: 201+11 tem de ter 212 entradas';
  assert jsonb_array_length(v_content_199_s13) = 212, 'gerador: 199+13 tem de ter 212 entradas';

  v_generated := jsonb_build_array(
    jsonb_build_object('name', 'generated: 201 content blocks + 11 markers (212 entries)',
      'valid', false, 'layout', jsonb_build_object('version', 1, 'blocks', v_content_201_s11)),
    jsonb_build_object('name', 'generated: 199 content blocks + 13 markers (212 entries)',
      'valid', false, 'layout', jsonb_build_object('version', 1, 'blocks', v_content_199_s13)),
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

  -- Imagem preenchida dentro de seções (Geral e Instagram): o layout seccionado é aceito e
  -- report_document_files_sync vincula os dois arquivos (mesmo setup de
  -- 99_report_image_files.sql: PNG do próprio workspace, file_id + width + height).
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes, width, height)
    values (v_ws, 'contas/'||v_ws||'/files/geral.png', 'geral.png', 'image', 'image/png', 100, 10, 10)
    returning id into f_geral;
  insert into files (conta_id, r2_key, name, kind, mime_type, size_bytes, width, height)
    values (v_ws, 'contas/'||v_ws||'/files/ig.png', 'ig.png', 'image', 'image/png', 100, 10, 10)
    returning id into f_ig;
  update report_documents set layout = jsonb_build_object('version', 1, 'blocks', jsonb_build_array(
      jsonb_build_object('id', 's_geral', 'type', 'section', 'size', 'full'),
      jsonb_build_object('id', 'img_geral', 'type', 'image', 'size', 'full', 'config',
        jsonb_build_object('file_id', f_geral, 'width', 10, 'height', 10)),
      jsonb_build_object('id', 's_ig', 'type', 'section', 'size', 'full',
        'config', '{"platform":"instagram"}'::jsonb),
      jsonb_build_object('id', 'ig_reach', 'type', 'kpi_reach', 'size', 'third'),
      jsonb_build_object('id', 'img_ig', 'type', 'image', 'size', 'half', 'config',
        jsonb_build_object('file_id', f_ig, 'width', 10, 'height', 10))))
   where id = v_doc;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'layout seccionado com imagens deveria ser aceito';
  select count(*) into v_links from report_document_files
   where report_id = v_doc and file_id in (f_geral, f_ig);
  assert v_links = 2, format('imagens em seções deveriam vincular 2 arquivos, got %s', v_links);
  select reference_count into v_rc from files where id = f_geral;
  assert v_rc = 1, format('reference_count da imagem na seção Geral deveria ser 1, got %s', v_rc);
  select reference_count into v_rc from files where id = f_ig;
  assert v_rc = 1, format('reference_count da imagem na seção Instagram deveria ser 1, got %s', v_rc);

  raise notice 'PASS 99_report_layout_sections (% casos)', v_n;
end $$;
rollback;
