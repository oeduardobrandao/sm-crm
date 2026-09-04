\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql
begin;
do $$
declare
  v_ws uuid; v_ws2 uuid; v_cli bigint; v_q uuid; v_q2 uuid; v_user uuid := gen_random_uuid();
  v_key text; v_key2 text; v_res jsonb; v_used bigint; v_blocked boolean;
  v_n int;
begin
  -- free = storage_quota_bytes 104857600 (100MB)
  -- As RPCs rodam sob service_role em produção (edge functions). A guarda lê
  -- auth.role() do GUC request.jwt.claims, então o teste precisa simular isso.
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  v_ws := et_make_workspace('free');
  v_ws2 := et_make_workspace('free');
  insert into auth.users (id) values (v_user);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'Cliente Audio', 'CA', '#000000') returning id into v_cli;
  insert into hub_briefing_questions (cliente_id, conta_id, question, display_order)
    values (v_cli, v_ws, 'Qual a história da marca?', 0) returning id into v_q;
  insert into hub_briefing_questions (cliente_id, conta_id, question, display_order)
    values (v_cli, v_ws, 'Público?', 1) returning id into v_q2;
  v_key  := 'briefing-audio/' || v_ws || '/' || v_q || '/a.webm';
  v_key2 := 'briefing-audio/' || v_ws || '/' || v_q || '/b.webm';

  -- 1. finalize reserva bytes e grava colunas
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key, 1000, 'audio/webm', 12);
  assert (v_res->>'reserved')::boolean, 'first finalize must reserve';
  assert v_res->>'previous_key' is null, 'no previous key on first finalize';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('used after finalize: %s', v_used);
  assert (select audio_transcription_status from hub_briefing_questions where id = v_q) = 'pending';

  -- 2. retry com a MESMA chave é idempotente (não soma)
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key, 1000, 'audio/webm', 12);
  assert not (v_res->>'reserved')::boolean, 'same key retry must not reserve';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, 'retry must not double count';

  -- 3. regravar (chave nova) troca, decrementa a antiga UMA vez e enfileira a antiga
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key2, 3000, 'audio/webm', 40);
  assert v_res->>'previous_key' = v_key, 'previous_key must be the replaced key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 3000, format('used after replace: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 1, 'old key must be enqueued once';
  assert (select audio_transcript from hub_briefing_questions where id = v_q) is null, 'replace resets transcript';

  -- 4. over quota bloqueia e não altera a linha
  update workspaces set storage_used_bytes = 104857600 where id = v_ws;
  v_blocked := false;
  begin
    perform briefing_audio_finalize(v_ws, v_cli, v_q2, 'briefing-audio/' || v_ws || '/' || v_q2 || '/c.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'quota_exceeded%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'over quota must block';
  assert (select audio_r2_key from hub_briefing_questions where id = v_q2) is null, 'blocked finalize must not write';
  update workspaces set storage_used_bytes = 3000 where id = v_ws;

  -- 4b. regravar perto da quota desconta o áudio substituído: used = quota,
  -- sendo 3000 bytes desta própria pergunta; trocar por 2000 tem que passar.
  update workspaces set storage_used_bytes = 104857600 where id = v_ws;
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, 'briefing-audio/' || v_ws || '/' || v_q || '/d.webm', 2000, 'audio/webm', 20);
  assert (v_res->>'reserved')::boolean, 'replace near quota must net out the old bytes';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 104857600 - 3000 + 2000, format('used after near-quota replace: %s', v_used);
  update workspaces set storage_used_bytes = 2000 where id = v_ws;
  v_key2 := 'briefing-audio/' || v_ws || '/' || v_q || '/d.webm';

  -- 5. chave fora do prefixo da pergunta -> invalid_key
  v_blocked := false;
  begin
    perform briefing_audio_finalize(v_ws, v_cli, v_q2, 'briefing-audio/' || v_ws || '/' || v_q || '/x.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'invalid_key%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'key of another question must be rejected';

  -- 6. pergunta de outro cliente -> question_not_found
  v_blocked := false;
  begin
    perform briefing_audio_finalize(v_ws, v_cli + 1, v_q2, 'briefing-audio/' || v_ws || '/' || v_q2 || '/c.webm', 1, 'audio/webm', 1);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'question_not_found%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'wrong cliente must be rejected';

  -- 7. release zera colunas, decrementa e enfileira
  assert briefing_audio_release(v_ws, v_cli, v_q) = v_key2, 'release returns the old key';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after release: %s', v_used);
  assert (select audio_r2_key from hub_briefing_questions where id = v_q) is null;
  select count(*) into v_n from post_media_deletions where r2_key = v_key2;
  assert v_n = 1, 'released key must be enqueued once';
  assert briefing_audio_release(v_ws, v_cli, v_q) is null, 'second release is a no-op';

  -- 7b. release com cliente errado -> question_not_found (mesmo escopo do finalize)
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key, 500, 'audio/webm', 5);
  v_blocked := false;
  begin
    perform briefing_audio_release(v_ws, v_cli + 1, v_q);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'question_not_found%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'release for another cliente must be rejected';
  assert (select audio_r2_key from hub_briefing_questions where id = v_q) = v_key, 'rejected release must not touch the row';
  assert briefing_audio_release(v_ws, v_cli, v_q) = v_key, 'cleanup for step 8';

  -- 8. DELETE da pergunta com áudio decrementa e enfileira
  v_res := briefing_audio_finalize(v_ws, v_cli, v_q, v_key, 500, 'audio/webm', 5);
  delete from hub_briefing_questions where id = v_q;
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('used after row delete: %s', v_used);
  select count(*) into v_n from post_media_deletions where r2_key = v_key;
  assert v_n = 3, 'deleted row key enqueued (third time for this key in this test: steps 3, 7b, 8)';

  -- 9. CHECK de tenant: chave de outra workspace não entra nem via service role
  -- (ainda sob claims service_role, então a guarda deixa passar e o CHECK dispara)
  v_blocked := false;
  begin
    update hub_briefing_questions set audio_r2_key = 'briefing-audio/' || v_ws2 || '/' || v_q2 || '/z.webm'
      where id = v_q2;
  exception when check_violation then v_blocked := true; end;
  assert v_blocked, 'cross-tenant key must violate CHECK';

  -- 10. guarda: chamador que não é service_role não escreve audio_*, mas escreve answer.
  -- auth.role() lê o GUC request.jwt.claims; ficamos como postgres (bypass de RLS)
  -- para que o UPDATE atinja a linha e o trigger dispare.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  v_blocked := false;
  begin
    update hub_briefing_questions set audio_size_bytes = 1 where id = v_q2;
  exception when insufficient_privilege then v_blocked := true; end;
  assert v_blocked, 'authenticated must not write audio_* columns';
  update hub_briefing_questions set answer = 'texto livre' where id = v_q2;
  assert (select answer from hub_briefing_questions where id = v_q2) = 'texto livre', 'answer stays writable';

  -- 11. service role escreve audio_* (caminho das edge functions)
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update hub_briefing_questions set audio_transcription_status = 'failed' where id = v_q2;
  assert (select audio_transcription_status from hub_briefing_questions where id = v_q2) = 'failed';

  -- 12. release em workspace inexistente -> workspace_not_found
  v_blocked := false;
  begin
    perform briefing_audio_release(gen_random_uuid(), v_cli, v_q2);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'workspace_not_found%', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'release on unknown workspace must raise';
  perform set_config('request.jwt.claims', '', true);

  raise notice 'PASS briefing_audio_rpcs';
end $$;
rollback;
