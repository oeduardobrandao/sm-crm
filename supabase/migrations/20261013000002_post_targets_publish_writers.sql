-- ============================================================
-- P4 (2/3): writers do estado de publicação em post_targets.
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
--   §2c (recompute), §2d (writers + mark_platform_published), §2e (reset).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 2).
--
-- Toda transição do TikTok que muda o status do post passa por aqui, numa
-- transação só: trava o post (FOR UPDATE), escreve o destino, recalcula o
-- status do post via record_post_status_change (eventos e automações seguem).
-- Em P4 os writers só aceitam 'tiktok' (o estado do Instagram segue legado até P5).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ---------- c. recompute ---------------------------------------------------
-- Interno: o chamador já segura a trava do post. Só age em agendado /
-- falha_publicacao; postado nunca rebaixa e os status anteriores são do usuário.
-- Instagram (legado até P5): publicado = instagram_media_id; falha =
-- post em falha_publicacao com publish_error (um retry do IG em voo, com o post
-- de volta em agendado e publish_error ainda setado, conta como em andamento).
-- Presença do Instagram: linha em post_targets OU platform legado instagram/both
-- (platform é derivado dos destinos desde P1; o OR só evita prender um post IG
-- cujo destino faltasse por drift). Geral é ignorado.
CREATE OR REPLACE FUNCTION public.recompute_post_publish_status(
  p_post_id bigint,
  p_source  text,
  p_actor   uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post   public.workflow_posts%ROWTYPE;
  v_states text[] := ARRAY[]::text[];
  v_tt     text;
  v_target text;
BEGIN
  SELECT * INTO v_post FROM public.workflow_posts WHERE id = p_post_id;
  IF NOT FOUND OR v_post.status NOT IN ('agendado','falha_publicacao') THEN
    RETURN NULL;
  END IF;

  SELECT t.status INTO v_tt
    FROM public.post_targets t
   WHERE t.post_id = p_post_id AND t.platform = 'tiktok';
  IF FOUND THEN
    v_states := v_states || v_tt;
  END IF;

  IF v_post.platform IN ('instagram','both')
     OR EXISTS (SELECT 1 FROM public.post_targets t
                 WHERE t.post_id = p_post_id AND t.platform = 'instagram') THEN
    v_states := v_states || CASE
      WHEN v_post.instagram_media_id IS NOT NULL THEN 'publicado'
      WHEN v_post.status = 'falha_publicacao' AND v_post.publish_error IS NOT NULL THEN 'falha'
      ELSE 'em_andamento'
    END;
  END IF;

  IF cardinality(v_states) = 0 THEN
    RETURN NULL;
  END IF;

  v_target := CASE
    WHEN 'falha' = ANY (v_states) THEN 'falha_publicacao'
    WHEN v_states <@ ARRAY['publicado'] THEN 'postado'
    ELSE 'agendado'
  END;

  IF v_target IS DISTINCT FROM v_post.status THEN
    PERFORM public.record_post_status_change(
      p_post_id, v_target, p_source, p_actor, NULL,
      CASE WHEN v_target = 'postado'
           THEN jsonb_build_object('published_at', COALESCE(v_post.published_at, now()))
           ELSE '{}'::jsonb END);
  END IF;
  RETURN v_target;
END $$;
REVOKE ALL ON FUNCTION public.recompute_post_publish_status(bigint, text, uuid) FROM public, anon, authenticated;

-- ---------- d. writers -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_target_published(
  p_post_id  bigint,
  p_platform text,
  p_fields   jsonb DEFAULT '{}'::jsonb,
  p_source   text  DEFAULT 'system',
  p_actor    uuid  DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fields jsonb := COALESCE(p_fields, '{}'::jsonb);
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  PERFORM 1 FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;

  UPDATE public.post_targets SET
    status        = 'publicado',
    external_id   = COALESCE(v_fields->>'external_id', external_id),
    permalink     = COALESCE(v_fields->>'permalink', permalink),
    published_at  = COALESCE(published_at, (v_fields->>'published_at')::timestamptz, now()),
    processing_at = NULL,
    error         = NULL,
    error_code    = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'target_not_found';
  END IF;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);
END $$;
REVOKE ALL ON FUNCTION public.mark_target_published(bigint, text, jsonb, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_target_published(bigint, text, jsonb, text, uuid) TO service_role;

-- Idempotente: uma linha já em falha carrega o publish_ref do publish que falhou
-- (só requeue_target limpa a ref, e só o init seguinte grava uma nova), então
-- "já está em falha" = "este publish já foi contado". publicado nunca rebaixa.
CREATE OR REPLACE FUNCTION public.mark_target_failed(
  p_post_id    bigint,
  p_platform   text,
  p_error      text,
  p_error_code text,
  p_retryable  boolean,
  p_source     text DEFAULT 'system',
  p_actor      uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_status text;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  PERFORM 1 FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;
  SELECT status INTO v_status FROM public.post_targets
   WHERE post_id = p_post_id AND platform = p_platform FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'target_not_found';
  END IF;
  IF v_status IN ('falha','publicado') THEN
    RETURN false;
  END IF;

  UPDATE public.post_targets SET
    status        = 'falha',
    error         = left(p_error, 500),
    error_code    = p_error_code,
    retry_count   = CASE WHEN p_retryable THEN retry_count + 1 ELSE 3 END,
    processing_at = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.mark_target_failed(bigint, text, text, text, boolean, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_target_failed(bigint, text, text, text, boolean, text, uuid) TO service_role;

-- Reenvio (manual e fase retry do cron): falha -> agendado, mantém retry_count.
-- O recompute leva o post a agendado, a menos que outro destino siga em falha.
CREATE OR REPLACE FUNCTION public.requeue_target(
  p_post_id  bigint,
  p_platform text,
  p_source   text DEFAULT 'system',
  p_actor    uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_status text;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  SELECT status INTO v_post_status FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND OR v_post_status NOT IN ('agendado','falha_publicacao') THEN
    RETURN false;
  END IF;

  UPDATE public.post_targets SET
    status        = 'agendado',
    error         = NULL,
    error_code    = NULL,
    publish_ref   = NULL,
    processing_at = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform AND status = 'falha';
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.requeue_target(bigint, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.requeue_target(bigint, text, text, uuid) TO service_role;

-- Publicar agora: aceita post em aprovado_cliente OU agendado (o publicar agora
-- do Instagram pode ter rodado antes: bug 1) e destino pendente/agendado.
-- false = trava fresca (outro processo publicando). Ao tomar a trava, carimba
-- scheduled_at = now() no post, na mesma transação.
CREATE OR REPLACE FUNCTION public.begin_target_publish(
  p_post_id  bigint,
  p_platform text,
  p_source   text,
  p_actor    uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_status text;
  v_status      text;
  v_lock        timestamptz;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  SELECT status INTO v_post_status FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;
  SELECT status, processing_at INTO v_status, v_lock FROM public.post_targets
   WHERE post_id = p_post_id AND platform = p_platform FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_not_found';
  END IF;
  IF v_status = 'processando' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_publishing';
  END IF;
  IF v_status = 'publicado' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_published';
  END IF;
  IF v_post_status NOT IN ('aprovado_cliente','agendado') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'post_not_publishable';
  END IF;
  IF v_status NOT IN ('pendente','agendado') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_not_ready';
  END IF;
  IF v_lock IS NOT NULL AND v_lock >= now() - interval '10 minutes' THEN
    RETURN false;
  END IF;

  -- Publicar agora carimba scheduled_at = now(), como o instagram-publish
  -- (handler.ts:225,304,363): se o init falhar e o destino for re-enfileirado, o
  -- claim (scheduled_at <= now(), 20261013000003) o pega no próximo ciclo em vez de
  -- esperar uma data futura ou nula.
  IF v_post_status = 'aprovado_cliente' THEN
    PERFORM public.record_post_status_change(p_post_id, 'agendado', p_source, p_actor, NULL,
      jsonb_build_object('scheduled_at', now()));
  ELSE
    UPDATE public.workflow_posts SET scheduled_at = now() WHERE id = p_post_id;
  END IF;
  UPDATE public.post_targets SET processing_at = now(), updated_at = now()
   WHERE post_id = p_post_id AND platform = p_platform;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.begin_target_publish(bigint, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_target_publish(bigint, text, text, uuid) TO service_role;

-- Cancelar agendamento: só post agendado (regra de hoje). Recusa destino
-- publicando (processando ou trava fresca) e publicado. Para post que também
-- vai ao Instagram, limpa os mesmos campos do IG que o handler limpava
-- (tiktok-publish/handler.ts:330-332).
CREATE OR REPLACE FUNCTION public.cancel_target_publish(
  p_post_id  bigint,
  p_platform text,
  p_source   text,
  p_actor    uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_status text;
  v_status      text;
  v_lock        timestamptz;
  v_fields      jsonb := '{}'::jsonb;
BEGIN
  IF p_platform IS DISTINCT FROM 'tiktok' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'unsupported_platform';
  END IF;
  SELECT status INTO v_post_status FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'post_not_found';
  END IF;
  IF v_post_status <> 'agendado' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'post_not_scheduled';
  END IF;
  SELECT status, processing_at INTO v_status, v_lock FROM public.post_targets
   WHERE post_id = p_post_id AND platform = p_platform FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_not_found';
  END IF;
  IF v_status = 'processando'
     OR (v_lock IS NOT NULL AND v_lock >= now() - interval '10 minutes') THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_publishing';
  END IF;
  IF v_status = 'publicado' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0422', MESSAGE = 'target_published';
  END IF;

  UPDATE public.post_targets SET
    status        = 'pendente',
    publish_ref   = NULL,
    error         = NULL,
    error_code    = NULL,
    processing_at = NULL,
    updated_at    = now()
  WHERE post_id = p_post_id AND platform = p_platform;

  IF EXISTS (SELECT 1 FROM public.post_targets
              WHERE post_id = p_post_id AND platform = 'instagram') THEN
    -- NULL::text: jsonb_build_object com NULL sem tipo é "unknown" (ambiguidade
    -- de tipo em alguns contextos); tipado, cada chave vira JSON null.
    v_fields := jsonb_build_object(
      'instagram_container_id', NULL::text,
      'publish_processing_at',  NULL::text,
      'publish_error',          NULL::text,
      'publish_error_code',     NULL::text);
  END IF;
  PERFORM public.record_post_status_change(p_post_id, 'aprovado_cliente', p_source, p_actor, NULL, v_fields);
END $$;
REVOKE ALL ON FUNCTION public.cancel_target_publish(bigint, text, text, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_target_publish(bigint, text, text, uuid) TO service_role;

-- ---------- mark_platform_published copiado para frente ---------------------
-- Canônica: 20260807000001_publish_error_code.sql:67-120 (grants refeitos em
-- 20260925000001:53-54). Mudanças marcadas com -- P4:.
--   * ramo TikTok delega a mark_target_published, traduzindo as chaves legadas
--     que os callers de hoje mandam (tiktok_post_id -> external_id,
--     tiktok_post_url -> permalink, published_at passa direto): uma versão
--     antiga de função ainda no ar durante o deploy cai no destino;
--   * ramo Instagram mantém as escritas legadas e chama o recompute no lugar do
--     ig_done/tt_done inline (que lia tiktok_publish_status, agora congelado).
CREATE OR REPLACE FUNCTION public.mark_platform_published(
  p_post_id  bigint,
  p_platform text,
  p_source   text  DEFAULT 'system',
  p_actor    uuid  DEFAULT NULL,
  p_fields   jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$  -- P4: pg_temp
BEGIN
  IF p_platform NOT IN ('instagram','tiktok') THEN
    RAISE EXCEPTION 'mark_platform_published: invalid platform %', p_platform;
  END IF;

  IF p_platform = 'tiktok' THEN  -- P4: delega ao destino
    PERFORM public.mark_target_published(
      p_post_id, 'tiktok',
      jsonb_strip_nulls(jsonb_build_object(
        'external_id',  p_fields->>'tiktok_post_id',
        'permalink',    p_fields->>'tiktok_post_url',
        'published_at', p_fields->>'published_at')),
      p_source, p_actor);
    RETURN;
  END IF;

  PERFORM 1 FROM public.workflow_posts WHERE id = p_post_id FOR UPDATE;  -- P4: trava antes do recompute
  UPDATE public.workflow_posts SET
    instagram_media_id    = COALESCE(p_fields->>'instagram_media_id', instagram_media_id),
    instagram_permalink   = COALESCE(p_fields->>'instagram_permalink', instagram_permalink),
    published_at          = COALESCE((p_fields->>'published_at')::timestamptz, published_at),
    publish_processing_at = NULL,
    publish_error         = NULL,
    publish_error_code    = NULL,
    publish_retry_count   = 0
  WHERE id = p_post_id;

  PERFORM public.recompute_post_publish_status(p_post_id, p_source, p_actor);  -- P4: no lugar de ig_done/tt_done
END;
$$;
REVOKE ALL ON FUNCTION public.mark_platform_published(bigint, text, text, uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_platform_published(bigint, text, text, uuid, jsonb) TO service_role;

-- ---------- e. reset ao sair de publicação ----------------------------------
-- Post sai de agendado/falha_publicacao/postado: destino TikTok em falha ou
-- agendado volta a pendente, limpo (bug 3). processando e publicado nunca são
-- tocados: a fase status do cron não filtra o status do post e termina o publish.
-- Sem GUC de recursão: escreve só status/erro em post_targets, e
-- post_targets_sync_platform só dispara em INSERT/DELETE/UPDATE OF platform, post_id.
CREATE OR REPLACE FUNCTION public.workflow_posts_reset_tiktok_target()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status NOT IN ('agendado','falha_publicacao','postado') THEN
    UPDATE public.post_targets SET
      status      = 'pendente',
      error       = NULL,
      error_code  = NULL,
      publish_ref = NULL,
      retry_count = 0,
      updated_at  = now()
    WHERE post_id = NEW.id AND platform = 'tiktok' AND status IN ('falha','agendado');
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_reset_tiktok_target() FROM public, anon, authenticated;

-- WHEN obrigatório: record_post_status_change sempre grava status.
CREATE TRIGGER workflow_posts_z9_reset_tiktok_target
  AFTER UPDATE OF status ON public.workflow_posts
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.workflow_posts_reset_tiktok_target();
