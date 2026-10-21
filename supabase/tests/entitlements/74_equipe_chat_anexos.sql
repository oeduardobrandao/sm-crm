\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- ============================================================
-- 1. Finalize cobra quota: primeiro finalize de uma key cria a linha
--    staged e credita storage_used_bytes; segundo finalize da MESMA key
--    (retry idempotente, ex. resposta perdida) devolve o mesmo anexo_id
--    sem cobrar quota de novo.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws        uuid;
  v_owner     uuid := gen_random_uuid();
  v_conv      bigint;
  v_key       text;
  v_p         jsonb;
  v_anexo_id  bigint;
  v_anexo_id2 bigint;
  v_used      bigint;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_owner);

  v_key := 'equipe-chat/' || v_ws::text || '/foto.png';
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', v_key, 'file_name', 'foto.png', 'mime_type', 'image/png',
    'size_bytes', 1000
  );

  select anexo_id into v_anexo_id from equipe_chat_anexo_finalize(v_p);
  assert v_anexo_id is not null, 'finalize deveria devolver um anexo_id';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('esperava storage_used_bytes=1000, achou %s', v_used);

  -- Retry idempotente: mesma key, mesmo anexo_id, sem cobrar de novo.
  select anexo_id into v_anexo_id2 from equipe_chat_anexo_finalize(v_p);
  assert v_anexo_id2 = v_anexo_id,
    format('retry da mesma key deveria devolver o mesmo anexo_id: %s vs %s', v_anexo_id2, v_anexo_id);
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('retry nao deveria cobrar quota de novo, achou %s', v_used);

  raise notice 'PASS 1: finalize cobra quota (idempotente na mesma key)';
end $$;
rollback;

-- ============================================================
-- 2. Quota estoura: com storage_quota_bytes limitado a 1500 via
--    resource_overrides, o primeiro finalize de 1000 passa e o segundo
--    (key diferente) de 1000 levanta quota_exceeded; used fica em 1000 -
--    a excecao aborta o segundo finalize antes de qualquer INSERT/UPDATE.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws      uuid;
  v_owner   uuid := gen_random_uuid();
  v_conv    bigint;
  v_p1      jsonb;
  v_p2      jsonb;
  v_used    bigint;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides, resource_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb, '{"storage_quota_bytes": 1500}'::jsonb);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_owner);

  v_p1 := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/um.png',
    'file_name', 'um.png', 'mime_type', 'image/png', 'size_bytes', 1000
  );
  v_p2 := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/dois.png',
    'file_name', 'dois.png', 'mime_type', 'image/png', 'size_bytes', 1000
  );

  perform equipe_chat_anexo_finalize(v_p1);
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('primeiro finalize deveria cobrar 1000, achou %s', v_used);

  v_blocked := false;
  begin
    perform equipe_chat_anexo_finalize(v_p2);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'quota_exceeded', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'segundo finalize deveria estourar a quota';

  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('finalize que estourou quota nao deveria alterar used, achou %s', v_used);

  raise notice 'PASS 2: quota estoura';
end $$;
rollback;

-- ============================================================
-- 3. Key invalida / conversa de outro workspace / criador nao-participante:
--    as tres levantam a excecao esperada, sem gravar nada.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws       uuid;
  v_ws2      uuid;
  v_owner    uuid := gen_random_uuid();
  v_naopart  uuid := gen_random_uuid();
  v_owner2   uuid := gen_random_uuid();
  v_conv     bigint;
  v_conv2    bigint;
  v_p        jsonb;
  v_blocked  boolean;
