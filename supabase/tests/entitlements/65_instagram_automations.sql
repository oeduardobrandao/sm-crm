\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Instagram comment-to-DM automations (migrations 20260815000002/3).
-- feature_instagram_automation ships dark: DEFAULT false on every plan, so
-- "flag on" in this suite always means an explicit workspace_plan_overrides
-- row, never a plan pick.
--
-- 1-3. instagram_comment_automations: flag-off blocks INSERT; flag-on lets
--      any workspace member (owner/admin/agent) write, same conta_id-only
--      RLS shape as workflow_posts_all (20260402) -- migration 20260829000001
--      dropped the owner/admin-only INSERT/UPDATE/DELETE restriction from
--      20260815000002; downgrade (flag back off) keeps the existing row
--      editable/deletable but blocks new INSERTs (block-new/keep-existing,
--      same policy as 06).
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
-- 9. public_replies (migration 20260901101000): CHECK via validate_ig_public_
--    replies (same CASE type-guard rationale as validate_ig_dm_buttons), the
--    backfill expression from the legacy public_reply column, and
--    claim_retryable_automation_sends returning the new public_reply_text
--    column.
-- 10-10b. dm_media/dm_subtitle (migration 20260901000002): CHECK de forma
--    (validate_ig_dm_media), bind de tenant via conta_id na key, subtítulo
--    só com mídia, dm_message <= 80 com mídia, o trigger
--    trg_ica_dm_media_finalized (dm_media só aceita objeto finalizado da
--    própria workspace, com content_type/size_bytes normalizados do
--    registro; key não finalizada -> media_not_finalized) e o índice único
--    parcial ica_dm_media_key_unique (posse única da key) (10).
--    automation_media_finalize/automation_media_release: idempotência por
--    key, incremento/decremento de storage_used_bytes, quota_exceeded sem
--    deixar linha órfã, piso 0 no release, e o anti-corrida attach/delete
--    (release de key referenciada por uma automação -> media_in_use,
--    registro sobrevive) (10b).

-- 1-3. Feature gate (off -> on -> downgrade) + RLS (any workspace member
--      writes, including agent)
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_agent uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_auto_by_agent uuid;
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

  -- agent SELECT sees the automation
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_agent, 'role', 'authenticated')::text, true);
  select count(*) into v_seen from instagram_comment_automations where conta_id = v_ws;
  assert v_seen = 1, format('agent should read the automation, saw %s', v_seen);

  -- agent INSERT allowed (full CRUD, same as owner/admin)
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message)
    values (v_ws, v_cli, 'Agent-made', array['x'], 'y')
    returning id into v_auto_by_agent;

  -- agent UPDATE allowed on any automation in the workspace
  update instagram_comment_automations set ativo = false where id = v_auto;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('agent UPDATE must affect 1 row, affected %s', v_rows);

  -- agent DELETE allowed on any automation in the workspace
  delete from instagram_comment_automations where id = v_auto_by_agent;
  get diagnostics v_rows = row_count;
  assert v_rows = 1, format('agent DELETE must affect 1 row, affected %s', v_rows);

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

  -- (f2) valor não-array e elemento não-objeto -> check_violation LIMPO
  --      (23514), nunca 22023: o CASE em validate_ig_dm_buttons garante a
  --      ordem dos type-guards (AND não garante short-circuit no Postgres).
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Escalar', array['x'], 'msg', '"not-an-array"'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'valor não-array deve cair no CHECK (23514), não em 22023';

  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'String', array['x'], 'msg', '["just-a-string"]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'elemento não-objeto deve cair no CHECK (23514), não em 22023';

  -- (f3) URL com userinfo (phishing) -> check_violation; @ no PATH é válido
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Phish', array['x'], 'msg',
        '[{"title":"Login","url":"https://accounts.instagram.com@evil.example/x"}]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'URL com userinfo deve ser rejeitada';

  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_buttons)
      values (v_ws, v_cli, 'Backslash', array['x'], 'msg',
        jsonb_build_array(jsonb_build_object('title', 'Login', 'url', 'https://good.com' || chr(92) || '@evil.com/x')));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'URL com barra invertida deve ser rejeitada';

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, dm_buttons)
    values (v_ws, v_cli, 'Perfil', array['perfil'], 'msg',
      '[{"title":"Perfil","url":"https://instagram.com/@handle"}]'::jsonb);

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

