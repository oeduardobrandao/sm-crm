\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- ============================================================
-- 1. DM idempotente: create_equipe_conversa('dm', ...) chamado por qualquer
--    lado do par devolve o MESMO id; dm consigo mesmo e destinatario fora do
--    workspace sao rejeitados com a mensagem exata do RPC.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();  -- existe, mas nunca vira workspace_member
  v_id1 bigint;
  v_id2 bigint;
  v_id3 bigint;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_b), (v_fora);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_b, v_ws, 'admin');
  -- v_fora NUNCA vira workspace_member (de proposito) nem tem seu profile
  -- apontado para v_ws: o trigger trg_validate_active_workspace exige
  -- membership para aceitar active_workspace_id, entao so atualizamos os
  -- profiles de quem de fato pertence ao workspace.
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
    where id in (v_a, v_b);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select public.create_equipe_conversa('dm', null, array[v_b]) into v_id1;
  select public.create_equipe_conversa('dm', null, array[v_b]) into v_id2;
  assert v_id1 = v_id2, format('segunda chamada de v_a deveria devolver o mesmo id: %s vs %s', v_id1, v_id2);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select public.create_equipe_conversa('dm', null, array[v_a]) into v_id3;
  assert v_id3 = v_id1, format('chamada simetrica de v_b deveria devolver o mesmo id: %s vs %s', v_id3, v_id1);

  -- dm consigo mesmo: v_a chamando com o proprio id.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.create_equipe_conversa('dm', null, array[v_a]);
  exception when others then
    assert sqlerrm = 'dm consigo mesmo nao e permitida', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'dm consigo mesmo deveria levantar excecao';

  -- destinatario fora do workspace.
  v_blocked := false;
  begin
    perform public.create_equipe_conversa('dm', null, array[v_fora]);
  exception when others then
    assert sqlerrm = 'destinatario fora do workspace', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'destinatario fora do workspace deveria levantar excecao';

  reset role;
  raise notice 'PASS 1: dm idempotente + validacoes';
end $$;
rollback;

-- ============================================================
-- 2. Grupo e papel: agent nao cria grupo; admin cria com criador +
--    convidados como participantes; participante fora do workspace e
--    rejeitado.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_admin uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_id bigint;
  v_n int;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_admin), (v_agent), (v_b), (v_fora);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_admin, v_ws, 'admin'), (v_agent, v_ws, 'agent'), (v_b, v_ws, 'agent');
  -- v_fora fica de fora do workspace_members e do UPDATE de profiles (idem
  -- ao cenario 1: trg_validate_active_workspace exige membership).
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
    where id in (v_admin, v_agent, v_b);

  -- agent nao pode criar grupo.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.create_equipe_conversa('grupo', 'Time', array[v_b]);
  exception when others then
    assert sqlerrm = 'apenas owner/admin cria grupos', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'agent nao deveria poder criar grupo';

  -- admin cria: criador + convidados viram participantes.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select public.create_equipe_conversa('grupo', 'Time', array[v_agent, v_b]) into v_id;
  reset role;

  select count(*) into v_n from equipe_conversa_participantes where conversa_id = v_id;
  assert v_n = 3, format('esperava 3 participantes (criador + 2 convidados), achou %s', v_n);
  select count(*) into v_n from equipe_conversa_participantes
   where conversa_id = v_id and user_id = v_admin;
  assert v_n = 1, 'criador deveria estar entre os participantes';

  -- participante fora do workspace.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.create_equipe_conversa('grupo', 'Time2', array[v_fora]);
  exception when others then
    assert sqlerrm = 'participante fora do workspace', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'participante fora do workspace deveria levantar excecao';

  raise notice 'PASS 2: grupo e papel';
end $$;
rollback;

