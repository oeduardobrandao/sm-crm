\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid; v_cli bigint; v_user uuid := gen_random_uuid();
  v_i uuid; v_i2 uuid; v_i3 uuid; v_ag uuid; v_ag2 uuid;
  v_key text; v_key2 text; v_res jsonb; v_used bigint; v_blocked boolean; v_n int; v_row ideias;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  -- pro's real plan quota is 10GB (10737418240) as of this writing; overriding
  -- it to 10MB here decouples step 4's "over quota" probe from that seed
  -- value ever changing, while staying far above the low-hundreds/thousands
  -- byte amounts the rest of this suite reserves.
  v_ws := et_make_workspace('pro', jsonb_build_object('storage_quota_bytes', 10485760));
  v_ws2 := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'Cliente Ideia', 'CI', '#000000') returning id into v_cli;

  -- 0. defaults: hub-style insert reads as cliente + visible
  insert into ideias (workspace_id, cliente_id, titulo, descricao)
    values (v_ws, v_cli, 'Do cliente', 'desc') returning id into v_i;
  assert (select origem from ideias where id = v_i) = 'cliente', 'default origem';
  assert (select visivel_no_hub from ideias where id = v_i), 'default visivel';
  insert into ideias (workspace_id, cliente_id, titulo, descricao)
    values (v_ws, v_cli, 'Do cliente 2', 'desc') returning id into v_i2;

  -- 0b. cliente rows can never be hidden
  v_blocked := false;
  begin
    update ideias set visivel_no_hub = false where id = v_i;
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'cliente row must stay visible';

  -- 0c. agencia row hidden by default choice of the CRM (explicit false allowed)
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem, visivel_no_hub)
    values (v_ws, v_cli, 'Da agência', 'desc', 'agencia', false) returning id into v_ag;
  assert not (select visivel_no_hub from ideias where id = v_ag), 'agencia row may be hidden';

  -- 0d2. agencia insert omitting visivel_no_hub is HIDDEN (column default false)
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem)
    values (v_ws, v_cli, 'Da agência sem flag', 'desc', 'agencia') returning id into v_ag2;
  assert not (select visivel_no_hub from ideias where id = v_ag2), 'agencia default must be hidden';
  -- 0d3. cliente insert with an explicit false is forced visible by the guard
  insert into ideias (workspace_id, cliente_id, titulo, descricao, visivel_no_hub)
    values (v_ws, v_cli, 'Do cliente forçado', 'desc', false) returning id into v_i3;
  assert (select visivel_no_hub from ideias where id = v_i3), 'cliente insert must be visible';

  -- 0e. origem is immutable, even for service_role
  v_blocked := false;
  begin
    update ideias set origem = 'agencia' where id = v_i;
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'origem must be immutable';

  -- 0f. cliente_id must belong to the workspace (composite FK)
  v_blocked := false;
  begin
    insert into ideias (workspace_id, cliente_id, titulo, descricao) values (v_ws2, v_cli, 'x', 'y');
  exception when foreign_key_violation then v_blocked := true; end;
  assert v_blocked, 'cross-tenant cliente_id must be rejected';

  -- 0g. authenticated INSERT must be origem = agencia; cliente insert is service-role only
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_blocked := false;
  begin
    insert into ideias (workspace_id, cliente_id, titulo, descricao) values (v_ws, v_cli, 'x', 'y');
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'authenticated insert must set origem = agencia';
  insert into ideias (workspace_id, cliente_id, titulo, descricao, origem, visivel_no_hub)
    values (v_ws, v_cli, 'Da agência 2', 'desc', 'agencia', false);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 0d. notification trigger skips agencia rows, fires for cliente rows
  select count(*) into v_n from notifications where type = 'idea_submitted' and (metadata->>'idea_id')::uuid = v_ag;
  assert v_n = 0, 'no notification for agencia ideia';
  select count(*) into v_n from notifications where type = 'idea_submitted' and (metadata->>'idea_id')::uuid = v_i;
  assert v_n >= 0, 'cliente ideia path still runs (targets may be empty in this fixture)';

  v_key  := 'ideia-audio/' || v_ws || '/' || v_i || '/a.webm';
  v_key2 := 'ideia-audio/' || v_ws || '/' || v_i || '/b.webm';

  -- 1. finalize reserves bytes and writes columns
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key, 1000, 'audio/webm', 12);
  assert (v_res->>'reserved')::boolean, 'first finalize must reserve';
  assert v_res->>'previous_key' is null, 'no previous key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('used after finalize: %s', v_used);
  assert (select audio_transcription_status from ideias where id = v_i) = 'pending';

  -- 2. same-key retry is idempotent
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key, 1000, 'audio/webm', 12);
  assert not (v_res->>'reserved')::boolean, 'same key retry must not reserve';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, 'retry must not double count';

  -- 3. re-record replaces, decrements once, enqueues old key
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key2, 3000, 'audio/webm', 40);
  assert v_res->>'previous_key' = v_key, 'previous_key must be the replaced key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 3000, format('used after replace: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 1, 'old key enqueued once';

  -- 4. over quota blocks and leaves the row untouched
  update workspaces set storage_used_bytes = 1073741824 where id = v_ws;
  v_blocked := false;
  begin
    perform ideia_audio_finalize(v_ws, v_i2, 'cliente', 'ideia-audio/' || v_ws || '/' || v_i2 || '/c.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'quota_exceeded%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'over quota must block';
  assert (select audio_r2_key from ideias where id = v_i2) is null, 'blocked finalize must not write';
  update workspaces set storage_used_bytes = 3000 where id = v_ws;

  -- 5. key outside the ideia prefix -> invalid_key
  v_blocked := false;
  begin
    perform ideia_audio_finalize(v_ws, v_i2, 'cliente', 'ideia-audio/' || v_ws || '/' || v_i || '/x.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'invalid_key%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'key of another ideia must be rejected';

  -- 6. wrong origem -> ideia_not_found (the "only the originating side writes" rule)
  v_blocked := false;
  begin
    perform ideia_audio_finalize(v_ws, v_i, 'agencia', 'ideia-audio/' || v_ws || '/' || v_i || '/z.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'ideia_not_found%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'wrong origem must be rejected';

  -- 7. release clears, decrements, enqueues; wrong origem rejected
  assert ideia_audio_release(v_ws, v_i, 'cliente') = v_key2, 'release returns the old key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after release: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key2;
  assert v_n = 1, 'released key enqueued once';
  assert ideia_audio_release(v_ws, v_i, 'cliente') is null, 'second release is a no-op';
  v_blocked := false;
  begin
    perform ideia_audio_release(v_ws, v_i, 'agencia');
  exception when sqlstate 'P0001' then v_blocked := true; end;
  assert v_blocked, 'release with wrong origem must raise';

  -- 8. DELETE of an ideia with audio decrements and enqueues
  v_res := ideia_audio_finalize(v_ws, v_i, 'cliente', v_key, 500, 'audio/webm', 5);
  delete from ideias where id = v_i;
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after row delete: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 2, 'deleted row key enqueued (steps 3 and 8)';

  -- 9. tenant CHECK: key of another workspace never enters
  v_blocked := false;
  begin
    update ideias set audio_r2_key = 'ideia-audio/' || v_ws2 || '/' || v_i2 || '/z.webm' where id = v_i2;
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'cross-tenant key must violate CHECK';

  -- 10. guard: authenticated cannot write audio_*, can write status and visivel_no_hub
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_blocked := false;
  begin
    update ideias set audio_size_bytes = 1 where id = v_i2;
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'authenticated must not write audio_* columns';
  update ideias set status = 'em_analise' where id = v_i2;
  assert (select status from ideias where id = v_i2) = 'em_analise', 'status stays writable';
  update ideias set visivel_no_hub = true where id = v_ag;
  assert (select visivel_no_hub from ideias where id = v_ag), 'visivel_no_hub stays writable';

  -- 11. service role writes audio_*
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update ideias set audio_transcription_status = 'failed' where id = v_i2;
  assert (select audio_transcription_status from ideias where id = v_i2) = 'failed';
  update ideias set audio_transcription_status = null where id = v_i2;

  -- 12. apply_transcript writes transcript + done, never touches descricao
  v_key := 'ideia-audio/' || v_ws || '/' || v_ag || '/e.webm';
  perform ideia_audio_finalize(v_ws, v_ag, 'agencia', v_key, 100, 'audio/webm', null);
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, v_key, '  Primeira fala. ', 7);
  assert v_row.id is not null, 'apply on a pending row must return the row';
  assert (select audio_transcript from ideias where id = v_ag) = 'Primeira fala.';
  assert (select audio_transcription_status from ideias where id = v_ag) = 'done';
  assert (select audio_duration_seconds from ideias where id = v_ag) = 7, 'null duration filled from p_duration';
  assert (select descricao from ideias where id = v_ag) = 'desc', 'descricao untouched';

  -- 13. second apply on a done row -> NULL
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, v_key, 'Segunda.', 9);
  assert v_row.id is null, 'apply on a done row must return NULL';
  assert (select audio_transcript from ideias where id = v_ag) = 'Primeira fala.';

  -- 14. stale key -> NULL, row untouched
  update ideias set audio_r2_key = 'ideia-audio/' || v_ws || '/' || v_ag || '/f.webm',
                    audio_transcript = null, audio_transcription_status = 'pending'
   where id = v_ag;
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, v_key, 'Atrasada.', 4);
  assert v_row.id is null, 'stale-key apply must return NULL';
  assert (select audio_transcript from ideias where id = v_ag) is null, 'stale-key apply must not write';

  -- 15. empty text -> NULL
  v_row := ideia_audio_apply_transcript(v_ws, v_ag, 'ideia-audio/' || v_ws || '/' || v_ag || '/f.webm', '   ', 4);
  assert v_row.id is null, 'empty text must be a no-op';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS ideia_audio_rpcs';
end $$;
rollback;