-- ---------------------------------------------------------------------------
-- 9. public_replies: CHECK, backfill e claim_retryable devolve public_reply_text
-- ---------------------------------------------------------------------------
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_cli bigint;
  v_rejected boolean;
  v_auto uuid;
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

  -- (a) válido: 5 variações de 500 chars como authenticated
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_replies)
    values (v_ws, v_cli, 'Cinco', array['x'], 'msg',
      to_jsonb(array_fill(repeat('a', 500), array[5])))
    returning id into v_auto;

  -- (b) 6 variações -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'Seis', array['x'], 'msg',
        to_jsonb(array_fill('oi'::text, array[6])));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, '6 variações devem ser rejeitadas';

  -- (c) item vazio após btrim -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'Vazia', array['x'], 'msg', '["ok", "   "]'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'variação só de espaços deve ser rejeitada';

  -- (d) item de 501 chars -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'Longa', array['x'], 'msg',
        jsonb_build_array(repeat('a', 501)));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'variação de 501 chars deve ser rejeitada';

  -- (e) não-array -> check_violation
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, public_replies)
      values (v_ws, v_cli, 'NaoArray', array['x'], 'msg', '"oi"'::jsonb);
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'public_replies não-array deve ser rejeitado';

  reset role;
  raise notice 'PASS 65 seção 9a: CHECKs de public_replies';
end $$;
rollback;

-- Backfill: simula a janela pré-migration inserindo com public_reply legado e
-- re-rodando o UPDATE de backfill (a migration real já rodou no schema do
-- teste; aqui provamos a EXPRESSÃO de backfill contra os dois casos). Roda
-- como table owner, sem troca de role (mesmo padrão das seções 4/6/8).
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint;
  v_normal uuid;
  v_blank uuid;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_reply)
    values (v_ws, v_cli, 'Com reply', array['x'], 'msg', 'olha a DM')
    returning id into v_normal;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_reply)
    values (v_ws, v_cli, 'Só espaços', array['x'], 'msg', '   ')
    returning id into v_blank;

  update instagram_comment_automations
     set public_replies = jsonb_build_array(public_reply)
   where public_reply is not null and btrim(public_reply) <> ''
     and id in (v_normal, v_blank);

  assert (select public_replies from instagram_comment_automations where id = v_normal)
         = '["olha a DM"]'::jsonb, 'backfill deve virar array de 1';
  assert (select public_replies from instagram_comment_automations where id = v_blank)
         = '[]'::jsonb, 'public_reply só de espaços deve ficar []';

  raise notice 'PASS 65 seção 9b: backfill de public_replies';
end $$;
rollback;

-- claim_retryable_automation_sends devolve public_reply_text (como owner,
-- stand-in do service_role -- ver seções 4/6/8; instagram_accounts não tem
-- coluna conta_id, o join da RPC é por client_id).
begin;
do $$
declare
  v_ws uuid;
  v_uid uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_send uuid;
  v_row record;
begin
  v_ws := et_make_workspace('pro');
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_uid);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_uid, v_ws, 'C', 'C', '#000') returning id into v_cli;

  insert into instagram_accounts
    (client_id, instagram_user_id, encrypted_access_token,
     authorization_status, permissions, comments_subscribed_at)
    values (v_cli, 'ig-1', 'enc-tok', 'active',
      array['instagram_business_manage_comments','instagram_business_manage_messages'],
      now());
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, public_replies)
    values (v_ws, v_cli, 'Retry', array['x'], 'msg', '["variação A"]'::jsonb)
    returning id into v_auto;
  insert into instagram_automation_sends
    (comment_id, automation_id, conta_id, commenter_id, comment_text,
     comment_created_at, status, next_attempt_at, attempts, public_reply_text)
    values ('c-9', v_auto, v_ws, 'u-9', 'x', now(), 'retry', now() - interval '1 minute',
      1, 'variação A')
    returning id into v_send;

  select * into v_row from claim_retryable_automation_sends(10);
  assert v_row.send_id = v_send, 'claim deve devolver o send em retry';
  assert v_row.public_reply_text = 'variação A',
    'claim deve devolver public_reply_text';

  raise notice 'PASS 65 seção 9c: claim devolve public_reply_text';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 10. dm_media/dm_subtitle (migração 20260901000002): CHECK de forma via