begin
  v_ws := et_make_workspace('pro');
  v_ws2 := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb),
           (v_ws2, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_owner), (v_naopart), (v_owner2);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_naopart, v_ws, 'agent'), (v_owner2, v_ws2, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
    where id in (v_owner, v_naopart);
  update profiles set conta_id = v_ws2, active_workspace_id = v_ws2 where id = v_owner2;

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_owner);
  -- v_naopart e membro do workspace mas NUNCA participante desta conversa.

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws2, 'grupo', 'Outro Time', v_owner2) returning id into v_conv2;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv2, v_ws2, v_owner2);

  -- (a) prefixo de outro conta_id na r2_key: invalid_key.
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws2::text || '/foto.png',
    'file_name', 'foto.png', 'mime_type', 'image/png', 'size_bytes', 1000
  );
  v_blocked := false;
  begin
    perform equipe_chat_anexo_finalize(v_p);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_key', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'prefixo de outro conta_id deveria levantar invalid_key';

  -- (b) conversa de outro workspace: conversa_not_found.
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv2, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/foto.png',
    'file_name', 'foto.png', 'mime_type', 'image/png', 'size_bytes', 1000
  );
  v_blocked := false;
  begin
    perform equipe_chat_anexo_finalize(v_p);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'conversa_not_found', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'conversa de outro workspace deveria levantar conversa_not_found';

  -- (c) criador nao-participante da conversa: conversa_not_found.
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_naopart,
    'r2_key', 'equipe-chat/' || v_ws::text || '/foto.png',
    'file_name', 'foto.png', 'mime_type', 'image/png', 'size_bytes', 1000
  );
  v_blocked := false;
  begin
    perform equipe_chat_anexo_finalize(v_p);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'conversa_not_found', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'criador nao-participante deveria levantar conversa_not_found';

  raise notice 'PASS 3: key invalida / conversa de outro workspace / criador nao-participante';
end $$;
rollback;

-- ============================================================
-- 4. Release estorna: release de staged devolve a r2_key, apaga a linha e
--    storage_used_bytes volta a 0; release do mesmo id de novo devolve
--    NULL; anexo ja ligado a uma mensagem (send_equipe_mensagem) devolve
--    NULL e a linha fica (release nunca desfaz um envio ja concluido).
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws        uuid;
  v_owner     uuid := gen_random_uuid();
  v_conv      bigint;
  v_p         jsonb;
  v_anexo_id  bigint;
  v_anexo_id2 bigint;
  v_returned  text;
  v_used      bigint;
  v_n         int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_owner);

  -- Finaliza um anexo staged de 1000 bytes.
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/um.png',
    'file_name', 'um.png', 'mime_type', 'image/png', 'size_bytes', 1000
  );
  select anexo_id into v_anexo_id from equipe_chat_anexo_finalize(v_p);
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 1000, format('finalize deveria ter cobrado 1000, achou %s', v_used);

  -- Release: devolve a r2_key, apaga a linha, estorna a quota.
  select equipe_chat_anexo_release(v_anexo_id) into v_returned;
  assert v_returned = 'equipe-chat/' || v_ws::text || '/um.png',
    format('release deveria devolver a r2_key, devolveu %s', v_returned);
  select count(*) into v_n from equipe_mensagem_anexos where id = v_anexo_id;
  assert v_n = 0, 'release deveria ter apagado a linha staged';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('release deveria estornar a quota para 0, achou %s', v_used);

  -- Release do mesmo id de novo: linha ja sumiu, devolve NULL.
  select equipe_chat_anexo_release(v_anexo_id) into v_returned;
  assert v_returned is null, format('release repetido deveria devolver NULL, devolveu %s', v_returned);

  -- Finaliza outro anexo e liga a uma mensagem via send_equipe_mensagem.
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/dois.png',
    'file_name', 'dois.png', 'mime_type', 'image/png', 'size_bytes', 500
  );
  select anexo_id into v_anexo_id2 from equipe_chat_anexo_finalize(v_p);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.send_equipe_mensagem(v_conv, 'com anexo', array[v_anexo_id2]::bigint[]);
  reset role;

  -- Release de um anexo ja ligado a uma mensagem: devolve NULL, linha fica.
  select equipe_chat_anexo_release(v_anexo_id2) into v_returned;
  assert v_returned is null, format('release de anexo ja ligado deveria devolver NULL, devolveu %s', v_returned);
  select count(*) into v_n from equipe_mensagem_anexos where id = v_anexo_id2;
  assert v_n = 1, 'release de anexo ja ligado nao deveria apagar a linha';

  raise notice 'PASS 4: release estorna';
end $$;
rollback;

