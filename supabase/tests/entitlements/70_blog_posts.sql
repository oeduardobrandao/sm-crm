\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- blog_posts: anon reads only publicando/publicado; authenticated reads nothing;
-- nobody but the service role writes; CHECK constraints and unique slug.
-- blog_posts is excluded from the parity helper so the migration's REVOKE is what is tested.

begin;
select et_grant_hosted_parity(array['blog_posts']);
-- Defensive (as in 99_tarefa_series_rls): earlier suites may have committed ALL grants.
revoke all on public.blog_posts from anon, authenticated;
grant select (id, slug, status, category, title, h1, description, lede, body_md,
  cover_image, images, sources, feature_slug, author, date, updated, revision)
  on public.blog_posts to anon;

do $$
declare
  v_st text;
  v_n bigint;
  v_rejected boolean;
  v_state text;
  v_col text;
begin
  foreach v_st in array array['rascunho','ajuste_solicitado','publicando','publicado','rejeitado','despublicado'] loop
    insert into blog_posts (slug, status, category, title, h1, description, sources)
      values ('post-' || replace(v_st, '_', '-'), v_st, 'guia', 't', 'h', 'd',
              '[{"title":"a","publisher":"b","url":"https://example.com"}]'::jsonb);
  end loop;

  -- ---- anon ----
  execute 'set local role anon';
  select count(*) into v_n from blog_posts where true;
  assert v_n = 2, format('anon saw %s rows, expected 2', v_n);
  select count(*) into v_n from blog_posts where status not in ('publicando','publicado');
  assert v_n = 0, 'anon saw a non-public status';

  perform slug, revision from blog_posts;
  foreach v_col in array array['revision_note','approved_by','checks','created_at'] loop
    v_state := null;
    begin
      execute format('select %I from blog_posts', v_col);
    exception when others then v_state := sqlstate; end;
    assert v_state = '42501', format('anon select %s: expected 42501, got %s', v_col, v_state);
  end loop;

  v_state := null;
  begin
    insert into blog_posts (slug, category, title, h1, description, sources)
      values ('anon-ins', 'guia', 't', 'h', 'd', '[{"a":1}]'::jsonb);
  exception when others then v_state := sqlstate; end;
  assert v_state = '42501', format('anon insert: expected 42501, got %s', v_state);

  v_state := null;
  begin
    update blog_posts set title = 'x';
  exception when others then v_state := sqlstate; end;
  assert v_state = '42501', format('anon update: expected 42501, got %s', v_state);

  v_state := null;
  begin
    delete from blog_posts;
  exception when others then v_state := sqlstate; end;
  assert v_state = '42501', format('anon delete: expected 42501, got %s', v_state);
  execute 'reset role';

  -- ---- authenticated: no access at all ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_state := null;
  begin
    select count(*) into v_n from blog_posts;
  exception when others then v_state := sqlstate; end;
  assert v_state = '42501', format('authenticated read: expected 42501, got %s', v_state);

  v_state := null;
  begin
    insert into blog_posts (slug, category, title, h1, description, sources)
      values ('auth-ins', 'guia', 't', 'h', 'd', '[{"a":1}]'::jsonb);
  exception when others then v_state := sqlstate; end;
  assert v_state = '42501', format('authenticated insert: expected 42501, got %s', v_state);

  v_state := null;
  begin
    update blog_posts set title = 'x';
  exception when others then v_state := sqlstate; end;
  assert v_state = '42501', format('authenticated update: expected 42501, got %s', v_state);

  v_state := null;
  begin
    delete from blog_posts;
  exception when others then v_state := sqlstate; end;
  assert v_state = '42501', format('authenticated delete: expected 42501, got %s', v_state);
  execute 'reset role';

  -- ---- CHECK constraints (as the table owner) ----
  v_rejected := false;
  begin
    insert into blog_posts (slug, status, category, title, h1, description, sources)
      values ('bad-status', 'foo', 'guia', 't', 'h', 'd', '[{"a":1}]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'status foo aceito';

  v_rejected := false;
  begin
    insert into blog_posts (slug, category, title, h1, description, sources)
      values ('bad-cat', 'foo', 't', 'h', 'd', '[{"a":1}]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'category foo aceita';

  v_rejected := false;
  begin
    insert into blog_posts (slug, category, title, h1, description, author, sources)
      values ('bad-author', 'guia', 't', 'h', 'd', 'foo', '[{"a":1}]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'author foo aceito';

  v_rejected := false;
  begin
    insert into blog_posts (slug, category, title, h1, description, sources)
      values ('bad-sources', 'guia', 't', 'h', 'd', '[]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'sources [] aceito';

  v_rejected := false;
  begin
    insert into blog_posts (slug, category, title, h1, description, sources)
      values ('bad-sources2', 'guia', 't', 'h', 'd', '{"a":1}'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'sources objeto aceito';

  v_rejected := false;
  begin
    insert into blog_posts (slug, category, title, h1, description, sources)
      values ('Bad Slug', 'guia', 't', 'h', 'd', '[{"a":1}]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'slug invalido aceito';

  -- ---- unique slug ----
  v_state := null;
  begin
    insert into blog_posts (slug, category, title, h1, description, sources)
      values ('post-publicado', 'guia', 't', 'h', 'd', '[{"a":1}]'::jsonb);
  exception when others then v_state := sqlstate; end;
  assert v_state = '23505', format('slug duplicado: expected 23505, got %s', v_state);

  -- ---- bucket (no SELECT policy on storage.objects) ----
  assert not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='blog_images_public_read'), 'blog images list policy exists';

  assert exists (select 1 from storage.buckets where id = 'blog-images' and public
                 and file_size_limit = 10485760
                 and allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']),
    'blog-images bucket missing or misconfigured';

  raise notice 'PASS 70_blog_posts';
end $$;

rollback;
