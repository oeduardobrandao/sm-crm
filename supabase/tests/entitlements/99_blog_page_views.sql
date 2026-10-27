\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Contagem anonima de views do blog (migration 20261031000001).
-- (a) grants: tabelas fechadas para anon/authenticated; as cinco funcoes so service_role.
-- (b) record_blog_view deduplica por (slug, hash) em 30 min. (c) blog_view_salt_today devolve o
--     mesmo sal de 64 hex no dia e apaga sais de dias anteriores; blog_view_prune_salts tambem.
-- (d) blog_view_stats / blog_view_daily: janelas 7d/30d/total, so dias com views.
begin;
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

  perform record_blog_view('a', 'h');
  perform record_blog_view('a', 'h');   -- dedupe 30 min
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
