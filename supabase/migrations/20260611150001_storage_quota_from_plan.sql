-- Storage quota now resolves from the plan (effective_plan_limit), not workspaces.storage_quota_bytes.
-- NULL = unlimited, 0 = blocked (fail-closed). Errcode standardized to P0001.
--
-- post_media_insert_with_quota: does NOT update storage_used_bytes inline; the
--   post_media_used_bytes_ins trigger (installed in 20260412_post_media_quota_atomic.sql)
--   handles that via AFTER INSERT ON post_media.
--
-- file_insert_with_quota: DOES update storage_used_bytes inline (as in the original),
--   in addition to the trg_file_used_bytes_del trigger that handles decrements on DELETE.

create or replace function post_media_insert_with_quota(p jsonb)
returns post_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta_id uuid := (p->>'conta_id')::uuid;
  v_needed   bigint := (p->>'size_bytes')::bigint;
  v_quota    bigint;
  v_used     bigint;
  v_row      post_media;
begin
  select storage_used_bytes into v_used from workspaces where id = v_conta_id for update;
  v_quota := effective_plan_limit(v_conta_id, 'storage_quota_bytes');

  if v_quota is not null and (coalesce(v_used, 0) + v_needed) > v_quota then
    raise exception 'quota_exceeded' using errcode = 'P0001';
  end if;

  insert into post_media (
    post_id, conta_id, r2_key, thumbnail_r2_key, kind, mime_type, size_bytes,
    original_filename, width, height, duration_seconds, is_cover, uploaded_by
  ) values (
    (p->>'post_id')::bigint,
    v_conta_id,
    p->>'r2_key',
    nullif(p->>'thumbnail_r2_key', ''),
    p->>'kind',
    p->>'mime_type',
    v_needed,
    p->>'original_filename',
    nullif(p->>'width', '')::int,
    nullif(p->>'height', '')::int,
    nullif(p->>'duration_seconds', '')::int,
    (p->>'is_cover')::boolean,
    (p->>'uploaded_by')::uuid
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function file_insert_with_quota(p jsonb)
returns files
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conta_id uuid := (p->>'conta_id')::uuid;
  v_quota    bigint;
  v_used     bigint;
  v_row      files;
begin
  select storage_used_bytes into v_used from workspaces where id = v_conta_id for update;
  v_quota := effective_plan_limit(v_conta_id, 'storage_quota_bytes');

  if v_quota is not null and coalesce(v_used, 0) + (p->>'size_bytes')::bigint > v_quota then
    raise exception 'quota_exceeded' using errcode = 'P0001';
  end if;

  insert into files (
    conta_id, folder_id, r2_key, thumbnail_r2_key, name, kind, mime_type,
    size_bytes, width, height, duration_seconds, uploaded_by
  ) values (
    v_conta_id,
    nullif(p->>'folder_id', '')::bigint,
    p->>'r2_key',
    nullif(p->>'thumbnail_r2_key', ''),
    p->>'name',
    p->>'kind',
    p->>'mime_type',
    (p->>'size_bytes')::bigint,
    nullif(p->>'width', '')::int,
    nullif(p->>'height', '')::int,
    nullif(p->>'duration_seconds', '')::int,
    nullif(p->>'uploaded_by', '')::uuid
  ) returning * into v_row;

  update workspaces
     set storage_used_bytes = storage_used_bytes + v_row.size_bytes
   where id = v_row.conta_id;

  return v_row;
end;
$$;
