\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Search Console do blog (migration 20261101000002).
-- (a) grants: tabelas e sequence fechadas para anon/authenticated; funcoes so service_role.
-- (b) blog_search_replace: troca a janela inteira (apaga e insere), linhas fora da janela
--     existente ficam, linha com dia fora da janela levanta 22023.
-- (c) blog_search_stats: posicao ponderada por impressoes, janela termina em max(day), p_days
--     nulo/<1 vira 28 e e limitado a 486. (d) blog_search_series. (e) blog_search_state so id 1.
begin;
-- A sequence da identidade vem antes da parity: o helper concede ALL em TODAS as sequences do
-- schema (nao so nas tabelas excluidas), entao depois dele a ACL real da migration some.
do $$
declare v_seq text;
begin
  v_seq := pg_get_serial_sequence('public.blog_search_runs', 'id');
  assert v_seq is not null, 'blog_search_runs.id sem sequence de identidade';
  assert not has_sequence_privilege('anon', v_seq, 'USAGE'), 'anon tem USAGE na sequence de runs';
  assert not has_sequence_privilege('authenticated', v_seq, 'USAGE'),
    'authenticated tem USAGE na sequence de runs';
  assert not has_sequence_privilege('authenticated', v_seq, 'SELECT'),
    'authenticated tem SELECT na sequence de runs';
  assert has_sequence_privilege('service_role', v_seq, 'USAGE'),
    'service_role precisa de USAGE na sequence de runs';
end $$;
-- As tabelas sao excluidas: a parity grant concederia ALL e desfaria o REVOKE sob teste.
select et_grant_hosted_parity(
  array['blog_search_daily', 'blog_index_status', 'blog_search_runs', 'blog_search_state']
);
do $$
declare
  v_n    int;
  v_fn   text;
  v_tbl  text;
  r      record;
  d1     date := date '2026-03-10';
  d2     date := date '2026-03-11';
  d3     date := date '2026-03-12';
  d4     date := date '2026-03-13';
  v_state text;
