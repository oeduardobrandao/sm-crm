-- Link de conexão do Instagram enviado pela agência ao cliente final.
-- O cliente abre o link sem login no Mesaas e autoriza o próprio Instagram.

CREATE TABLE IF NOT EXISTS instagram_connect_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id    uuid NOT NULL,
  -- auth.users.id de quem gerou. Sem FK de propósito: notifications.user_id tem
  -- ON DELETE CASCADE, e remover um membro não pode apagar links pendentes de clientes.
  created_by  uuid NOT NULL,
  token       uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  -- "última tentativa que passou o portão do callback", não "última conexão bem-sucedida":
  -- o portão precisa marcar antes da escrita em instagram_accounts para ser atômico.
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Um único link não revogado por cliente.
-- O predicado NÃO pode incluir expires_at > now(): predicado de índice parcial exige
-- funções IMMUTABLE e now() é STABLE, então a criação falharia. A metade "não expirado"
-- da liveness é avaliada em tempo de leitura por connectLinkLive().
CREATE UNIQUE INDEX IF NOT EXISTS instagram_connect_links_one_live
  ON instagram_connect_links (cliente_id) WHERE revoked_at IS NULL;

ALTER TABLE instagram_connect_links ENABLE ROW LEVEL SECURITY;

-- USING e WITH CHECK também amarram cliente_id ao conta_id da própria linha
-- (padrão 20260730000005 / tarefas_tenant_all): um FK simples deixaria um
-- membro do workspace A apontar cliente_id para um cliente do workspace B
-- enquanto declara conta_id = A, roubando o slot único de B em
-- instagram_connect_links_one_live e, no fluxo público, anexando a conta do
-- Instagram autorizada a um cliente de outro workspace. A subquery qualifica
-- a linha externa (instagram_connect_links.cliente_id / .conta_id): clientes
-- carrega seu próprio conta_id, e um `conta_id` sem qualificação resolveria
-- para o escopo da subquery, colapsando a comparação numa tautologia que
-- libera tudo. cliente_id é NOT NULL aqui, então (diferente de tarefas) não
-- precisa do braço `IS NULL OR`.
CREATE POLICY "instagram_connect_links_workspace_all" ON instagram_connect_links
  FOR ALL USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = instagram_connect_links.cliente_id
        AND c.conta_id = instagram_connect_links.conta_id
    )
  )
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND EXISTS (
      SELECT 1 FROM public.clientes c
      WHERE c.id = instagram_connect_links.cliente_id
        AND c.conta_id = instagram_connect_links.conta_id
    )
  );

