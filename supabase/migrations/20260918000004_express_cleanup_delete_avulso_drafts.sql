-- Delete atomico dos rascunhos Express avulsos abandonados (passo 3 de
-- express-post-cleanup-cron). O cron pre-filtra por post_processes, mas ler
-- e apagar em requisicoes separadas deixa uma janela em que um processo
-- individual criado no meio seria levado pelo cascade. Aqui: (1) FOR UPDATE
-- nas linhas candidatas espera qualquer criacao em voo (o trigger
-- post_processes_requires_avulso segura FOR SHARE na linha do post ate o
-- commit); (2) o DELETE e uma instrucao nova, com snapshot novo em READ
-- COMMITTED, entao um processo commitado enquanto esperavamos e visto pelo
-- NOT EXISTS. Reconfere tambem os predicados de rascunho avulso, pois o post
-- pode ter mudado desde a leitura do cron. Devolve os ids apagados.
CREATE OR REPLACE FUNCTION public.express_cleanup_delete_avulso_drafts(p_ids bigint[])
RETURNS bigint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted bigint[];
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN '{}'::bigint[];
  END IF;

  PERFORM 1 FROM workflow_posts wp
    WHERE wp.id = ANY (p_ids)
    ORDER BY wp.id
    FOR UPDATE;

  WITH del AS (
    DELETE FROM workflow_posts wp
     WHERE wp.id = ANY (p_ids)
       AND wp.is_express
       AND wp.workflow_id IS NULL
       AND wp.status = 'rascunho'
       AND NOT EXISTS (
         SELECT 1 FROM post_processes pp
          WHERE pp.post_id = wp.id AND pp.estado = 'ativo'
       )
    RETURNING wp.id
  )
  SELECT COALESCE(array_agg(id ORDER BY id), '{}'::bigint[]) INTO v_deleted FROM del;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.express_cleanup_delete_avulso_drafts(bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.express_cleanup_delete_avulso_drafts(bigint[]) TO service_role;
