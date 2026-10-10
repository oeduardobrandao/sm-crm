-- ============================================================
-- P4 (3/3): claim do TikTok por destino + guardas copiadas para frente.
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
--   §2f (claim), §2g (reorder_post_schedules, post_file_link_replace).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 3).
-- ============================================================

SET LOCAL lock_timeout = '5s';

-- ---------- f. claim por destino --------------------------------------------
-- init:   data vencida (scheduled_at <= now(), spec §2f) E destino re-enfileirado
--         (agendado) com post em agendado/falha_publicacao, ou destino pendente com
--         post agendado. Um reenvio de publicar-agora tem data vencida porque
--         begin_target_publish carimba scheduled_at = now() (20261013000002).
-- status: destino processando com publish_ref, sem filtro de status do post (um
--         publish em voo termina mesmo se o post foi movido).
-- retry:  destino falha, retry_count < 3, post em agendado/falha_publicacao; o cron
--         chama requeue_target.
-- A conta ativa entra no CTE antes do FOR UPDATE SKIP LOCKED: processing_at só é
-- carimbado em linha devolvida. Trava post e destino (OF wp, t): post_file_link_replace
-- e os writers serializam na linha do post (20260916000001:67-69).
-- Ordem das travas: os rowmarks travam na ordem do FROM, t e depois wp (os writers
-- travam wp e depois t). Se t trava e wp está ocupado, SKIP LOCKED pula a linha do
-- join mas a trava de t FICA até o fim da transação do statement. Isso só é seguro
-- porque o claim roda na própria transação autocommit (uma chamada rpc do cron): ela
-- termina logo, o writer que esperava por t segue, e como SKIP LOCKED nunca espera
-- não há deadlock. NUNCA chame este claim dentro de uma transação mais longa.
CREATE OR REPLACE FUNCTION public.claim_tiktok_targets_for_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id           bigint,
  conta_id          uuid,
  cliente_id        bigint,
  tipo              text,
  scheduled_at      timestamptz,
  caption           text,
  tiktok_title      text,
  tiktok_settings   jsonb,
  tiktok_username   text,
  tiktok_account_id uuid,
  target_id         bigint,
  publish_ref       text,
  retry_count       int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF p_phase IS NULL OR p_phase NOT IN ('init','status','retry') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid_phase';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT t.id AS c_target_id, wp.id AS c_post_id, ta.id AS c_account_id, ta.username AS c_username
      FROM public.post_targets t
      JOIN public.workflow_posts wp ON wp.id = t.post_id
      JOIN public.tiktok_accounts ta
        ON ta.client_id = wp.cliente_id AND ta.authorization_status = 'active'
     WHERE t.platform = 'tiktok'
       AND CASE p_phase
         WHEN 'init' THEN
              wp.scheduled_at <= now()
              AND (   (t.status = 'agendado' AND wp.status IN ('agendado','falha_publicacao'))
                   OR (t.status = 'pendente' AND wp.status = 'agendado'))
         WHEN 'status' THEN
              t.status = 'processando' AND t.publish_ref IS NOT NULL
         WHEN 'retry' THEN
              t.status = 'falha' AND t.retry_count < 3
              AND wp.status IN ('agendado','falha_publicacao')
       END
       AND (t.processing_at IS NULL OR t.processing_at < now() - interval '10 minutes')
     ORDER BY wp.scheduled_at, t.id
     LIMIT p_limit
     FOR UPDATE OF wp, t SKIP LOCKED
  ),
  stamped AS (
    UPDATE public.post_targets u
       SET processing_at = now(), updated_at = now()
      FROM candidates c
     WHERE u.id = c.c_target_id
    RETURNING u.id AS s_target_id, u.publish_ref AS s_publish_ref, u.retry_count AS s_retry_count
  )
  SELECT wp.id::bigint,
         wp.conta_id::uuid,
         wp.cliente_id::bigint,
         wp.tipo::text,
         wp.scheduled_at::timestamptz,
         COALESCE(wp.tiktok_caption, wp.ig_caption, '')::text,
         wp.tiktok_title::text,
         wp.tiktok_settings::jsonb,
         c.c_username::text,
         c.c_account_id::uuid,
         s.s_target_id::bigint,
         s.s_publish_ref::text,
         s.s_retry_count::int
    FROM stamped s
    JOIN candidates c ON c.c_target_id = s.s_target_id
    JOIN public.workflow_posts wp ON wp.id = c.c_post_id
   ORDER BY wp.scheduled_at, s.s_target_id;
