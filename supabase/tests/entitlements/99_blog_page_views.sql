\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Contagem anonima de views do blog (migration 20261101000001).
-- (a) grants: tabelas e sequence fechadas para anon/authenticated; as cinco funcoes so service_role.
-- (b) record_blog_view deduplica por (slug, hash) em 30 min, devolve 'inserted' / 'duplicate' /
--     'capped' e para de gravar num post com 1000 views na ultima hora (so linhas novas contam). (c) blog_view_salt_today devolve o
--     mesmo sal de 64 hex no dia e apaga sais de dias anteriores; blog_view_prune_salts tambem.
-- (d) blog_view_stats / blog_view_daily: janelas 7d/30d/total, so dias com views.
begin;
-- A sequence da identidade vem antes da parity: o helper concede ALL em TODAS as sequences do
-- schema (nao so nas tabelas excluidas), entao depois dele a ACL real da migration some.
do $$
declare v_seq text;
begin
  v_seq := pg_get_serial_sequence('public.blog_page_views', 'id');
  assert v_seq is not null, 'blog_page_views.id sem sequence de identidade';
  assert not has_sequence_privilege('anon', v_seq, 'USAGE'), 'anon tem USAGE na sequence de views';
  assert not has_sequence_privilege('anon', v_seq, 'SELECT'), 'anon tem SELECT na sequence de views';
  assert not has_sequence_privilege('authenticated', v_seq, 'USAGE'),
    'authenticated tem USAGE na sequence de views';
  assert not has_sequence_privilege('authenticated', v_seq, 'SELECT'),
    'authenticated tem SELECT na sequence de views';
  assert has_sequence_privilege('service_role', v_seq, 'USAGE'),
    'service_role precisa de USAGE na sequence de views';
end $$;
-- As duas tabelas sao excluidas: a parity grant concederia ALL e desfaria o REVOKE sob teste.
select et_grant_hosted_parity(array['blog_page_views', 'blog_view_salts']);
do $$
declare
  v_n    int;
  v_salt text;
  v_salt2 text;
  v_id   bigint;
  r      record;
  v_fn   text;
  v_res  text;
