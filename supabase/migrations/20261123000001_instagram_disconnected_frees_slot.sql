-- Instagram: uma conta desconectada deixa de ocupar a vaga do plano.
--
-- Antes: trg_limit_instagram contava toda linha de instagram_accounts do
-- workspace, e disconnect.ts mantém a linha (só zera o token e marca
-- authorization_status = 'disconnected'). No Free (limite 1), desconectar o
-- Instagram do cliente A não liberava a vaga para o cliente B.
--
-- Decisão: só 'disconnected' sai da conta. É o único estado que o usuário
-- escolhe (o token foi apagado e os posts sincronizados também). 'expired' e
-- 'revoked' seguem ocupando a vaga: a integração continua configurada e o CRM
-- pede para reconectar; liberá-los deixaria um workspace trocar de conta à
-- vontade sem desconectar.
--
-- 1. enforce_plan_count_limit(): no modo 'via_clientes' o predicado
--    (TG_ARGV[4]) era ignorado. Agora é aplicado, como no modo 'direct'. Corpo
--    copiado de 20260919000009 sem outra mudança. Só trg_limit_instagram usa
--    'via_clientes' e ele passava '' até aqui, então os outros oito triggers
--    (clientes, leads, seats, hub tokens, templates, workflows, custom props,
--    posts) seguem idênticos.
-- 2. trg_limit_instagram passa o predicado t.authorization_status <> 'disconnected'
--    (t = instagram_accounts, c = clientes no join).
-- 3. trg_limit_instagram_reconnect: reconectar uma linha 'disconnected'
--    (o callback do OAuth faz UPDATE para linha existente, que o BEFORE INSERT
--    não vê) passa pelo mesmo limite. No BEFORE UPDATE a linha ainda está
--    'disconnected' na tabela, então a contagem a exclui; mesma chave de
--    advisory lock que o insert, então os dois serializam.
-- 4. workspace_usage(): instagram_accounts conta só as não desconectadas, igual
--    ao trigger. Corpo copiado de 20261117000012 (com o escopo por cliente).

CREATE OR REPLACE FUNCTION enforce_plan_count_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit_key text := TG_ARGV[0];
  v_ws_mode   text := TG_ARGV[1];
  v_ws_col    text := TG_ARGV[2];
  v_scope_col text := TG_ARGV[3];
  v_pred      text := coalesce(TG_ARGV[4], '');
  v_allow_first boolean := coalesce(TG_ARGV[5], 'false')::boolean;
  v_ws_id     uuid;
  v_scope_val text;
  v_limit     bigint;
  v_count     bigint;
  v_sql       text;
