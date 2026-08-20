-- Triggers do alvo "post em producao" (colunas na 20260820000002):
--   (a) resolver/validador na propria automacao;
--   (b) z3 em workflow_posts: liga a automacao pendente quando o post publica;
--   (c) z4 em workflow_posts: tombstone quando o post e excluido antes disso;
--   (d) RPC de sweep, rede de seguranca do cron para a janela MVCC do resolver.

-- ---------- (a) resolver/validador na automacao -----------------------------
CREATE OR REPLACE FUNCTION resolve_ica_workflow_post_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tipo text; v_platform text; v_cliente bigint; v_media text; v_permalink text;
BEGIN
  -- Tombstone limpa SO quando um alvo novo nao-nulo e escolhido: o SET NULL da
  -- FK (post excluido) tambem dispara este trigger e nao pode apagar o
  -- tombstone que workflow_posts_z4 acabou de gravar.
  IF TG_OP = 'UPDATE'
     AND (NEW.ig_media_id IS NOT NULL OR NEW.workflow_post_id IS NOT NULL)
     AND (NEW.ig_media_id IS DISTINCT FROM OLD.ig_media_id
          OR NEW.workflow_post_id IS DISTINCT FROM OLD.workflow_post_id) THEN
    NEW.pending_post_deleted_at := NULL;
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
  SELECT wp.tipo, wp.platform, w.cliente_id, wp.instagram_media_id, wp.instagram_permalink
    INTO v_tipo, v_platform, v_cliente, v_media, v_permalink
  FROM workflow_posts wp
  JOIN workflows w ON w.id = wp.workflow_id
  WHERE wp.id = NEW.workflow_post_id AND wp.conta_id = NEW.conta_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'instagram automation target post not found in workspace';
  END IF;
  -- A FK composta so garante mesmo workspace; owner/admin via PostgREST
  -- poderia apontar para post de OUTRO cliente do mesmo tenant.
  IF v_cliente IS DISTINCT FROM NEW.client_id THEN
    RAISE EXCEPTION 'instagram automation target post belongs to another client';
  END IF;
  IF COALESCE(v_platform, 'instagram') = 'tiktok' THEN
    RAISE EXCEPTION 'instagram automation target cannot be a tiktok-only post';
  END IF;
  IF v_tipo = 'stories' THEN
    RAISE EXCEPTION 'instagram automation target cannot be a stories post';
  END IF;

  -- So o preenchimento depende de ig_media_id nulo; as validacoes acima rodam
  -- SEMPRE que ha workflow_post_id (cobre o estado Ligado e INSERT com ambos).
  IF NEW.ig_media_id IS NULL AND v_media IS NOT NULL THEN
    NEW.ig_media_id := v_media;
    NEW.media_permalink := COALESCE(NEW.media_permalink, v_permalink);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER ica_a1_resolve_workflow_post_target
  BEFORE INSERT OR UPDATE OF workflow_post_id, ig_media_id, ativo, client_id
  ON instagram_comment_automations
  FOR EACH ROW EXECUTE FUNCTION resolve_ica_workflow_post_target();

-- ---------- (b) ligacao na publicacao ---------------------------------------
CREATE OR REPLACE FUNCTION link_pending_instagram_automations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- O ramo do OR e obrigatorio: a publicacao grava instagram_media_id primeiro
  -- (liga a automacao) e o permalink num UPDATE separado DEPOIS; sem o OR o
  -- segundo UPDATE nao alcancaria a automacao ja ligada e o permalink ficaria
  -- nulo para sempre.
  UPDATE instagram_comment_automations a
     SET ig_media_id     = COALESCE(a.ig_media_id, NEW.instagram_media_id),
         media_permalink = COALESCE(a.media_permalink, NEW.instagram_permalink),
         media_caption   = COALESCE(a.media_caption, NULLIF(left(NEW.ig_caption, 300), ''))
   WHERE a.workflow_post_id = NEW.id
     AND (a.ig_media_id IS NULL
          OR (a.media_permalink IS NULL AND NEW.instagram_permalink IS NOT NULL));
  RETURN NULL;
END $$;

-- WHEN com IS DISTINCT FROM e essencial: mark_platform_published e
-- record_post_status_change SEMPRE mencionam estas colunas no SET
-- (CASE ... ELSE manter), entao UPDATE OF sozinho dispararia em toda mudanca
-- de status; e o fallback de stories grava instagram_media_id NULL explicito.
CREATE TRIGGER workflow_posts_z3_link_ig_automations
  AFTER UPDATE OF instagram_media_id, instagram_permalink ON workflow_posts
  FOR EACH ROW
  WHEN (NEW.instagram_media_id IS NOT NULL
        AND (OLD.instagram_media_id IS DISTINCT FROM NEW.instagram_media_id
             OR OLD.instagram_permalink IS DISTINCT FROM NEW.instagram_permalink))
  EXECUTE FUNCTION link_pending_instagram_automations();

-- ---------- (c) tombstone no DELETE do post ---------------------------------
-- BEFORE DELETE: roda antes da acao referencial da FK (o SET NULL que apagaria
-- o ponteiro), entao ainda enxerga quais automacoes apontavam para o post.
CREATE OR REPLACE FUNCTION tombstone_pending_instagram_automations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Pendente (ig_media_id nulo) NUNCA pode virar "todos os posts" silencioso:
  -- desativa e marca tombstone; a CHECK ica_tombstone_inactive impede reativar
  -- ate o usuario escolher novo alvo. Automacao ja ligada sobrevive intacta
  -- (so o ponteiro cai via SET NULL da FK).
  UPDATE instagram_comment_automations a
     SET ativo = false, pending_post_deleted_at = now()
   WHERE a.workflow_post_id = OLD.id AND a.ig_media_id IS NULL;
  RETURN OLD;
END $$;

CREATE TRIGGER workflow_posts_z4_tombstone_ig_automations
  BEFORE DELETE ON workflow_posts
  FOR EACH ROW EXECUTE FUNCTION tombstone_pending_instagram_automations();

-- ---------- (d) sweep (chamado pelo instagram-automation-cron) ---------------
-- Rede de seguranca da janela MVCC do resolver: se a publicacao commitou
-- DEPOIS do SELECT do resolver mas ANTES do commit da automacao, o z3 nao viu
-- a automacao e o resolver nao viu o media ID. O sweep religa no proximo tick.
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
     AND wp.instagram_media_id IS NOT NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- service_role only. REVOKE FROM PUBLIC tambem tira o default do service_role:
-- o GRANT explicito abaixo e obrigatorio (gotcha da casa, 20260806000002).
REVOKE ALL ON FUNCTION sweep_pending_instagram_automation_links() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sweep_pending_instagram_automation_links() TO service_role;
