\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- ============================================================
-- 1. feature_team_chat OFF: INSERT em equipe_conversas (service role
--    simulando RPC) e equipe_mensagens bloqueiam com feature_disabled.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'owner'
    where id = v_owner;

  v_blocked := false;
  begin
    insert into equipe_conversas (conta_id, tipo, nome, created_by)
      values (v_ws, 'grupo', 'Time', v_owner);
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_team_chat%',
      format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'insert de conversa deve bloquear com a flag off';
  raise notice 'PASS 1: gate feature_team_chat bloqueia conversa';
end $$;
rollback;

-- ============================================================
-- 2. Flag ON via override: cria conversa+participantes+mensagem (como
--    postgres, simulando as RPCs SECURITY DEFINER); nao-participante do
--    MESMO workspace nao le nada (conversa, participantes, mensagens);
--    participante le tudo.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();  -- participante
  v_b uuid := gen_random_uuid();  -- colega de fora da conversa
  v_conv bigint;
  v_rows int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_b);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a);
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'oi');

  -- v_b (mesmo workspace, fora da conversa): zero linhas nas tres tabelas.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform 1 from equipe_conversas where id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'nao-participante nao pode ler a conversa';
  perform 1 from equipe_conversa_participantes where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'nao-participante nao pode ler participantes';
  perform 1 from equipe_mensagens where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'nao-participante nao pode ler mensagens';

  -- v_a (participante): le as tres.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform 1 from equipe_conversas where id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'participante le a conversa';
  perform 1 from equipe_mensagens where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'participante le a mensagem';
  execute 'reset role';
  raise notice 'PASS 2: RLS por participante';
end $$;
rollback;

-- ============================================================
-- 3. Removido do workspace nao le mais, mesmo com a linha de participante
--    viva e active_workspace_id ainda apontando para o workspace.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_gone uuid := gen_random_uuid();
  v_conv bigint;
  v_rows int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_gone);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_gone, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_gone);

  insert into equipe_conversas (conta_id, tipo, dm_key, created_by)
    values (v_ws, 'dm', least(v_a::text, v_gone::text) || ':' || greatest(v_a::text, v_gone::text), v_a)
    returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a), (v_conv, v_ws, v_gone);
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'segredo');

  -- Remove do workspace; linha de participante fica (historico dos demais).
  delete from workspace_members where user_id = v_gone and workspace_id = v_ws;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gone, 'role', 'authenticated')::text, true);
  perform 1 from equipe_mensagens where conversa_id = v_conv;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'removido do workspace nao le mensagens da DM';
  execute 'reset role';
  raise notice 'PASS 3: remocao do workspace corta acesso';
end $$;
rollback;

-- ============================================================
-- 4. INSERT direto de mensagem: participante manda como ele mesmo; forjar
--    author de colega e bloqueado; content vazio e bloqueado; nao-
--    participante e bloqueado.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_conv bigint;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b), (v_fora);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin'), (v_fora, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
    where id in (v_a, v_b, v_fora);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a), (v_conv, v_ws, v_b);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- Envio legitimo passa.
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'oi time');

  -- Forjar autoria do colega: RLS bloqueia (42501).
  v_blocked := false;
  begin
    insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
      values (v_conv, v_ws, v_b, 'falso');
  exception when others then
    v_blocked := true;
  end;
  assert v_blocked, 'autoria forjada deve ser bloqueada';

  -- Content vazio via INSERT direto: bloqueado.
  v_blocked := false;
  begin
    insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
      values (v_conv, v_ws, v_a, '   ');
  exception when others then
    v_blocked := true;
  end;
  assert v_blocked, 'content vazio via INSERT direto deve ser bloqueado';

  -- Nao-participante: bloqueado.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fora, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
      values (v_conv, v_ws, v_fora, 'intruso');
  exception when others then
    v_blocked := true;
  end;
  assert v_blocked, 'nao-participante nao insere mensagem';
  execute 'reset role';
  raise notice 'PASS 4: WITH CHECK do INSERT direto';
