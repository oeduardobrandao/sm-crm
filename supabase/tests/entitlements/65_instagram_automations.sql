\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Instagram comment-to-DM automations (migrations 20260815000002/3).
-- feature_instagram_automation ships dark: DEFAULT false on every plan, so
-- "flag on" in this suite always means an explicit workspace_plan_overrides
-- row, never a plan pick.
--
-- 1-3. instagram_comment_automations: flag-off blocks INSERT; flag-on lets
--      owner/admin write while agent only reads (intentional deviation from
--      post_status_automations, documented in the migration); downgrade
--      (flag back off) keeps the existing row editable/deletable but blocks
--      new INSERTs (block-new/keep-existing, same policy as 06).
-- 4. Structural tenant-safety: the composite FKs ica_client_same_tenant and
--    ias_automation_same_tenant reject cross-workspace pointers even for a
--    caller that bypasses RLS entirely (table owner, standing in for the
--    service-role worker — FK enforcement does not depend on role).
-- 5. instagram_automation_sends: SELECT isolation between workspaces, and
--    confirmation that authenticated cannot write sends directly (service
--    role only, per the migration's RLS policies).
-- 6. claim_automation_send: the no-double-DM linchpin (advisory lock over
--    (automation, commenter) + cooldown revalidation + comment_id UNIQUE).
--    Single-session scenario: claimed (first comment) -> cooldown (second,
--    different comment, same commenter -- the in-flight 'processing' row
--    reserves it) -> duplicate (re-claiming the first comment again).

-- 1-3. Feature gate (off -> on -> downgrade) + RLS (owner/admin write, agent
--      read-only)
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_seen bigint;
  v_rows bigint;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('pro'); -- feature_instagram_automation defaults false (ship dark)

  insert into auth.users (id) values (v_owner), (v_agent);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_owner, v_ws, 'owner'), (v_agent, v_ws, 'agent');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'owner'
    where id = v_owner;
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'agent'
    where id = v_agent;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- 1. Flag OFF: owner INSERT fails feature_disabled:feature_instagram_automation
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws, v_cli, 'Promo', array['preco'], 'Chama no DM que te mando o link!');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_instagram_automation%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'owner insert must be blocked while the feature is off';
  reset role;

  -- 2. Flag ON via workspace_plan_overrides.feature_overrides
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'Promo', array['preco'], 'Chama no DM que te mando o link!')
    returning id into v_auto;

  -- agent SELECT sees the automation (intentional read access, spec deviation)
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  select count(*) into v_seen from instagram_comment_automations where conta_id = v_ws;
  assert v_seen = 1, format('agent should read the automation, saw %s', v_seen);

  -- agent INSERT rejected by RLS WITH CHECK
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws, v_cli, 'Hack', array['x'], 'y');
  exception when sqlstate '42501' then
    v_rejected := true;
  end;
  assert v_rejected, 'agent INSERT must be rejected by RLS';

  -- agent UPDATE silently filtered by RLS USING (0 rows)
  update instagram_comment_automations set ativo = false where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('agent UPDATE must affect 0 rows, affected %s', v_rows);

  -- agent DELETE silently filtered by RLS USING (0 rows)
  delete from instagram_comment_automations where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 0, format('agent DELETE must affect 0 rows, affected %s', v_rows);

  reset role;

  -- 3. Downgrade: flag back off. Existing row stays editable/deletable by
  --    owner/admin; a NEW insert is blocked again (block-new/keep-existing).
  delete from workspace_plan_overrides where workspace_id = v_ws;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  update instagram_comment_automations set ativo = false where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('owner UPDATE of the existing automation must survive downgrade, affected %s', v_rows);

  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws, v_cli, 'New', array['x'], 'y');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'feature_disabled:feature_instagram_automation%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'a NEW insert after downgrade must be blocked again';

  delete from instagram_comment_automations where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('owner DELETE of the existing automation must survive downgrade, affected %s', v_rows);

  reset role;
  raise notice 'PASS 65 feature gate + RLS + downgrade';
end $$;
rollback;

-- 4. Structural tenant-safety: composite FKs reject cross-workspace pointers
--    even for a caller that bypasses RLS (table owner here, standing in for
--    the service-role worker that owns writes on both tables).
begin;
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_uid uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_auto_a uuid;
  v_rejected boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws_a, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  -- client_id pointing at another workspace's cliente must be rejected
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message)
      values (v_ws_a, v_cli_b, 'Cross', array['x'], 'y');
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'cross-tenant client_id must be rejected by ica_client_same_tenant';

  -- a real, same-tenant automation to use as the FK target below
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws_a, v_cli_a, 'Real', array['x'], 'y')
    returning id into v_auto_a;

  -- automation_id from ws A paired with conta_id from ws B must be rejected
  v_rejected := false;
  begin
    insert into instagram_automation_sends
      (comment_id, automation_id, conta_id, comment_created_at)
      values ('cross-comment-1', v_auto_a, v_ws_b, now());
  exception when foreign_key_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'cross-tenant (automation_id, conta_id) must be rejected by ias_automation_same_tenant';

  raise notice 'PASS 65 tenant-safety composite FKs';
