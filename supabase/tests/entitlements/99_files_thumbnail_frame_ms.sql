\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- files.thumbnail_frame_ms + trg_files_thumbnail_frame_reset (20261110000001): swapping the
-- thumbnail clears the frame; a follow-up update that only sets the frame keeps it.

begin;
do $$
declare
  v_ws uuid;
  v_file bigint;
  v_ms integer;
begin
  v_ws := et_make_workspace('max');
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes, thumbnail_frame_ms)
  values (v_ws, 'contas/' || v_ws || '/files/v.mp4', 'contas/' || v_ws || '/files/v-a.jpg', 'v.mp4', 'video', 'video/mp4', 1000, 500)
  returning id into v_file;
  select thumbnail_frame_ms into v_ms from files where id = v_file;
  assert v_ms = 500, 'insert did not keep thumbnail_frame_ms';

  -- Unrelated update: frame stays.
  update files set name = 'renamed.mp4' where id = v_file;
  select thumbnail_frame_ms into v_ms from files where id = v_file;
  assert v_ms = 500, 'an update that does not touch the thumbnail cleared the frame';

  -- Same thumbnail key written again: frame stays.
  update files set thumbnail_r2_key = 'contas/' || v_ws || '/files/v-a.jpg' where id = v_file;
  select thumbnail_frame_ms into v_ms from files where id = v_file;
  assert v_ms = 500, 'rewriting the same thumbnail key cleared the frame';

  -- New thumbnail (e.g. an uploaded image or an Estúdio cover): frame cleared.
  update files set thumbnail_r2_key = 'contas/' || v_ws || '/files/v-b.jpg' where id = v_file;
  select thumbnail_frame_ms into v_ms from files where id = v_file;
  assert v_ms is null, 'swapping the thumbnail did not clear the frame';

  -- New thumbnail and a frame in one statement: still cleared (writers set the frame after).
  update files set thumbnail_r2_key = 'contas/' || v_ws || '/files/v-c.jpg', thumbnail_frame_ms = 1200 where id = v_file;
  select thumbnail_frame_ms into v_ms from files where id = v_file;
  assert v_ms is null, 'a combined update kept the frame';

  -- Follow-up update with the frame only: kept.
  update files set thumbnail_frame_ms = 12300 where id = v_file;
  select thumbnail_frame_ms into v_ms from files where id = v_file;
  assert v_ms = 12300, 'the follow-up frame update was not kept';

  begin
    update files set thumbnail_frame_ms = -1 where id = v_file;
    assert false, 'a negative frame was accepted';
  exception when check_violation then
    null;
  end;

  raise notice 'PASS 99_files_thumbnail_frame_ms';
end $$;
rollback;