end $$;
rollback;

-- ============================================================
-- 5. Notificacao coalescida: 1a mensagem cria team_message para os demais
--    participantes (nunca para o autor); 2a mensagem NAO duplica; apos
--    marcar lida, a 3a cria de novo.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_conv bigint;
  v_n int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_b);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a), (v_conv, v_ws, v_b);

  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'primeira');
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_b
     and metadata->>'conversa_id' = v_conv::text;
  assert v_n = 1, format('esperava 1 notificacao, achou %s', v_n);
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_a;
  assert v_n = 0, 'autor nunca recebe a propria notificacao';

  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'segunda');
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_b
     and metadata->>'conversa_id' = v_conv::text;
  assert v_n = 1, 'segunda mensagem nao duplica a nao lida';

  update notifications set read_at = now()
   where type = 'team_message' and user_id = v_b;
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'terceira');
  select count(*) into v_n from notifications
   where type = 'team_message' and user_id = v_b
     and metadata->>'conversa_id' = v_conv::text and read_at is null;
  assert v_n = 1, 'apos ler, nova mensagem notifica de novo';
  raise notice 'PASS 5: coalescing de team_message';
end $$;
rollback;

-- ============================================================
-- 6. dm_key unico por (conta, par): segunda DM identica viola o indice.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_key text;
  v_blocked boolean := false;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b);
  v_key := least(v_a::text, v_b::text) || ':' || greatest(v_a::text, v_b::text);
  insert into equipe_conversas (conta_id, tipo, dm_key, created_by)
    values (v_ws, 'dm', v_key, v_a);
  begin
    insert into equipe_conversas (conta_id, tipo, dm_key, created_by)
      values (v_ws, 'dm', v_key, v_b);
  exception when unique_violation then
    v_blocked := true;
  end;
  assert v_blocked, 'dm_key duplicada deve violar o indice unico';
  raise notice 'PASS 6: dm_key unica';
end $$;
rollback;

-- ============================================================
-- 7. Anexo staged (mensagem_id NULL) e privado ao autor: outro participante
--    da MESMA conversa nao le a linha staged de A; A sempre le a propria;
--    uma vez o anexo linkado a uma mensagem (enviado), B passa a ler.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();  -- autor do anexo
  v_b uuid := gen_random_uuid();  -- outro participante da mesma conversa
  v_conv bigint;
  v_anexo bigint;
  v_msg bigint;
  v_rows int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_b);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a), (v_conv, v_ws, v_b);

  -- Staged: simula o que equipe_chat_anexo_finalize gravaria (service role).
  insert into equipe_mensagem_anexos
    (conta_id, conversa_id, mensagem_id, r2_key, file_name, mime_type, size_bytes, created_by)
  values
    (v_ws, v_conv, null, 'equipe-chat/' || v_ws::text || '/staged.png',
     'staged.png', 'image/png', 1000, v_a)
  returning id into v_anexo;

  -- B (participante, NAO autor): zero linhas enquanto staged.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform 1 from equipe_mensagem_anexos where id = v_anexo;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, 'participante que nao e o autor nao le o anexo staged de outro';

  -- A (autor): sempre le a propria linha staged.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform 1 from equipe_mensagem_anexos where id = v_anexo;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'autor sempre le o proprio anexo staged';
  execute 'reset role';

  -- Envia: linka o anexo a uma mensagem (como send_equipe_mensagem faria).
  insert into equipe_mensagens (conversa_id, conta_id, author_user_id, content)
    values (v_conv, v_ws, v_a, 'com anexo') returning id into v_msg;
  update equipe_mensagem_anexos set mensagem_id = v_msg where id = v_anexo;

  -- B agora le: mensagem_id preenchido, nao staged mais.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform 1 from equipe_mensagem_anexos where id = v_anexo;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, 'apos enviado, qualquer participante le o anexo';
  execute 'reset role';

  raise notice 'PASS 7: anexo staged e privado ao autor ate o envio';
end $$;
rollback;