-- ============================================================
-- 3. manage_equipe_conversa: leave por qualquer participante; rename negado
--    a agent; admin faz rename/add/remove; add de fora do workspace e
--    negado; manage numa DM e negado (dm nao tem gestao).
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_admin uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_conv bigint;
  v_dm bigint;
  v_n int;
  v_nome text;
  v_blocked boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_admin), (v_agent), (v_c), (v_fora);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_admin, v_ws, 'admin'), (v_agent, v_ws, 'agent'), (v_c, v_ws, 'agent');
  -- v_fora fica de fora do workspace_members e do UPDATE de profiles (idem
  -- ao cenario 1: trg_validate_active_workspace exige membership).
  update profiles set conta_id = v_ws, active_workspace_id = v_ws
    where id in (v_admin, v_agent, v_c);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_admin) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_admin), (v_conv, v_ws, v_agent);

  -- Qualquer participante sai de si mesmo (leave).
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  perform public.manage_equipe_conversa(v_conv, 'leave');
  reset role;
  select count(*) into v_n from equipe_conversa_participantes
   where conversa_id = v_conv and user_id = v_agent;
  assert v_n = 0, 'agent deveria ter saido do grupo apos leave';

  -- Re-adiciona agent (fora de RLS, como postgres) para o proximo cenario.
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_agent);

  -- agent (participante, nao owner/admin) nao pode renomear.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.manage_equipe_conversa(v_conv, 'rename', 'Novo Nome');
  exception when others then
    assert sqlerrm = 'apenas owner/admin gerencia grupos', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'agent nao deveria poder renomear o grupo';

  -- admin: rename, add, remove com sucesso.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.manage_equipe_conversa(v_conv, 'rename', 'Time Renomeado');
  perform public.manage_equipe_conversa(v_conv, 'add', null, v_c);
  perform public.manage_equipe_conversa(v_conv, 'remove', null, v_agent);
  reset role;

  select nome into v_nome from equipe_conversas where id = v_conv;
  assert v_nome = 'Time Renomeado', format('rename nao aplicou, nome=%s', v_nome);
  select count(*) into v_n from equipe_conversa_participantes
   where conversa_id = v_conv and user_id = v_c;
  assert v_n = 1, 'add deveria ter incluido v_c entre os participantes';
  select count(*) into v_n from equipe_conversa_participantes
   where conversa_id = v_conv and user_id = v_agent;
  assert v_n = 0, 'remove deveria ter tirado v_agent dos participantes';

  -- add de uuid fora do workspace.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.manage_equipe_conversa(v_conv, 'add', null, v_fora);
  exception when others then
    assert sqlerrm = 'participante fora do workspace', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'add de fora do workspace deveria levantar excecao';

  -- manage numa DM: dm nao tem gestao (mesmo para admin/owner participante).
  -- INSERT direto como postgres (fora de RLS): so as RPCs criam conversas.
  insert into equipe_conversas (conta_id, tipo, dm_key, created_by)
    values (v_ws, 'dm',
            least(v_admin::text, v_c::text) || ':' || greatest(v_admin::text, v_c::text),
            v_admin)
    returning id into v_dm;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_dm, v_ws, v_admin), (v_dm, v_ws, v_c);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.manage_equipe_conversa(v_dm, 'rename', 'Nao Vale');
  exception when others then
    assert sqlerrm = 'dm nao tem gestao', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'manage numa dm deveria levantar excecao';

  raise notice 'PASS 3: manage_equipe_conversa';
end $$;
rollback;

-- ============================================================
-- 4. seen + unread: high-water mark nunca regride; mensagens do proprio
--    caller nunca contam como nao lidas.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_conv bigint;
  v_id1 bigint;
  v_id2 bigint;
  v_id3 bigint;
  v_unread bigint;
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

  -- v_a manda 3 mensagens.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select public.send_equipe_mensagem(v_conv, 'um') into v_id1;
  select public.send_equipe_mensagem(v_conv, 'dois') into v_id2;
  select public.send_equipe_mensagem(v_conv, 'tres') into v_id3;
  reset role;

  -- v_b: 3 nao lidas.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  select public.get_equipe_chat_unread() into v_unread;
  assert v_unread = 3, format('esperava 3 nao lidas, achou %s', v_unread);

  -- marca ate a 2a: sobra 1 nao lida.
  perform public.mark_equipe_conversa_seen(v_conv, v_id2);
  select public.get_equipe_chat_unread() into v_unread;
  assert v_unread = 1, format('esperava 1 nao lida apos marcar a 2a, achou %s', v_unread);

  -- mark com id menor (o da 1a) nao regride.
  perform public.mark_equipe_conversa_seen(v_conv, v_id1);
  select public.get_equipe_chat_unread() into v_unread;
  assert v_unread = 1, format('mark com id menor nao deveria regredir o marcador, achou %s', v_unread);

  -- mensagem do proprio v_b nunca conta como nao lida para ele mesmo.
  perform public.send_equipe_mensagem(v_conv, 'msg do proprio b');
  select public.get_equipe_chat_unread() into v_unread;
  assert v_unread = 1, format('mensagem do proprio autor nao deveria contar, achou %s', v_unread);

  reset role;
  raise notice 'PASS 4: seen + unread';
end $$;
rollback;