begin
  -- ---- (a) grants ----
  assert not has_table_privilege('anon', 'public.blog_page_views', 'SELECT'),
    'anon tem SELECT em blog_page_views';
  assert not has_table_privilege('authenticated', 'public.blog_page_views', 'SELECT'),
    'authenticated tem SELECT em blog_page_views';
  assert not has_table_privilege('authenticated', 'public.blog_page_views', 'INSERT'),
    'authenticated tem INSERT em blog_page_views';
  assert not has_table_privilege('anon', 'public.blog_view_salts', 'SELECT'),
    'anon tem SELECT em blog_view_salts';
  assert not has_table_privilege('authenticated', 'public.blog_view_salts', 'SELECT'),
    'authenticated tem SELECT em blog_view_salts';
  assert not has_table_privilege('authenticated', 'public.blog_view_salts', 'INSERT'),
    'authenticated tem INSERT em blog_view_salts';
  assert has_table_privilege('service_role', 'public.blog_page_views', 'SELECT'),
    'service_role precisa de SELECT em blog_page_views';

  foreach v_fn in array array[
    'public.record_blog_view(text,text)',
    'public.blog_view_salt_today()',
    'public.blog_view_prune_salts()',
    'public.blog_view_stats()',
    'public.blog_view_daily(text,integer)'
  ] loop
    assert not has_function_privilege('anon', v_fn, 'EXECUTE'), format('anon executa %s', v_fn);
    assert not has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      format('authenticated executa %s', v_fn);
    assert has_function_privilege('service_role', v_fn, 'EXECUTE'),
      format('service_role nao executa %s', v_fn);
  end loop;

  -- ---- (b) record_blog_view ----
  delete from blog_page_views;
  delete from blog_view_salts;

  v_res := record_blog_view('a', 'h');
  assert v_res = 'inserted', format('primeira chamada devolveu %s, esperado inserted', v_res);
  v_res := record_blog_view('a', 'h');   -- dedupe 30 min
  assert v_res = 'duplicate', format('repeticao devolveu %s, esperado duplicate', v_res);
  select count(*) into v_n from blog_page_views;
  assert v_n = 1, format('duas chamadas seguidas gravaram %s linhas, esperado 1', v_n);

  update blog_page_views set viewed_at = now() - interval '31 minutes' where slug = 'a' and visitor_hash = 'h';
  perform record_blog_view('a', 'h');   -- fora da janela: grava
  select count(*) into v_n from blog_page_views;
  assert v_n = 2, format('apos 31 min: %s linhas, esperado 2', v_n);

  perform record_blog_view('a', 'other');  -- outro hash: grava
  select count(*) into v_n from blog_page_views;
  assert v_n = 3, format('outro hash: %s linhas, esperado 3', v_n);

  perform record_blog_view('b', 'h');   -- outro slug, mesmo hash: grava
  select count(*) into v_n from blog_page_views;
  assert v_n = 4, format('outro slug: %s linhas, esperado 4', v_n);

  -- teto por post: 1000 linhas na ultima hora bloqueiam um hash novo; a repeticao de um hash
  -- ja gravado continua 'duplicate' (nao gasta o teto); linhas com mais de 1 h nao contam.
  insert into blog_page_views (slug, visitor_hash, viewed_at)
    select 'cheio', 'f' || g, now() - interval '61 minutes' from generate_series(1, 5) g;
  insert into blog_page_views (slug, visitor_hash)
    select 'cheio', 'c' || g from generate_series(1, 999) g;
  v_res := record_blog_view('cheio', 'novo-1');
  assert v_res = 'inserted', format('999 na hora: devolveu %s, esperado inserted', v_res);
  v_res := record_blog_view('cheio', 'novo-2');
  assert v_res = 'capped', format('1000 na hora: devolveu %s, esperado capped', v_res);
  v_res := record_blog_view('cheio', 'c1');
  assert v_res = 'duplicate', format('repeticao no teto devolveu %s, esperado duplicate', v_res);
  select count(*) into v_n from blog_page_views where slug = 'cheio';
  assert v_n = 1005, format('post no teto tem %s linhas, esperado 1005', v_n);
  v_res := record_blog_view('outro-post', 'novo-2');
  assert v_res = 'inserted', 'o teto de um post bloqueou outro post';

  -- ---- (c) sal do dia ----
  v_salt := blog_view_salt_today();
  v_salt2 := blog_view_salt_today();
  assert v_salt ~ '^[0-9a-f]{64}$', format('sal nao e hex de 64: %s', v_salt);
  assert v_salt = v_salt2, 'sal mudou entre chamadas no mesmo dia';
  select count(*) into v_n from blog_view_salts;
  assert v_n = 1, format('blog_view_salts tem %s linhas, esperado 1', v_n);

  insert into blog_view_salts (day, salt)
    values ((now() at time zone 'America/Sao_Paulo')::date - 1, 'old-1');
  v_salt2 := blog_view_salt_today();
  assert v_salt2 = v_salt, 'sal de hoje mudou ao apagar o de ontem';
  select count(*) into v_n from blog_view_salts;
  assert v_n = 1, format('sal de ontem nao foi apagado por blog_view_salt_today: %s linhas', v_n);

  -- prune isolado (job do pg_cron): apaga so dias anteriores a hoje
  insert into blog_view_salts (day, salt)
    values ((now() at time zone 'America/Sao_Paulo')::date - 2, 'old-2');
  perform blog_view_prune_salts();
  select count(*) into v_n from blog_view_salts;
  assert v_n = 1, format('prune deixou %s linhas, esperado 1 (so hoje)', v_n);
  assert exists (select 1 from blog_view_salts where salt = v_salt), 'prune apagou o sal de hoje';

  -- ---- (d) stats e daily ----
  delete from blog_page_views;
  insert into blog_page_views (slug, viewed_at, visitor_hash) values
    ('s', now() - interval '1 day',   'x1'),
    ('s', now() - interval '10 days', 'x2'),
    ('s', now() - interval '40 days', 'x3');

  select * into r from blog_view_stats() where slug = 's';
  assert r.views_7d = 1, format('views_7d = %s, esperado 1', r.views_7d);
  assert r.views_30d = 2, format('views_30d = %s, esperado 2', r.views_30d);
  assert r.views_total = 3, format('views_total = %s, esperado 3', r.views_total);

  select count(*) into v_n from blog_view_daily('s', 30);
  assert v_n = 2, format('blog_view_daily(30) devolveu %s dias, esperado 2 (sem o de 40 dias)', v_n);
  select count(*) into v_n from blog_view_daily('s', 60);
  assert v_n = 3, format('blog_view_daily(60) devolveu %s dias, esperado 3', v_n);
  select count(*) into v_n from blog_view_daily('nao-existe', 30);
  assert v_n = 0, 'slug sem views deveria devolver zero linhas';
end $$;
rollback;