BEGIN
  -- resolve workspace id from NEW
  IF v_ws_mode = 'via_clientes' THEN
    EXECUTE format('select conta_id from clientes where id = ($1).%I', v_ws_col)
      USING NEW INTO v_ws_id;
  ELSE
    EXECUTE format('select (($1).%I)::uuid', v_ws_col) USING NEW INTO v_ws_id;
  END IF;
  IF v_ws_id IS NULL THEN
    RETURN NEW; -- cannot resolve workspace; defer to other constraints
  END IF;

  -- serialize concurrent inserts for this (workspace, limit) to prevent overshoot
  PERFORM pg_advisory_xact_lock(hashtext(v_ws_id::text || ':' || v_limit_key));

  IF v_allow_first THEN
    -- The carve-out needs to know the count before it can decide whether to
    -- skip the limit check, so it must be computed up front for this trigger.
    IF v_ws_mode = 'via_clientes' THEN
      v_sql := format(
        'select count(*) from %I t join clientes c on c.id = t.%I where c.conta_id = $1',
        TG_TABLE_NAME, v_ws_col);
      IF v_pred <> '' THEN
        v_sql := v_sql || ' and ' || v_pred;
      END IF;
      EXECUTE v_sql USING v_ws_id INTO v_count;
    ELSE
      EXECUTE format('select (($1).%I)::text', v_scope_col) USING NEW INTO v_scope_val;
      v_sql := format('select count(*) from %I where %I::text = $1', TG_TABLE_NAME, v_scope_col);
      IF v_pred <> '' THEN
        v_sql := v_sql || ' and ' || v_pred;
      END IF;
      EXECUTE v_sql USING v_scope_val INTO v_count;
    END IF;

    IF v_count = 0 THEN
      RETURN NEW; -- first row for this scope is always allowed, regardless of plan/limit state
    END IF;
  END IF;

  -- Fast path preserved for every other trigger (the 8 not passing
  -- allow_first_row): resolve the limit first and skip the count entirely
  -- when unlimited, so bulk inserts on unlimited plans don't pay for a
  -- COUNT(*) they'll never need.
  v_limit := effective_plan_limit(v_ws_id, v_limit_key);
  IF v_limit IS NULL THEN
    RETURN NEW; -- unlimited
  END IF;

  IF NOT v_allow_first THEN
    IF v_ws_mode = 'via_clientes' THEN
      -- workspace-wide count across the clientes join (t = counted table, c = clientes)
      v_sql := format(
        'select count(*) from %I t join clientes c on c.id = t.%I where c.conta_id = $1',
        TG_TABLE_NAME, v_ws_col);
      IF v_pred <> '' THEN
        v_sql := v_sql || ' and ' || v_pred;
      END IF;
      EXECUTE v_sql USING v_ws_id INTO v_count;
    ELSE
      EXECUTE format('select (($1).%I)::text', v_scope_col) USING NEW INTO v_scope_val;
      -- Cast $1 explicitly; the scope value was read from the same column type,
      -- so casting back via the column avoids implicit text→typed mismatches.
      v_sql := format('select count(*) from %I where %I::text = $1', TG_TABLE_NAME, v_scope_col);
      IF v_pred <> '' THEN
        v_sql := v_sql || ' and ' || v_pred;
      END IF;
      EXECUTE v_sql USING v_scope_val INTO v_count;
    END IF;
  END IF;

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'plan_limit_exceeded:%', v_limit_key USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_limit_instagram ON instagram_accounts;
CREATE TRIGGER trg_limit_instagram BEFORE INSERT ON instagram_accounts
  FOR EACH ROW EXECUTE FUNCTION enforce_plan_count_limit(
    'max_instagram_accounts', 'via_clientes', 'client_id', '',
    't.authorization_status <> ''disconnected''');

DROP TRIGGER IF EXISTS trg_limit_instagram_reconnect ON instagram_accounts;
CREATE TRIGGER trg_limit_instagram_reconnect
  BEFORE UPDATE OF authorization_status ON instagram_accounts
  FOR EACH ROW
  WHEN (OLD.authorization_status = 'disconnected'
        AND NEW.authorization_status IS DISTINCT FROM 'disconnected')
  EXECUTE FUNCTION enforce_plan_count_limit(
    'max_instagram_accounts', 'via_clientes', 'client_id', '',
    't.authorization_status <> ''disconnected''');

CREATE OR REPLACE FUNCTION public.workspace_usage()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ws uuid := public.get_my_conta_id();
  v_all boolean;
begin
  if v_ws is null then
    return '{}'::jsonb;
  end if;

  -- Defense-in-depth: a stale active_workspace_id pointer (membership deleted,
  -- pointer not yet cleared) must not leak aggregate counts to a removed user.
  if not exists (
    select 1 from workspace_members
     where workspace_id = v_ws and user_id = auth.uid()
  ) then
    return '{}'::jsonb;
  end if;

  v_all := public.my_client_scope_all();

  return jsonb_build_object(
    'clients',            (select count(*) from clientes c
                            where c.conta_id = v_ws
                              and (v_all or public.can_access_cliente(c.id))),
    'team_members',       (select count(*) from workspace_members where workspace_id = v_ws),
    'pending_invites',    (select count(*) from invites
                            where conta_id = v_ws and status = 'pending'),
    'leads',              (select count(*) from leads where conta_id = v_ws),
    'hub_tokens',         (select count(*) from client_hub_tokens h
                            where h.conta_id = v_ws
                              and (v_all or public.can_access_cliente(h.cliente_id))),
    'workflow_templates', (select count(*) from workflow_templates where conta_id = v_ws),
    -- Mesmo predicado de trg_limit_instagram: conta desconectada não ocupa vaga.
    'instagram_accounts', (select count(*) from instagram_accounts t
                             join clientes c on c.id = t.client_id
                            where c.conta_id = v_ws
                              and t.authorization_status <> 'disconnected'
                              and (v_all or public.can_access_cliente(c.id))),
    'mcp_keys',           (select count(*) from mcp_api_keys
                            where conta_id = v_ws and revoked_at is null),
    'storage_used_bytes', (select coalesce(storage_used_bytes, 0)
                             from workspaces where id = v_ws)
  );
end;
$function$;
