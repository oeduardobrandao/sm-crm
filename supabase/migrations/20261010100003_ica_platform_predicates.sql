-- ============================================================
-- Automações de comentário: só post de Instagram é alvo (P1)
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
-- Com workflow_posts.platform = 'other' (post sem Instagram nem TikTok), os
-- testes "<> 'tiktok'" passaram a aceitar post só Geral. Os predicados viram
-- "IN ('instagram','both')" (inclusão) e "NOT IN ('instagram','both')"
-- (exclusão). Copy-forward VERBATIM das definições vigentes; só essas linhas
-- mudam. CREATE OR REPLACE preserva oid, grants e triggers.
-- ============================================================

-- reconcile_unlinked_automation_targets(): de 20260914000001_ica_target_unlinked.sql
CREATE OR REPLACE FUNCTION public.reconcile_unlinked_automation_targets()
RETURNS TABLE(marked int, cleared int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_marked int; v_cleared int;
BEGIN
  -- Carimba. As guardas de deriva sao as MESMAS do z3 e do sweep: o sistema
  -- nunca aborta e a deriva nunca marca.
  UPDATE instagram_comment_automations a
     SET target_unlinked_at = COALESCE(wp.published_at, wp.updated_at, now())
    FROM workflow_posts wp
   WHERE wp.id = a.workflow_post_id
     AND a.ig_media_id IS NULL
     AND a.target_unlinked_at IS NULL
     AND wp.status = 'postado'
     AND wp.instagram_media_id IS NULL
     AND wp.cliente_id = a.client_id
     AND wp.tipo <> 'stories'
     AND COALESCE(wp.platform, 'instagram') IN ('instagram','both');
  GET DIAGNOSTICS v_marked = ROW_COUNT;

  -- Limpa o que nao vale mais: media chegou, alvo mudou, ou o post saiu de
  -- 'postado'. Cobre tambem a automacao que virou global (workflow_post_id
  -- nulo), onde o LEFT JOIN nao acha post nenhum.
  UPDATE instagram_comment_automations a
     SET target_unlinked_at = NULL
   WHERE a.target_unlinked_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM workflow_posts wp
        WHERE wp.id = a.workflow_post_id
          AND a.ig_media_id IS NULL
          AND wp.status = 'postado'
          AND wp.instagram_media_id IS NULL
          AND wp.cliente_id = a.client_id
          AND wp.tipo <> 'stories'
          AND COALESCE(wp.platform, 'instagram') IN ('instagram','both')
     );
  GET DIAGNOSTICS v_cleared = ROW_COUNT;

  marked := v_marked; cleared := v_cleared;
  RETURN NEXT;
END $$;

-- Grants como na migration de origem (CREATE OR REPLACE ja os preserva).
REVOKE ALL ON FUNCTION public.reconcile_unlinked_automation_targets() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reconcile_unlinked_automation_targets() FROM anon;
REVOKE ALL ON FUNCTION public.reconcile_unlinked_automation_targets() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_unlinked_automation_targets() TO service_role;

-- resolve_ica_workflow_post_target(): de 20260914000001_ica_target_unlinked.sql
-- (trigger ica_a1_resolve_workflow_post_target nao e recriado; segue apontando
-- para o mesmo oid).
CREATE OR REPLACE FUNCTION resolve_ica_workflow_post_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo text; v_platform text; v_cliente bigint; v_media text; v_permalink text;
  v_found boolean;
  v_user_directed boolean;
