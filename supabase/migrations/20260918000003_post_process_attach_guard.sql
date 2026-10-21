-- Um post com execucao vigente (ativo ou concluido) em post_processes nao
-- pode ganhar workflow_id: os quatro caminhos que colocam post em fluxo
-- (attach_posts_to_flow, move_posts_to_new_flow, move_posts_to_existing_flow
-- e qualquer UPDATE com app.allow_post_move) passam por este trigger, que
-- dispara DEPOIS de post_a0_sync_cliente (ordem alfabetica). A RPC da fase 2
-- que vincula encerra a execucao antes do attach, na mesma transacao, e por
-- isso passa. Nao usa GUC de escape: o guard vale para todo mundo. A
-- serializacao com a criacao de processo vem do FOR SHARE em
-- post_processes_requires_avulso; este guard nao precisa de lock proprio
-- porque o UPDATE de workflow_id ja segura a linha do post.
CREATE OR REPLACE FUNCTION public.post_a1_process_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF new.workflow_id IS NOT NULL
     AND new.workflow_id IS DISTINCT FROM old.workflow_id
     AND EXISTS (
       SELECT 1 FROM post_processes pp
        WHERE pp.post_id = new.id
          AND pp.conta_id = old.conta_id
          AND pp.estado IN ('ativo', 'concluido')
     ) THEN
    RAISE EXCEPTION 'post_has_active_process' USING ERRCODE = 'P0001';
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS post_a1_process_guard ON public.workflow_posts;
CREATE TRIGGER post_a1_process_guard
  BEFORE UPDATE OF workflow_id ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.post_a1_process_guard();
