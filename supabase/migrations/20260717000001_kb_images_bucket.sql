-- Public bucket for Knowledge Base article screenshots.
--
-- These are app assets (like the logo), not tenant content: they are captured
-- from a demo workspace and shown identically to every reader. Serving them
-- public and permanent is what makes them immune to the body-image expiry bug
-- (sign-r2-urls only re-signs kb_articles.cover_image_url, never images inside
-- the content JSONB, so a signed body image 403s once its 3600s URL expires).
insert into storage.buckets (id, name, public)
values ('kb-images', 'kb-images', true)
on conflict (id) do nothing;

-- Public read. No write policy: uploads run with the service role key, which
-- bypasses RLS entirely.
--
-- NOTE: deliberately narrower than the avatars bucket. avatars_service_write is
-- `for insert with check (bucket_id = 'avatars')` with no role restriction --
-- its comment claims "service role" but as written any authenticated user can
-- insert. That policy is both unnecessary (service role bypasses RLS) and too
-- permissive. Not replicated here.
drop policy if exists "kb_images_public_read" on storage.objects;
create policy "kb_images_public_read"
  on storage.objects for select
  using (bucket_id = 'kb-images');