BEGIN
  -- A CHECK ica_tombstone_inactive so proibe o par (ativo, tombstone) no
  -- estado FINAL da linha, entao um UNICO write que limpa o tombstone e ativa
  -- ao mesmo tempo -- sem escolher alvo -- passaria por ela e entregaria uma
  -- automacao GLOBAL ativa que ninguem pediu. O caminho legitimo e em dois
  -- passos e continua valendo: escolher "Todos os posts" limpa o tombstone sem
  -- ativar, e so depois o toggle reativa.
  IF TG_OP = 'UPDATE'
     AND OLD.pending_post_deleted_at IS NOT NULL
     AND NEW.pending_post_deleted_at IS NULL
     AND NEW.ativo
     AND NEW.ig_media_id IS NULL
     AND NEW.workflow_post_id IS NULL THEN
    RAISE EXCEPTION 'cannot clear tombstone and reactivate without a target in one write';
  END IF;

  -- Tombstone limpa SO quando um alvo novo nao-nulo e escolhido: o SET NULL da
  -- FK (post excluido) tambem dispara este trigger e nao pode apagar o
  -- tombstone que workflow_posts_z4 acabou de gravar.
  IF TG_OP = 'UPDATE'
     AND (NEW.ig_media_id IS NOT NULL OR NEW.workflow_post_id IS NOT NULL)
     AND (NEW.ig_media_id IS DISTINCT FROM OLD.ig_media_id
          OR NEW.workflow_post_id IS DISTINCT FROM OLD.workflow_post_id) THEN
    NEW.pending_post_deleted_at := NULL;
  END IF;

  -- Alvo orfao: limpa em QUALQUER mudanca de alvo dirigida pelo usuario.
  -- Condicao deliberadamente MAIS LARGA que a do tombstone acima: sem a guarda
  -- (NEW.ig_media_id IS NOT NULL OR NEW.workflow_post_id IS NOT NULL), porque
  -- trocar um orfao para "Todos os posts" zera os dois campos e tambem precisa
  -- limpar a marca, senao a automacao vira global carregando um aviso morto.
  IF TG_OP = 'UPDATE'
     AND (NEW.ig_media_id IS DISTINCT FROM OLD.ig_media_id
          OR NEW.workflow_post_id IS DISTINCT FROM OLD.workflow_post_id) THEN
    NEW.target_unlinked_at := NULL;
  END IF;

  IF NEW.workflow_post_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- SELECT simples DE PROPOSITO (sem FOR SHARE/FOR UPDATE):
  -- mark_platform_published trava workflow_posts FOR UPDATE e o z3 (AFTER)
  -- atualiza automacoes (ordem post -> automacao). Um lock aqui inverteria a
  -- ordem (automacao -> post) e formaria deadlock com a publicacao; se a
  -- publicacao fosse a vitima, o Graph ja publicou mas o handler registraria
  -- falha_publicacao. A janela MVCC residual e fechada pelo sweep do cron.
  SELECT wp.tipo, wp.platform, wp.cliente_id, wp.instagram_media_id, wp.instagram_permalink
    INTO v_tipo, v_platform, v_cliente, v_media, v_permalink
  FROM workflow_posts wp
  WHERE wp.id = NEW.workflow_post_id AND wp.conta_id = NEW.conta_id;
  v_found := FOUND;

  -- Escrita dirigida pelo usuario = INSERT, ou UPDATE que mexe no ALVO
  -- (workflow_post_id) ou no CLIENTE (client_id). Os dois buracos que a
  -- revisao original apontou continuam fechados: INSERT com workflow_post_id E
  -- ig_media_id valida, e trocar so client_id no estado Ligado revalida. O que
  -- deixa de validar sao os UPDATEs de maquina: o do z3 (toca ig_media_id) e o
  -- do z4 (toca ativo), que nao escolhem alvo nenhum.
  v_user_directed := TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE'
        AND (NEW.workflow_post_id IS DISTINCT FROM OLD.workflow_post_id
             OR NEW.client_id IS DISTINCT FROM OLD.client_id));

  IF v_user_directed THEN
    IF NOT v_found THEN
      RAISE EXCEPTION 'instagram automation target post not found in workspace';
    END IF;
    -- A FK composta so garante mesmo workspace; owner/admin via PostgREST
    -- poderia apontar para post de OUTRO cliente do mesmo tenant.
    IF v_cliente IS DISTINCT FROM NEW.client_id THEN
      RAISE EXCEPTION 'instagram automation target post belongs to another client';
    END IF;
    IF COALESCE(v_platform, 'instagram') NOT IN ('instagram','both') THEN
      RAISE EXCEPTION 'instagram automation target must be an instagram post';
    END IF;
    IF v_tipo = 'stories' THEN
      RAISE EXCEPTION 'instagram automation target cannot be a stories post';
    END IF;
  END IF;

  -- Preenchimento com as MESMAS guardas, agora silenciosas: alvo derivado (ou
  -- sumido) nunca liga a automacao, so a deixa pendente. Aqui nao pode haver
  -- RAISE -- este bloco tambem roda nos caminhos de maquina.
  IF v_found
     AND NEW.ig_media_id IS NULL
     AND v_media IS NOT NULL
     AND v_cliente IS NOT DISTINCT FROM NEW.client_id
     AND COALESCE(v_platform, 'instagram') IN ('instagram','both')
     AND v_tipo <> 'stories' THEN
    NEW.ig_media_id := v_media;
    NEW.media_permalink := COALESCE(NEW.media_permalink, v_permalink);
  END IF;
  RETURN NEW;
