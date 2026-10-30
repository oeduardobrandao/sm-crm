\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- files.thumbnail_source + trg_files_thumbnail_frame_reset
-- (20261110000002): swapping the thumbnail clears the frame and marks it an image; a
-- follow-up update that only sets the frame and source keeps them.

begin;
do $$
declare
  v_ws uuid;
  v_file bigint;
  v_ms integer;
  v_src text;
begin
  v_ws := et_make_workspace('max');
  insert into files (conta_id, r2_key, thumbnail_r2_key, name, kind, mime_type, size_bytes, thumbnail_frame_ms, thumbnail_source)
  values (v_ws, 'contas/' || v_ws || '/files/v.mp4', 'contas/' || v_ws || '/files/v-a.jpg', 'v.mp4', 'video', 'video/mp4', 1000, 500, 'auto')
  returning id into v_file;
  select thumbnail_frame_ms, thumbnail_source into v_ms, v_src from files where id = v_file;
  assert v_ms = 500 and v_src = 'auto', 'insert did not keep the frame and source';

  -- Unrelated update: both stay.
  update files set name = 'renamed.mp4' where id = v_file;
  select thumbnail_frame_ms, thumbnail_source into v_ms, v_src from files where id = v_file;
  assert v_ms = 500 and v_src = 'auto', 'an update that does not touch the thumbnail changed the frame or source';

  -- Same thumbnail key written again: both stay.
  update files set thumbnail_r2_key = 'contas/' || v_ws || '/files/v-a.jpg' where id = v_file;
  select thumbnail_frame_ms, thumbnail_source into v_ms, v_src from files where id = v_file;
  assert v_ms = 500 and v_src = 'auto', 'rewriting the same thumbnail key changed the frame or source';

  -- New thumbnail from a writer that says nothing (uploaded image, Estúdio cover): image, no frame.
  update files set thumbnail_r2_key = 'contas/' || v_ws || '/files/v-b.jpg' where id = v_file;
  select thumbnail_frame_ms, thumbnail_source into v_ms, v_src from files where id = v_file;
  assert v_ms is null and v_src = 'image', 'swapping the thumbnail did not reset to an image without a frame';

  -- New thumbnail and a frame in one statement: still reset (writers set the frame after).
  update files set thumbnail_r2_key = 'contas/' || v_ws || '/files/v-c.jpg', thumbnail_frame_ms = 1200, thumbnail_source = 'frame' where id = v_file;
  select thumbnail_frame_ms, thumbnail_source into v_ms, v_src from files where id = v_file;
  assert v_ms is null and v_src = 'image', 'a combined update kept the frame';

  -- Follow-up update with the picked frame: kept.
  update files set thumbnail_frame_ms = 12300, thumbnail_source = 'frame' where id = v_file;
  select thumbnail_frame_ms, thumbnail_source into v_ms, v_src from files where id = v_file;
  assert v_ms = 12300 and v_src = 'frame', 'the follow-up frame update was not kept';

  begin
    update files set thumbnail_frame_ms = -1 where id = v_file;
    assert false, 'a negative frame was accepted';
  exception when check_violation then
    null;
  end;

  begin
    update files set thumbnail_source = 'video' where id = v_file;
    assert false, 'an unknown thumbnail_source was accepted';
  exception when check_violation then
    null;
  end;

  raise notice 'PASS 99_files_thumbnail_source';
end $$;
rollback;