END $$;
REVOKE ALL ON FUNCTION public.claim_tiktok_targets_for_publishing(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tiktok_targets_for_publishing(text, int) TO service_role;

-- ---------- claim antigo vira no-op ------------------------------------------
-- Canônica: 20260830000002_avulso_claim_reorder_ica.sql:139-214. Assinatura,
-- nomes de parâmetro, default e RETURNS TABLE idênticos (CREATE OR REPLACE exige);
-- o corpo passa a não devolver nada. Um cron ainda na versão antiga entre a
-- migration e o deploy da função não claima nada, em vez de publicar a partir das
-- colunas congeladas. Um follow-up remove a função.
CREATE OR REPLACE FUNCTION public.claim_posts_for_tiktok_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  tipo text,
  scheduled_at timestamptz,
  caption text,
  tiktok_title text,
  tiktok_settings jsonb,
  tiktok_publish_id text,
  tiktok_publish_retry_count smallint,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  tiktok_account_id uuid,
  tiktok_open_id text,
  tiktok_username text,
  client_id bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$  -- P4: plpgsql no-op
BEGIN
  RETURN;  -- P4: substituído por claim_tiktok_targets_for_publishing
END $$;
REVOKE ALL ON FUNCTION public.claim_posts_for_tiktok_publishing(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_posts_for_tiktok_publishing(text, int) TO service_role;

-- ---------- g1. reorder_post_schedules copiado para frente --------------------
-- Canônica: 20260923000009_instagram_carousel_children.sql:77-218. Mudanças
-- marcadas com -- P4: search_path com pg_temp e a guarda de destino publicando
-- (processando, ou trava com menos de 10 min, a mesma janela da checagem do IG).
-- Vale para qualquer status do post: um destino processando pode estar num post
-- movido para aprovado_cliente no meio do publish.
CREATE OR REPLACE FUNCTION public.reorder_post_schedules(
  p_cliente_id       bigint,
  p_conta_id         uuid,
  p_updates          jsonb,
  p_allowed_statuses text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp  -- P4: pg_temp
AS $$
DECLARE
  v_ids       bigint[];
  v_count     int;
  v_owned     int;
  v_locked    bigint[];
  v_updated   int := 0;
  r           record;
  v_new_at    timestamptz;
  v_status    text;
  v_tipo      text;
  v_media_id  text;
  v_segments  jsonb;
BEGIN
  IF p_updates IS NULL
     OR jsonb_typeof(p_updates) <> 'array'
     OR jsonb_array_length(p_updates) = 0 THEN
    RAISE EXCEPTION 'BAD_REQUEST: empty updates';
  END IF;

  SELECT array_agg((e->>'post_id')::bigint) INTO v_ids
  FROM jsonb_array_elements(p_updates) e;

  -- A swap must reference each post at most once.
  IF (SELECT count(*) FROM unnest(v_ids)) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'BAD_REQUEST: duplicate post_id';
  END IF;
  v_count := array_length(v_ids, 1);

  -- Lock every owned target row up front, in a stable order, to serialize against
  -- claim_posts_for_publishing and any concurrent reorder.
  PERFORM 1
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.cliente_id = p_cliente_id
    AND wp.conta_id  = p_conta_id
  ORDER BY wp.id
  FOR UPDATE OF wp;

  -- Ownership: every id must resolve to a row owned by this client/account.
  SELECT count(*) INTO v_owned
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.cliente_id = p_cliente_id
    AND wp.conta_id  = p_conta_id;
  IF v_owned <> v_count THEN
    RAISE EXCEPTION 'FORBIDDEN: post outside token scope';
  END IF;

  -- Status allowlist — reject the whole batch if any post is not reschedulable.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND NOT (wp.status = ANY(p_allowed_statuses));
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: forbidden status: %', v_locked;
  END IF;

  -- Publishing safety: an agendado row the cron is actively working on is off-limits.
  SELECT array_agg(wp.id) INTO v_locked
  FROM workflow_posts wp
  WHERE wp.id = ANY(v_ids)
    AND wp.status = 'agendado'
    AND wp.publish_processing_at IS NOT NULL
    AND wp.publish_processing_at >= now() - interval '10 minutes';
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: publishing in progress: %', v_locked;
  END IF;

  -- P4: um destino publicando (processando ou com trava fresca) segura o post.
  SELECT array_agg(DISTINCT t.post_id) INTO v_locked
  FROM post_targets t
  WHERE t.post_id = ANY(v_ids)
    AND (t.status = 'processando'
         OR (t.processing_at IS NOT NULL
             AND t.processing_at >= now() - interval '10 minutes'));
  IF v_locked IS NOT NULL THEN
    RAISE EXCEPTION 'LOCKED: publishing in progress: %', v_locked;
  END IF;

  FOR r IN
    SELECT (e->>'post_id')::bigint AS pid, e->>'scheduled_at' AS at
    FROM jsonb_array_elements(p_updates) e
  LOOP
    v_new_at := CASE WHEN r.at IS NULL THEN NULL ELSE r.at::timestamptz END;

    SELECT wp.status, wp.tipo, wp.instagram_media_id, wp.story_segments
      INTO v_status, v_tipo, v_media_id, v_segments
    FROM workflow_posts wp
    WHERE wp.id = r.pid;

    IF v_status = 'agendado' THEN
      -- A scheduled post must keep a valid, not-immediate future slot.
      IF v_new_at IS NULL OR v_new_at < now() + interval '10 minutes' THEN
        RAISE EXCEPTION 'BAD_REQUEST: agendado needs a future date';
      END IF;

      IF v_tipo = 'stories' THEN
        -- Defense-in-depth: if any segment already published we must not move it;
        -- otherwise drop prepared containers so the cron rebuilds them near the new time.
        IF v_segments IS NOT NULL
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_segments) s WHERE s->>'media_id' IS NOT NULL) THEN
          RAISE EXCEPTION 'LOCKED: publishing in progress: {%}', r.pid;
        END IF;
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            story_segments = CASE
              WHEN v_segments IS NULL THEN NULL
              ELSE (
                SELECT jsonb_agg(jsonb_set(s, '{container_id}', 'null'::jsonb))
                FROM jsonb_array_elements(v_segments) s
              )
            END
        WHERE id = r.pid;
      ELSE
        -- Non-story: clear a prepared (not-yet-published) container so a fresh one
        -- is built near the new time; never touch an already-published media.
        -- Carousel children are dropped for the same reason: their Meta containers
        -- expire in 24h and the parent is rebuilt from them (this migration).
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            instagram_container_id = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE instagram_container_id
            END,
            carousel_children = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE carousel_children
            END
        WHERE id = r.pid;
      END IF;
    ELSE
      UPDATE workflow_posts SET scheduled_at = v_new_at WHERE id = r.pid;
    END IF;

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.reorder_post_schedules(bigint, uuid, jsonb, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reorder_post_schedules(bigint, uuid, jsonb, text[]) TO service_role;

-- ---------- g2. post_file_link_replace copiado para frente --------------------
-- Canônica: 20260916000001_post_file_link_replace.sql:32-122 (única definição).
-- Única mudança (-- P4:): a condição do TikTok lê o destino em vez das colunas
-- tiktok_* congeladas.
CREATE OR REPLACE FUNCTION public.post_file_link_replace(
  p_conta_id uuid,
  p_user_id uuid,
  p_link_id bigint,
  p_file_id bigint,
  p_expected_r2_key text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post_id bigint;
  v_post public.workflow_posts%ROWTYPE;
  v_link public.post_file_links%ROWTYPE;
  v_source public.files%ROWTYPE;
  v_target public.files%ROWTYPE;
BEGIN
  -- p_user_id is the validated JWT subject supplied by the service-role handler.
  -- Recheck both selectors and membership under locks, preventing revocation or
  -- workspace switching between the handler's authentication and the actual swap.
  PERFORM p.id FROM public.profiles p
    JOIN public.workspace_members m ON m.user_id = p.id AND m.workspace_id = p_conta_id
    WHERE p.id = p_user_id AND p.active_workspace_id = p_conta_id
    FOR SHARE OF p, m;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0403', MESSAGE = 'workspace_unavailable';
  END IF;
  IF p_link_id IS NULL OR p_link_id <= 0 OR p_file_id IS NULL OR p_file_id <= 0 OR
     p_expected_r2_key IS NULL OR btrim(p_expected_r2_key) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0400', MESSAGE = 'invalid_replacement';
  END IF;

  SELECT post_id INTO v_post_id FROM public.post_file_links
    WHERE id = p_link_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  -- Publishers claim/lock this same row before reading media. Serialize with them.
  SELECT * INTO v_post FROM public.workflow_posts
    WHERE id = v_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  SELECT * INTO v_link FROM public.post_file_links
    WHERE id = p_link_id AND post_id = v_post_id AND conta_id = p_conta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;

  PERFORM id FROM public.files WHERE id IN (v_link.file_id, p_file_id) ORDER BY id FOR UPDATE;
  SELECT * INTO v_source FROM public.files WHERE id = v_link.file_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  SELECT * INTO v_target FROM public.files WHERE id = p_file_id AND conta_id = p_conta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0404', MESSAGE = 'media_not_found';
  END IF;
  IF v_source.media_lost_at IS NOT NULL OR v_target.media_lost_at IS NOT NULL OR
     v_source.kind NOT IN ('image', 'video') OR v_source.kind <> v_target.kind OR
     v_target.r2_key NOT LIKE 'contas/' || p_conta_id::text || '/files/%' THEN
    RAISE EXCEPTION USING ERRCODE = 'P0400', MESSAGE = 'invalid_replacement';
  END IF;

  -- An uncertain response may be retried after the transaction already committed,
  -- even if the post has since been scheduled. This branch never changes any row.
  IF v_link.file_id = p_file_id THEN RETURN true; END IF;

  IF v_post.status IN ('agendado', 'postado') OR v_post.published_at IS NOT NULL OR
     v_post.instagram_media_id IS NOT NULL OR v_post.publish_processing_at IS NOT NULL OR
     EXISTS (SELECT 1 FROM public.post_targets t                          -- P4: destino TikTok
              WHERE t.post_id = v_post_id AND t.platform = 'tiktok'       -- P4
                AND (t.processing_at IS NOT NULL                          -- P4
                     OR t.status IN ('processando', 'publicado'))) OR     -- P4
     v_post.instagram_container_id IS NOT NULL OR v_post.story_segments IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'post_not_editable';
  END IF;
  IF v_source.r2_key IS DISTINCT FROM p_expected_r2_key THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'source_changed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.post_file_links WHERE post_id = v_post_id AND file_id = p_file_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'target_already_linked';
  END IF;

  -- Only file_id changes. Cover, ordering and link identity stay intact, while the
  -- UPDATE trigger transfers the reference count. Never garbage-collect the source.
  UPDATE public.post_file_links SET file_id = p_file_id WHERE id = p_link_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.post_file_link_replace(uuid, uuid, bigint, bigint, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_file_link_replace(uuid, uuid, bigint, bigint, text)
  TO service_role;