CREATE POLICY "instagram_connect_links_service_role" ON instagram_connect_links
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Lock consultivo transacional por cliente + "já existe link vivo? devolve ele"
-- em vez de contar com a colisão no índice único. Um UPDATE-revoga seguido de
-- INSERT sem lock deixava o resultado de dois POSTs concorrentes para o mesmo
-- cliente não determinístico: a ordem física de scan e o snapshot de cada
-- statement decidiam se o segundo UPDATE também revogava a linha que o
-- primeiro acabara de inserir. Quando revogava, a resposta HTTP do primeiro
-- POST carregava um token já morto -- a primeira aba podia mostrar e mandar
-- um link natimorto ao cliente. Com o lock, o segundo `pg_advisory_xact_lock`
-- espera o primeiro liberar (commit/rollback da transação) antes de agir, e
-- aí encontra o link recém-criado pela verificação de liveness abaixo e o
-- devolve em vez de revogar. A UI só mostra "Gerar" quando não há link vivo
-- (ConnectLinkDialog), então duas abas que concordam nisso devem convergir
-- no MESMO token -- não existe fluxo de produto que peça para rotacionar um
-- link vivo por engano. Rotação continua disponível via Revogar + Gerar.
CREATE OR REPLACE FUNCTION create_instagram_connect_link(
  p_cliente_id bigint,
  p_conta_id   uuid,
  p_created_by uuid,
  p_ttl_days   int DEFAULT 30
)
RETURNS TABLE (token uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  -- Defesa em profundidade: o handler já checa, mas a RPC não confia nele.
  IF NOT EXISTS (
    SELECT 1 FROM clientes c WHERE c.id = p_cliente_id AND c.conta_id = p_conta_id
  ) THEN
    RAISE EXCEPTION 'client % does not belong to workspace %', p_cliente_id, p_conta_id;
  END IF;

  -- Namespace = hash de um literal fixo ('instagram_connect_links'), chave =
  -- hash do cliente_id como texto. bigint não cabe no segundo argumento int4
  -- de pg_advisory_xact_lock(int, int); hashear a representação em texto (em
  -- vez de truncar/moduloar o bigint) evita qualquer cuidado extra com
  -- overflow ou sinal. O par (namespace, chave) fica isolado de qualquer
  -- outro uso de advisory lock neste banco -- não colide por construção com
  -- um lock de duas chaves aleatórias de outro subsistema. Escopo XACT: solto
  -- automaticamente no commit ou rollback, sem UNLOCK explícito. Não se usa
  -- `SELECT ... FOR UPDATE` em `clientes` aqui: seria um lock de linha numa
  -- tabela com escrita pesada, arriscando deadlock contra transações que
  -- tocam `clientes` em outra ordem.
  PERFORM pg_advisory_xact_lock(hashtext('instagram_connect_links'), hashtext(p_cliente_id::text));

  -- Com o lock em mãos (serializa concorrentes para este cliente_id), procura
  -- um link já vivo -- não revogado e ainda dentro do prazo. Se existir,
  -- devolve sem tocar em nada.
  SELECT icl.token, icl.expires_at INTO v_existing
    FROM instagram_connect_links icl
   WHERE icl.cliente_id = p_cliente_id
     AND icl.revoked_at IS NULL
     AND icl.expires_at > now()
   LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_existing.token, v_existing.expires_at;
    RETURN;
  END IF;

  -- Nenhum link vivo: revoga qualquer linha não revogada mas EXPIRADA (que
  -- ainda ocupa o slot do índice único parcial) e insere o novo.
  UPDATE instagram_connect_links l
     SET revoked_at = now()
   WHERE l.cliente_id = p_cliente_id AND l.revoked_at IS NULL;

  RETURN QUERY
  INSERT INTO instagram_connect_links AS icl (cliente_id, conta_id, created_by, expires_at)
  VALUES (p_cliente_id, p_conta_id, p_created_by, now() + make_interval(days => p_ttl_days))
  RETURNING icl.token, icl.expires_at;
END;
$$;

-- REVOKE FROM PUBLIC também tira o service_role: re-conceder explicitamente.
REVOKE ALL ON FUNCTION create_instagram_connect_link(bigint, uuid, uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_instagram_connect_link(bigint, uuid, uuid, int) TO service_role;

-- Revoga o(s) link(s) vivo(s) de um cliente sob o MESMO lock consultivo
-- namespaced que create_instagram_connect_link (mesmo hashtext do namespace e
-- da chave), para que as duas RPCs disputem a mesma seção crítica por
-- cliente_id de verdade. Sem isso, um DELETE (revogação) podia rodar entre o
-- "revoga o que existe" e o "insere o novo" da RPC de criação: o DELETE
-- revogava a linha antiga, devolvia { ok: true } para a agência, e a criação
-- então commitava um token novo e vivo por baixo -- a agência via "revogado"
-- enquanto uma credencial usável continuava no ar.
CREATE OR REPLACE FUNCTION revoke_instagram_connect_link(
  p_cliente_id bigint,
  p_conta_id   uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Defesa em profundidade: o handler já checa a posse do cliente, a RPC não
  -- confia nele.
  IF NOT EXISTS (
    SELECT 1 FROM clientes c WHERE c.id = p_cliente_id AND c.conta_id = p_conta_id
  ) THEN
    RAISE EXCEPTION 'client % does not belong to workspace %', p_cliente_id, p_conta_id;
  END IF;

  -- Mesmo par (namespace, chave) que create_instagram_connect_link: só assim
  -- as duas RPCs contendem pelo mesmo lock para o mesmo cliente_id.
  PERFORM pg_advisory_xact_lock(hashtext('instagram_connect_links'), hashtext(p_cliente_id::text));

  UPDATE instagram_connect_links l
     SET revoked_at = now()
   WHERE l.cliente_id = p_cliente_id AND l.revoked_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION revoke_instagram_connect_link(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_instagram_connect_link(bigint, uuid) TO service_role;

-- ---------- notifications_type_check ---------------------------------
-- Lista copiada da definição MAIS RECENTE (20260805000002_post_status_automations.sql,
-- 18 valores). Este arquivo passa a ser a definição mais recente: a próxima migration
-- que tocar notifications_type_check deve copiar daqui, e não de um arquivo antigo.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client'
  )
);
