\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare v_ws uuid; v_blocked boolean := false;
begin
  v_ws := et_make_workspace('free'); -- plan storage_quota_bytes = 104857600 (100MB)
  -- set the (now-deprecated) column huge + used at the plan quota
  update workspaces set storage_quota_bytes = 999999999999, storage_used_bytes = 104857600 where id = v_ws;

  begin
    perform post_media_insert_with_quota(jsonb_build_object(
      'conta_id', v_ws::text, 'size_bytes', '1', 'post_id', '1',
      'r2_key', 'k', 'kind', 'image', 'mime_type', 'image/png',
      'original_filename', 'x.png', 'is_cover', 'false', 'uploaded_by', gen_random_uuid()::text));
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'quota_exceeded%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'post_media over PLAN quota must block (column ignored)';

  v_blocked := false;
  begin
    perform file_insert_with_quota(jsonb_build_object(
      'conta_id', v_ws::text, 'size_bytes', '1', 'r2_key', 'k', 'name', 'x',
      'kind', 'image', 'mime_type', 'image/png', 'uploaded_by', gen_random_uuid()::text));
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'file over PLAN quota must block (column ignored)';

  raise notice 'PASS 20_storage_rpcs';
end $$;
rollback;