-- ============================================================
-- 5. Corrida send vs release: enviar primeiro trava o anexo (release
--    depois vira noop, linha preservada); liberar primeiro apaga o anexo
--    (send depois levanta anexo_not_found e nao grava mensagem).
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws           uuid;
  v_owner        uuid := gen_random_uuid();
  v_conv         bigint;
  v_p            jsonb;
  v_anexo_a      bigint;
  v_anexo_b      bigint;
  v_returned     text;
  v_n            int;
  v_blocked      boolean;
  v_count_before int;
  v_count_after  int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_owner);

  -- --- Direcao A: send ganha a corrida; release depois vira noop. ---
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/a.png',
    'file_name', 'a.png', 'mime_type', 'image/png', 'size_bytes', 300
  );
  select anexo_id into v_anexo_a from equipe_chat_anexo_finalize(v_p);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.send_equipe_mensagem(v_conv, 'primeiro', array[v_anexo_a]::bigint[]);
  reset role;

  select equipe_chat_anexo_release(v_anexo_a) into v_returned;
  assert v_returned is null,
    format('release apos o send ganhar a corrida deveria devolver NULL, devolveu %s', v_returned);
  select count(*) into v_n from equipe_mensagem_anexos where id = v_anexo_a;
  assert v_n = 1, 'linha do anexo ligado deveria ter sido preservada';

  -- --- Direcao B: release ganha a corrida; send depois falha. ---
  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/b.png',
    'file_name', 'b.png', 'mime_type', 'image/png', 'size_bytes', 300
  );
  select anexo_id into v_anexo_b from equipe_chat_anexo_finalize(v_p);

  select equipe_chat_anexo_release(v_anexo_b) into v_returned;
  assert v_returned is not null, 'release do anexo ainda staged deveria devolver a r2_key';

  select count(*) into v_count_before from equipe_mensagens where conversa_id = v_conv;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.send_equipe_mensagem(v_conv, 'segundo', array[v_anexo_b]::bigint[]);
  exception when others then
    assert sqlerrm = 'anexo_not_found', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'send apos o release ganhar a corrida deveria levantar anexo_not_found';
  select count(*) into v_count_after from equipe_mensagens where conversa_id = v_conv;
  assert v_count_after = v_count_before,
    format('send que falhou no anexo nao deveria gravar mensagem: antes=%s depois=%s', v_count_before, v_count_after);

  raise notice 'PASS 5: corrida send vs release';
end $$;
rollback;

-- ============================================================
-- 6. Backstop de feature: conversa/participante criados com a flag ON
--    (a trigger de INSERT em equipe_conversas exige isso), depois a flag e
--    desligada (downgrade de plano / override revogado) -- finalize levanta
--    feature_disabled:feature_team_chat mesmo com key/conversa/participante
--    todos validos. So a RPC pega isto: equipe_mensagem_anexos nao tem
--    enforce_plan_feature trigger (a INSERT direta e so via esta RPC
--    service_role), entao sem este backstop um workspace rebaixado depois
--    de ja ter conversas continuaria podendo gravar anexo novo.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws      uuid;
  v_owner   uuid := gen_random_uuid();
  v_conv    bigint;
  v_p       jsonb;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_owner);

  -- Downgrade: revoga o override (efetivo volta ao default do plano, false).
  update workspace_plan_overrides
     set feature_overrides = '{"feature_team_chat": false}'::jsonb
   where workspace_id = v_ws;

  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/foto.png',
    'file_name', 'foto.png', 'mime_type', 'image/png', 'size_bytes', 1000
  );
  v_blocked := false;
  begin
    perform equipe_chat_anexo_finalize(v_p);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'feature_disabled:feature_team_chat', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'workspace com feature_team_chat off deveria levantar feature_disabled:feature_team_chat';

  raise notice 'PASS 6: backstop de feature (flag desligada apos a conversa existir)';
end $$;
rollback;

-- ============================================================
-- 7. Teto de tamanho: v_size acima de 25MB (26214400 bytes) levanta
--    invalid_size, mesmo com key/conversa/participante e feature todos
--    validos. Cinto de seguranca da RPC -- a edge ja re-checa o mesmo teto
--    no finalize (o PUT pre-assinado nao restringe Content-Length).
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws      uuid;
  v_owner   uuid := gen_random_uuid();
  v_conv    bigint;
  v_p       jsonb;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_owner;

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_owner) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_owner);

  v_p := jsonb_build_object(
    'conta_id', v_ws, 'conversa_id', v_conv, 'created_by', v_owner,
    'r2_key', 'equipe-chat/' || v_ws::text || '/grande.png',
    'file_name', 'grande.png', 'mime_type', 'image/png',
    'size_bytes', 26214401 -- 25MB + 1 byte
  );
  v_blocked := false;
  begin
    perform equipe_chat_anexo_finalize(v_p);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_size', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'size_bytes acima de 25MB deveria levantar invalid_size';

  raise notice 'PASS 7: teto de tamanho (26MB+1 rejeitado)';
end $$;
rollback;