end $$;
rollback;

-- 5. instagram_automation_sends: SELECT isolation between workspaces, and
--    writes are service-role only (no INSERT policy for authenticated).
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_uid uuid := gen_random_uuid();
  v_member_a uuid := gen_random_uuid();
  v_cli_a bigint; v_cli_b bigint;
  v_auto_a uuid; v_auto_b uuid;
  v_n bigint;
  v_rejected boolean;
begin
  v_ws_a := et_make_workspace('pro');
  v_ws_b := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides) values
    (v_ws_a, '{"feature_instagram_automation": true}'::jsonb),
    (v_ws_b, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid), (v_member_a);
  insert into workspace_members (user_id, workspace_id, role) values (v_member_a, v_ws_a, 'agent');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a, role = 'agent'
    where id = v_member_a;

  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws_a, v_cli_a, 'A1', array['x'], 'y') returning id into v_auto_a;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws_b, v_cli_b, 'B1', array['x'], 'y') returning id into v_auto_b;

  insert into instagram_automation_sends
    (comment_id, automation_id, conta_id, comment_created_at)
    values ('send-a1', v_auto_a, v_ws_a, now());
  insert into instagram_automation_sends
    (comment_id, automation_id, conta_id, comment_created_at)
    values ('send-b1', v_auto_b, v_ws_b, now());

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_member_a, 'role', 'authenticated')::text, true);

  select count(*) into v_n from instagram_automation_sends;
  assert v_n = 1, format('member of workspace A must see exactly its own send, saw %s', v_n);

  select count(*) into v_n from instagram_automation_sends where conta_id = v_ws_b;
  assert v_n = 0, 'member of workspace A must not see workspace B sends even when filtering explicitly';

  -- writes are service-role only: no INSERT policy exists for authenticated
  v_rejected := false;
  begin
    insert into instagram_automation_sends
      (comment_id, automation_id, conta_id, comment_created_at)
      values ('send-a2', v_auto_a, v_ws_a, now());
  exception when insufficient_privilege then
    v_rejected := true;
  end;
  assert v_rejected, 'authenticated must not be able to write sends directly';

  reset role;
  raise notice 'PASS 65 sends RLS isolation';
end $$;
rollback;

-- 6. claim_automation_send: no-double-DM linchpin. Runs as the table owner
--    (same stand-in for the service-role worker as section 4 -- the function
--    is REVOKE ALL FROM PUBLIC / GRANT ... TO service_role, and ownership
--    bypasses that grant check same as it bypasses RLS).
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_send1 uuid;
  v_send2 uuid;
  v_send3 uuid;
  v_outcome1 text;
  v_outcome2 text;
  v_outcome3 text;
  v_n int;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'Promo', array['preco'], 'Chama no DM que te mando o link!')
    returning id into v_auto;

  -- (a) first call, comment C1 / commenter U -> claimed, non-null send_id.
  select send_id, outcome into v_send1, v_outcome1
    from claim_automation_send('C1', v_auto, v_ws, 'media-1', 'commenter-U', 'user_u', 'oi', now());
  assert v_outcome1 = 'claimed', format('first claim on C1 must be claimed, got %s', v_outcome1);
  assert v_send1 is not null, 'claimed outcome must return a non-null send_id';

  -- (b) second call, SAME automation+commenter, a DIFFERENT comment C2 ->
  --     cooldown: the row from (a) is still 'processing' (in-flight), which
  --     reserves the cooldown even though no DM has actually sent yet.
  select send_id, outcome into v_send2, v_outcome2
    from claim_automation_send('C2', v_auto, v_ws, 'media-1', 'commenter-U', 'user_u', 'de novo', now());
  assert v_outcome2 = 'cooldown', format('second comment from same commenter must be cooldown, got %s', v_outcome2);
  assert v_send2 is null, 'cooldown outcome must return a null send_id';

  select count(*) into v_n from instagram_automation_sends
    where comment_id = 'C2' and status = 'skipped' and skip_reason = 'cooldown';
  assert v_n = 1, format('C2 must have a skipped/cooldown row recorded, saw %s', v_n);

  -- (c) call again for C1 (same comment_id) -> duplicate, via the UNIQUE
  --     constraint's ON CONFLICT DO NOTHING (no second insert, no second DM).
  select send_id, outcome into v_send3, v_outcome3
    from claim_automation_send('C1', v_auto, v_ws, 'media-1', 'commenter-U', 'user_u', 'oi', now());
  assert v_outcome3 = 'duplicate', format('re-claiming C1 must be duplicate, got %s', v_outcome3);
  assert v_send3 is null, 'duplicate outcome must return a null send_id';

  select count(*) into v_n from instagram_automation_sends where comment_id = 'C1';
  assert v_n = 1, format('C1 must still have exactly 1 row (no duplicate insert), saw %s', v_n);

  raise notice 'PASS 65 claim_automation_send no-double-DM (claimed/cooldown/duplicate)';
end $$;
rollback;

