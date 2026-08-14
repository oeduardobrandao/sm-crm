\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Stream playback columns (spec 2026-08-13): deleting a files row must carry
-- stream_uid into file_deletions via the SECURITY DEFINER trigger.

begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_file bigint;
  v_queued_uid text;
  v_secdef boolean;
begin
  -- file_enqueue_delete must remain SECURITY DEFINER.
  select prosecdef into v_secdef from pg_proc where proname = 'file_enqueue_delete';
  if v_secdef is distinct from true then
    raise exception 'file_enqueue_delete lost SECURITY DEFINER';
  end if;

  v_ws := et_make_workspace('max');
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes, stream_uid, stream_status)
  values (v_ws, 'contas/' || v_ws || '/files/v.mov', 'contas/' || v_ws || '/files/v.thumb', 'v.mov', 'video', 'video/quicktime', 1000, 'uid-abc', 'ready')
  returning id into v_file;

  delete from files where id = v_file;

  select stream_uid into v_queued_uid
  from file_deletions where r2_key = 'contas/' || v_ws || '/files/v.mov';
  if v_queued_uid is distinct from 'uid-abc' then
    raise exception 'file_deletions row missing stream_uid (got %)', v_queued_uid;
  end if;
end $$;
rollback;
