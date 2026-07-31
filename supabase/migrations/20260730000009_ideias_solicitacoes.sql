-- Spec: docs/superpowers/specs/2026-07-30-hub-solicitacoes-conversao-tarefa-design.md
-- Solicitacoes no Hub: ideias.tipo, conversao atomica em tarefa e sync de status.

-- 1) Colunas + constraints
ALTER TABLE ideias ADD COLUMN tipo text NOT NULL DEFAULT 'ideia';
ALTER TABLE ideias ADD CONSTRAINT ideias_tipo_check CHECK (tipo IN ('ideia','solicitacao'));

-- FK composta: ponteiro cross-tenant impossivel no banco para TODOS os escritores.
-- Column-list no SET NULL (PG 15+; prod = 17.6) anula so tarefa_id, preserva workspace_id.
-- MATCH SIMPLE ignora a constraint quando tarefa_id e NULL.
ALTER TABLE ideias ADD COLUMN tarefa_id bigint;
ALTER TABLE ideias ADD CONSTRAINT ideias_tarefa_fk
  FOREIGN KEY (tarefa_id, workspace_id) REFERENCES tarefas (id, conta_id)
  ON DELETE SET NULL (tarefa_id);
CREATE INDEX ideias_tarefa_idx ON ideias (tarefa_id);

-- Estados derivados: convertida/concluida so via RPC + trigger de sync, nunca via UI.
ALTER TABLE ideias DROP CONSTRAINT ideias_status_check;
ALTER TABLE ideias ADD CONSTRAINT ideias_status_check
  CHECK (status IN ('nova','em_analise','aprovada','descartada','convertida','concluida'));

-- 2) RPC de conversao: atomica, claim com FOR UPDATE, cliente fixado ao da solicitacao.
CREATE OR REPLACE FUNCTION convert_solicitacao_em_tarefa(
  p_ideia_id uuid,
  p_titulo text,
  p_descricao text DEFAULT NULL,
  p_responsavel_id bigint DEFAULT NULL,
  p_data_limite date DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ideia record;
  v_tarefa_id bigint;
BEGIN
  -- RLS do invocador: ideia de outro workspace nao aparece (NOT FOUND).
  SELECT id, workspace_id, cliente_id, tipo, status, tarefa_id
    INTO v_ideia
    FROM ideias
   WHERE id = p_ideia_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitacao nao encontrada.';
  END IF;
  IF v_ideia.tipo <> 'solicitacao' THEN
    RAISE EXCEPTION 'Apenas solicitacoes podem virar tarefa.';
  END IF;
  IF v_ideia.tarefa_id IS NOT NULL OR v_ideia.status NOT IN ('nova','em_analise','aprovada') THEN
    RAISE EXCEPTION 'Solicitacao ja convertida ou com status nao elegivel.';
  END IF;
  IF p_titulo IS NULL OR btrim(p_titulo) = '' THEN
    RAISE EXCEPTION 'Titulo obrigatorio.';
  END IF;

  -- cliente_id vem da propria solicitacao, NUNCA de parametro.
  -- WITH CHECK de tarefas valida responsavel_id no workspace; task_assigned dispara
  -- com ator = auth.uid() (excluido do batch).
  INSERT INTO tarefas (conta_id, user_id, titulo, descricao, status,
                       responsavel_id, cliente_id, data_limite)
  VALUES (v_ideia.workspace_id, auth.uid(), btrim(p_titulo),
          NULLIF(btrim(coalesce(p_descricao, '')), ''), 'pendente',
          p_responsavel_id, v_ideia.cliente_id, p_data_limite)
  RETURNING id INTO v_tarefa_id;

  UPDATE ideias SET status = 'convertida', tarefa_id = v_tarefa_id
   WHERE id = p_ideia_id;

  RETURN v_tarefa_id;
END;
$$;

-- Default do PG e EXECUTE para PUBLIC; REVOKE sem re-grant derrubaria service_role.
REVOKE ALL ON FUNCTION convert_solicitacao_em_tarefa(uuid, text, text, bigint, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION convert_solicitacao_em_tarefa(uuid, text, text, bigint, date) TO authenticated;
GRANT EXECUTE ON FUNCTION convert_solicitacao_em_tarefa(uuid, text, text, bigint, date) TO service_role;

-- 3) Sync tarefa -> solicitacao. Invariante de dados: SEM bloco EXCEPTION.
-- Falha propaga e desfaz a transicao da tarefa (divergencia silenciosa seria pior).
CREATE OR REPLACE FUNCTION trg_sync_ideia_from_tarefa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'concluida' AND OLD.status IS DISTINCT FROM 'concluida' THEN
    UPDATE ideias SET status = 'concluida'
     WHERE tarefa_id = NEW.id AND workspace_id = NEW.conta_id AND status = 'convertida';
  ELSIF NEW.status <> 'concluida' AND OLD.status = 'concluida' THEN
    UPDATE ideias SET status = 'convertida'
     WHERE tarefa_id = NEW.id AND workspace_id = NEW.conta_id AND status = 'concluida';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_ideia_from_tarefa ON tarefas;
CREATE TRIGGER sync_ideia_from_tarefa
  AFTER UPDATE OF status ON tarefas
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION trg_sync_ideia_from_tarefa();

-- 4) Notificacao: recria a versao MAIS RECENTE (20260430000003) adicionando tipo ao metadata.
CREATE OR REPLACE FUNCTION trg_notify_idea_submitted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
BEGIN
  BEGIN
    IF NEW.status IS DISTINCT FROM 'nova' THEN
      RETURN NEW;
    END IF;

    SELECT nome INTO v_client_name FROM clientes WHERE id = NEW.cliente_id;

    v_targets := resolve_notification_targets(NEW.workspace_id, NULL, ARRAY['owner','admin']);

    PERFORM insert_notification_batch(
      NEW.workspace_id,
      v_targets,
      'idea_submitted',
      '/ideias',
      jsonb_build_object(
        'client_name', v_client_name,
        'idea_title',  NEW.titulo,
        'idea_id',     NEW.id,
        'tipo',        NEW.tipo
      ),
      NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_idea_submitted failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;