-- 7. dm_buttons (migration 20260819000001): CHECK de forma via
--    validate_ig_dm_buttons + limite de 640 chars em dm_message quando há
--    botão. O insert VÁLIDO roda como authenticated de propósito: prova que
--    a função de CHECK é executável pelo role da API (ela NÃO leva o
--    REVOKE/GRANT do padrão de RPC da casa; revogar quebraria todo
--    INSERT/UPDATE com 42501).
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_buttons jsonb;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'owner'
    where id = v_owner;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- (a) Válido: 3 botões + dm_message de exatamente 640 chars, como authenticated.
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, dm_buttons)
    values (v_ws, v_cli, 'Botões', array['promo'], repeat('a', 640),
      '[{"title":"Agendar","url":"https://agenda.x"},
        {"title":"WhatsApp","url":"https://wa.me/55"},
        {"title":"Site","url":"https://site.x"}]'::jsonb)
    returning id, dm_buttons into v_auto, v_buttons;
  assert jsonb_array_length(v_buttons) = 3, 'insert válido com 3 botões deve passar';

  -- (b) 4 botões -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Quatro', array['x'], 'msg',
        '[{"title":"1","url":"https://a.b"},{"title":"2","url":"https://a.b"},
          {"title":"3","url":"https://a.b"},{"title":"4","url":"https://a.b"}]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, '4 botões devem ser rejeitados';

  -- (c) URL sem http(s) -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Ftp', array['x'], 'msg',
        '[{"title":"Ftp","url":"ftp://a.b"}]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'URL sem http(s) deve ser rejeitada';

  -- (d) título com 21 chars -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Longo', array['x'], 'msg',
        jsonb_build_array(jsonb_build_object('title', repeat('t', 21), 'url', 'https://a.b')));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'título de 21 chars deve ser rejeitado';

  -- (e) chave extra no objeto -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Extra', array['x'], 'msg',
        '[{"title":"Ok","url":"https://a.b","payload":"x"}]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'chave extra no objeto do botão deve ser rejeitada';

  -- (f) objeto vazio -> check_violation (regressão do coalesce por item:
  --     bool_and ignora NULLs; sem o coalesce(false) um {} passaria)
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Vazio', array['x'], 'msg', '[{}]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'objeto vazio deve ser rejeitado';

  -- (g) dm_message 641 chars COM botão -> check_violation (limite do template)
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Grande', array['x'], repeat('a', 641),
        '[{"title":"Ok","url":"https://a.b"}]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'dm_message de 641 chars com botão deve ser rejeitada';

  -- (h) dm_message 641 chars SEM botão segue válida (CHECK original 1..1000)
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'Texto', array['y'], repeat('a', 641));

  reset role;
  raise notice 'PASS 65 dm_buttons CHECKs (forma, 640, EXECUTE como authenticated)';
end $$;
rollback;

-- 8. mark_automation_dm_sent(p_send_id, p_dm_kind): grava dm_kind SÓ na
--    transição dm_status -> 'sent' (idempotência preservada); kind inválido
--    cai no CHECK da coluna. Roda como table owner (stand-in do service role,
--    como as seções 4 e 6).
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_send uuid;
  v_marked boolean;
  v_kind text;
  v_count int;
  v_rejected boolean;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);
  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, dm_buttons)
    values (v_ws, v_cli, 'Promo', array['preco'], 'msg',
      '[{"title":"Link","url":"https://a.b"}]'::jsonb)
    returning id into v_auto;
  select send_id into v_send
    from claim_automation_send('C1', v_auto, v_ws, 'media-1', 'commenter-U', 'user_u', 'oi', now());

  -- (a) transição: grava dm_kind e incrementa o contador
  select mark_automation_dm_sent(v_send, 'buttons') into v_marked;
  assert v_marked, 'primeira chamada deve reportar a transição';
  select dm_kind into v_kind from instagram_automation_sends where id = v_send;
  assert v_kind = 'buttons', format('dm_kind deve ser buttons, veio %s', v_kind);
  select dms_sent_count into v_count from instagram_comment_automations where id = v_auto;
  assert v_count = 1, format('contador deve ser 1, veio %s', v_count);

  -- (b) rechamada com outro kind: idempotente, NÃO regrava dm_kind nem conta
  select mark_automation_dm_sent(v_send, 'text') into v_marked;
  assert not v_marked, 'rechamada não deve reportar transição';
  select dm_kind into v_kind from instagram_automation_sends where id = v_send;
  assert v_kind = 'buttons', 'dm_kind não pode mudar fora da transição';
  select dms_sent_count into v_count from instagram_comment_automations where id = v_auto;
  assert v_count = 1, 'contador não pode incrementar fora da transição';

  -- (c) kind inválido em outra linha -> check_violation da coluna
  update instagram_automation_sends set dm_status = null where id = v_send;
  v_rejected := false;
  begin
    perform mark_automation_dm_sent(v_send, 'carrier_pigeon');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'dm_kind inválido deve cair no CHECK';

  raise notice 'PASS 65 mark_automation_dm_sent dm_kind (transição única + CHECK)';
end $$;
rollback;