-- ============================================================
-- 5. get_equipe_mensagens: nao-participante e barrado; participante recebe
--    em ordem desc com author_name resolvido; cursor keyset nao repete.
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_conv bigint;
  v_id1 bigint;
  v_id2 bigint;
  v_id3 bigint;
  v_blocked boolean;
  v_count int;
  v_ids bigint[];
  v_authors text[];
  v_cursor_created timestamptz;
  v_cursor_id bigint;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_fora);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_fora, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_fora);
  insert into membros (conta_id, user_id, crm_user_id, nome)
    values (v_ws, v_a, v_a, 'Ana');

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  select public.send_equipe_mensagem(v_conv, 'primeira') into v_id1;
  select public.send_equipe_mensagem(v_conv, 'segunda') into v_id2;
  select public.send_equipe_mensagem(v_conv, 'terceira') into v_id3;
  reset role;

  -- nao-participante: Forbidden.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fora, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.get_equipe_mensagens(v_conv);
  exception when others then
    assert sqlerrm = 'Forbidden', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'nao-participante deveria levar Forbidden';

  -- participante: as 3 mensagens, ordem desc, author_name resolvido.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  select count(*) into v_count from public.get_equipe_mensagens(v_conv);
  assert v_count = 3, format('esperava 3 mensagens, achou %s', v_count);

  select array_agg(t.id), array_agg(t.author_name)
    into v_ids, v_authors
    from (
      select id, author_name
        from public.get_equipe_mensagens(v_conv)
       order by created_at desc, id desc
    ) t;
  assert v_ids = array[v_id3, v_id2, v_id1],
    format('ordem desc incorreta: %s (esperava [%s,%s,%s])', v_ids, v_id3, v_id2, v_id1);
  assert v_authors[1] = 'Ana' and v_authors[2] = 'Ana' and v_authors[3] = 'Ana',
    format('author_name nao resolvido: %s', v_authors);

  -- Cursor: pagina de 2 (id3, id2). Usa a mais antiga da pagina (id2) como
  -- cursor e espera SO id1 de volta, sem repetir id2.
  select t.created_at, t.id into v_cursor_created, v_cursor_id
    from (
      select created_at, id
        from public.get_equipe_mensagens(v_conv, null, null, 2)
       order by created_at desc, id desc
       limit 1 offset 1
    ) t;
  assert v_cursor_id = v_id2, format('cursor deveria ser id2, achou %s', v_cursor_id);

  select array_agg(x.id) into v_ids
    from (
      select id
        from public.get_equipe_mensagens(v_conv, v_cursor_created, v_cursor_id, 2)
       order by created_at desc, id desc
    ) x;
  assert v_ids = array[v_id1],
    format('pagina anterior deveria devolver so [%s], achou %s', v_id1, v_ids);

  reset role;
  raise notice 'PASS 5: get_equipe_mensagens';
end $$;
rollback;

-- ============================================================
-- 6. send_equipe_mensagem: envio legitimo devolve id; content vazio sem
--    anexo e negado; nao-participante e barrado; anexo inexistente aborta
--    tudo (nenhuma mensagem gravada).
-- ============================================================
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_a uuid := gen_random_uuid();
  v_fora uuid := gen_random_uuid();
  v_conv bigint;
  v_id bigint;
  v_blocked boolean;
  v_count_before int;
  v_count_after int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_team_chat": true}'::jsonb);
  insert into auth.users (id) values (v_a), (v_fora);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_a, v_ws, 'owner'), (v_fora, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id in (v_a, v_fora);

  insert into equipe_conversas (conta_id, tipo, nome, created_by)
    values (v_ws, 'grupo', 'Time', v_a) returning id into v_conv;
  insert into equipe_conversa_participantes (conversa_id, conta_id, user_id)
    values (v_conv, v_ws, v_a);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- Envio legitimo devolve um id.
  select public.send_equipe_mensagem(v_conv, 'oi time') into v_id;
  assert v_id is not null, 'envio legitimo deveria devolver um id';

  -- content vazio sem anexo: negado.
  v_blocked := false;
  begin
    perform public.send_equipe_mensagem(v_conv, '');
  exception when others then
    assert sqlerrm = 'texto ou anexo obrigatorio', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  assert v_blocked, 'content vazio sem anexo deveria levantar excecao';

  -- anexo inexistente: aborta tudo (rollback da mensagem tambem).
  select count(*) into v_count_before from equipe_mensagens where conversa_id = v_conv;
  v_blocked := false;
  begin
    perform public.send_equipe_mensagem(v_conv, 'com anexo fantasma', array[999999]::bigint[]);
  exception when others then
    assert sqlerrm = 'anexo_not_found', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  select count(*) into v_count_after from equipe_mensagens where conversa_id = v_conv;
  assert v_blocked, 'anexo inexistente deveria levantar excecao';
  assert v_count_after = v_count_before,
    format('anexo invalido nao deveria deixar mensagem gravada: antes=%s depois=%s', v_count_before, v_count_after);
  reset role;

  -- nao-participante: Forbidden.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_fora, 'role', 'authenticated')::text, true);
  v_blocked := false;
  begin
    perform public.send_equipe_mensagem(v_conv, 'intruso');
  exception when others then
    assert sqlerrm = 'Forbidden', format('wrong msg: %s', sqlerrm);
    v_blocked := true;
  end;
  reset role;
  assert v_blocked, 'nao-participante nao pode enviar mensagem';

  raise notice 'PASS 6: send_equipe_mensagem';
end $$;
rollback;