begin
  -- ---- (a) grants ----
  foreach v_tbl in array array[
    'public.blog_search_daily', 'public.blog_index_status',
    'public.blog_search_runs', 'public.blog_search_state'
  ] loop
    assert not has_table_privilege('anon', v_tbl, 'SELECT'), format('anon tem SELECT em %s', v_tbl);
    assert not has_table_privilege('authenticated', v_tbl, 'SELECT'),
      format('authenticated tem SELECT em %s', v_tbl);
    assert not has_table_privilege('authenticated', v_tbl, 'INSERT'),
      format('authenticated tem INSERT em %s', v_tbl);
    assert not has_table_privilege('authenticated', v_tbl, 'UPDATE'),
      format('authenticated tem UPDATE em %s', v_tbl);
    assert not has_table_privilege('authenticated', v_tbl, 'DELETE'),
      format('authenticated tem DELETE em %s', v_tbl);
    assert has_table_privilege('service_role', v_tbl, 'SELECT'),
      format('service_role precisa de SELECT em %s', v_tbl);
  end loop;
  assert has_table_privilege('service_role', 'public.blog_search_runs', 'INSERT'),
    'service_role precisa de INSERT em blog_search_runs';
  assert has_table_privilege('service_role', 'public.blog_search_runs', 'UPDATE'),
    'service_role precisa de UPDATE em blog_search_runs';
  assert has_table_privilege('service_role', 'public.blog_index_status', 'INSERT'),
    'service_role precisa de INSERT em blog_index_status';
  assert has_table_privilege('service_role', 'public.blog_index_status', 'UPDATE'),
    'service_role precisa de UPDATE em blog_index_status';
  assert has_table_privilege('service_role', 'public.blog_search_state', 'UPDATE'),
    'service_role precisa de UPDATE em blog_search_state';

  foreach v_fn in array array[
    'public.blog_search_replace(date,date,jsonb)',
    'public.blog_search_stats(integer)',
    'public.blog_search_series(text,integer)'
  ] loop
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon executa %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('authenticated executa %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'),
      format('service_role nao executa %s', v_fn);
  end loop;

  -- ---- (b) blog_search_replace ----
  delete from blog_search_daily;
  insert into blog_search_daily (slug, day, clicks, impressions, position) values
    ('p', d1, 1, 10, 3), ('p', d2, 2, 20, 3), ('p', d3, 3, 30, 3), ('p', d4, 4, 40, 3);

  perform blog_search_replace(d1, d3, jsonb_build_array(
    jsonb_build_object('slug', 'p', 'day', d1, 'clicks', 9, 'impressions', 90, 'position', 1.5)
  ));
  select count(*) into v_n from blog_search_daily where slug = 'p' and day in (d2, d3);
  assert v_n = 0, format('d2/d3 deveriam ter sumido, restaram %s', v_n);
  select * into r from blog_search_daily where slug = 'p' and day = d1;
  assert r.clicks = 9 and r.impressions = 90 and r.position = 1.5, 'd1 nao foi atualizado';
  select * into r from blog_search_daily where slug = 'p' and day = d4;
  assert r.clicks = 4 and r.impressions = 40, 'linha de d4 (fora da janela) foi alterada';
  select count(*) into v_n from blog_search_daily;
  assert v_n = 2, format('esperado 2 linhas (d1, d4), ha %s', v_n);

  -- array vazio apaga a janela (dia revisado para zero some)
  perform blog_search_replace(d1, d1, '[]'::jsonb);
  select count(*) into v_n from blog_search_daily where day = d1;
  assert v_n = 0, 'janela com array vazio deveria apagar d1';

  -- linha fora da janela: 22023 e nada muda (linhas existentes em d1/d2 sobrevivem)
  insert into blog_search_daily (slug, day, clicks, impressions, position) values
    ('p', d1, 11, 110, 2), ('p', d2, 12, 120, 2);
  begin
    perform blog_search_replace(d1, d2, jsonb_build_array(
      jsonb_build_object('slug', 'p', 'day', d1, 'clicks', 1, 'impressions', 1, 'position', 1),
      jsonb_build_object('slug', 'p', 'day', d3, 'clicks', 1, 'impressions', 1, 'position', 1)
    ));
    assert false, 'linha fora da janela deveria levantar';
  exception when sqlstate '22023' then
    null;
  end;
  select count(*) into v_n from blog_search_daily
    where slug = 'p' and day in (d1, d2) and clicks in (11, 12);
  assert v_n = 2, format('erro 22023 deveria preservar d1/d2 (sobraram %s de 2)', v_n);
  select count(*) into v_n from blog_search_daily where day = d3;
  assert v_n = 0, 'insercao parcial apos erro 22023';
  delete from blog_search_daily;

  -- janela invertida e p_rows que nao e array tambem sao 22023
  begin
    perform blog_search_replace(d3, d1, '[]'::jsonb);
    assert false, 'janela invertida deveria levantar';
  exception when sqlstate '22023' then
    null;
  end;
  begin
    perform blog_search_replace(d1, d3, '{}'::jsonb);
    assert false, 'p_rows objeto deveria levantar';
  exception when sqlstate '22023' then
    null;
  end;

  -- ---- (c) blog_search_stats ----
  delete from blog_search_daily;
  insert into blog_search_daily (slug, day, clicks, impressions, position) values
    ('w', d3, 1, 10, 2),
    ('w', d2, 3, 30, 6),
    ('z', d3, 0, 0, 4),
    ('old', d3 - 100, 5, 50, 1);

  select * into r from blog_search_stats(28) where slug = 'w';
  assert r.clicks = 4 and r.impressions = 40, format('w: clicks=%s impressions=%s', r.clicks, r.impressions);
  assert r.position = 5.0, format('posicao ponderada de w = %s, esperado 5.0', r.position);
  assert r.ctr = 0.1, format('ctr de w = %s, esperado 0.1', r.ctr);

  select * into r from blog_search_stats(28) where slug = 'z';
  assert r.ctr = 0, 'ctr sem impressoes deveria ser 0';
  assert r.position is null, 'posicao sem impressoes deveria ser null';

  select count(*) into v_n from blog_search_stats(28) where slug = 'old';
  assert v_n = 0, 'linha de 100 dias antes de max(day) entrou na janela de 28';
  select count(*) into v_n from blog_search_stats(120) where slug = 'old';
  assert v_n = 1, 'janela de 120 dias deveria incluir a linha antiga';
  -- p_days = 1: so o proprio max(day)
  select impressions into v_n from blog_search_stats(1) where slug = 'w';
  assert v_n = 10, format('janela de 1 dia: impressoes = %s, esperado 10', v_n);
  -- nulo e < 1 viram o padrao (28); acima de 486 e limitado a 486
  select count(*) into v_n from blog_search_stats(null) where slug = 'old';
  assert v_n = 0, 'p_days nulo deveria virar 28';
  select count(*) into v_n from blog_search_stats(0) where slug = 'old';
  assert v_n = 0, 'p_days 0 deveria virar 28';
  select count(*) into v_n from blog_search_stats(-5) where slug = 'old';
  assert v_n = 0, 'p_days negativo deveria virar 28';
  insert into blog_search_daily (slug, day, clicks, impressions, position)
    values ('far', d3 - 485, 1, 1, 1), ('toofar', d3 - 486, 1, 1, 1);
  select count(*) into v_n from blog_search_stats(100000) where slug = 'far';
  assert v_n = 1, 'p_days 100000 deveria cobrir 486 dias';
  select count(*) into v_n from blog_search_stats(100000) where slug = 'toofar';
  assert v_n = 0, 'p_days 100000 deveria ser limitado a 486 dias';

  delete from blog_search_daily;
  select count(*) into v_n from blog_search_stats(28);
  assert v_n = 0, 'tabela vazia deveria devolver zero linhas';

  -- ---- (d) blog_search_series ----
  insert into blog_search_daily (slug, day, clicks, impressions, position) values
    ('s', d3, 1, 10, 2),
    ('s', d1, 2, 20, 4),
    ('s', d3 - 40, 7, 70, 1),
    ('other', d3, 9, 90, 1);
  select count(*) into v_n from blog_search_series('s', 28);
  assert v_n = 2, format('series(28) devolveu %s dias, esperado 2', v_n);
  select count(*) into v_n from blog_search_series('s', 60);
  assert v_n = 3, format('series(60) devolveu %s dias, esperado 3', v_n);
  select string_agg(day::text, ',' order by day) into v_state from blog_search_series('s', 28);
  assert v_state = d1::text || ',' || d3::text, format('series fora de ordem: %s', v_state);
  select * into r from blog_search_series('s', 28) where day = d1;
  assert r.clicks = 2 and r.impressions = 20, 'series: valores de d1 errados';
  -- a janela termina em max(day) da tabela, nao no max do slug
  insert into blog_search_daily (slug, day, clicks, impressions, position)
    values ('late', d3 + 30, 1, 1, 1);
  select count(*) into v_n from blog_search_series('s', 28);
  assert v_n = 0, 'janela deveria terminar no max(day) global (d3 + 30)';
  select count(*) into v_n from blog_search_series('s', null);
  assert v_n = 0, 'series(null) deveria usar 28 dias';
  select count(*) into v_n from blog_search_series('nao-existe', 28);
  assert v_n = 0, 'slug sem dados deveria devolver zero linhas';

  -- ---- (e) blog_search_state ----
  assert (select count(*) from blog_search_state) = 1, 'blog_search_state deveria ter a linha 1';
  begin
    insert into blog_search_state (id) values (2);
    assert false, 'id = 2 deveria ser rejeitado';
  exception when check_violation then
    null;
  end;
end $$;
rollback;
