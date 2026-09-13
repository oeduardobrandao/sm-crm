-- Store TipTap JSON for task descriptions. `descricao` remains the searchable/readable
-- plain-text projection and provides backward compatibility for existing rows.
ALTER TABLE public.tarefas
  ADD COLUMN IF NOT EXISTS descricao_rich jsonb;

-- Replace the old signature rather than adding an overload: the new rich argument has
-- a default, so old clients remain compatible without making PostgREST function routing
-- ambiguous.
DROP FUNCTION IF EXISTS public.convert_solicitacao_em_tarefa(uuid, text, text, bigint, date);

CREATE OR REPLACE FUNCTION public.convert_solicitacao_em_tarefa(
  p_ideia_id uuid,
  p_titulo text,
  p_descricao text DEFAULT NULL,
  p_responsavel_id bigint DEFAULT NULL,
  p_data_limite date DEFAULT NULL,
  p_descricao_rich jsonb DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ideia record;
  v_tarefa_id bigint;
BEGIN
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

  INSERT INTO tarefas (
    conta_id,
    user_id,
    titulo,
    descricao,
    descricao_rich,
    status,
    responsavel_id,
    cliente_id,
    data_limite
  )
  VALUES (
    v_ideia.workspace_id,
    auth.uid(),
    btrim(p_titulo),
    NULLIF(btrim(coalesce(p_descricao, '')), ''),
    p_descricao_rich,
    'pendente',
    p_responsavel_id,
    v_ideia.cliente_id,
    p_data_limite
  )
  RETURNING id INTO v_tarefa_id;

  UPDATE ideias
     SET status = 'convertida', tarefa_id = v_tarefa_id
   WHERE id = p_ideia_id;

  RETURN v_tarefa_id;
END;
$$;

REVOKE ALL ON FUNCTION public.convert_solicitacao_em_tarefa(
  uuid,
  text,
  text,
  bigint,
  date,
  jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_solicitacao_em_tarefa(
  uuid,
  text,
  text,
  bigint,
  date,
  jsonb
) TO authenticated, service_role;