--     validate_ig_dm_media, bind de tenant (a key precisa carregar o
--     conta_id da PRÓPRIA automação), teto de 80 chars em dm_message/
--     dm_subtitle quando há mídia, e o trigger trg_ica_dm_media_finalized
--     (dm_media só aceita objeto FINALIZADO da mesma workspace; normaliza
--     content_type/size_bytes do registro; índice único ica_dm_media_key_unique
--     dá posse única da key). Como o trigger reconstrói dm_media inteiro a
--     partir do registro antes dos CHECKs rodarem, todo caso com dm_media
--     NÃO nulo precisa primeiro finalizar o objeto (table owner, stand-in do
--     service_role -- a RPC é REVOKE ALL FROM PUBLIC / GRANT ... TO
--     service_role) antes do INSERT como authenticated; só assim o trigger
--     encontra o registro e deixa o CHECK sob teste ser o único a disparar.
-- ---------------------------------------------------------------------------
begin;
select et_grant_hosted_parity();
do $$
declare
  v_ws uuid;
  v_owner uuid := gen_random_uuid();
  v_cli bigint;
  v_auto uuid;
  v_media jsonb;
  v_rejected boolean;
  v_ok boolean;
  v_valid boolean;
  v_key_a text;
  v_key_b text;
  v_key_c text;
  v_key_d text;
  v_key_e text;
  v_key_h text;
  v_key_k text;
  v_key_l text;