END $$;

-- link_pending_instagram_automations(): de 20260830000002_avulso_claim_reorder_ica.sql
CREATE OR REPLACE FUNCTION link_pending_instagram_automations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Guardas de deriva: o post pode ter virado stories ou so-TikTok depois que
  -- a automacao o escolheu. Sai calado -- a publicacao nao pode falhar por
  -- causa disso, e a automacao fica pendente ate o usuario reescolher.
  IF NEW.tipo = 'stories' OR COALESCE(NEW.platform, 'instagram') NOT IN ('instagram','both') THEN
    RETURN NULL;
  END IF;

  -- O ramo do OR e obrigatorio: a publicacao grava instagram_media_id primeiro
  -- (liga a automacao) e o permalink num UPDATE separado DEPOIS; sem o OR o
  -- segundo UPDATE nao alcancaria a automacao ja ligada e o permalink ficaria
  -- nulo para sempre.
  -- A comparacao NEW.cliente_id = a.client_id e a terceira guarda de deriva:
  -- workflow movido para outro cliente nao pode ligar a automacao do cliente
  -- antigo.
  UPDATE instagram_comment_automations a
     SET ig_media_id     = COALESCE(a.ig_media_id, NEW.instagram_media_id),
         media_permalink = COALESCE(a.media_permalink, NEW.instagram_permalink),
         media_caption   = COALESCE(a.media_caption, NULLIF(left(NEW.ig_caption, 300), ''))
   WHERE a.workflow_post_id = NEW.id
     AND (a.ig_media_id IS NULL
          OR (a.media_permalink IS NULL AND NEW.instagram_permalink IS NOT NULL))
     AND NEW.cliente_id = a.client_id;
  RETURN NULL;
END $$;

-- sweep_pending_instagram_automation_links(): de 20260830000002_avulso_claim_reorder_ica.sql
CREATE OR REPLACE FUNCTION sweep_pending_instagram_automation_links()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  UPDATE instagram_comment_automations a
     SET ig_media_id     = COALESCE(a.ig_media_id, wp.instagram_media_id),
         media_permalink = COALESCE(a.media_permalink, wp.instagram_permalink),
         media_caption   = COALESCE(a.media_caption, NULLIF(left(wp.ig_caption, 300), ''))
    FROM workflow_posts wp
   WHERE wp.id = a.workflow_post_id
     AND a.ig_media_id IS NULL
     AND wp.instagram_media_id IS NOT NULL
     -- mesmas guardas de deriva do z3: o cron nao liga o que o trigger recusou
     AND wp.cliente_id = a.client_id
     AND wp.tipo <> 'stories'
     AND COALESCE(wp.platform, 'instagram') IN ('instagram','both');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- service_role only, como na migration de origem.
REVOKE ALL ON FUNCTION sweep_pending_instagram_automation_links() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sweep_pending_instagram_automation_links() TO service_role;
