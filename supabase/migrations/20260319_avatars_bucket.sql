-- Create public avatars bucket for caching Instagram profile pictures
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Allow anyone to read avatars (public bucket)
create policy "avatars_public_read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Allow service role to write avatars (edge functions use service role key)
create policy "avatars_service_write"
  on storage.objects for insert
  with check (bucket_id = 'avatars');

create policy "avatars_service_update"
  on storage.objects for update
  using (bucket_id = 'avatars');