begin
  v_ws := et_make_workspace('pro'); -- plano 'pro': storage_quota_bytes = 10737418240 (10GB), folga de sobra
  insert into workspace_plan_overrides (workspace_id, feature_overrides)
    values (v_ws, '{"feature_instagram_automation": true}'::jsonb);

  insert into auth.users (id) values (v_owner);
  insert into workspace_members (user_id, workspace_id, role) values (v_owner, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws, role = 'owner'
    where id = v_owner;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner, v_ws, 'C', 'C', '#000') returning id into v_cli;

  -- (a) Válido: finalize o objeto (table owner) e então INSERT como
  --     authenticated com dm_media completo (width/height opcionais) +
  --     dm_message de exatamente 80 chars + dm_subtitle.
  v_key_a := 'automation-media/' || v_ws::text || '/img1.jpg';
  select automation_media_finalize(v_ws, v_key_a, 12345, 'image/jpeg') into v_ok;
  assert v_ok, 'finalize do objeto válido (a) deve devolver true';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, dm_subtitle, dm_media)
    values (v_ws, v_cli, 'Cartão', array['card'], repeat('a', 80), 'Confira as novidades!',
      jsonb_build_object('key', v_key_a, 'content_type', 'image/jpeg', 'size_bytes', 12345,
        'width', 800, 'height', 600))
    returning id, dm_media into v_auto, v_media;
  assert v_media->>'content_type' = 'image/jpeg', 'insert válido com dm_media finalizado deve passar';
  assert (v_media->>'size_bytes')::bigint = 12345, 'size_bytes deve vir normalizado do registro';

  reset role;

  -- (b) key finalizada na PRÓPRIA workspace mas com prefixo de OUTRO
  --     conta_id no texto -> passa o trigger (achou o registro), mas
  --     check_violation em ica_dm_media_tenant.
  v_key_b := 'automation-media/' || gen_random_uuid()::text || '/img.jpg';
  select automation_media_finalize(v_ws, v_key_b, 100, 'image/png') into v_ok;
  assert v_ok, 'finalize do objeto (b) deve devolver true';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_media)
      values (v_ws, v_cli, 'Outro tenant', array['x'], 'msg',
        jsonb_build_object('key', v_key_b, 'content_type', 'image/png', 'size_bytes', 100));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'key com conta_id de outra workspace no texto deve ser rejeitada';
  reset role;

  -- (c) key fora de automation-media/ -> finalizada, mas
  --     check_violation em validate_ig_dm_media (prefixo).
  v_key_c := 'outro-prefixo/' || v_ws::text || '/img.jpg';
  select automation_media_finalize(v_ws, v_key_c, 100, 'image/png') into v_ok;
  assert v_ok, 'finalize do objeto (c) deve devolver true';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_media)
      values (v_ws, v_cli, 'Prefixo errado', array['x'], 'msg',
        jsonb_build_object('key', v_key_c, 'content_type', 'image/png', 'size_bytes', 100));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'key fora de automation-media/ deve ser rejeitada';
  reset role;

  -- (d) size_bytes 8388609 (1 acima do teto de 8MB) registrado no objeto ->
  --     normalizado pelo trigger -> check_violation em validate_ig_dm_media.
  v_key_d := 'automation-media/' || v_ws::text || '/imgd.jpg';
  select automation_media_finalize(v_ws, v_key_d, 8388609, 'image/jpeg') into v_ok;
  assert v_ok, 'finalize do objeto (d) deve devolver true';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_media)
      values (v_ws, v_cli, 'Grande demais', array['x'], 'msg',
        jsonb_build_object('key', v_key_d, 'content_type', 'image/jpeg', 'size_bytes', 8388609));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'size_bytes acima de 8388608 deve ser rejeitado';
  reset role;

  -- (e) content_type image/webp registrado no objeto (finalize não valida
  --     o mime) -> normalizado pelo trigger -> check_violation.
  v_key_e := 'automation-media/' || v_ws::text || '/imge.jpg';
  select automation_media_finalize(v_ws, v_key_e, 100, 'image/webp') into v_ok;
  assert v_ok, 'finalize do objeto (e) deve devolver true';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_media)
      values (v_ws, v_cli, 'Webp', array['x'], 'msg',
        jsonb_build_object('key', v_key_e, 'content_type', 'image/webp', 'size_bytes', 100));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'content_type image/webp deve ser rejeitado';
  reset role;

  -- (f) chave extra no objeto -> o trigger trg_ica_dm_media_finalized SEMPRE
  --     reconstrói dm_media a partir do registro + width/height, então uma
  --     chave extra do cliente nunca sobrevive até o CHECK via INSERT/UPDATE
  --     normal. Prova-se a rejeição chamando validate_ig_dm_media direto.
  select validate_ig_dm_media(jsonb_build_object(
    'key', 'automation-media/' || v_ws::text || '/img.jpg',
    'content_type', 'image/png', 'size_bytes', 100, 'foo', 'bar'
  )) into v_valid;
  assert not v_valid, 'chave extra no objeto de dm_media deve ser rejeitada pela função de validação';

  -- (g) dm_subtitle sem dm_media -> check_violation (ica_dm_subtitle_with_media).
  --     dm_media é NULL, então o trigger nem toca a linha; nenhum finalize
  --     é necessário aqui.
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_subtitle)
      values (v_ws, v_cli, 'Sem mídia', array['x'], 'msg', 'Legenda solta');
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'dm_subtitle sem dm_media deve ser rejeitado';
  reset role;

  -- (h) dm_message com 81 chars COM mídia finalizada -> passa o trigger,
  --     check_violation em ica_dm_message_len_with_media (teto de 80).
  v_key_h := 'automation-media/' || v_ws::text || '/imgh.jpg';
  select automation_media_finalize(v_ws, v_key_h, 100, 'image/jpeg') into v_ok;
  assert v_ok, 'finalize do objeto (h) deve devolver true';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_media)
      values (v_ws, v_cli, 'Título longo', array['x'], repeat('a', 81),
        jsonb_build_object('key', v_key_h, 'content_type', 'image/jpeg', 'size_bytes', 100));
  exception when check_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'dm_message de 81 chars com mídia deve ser rejeitado';

  -- (k) dm_media aponta para key SEM registro em automation_media_objects
  --     -> trigger dispara media_not_finalized (P0001), não check_violation.
  v_key_k := 'automation-media/' || v_ws::text || '/imgk-nunca-finalizada.jpg';
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_media)
      values (v_ws, v_cli, 'Nunca finalizada', array['x'], 'msg',
        jsonb_build_object('key', v_key_k, 'content_type', 'image/jpeg', 'size_bytes', 100));
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'media_not_finalized', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'dm_media apontando para key não finalizada deve ser rejeitado';

  -- (l) metadata fabricada (content_type/size_bytes divergentes do
  --     registro) é NORMALIZADA pelo trigger para os valores reais.
  v_key_l := 'automation-media/' || v_ws::text || '/imgl.jpg';
  reset role;
  select automation_media_finalize(v_ws, v_key_l, 555, 'image/png') into v_ok;
  assert v_ok, 'finalize do objeto (l) deve devolver true';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, dm_media)
    values (v_ws, v_cli, 'Normalizado', array['x'], 'Confira!',
      jsonb_build_object('key', v_key_l, 'content_type', 'image/gif', 'size_bytes', 999999))
    returning dm_media into v_media;
  assert v_media->>'content_type' = 'image/png',
    format('content_type deve vir normalizado do registro (image/png), veio %s', v_media->>'content_type');
  assert (v_media->>'size_bytes')::bigint = 555,
    format('size_bytes deve vir normalizado do registro (555), veio %s', v_media->>'size_bytes');

  -- (m) segunda automação referenciando a MESMA key de (a) -> unique_violation
  --     (índice parcial ica_dm_media_key_unique: posse única da key).
  v_rejected := false;
  begin
    insert into instagram_comment_automations
      (conta_id, client_id, name, keywords, dm_message, dm_media)
      values (v_ws, v_cli, 'Duplicada', array['x'], 'Outra',
        jsonb_build_object('key', v_key_a, 'content_type', 'image/jpeg', 'size_bytes', 12345));
  exception when unique_violation then
    v_rejected := true;
  end;
  assert v_rejected, 'segunda automação com a mesma key deve violar o índice único';

  reset role;
  raise notice 'PASS 65 seção 10: dm_media CHECKs + trigger de finalização + índice único';
end $$;
rollback;

-- 10b. automation_media_finalize/automation_media_release: idempotência por
--      key, incremento/decremento atômico de workspaces.storage_used_bytes,
--      quota_exceeded sem deixar linha órfã em automation_media_objects,
--      piso 0 no release (nunca deixa storage_used_bytes negativo), e o
--      anti-corrida attach/delete (release de key referenciada por uma
--      automação -> media_in_use, registro sobrevive). Roda como table owner
--      (stand-in do service role, como as seções 4, 6 e 8 -- as RPCs são
--      REVOKE ALL FROM PUBLIC / GRANT ... TO service_role).
begin;
do $$
declare
  v_ws uuid;
  v_key1 text;
  v_key2 text;
  v_key3 text;
  v_key4 text;
  v_ok boolean;
  v_bytes bigint;
  v_used bigint;
  v_n int;
  v_rejected boolean;
  v_owner4 uuid := gen_random_uuid();
  v_cli4 bigint;
begin
  -- Workspace real (a FOR UPDATE de automation_media_finalize precisa achar
  -- a linha em workspaces) com quota baixa e conhecida via resource_overrides,
  -- no mesmo padrão de 63_storage_autoclean.sql.
  v_ws := et_make_workspace('pro', '{"storage_quota_bytes": 1000}'::jsonb);
  v_key1 := 'automation-media/' || v_ws::text || '/img1.jpg';
  v_key2 := 'automation-media/' || v_ws::text || '/img2.jpg';
  v_key3 := 'automation-media/' || v_ws::text || '/img3.jpg';

  -- (i) primeira finalize: incrementa e devolve true
  select automation_media_finalize(v_ws, v_key1, 600, 'image/jpeg') into v_ok;
  assert v_ok, 'primeira finalize deve devolver true';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 600, format('storage_used_bytes deve ser 600, veio %s', v_used);

  -- rechamada com a MESMA key: idempotente, não re-reserva nem incrementa
  select automation_media_finalize(v_ws, v_key1, 600, 'image/jpeg') into v_ok;
  assert not v_ok, 'segunda finalize com a mesma key deve devolver false';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 600, 'segunda finalize não pode incrementar de novo';

  -- finalize de uma NOVA key que estouraria a quota (600 + 500 > 1000)
  v_rejected := false;
  begin
    perform automation_media_finalize(v_ws, v_key2, 500, 'image/jpeg');
  exception when sqlstate 'P0001' then
    assert sqlerrm like 'quota_exceeded%', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'finalize acima da quota do plano deve estourar quota_exceeded';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 600, 'quota_exceeded não pode alterar storage_used_bytes';
  select count(*) into v_n from automation_media_objects where key = v_key2;
  assert v_n = 0, 'quota_exceeded não pode deixar linha órfã em automation_media_objects';

  -- (j) release devolve os bytes do registro e decrementa
  select automation_media_release(v_ws, v_key1) into v_bytes;
  assert v_bytes = 600, format('release deve devolver 600, veio %s', v_bytes);
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('storage_used_bytes deve voltar a 0, veio %s', v_used);

  -- rechamada com a MESMA key: no-op idempotente
  select automation_media_release(v_ws, v_key1) into v_bytes;
  assert v_bytes = 0, 'segunda release da mesma key deve devolver 0';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, 'segunda release não pode decrementar de novo';

  -- release de key nunca finalizada: no-op idempotente
  select automation_media_release(v_ws, v_key3) into v_bytes;
  assert v_bytes = 0, 'release de key nunca finalizada deve devolver 0';

  -- piso 0: storage_used_bytes corrompido/menor que o registro nunca vai a
  -- negativo (GREATEST(0, ...)).
  select automation_media_finalize(v_ws, v_key3, 300, 'image/jpeg') into v_ok;
  assert v_ok, 'finalize de v_key3 deve devolver true';
  update workspaces set storage_used_bytes = 100 where id = v_ws;
  select automation_media_release(v_ws, v_key3) into v_bytes;
  assert v_bytes = 300, format('release deve devolver o tamanho registrado (300), veio %s', v_bytes);
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 0, format('piso 0: storage_used_bytes não pode ir negativo, veio %s', v_used);

  -- (n) release de key REFERENCIADA por uma automação -> media_in_use
  --     (anti-corrida attach/delete); o registro sobrevive (o RAISE desfaz
  --     o DELETE) e storage_used_bytes continua refletindo o objeto vivo.
  v_key4 := 'automation-media/' || v_ws::text || '/img4.jpg';
  select automation_media_finalize(v_ws, v_key4, 700, 'image/jpeg') into v_ok;
  assert v_ok, 'finalize de v_key4 deve devolver true';

  insert into auth.users (id) values (v_owner4);
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_owner4, v_ws, 'C4', 'C4', '#000') returning id into v_cli4;
  insert into instagram_comment_automations
    (conta_id, client_id, name, keywords, dm_message, dm_media)
    values (v_ws, v_cli4, 'Em uso', array['x'], 'msg',
      jsonb_build_object('key', v_key4, 'content_type', 'image/jpeg', 'size_bytes', 700));

  v_rejected := false;
  begin
    perform automation_media_release(v_ws, v_key4);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'media_in_use', format('wrong msg: %s', sqlerrm);
    v_rejected := true;
  end;
  assert v_rejected, 'release de key referenciada por automação deve estourar media_in_use';

  select count(*) into v_n from automation_media_objects where key = v_key4;
  assert v_n = 1, 'registro deve sobreviver ao release rejeitado (DELETE desfeito pelo RAISE)';
  select storage_used_bytes into v_used from workspaces where id = v_ws;
  assert v_used = 700, format('storage_used_bytes deve continuar refletindo o objeto vivo (700), veio %s', v_used);

  raise notice 'PASS 65 seção 10b: automation_media_finalize/release (idempotência, quota, piso 0, anti-corrida)';
end $$;
rollback;
