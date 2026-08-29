-- Posts avulsos (fora de fluxo): claim, reorder e familia ICA. Task 2 do plano
-- .superpowers/sdd/2026-08-29-posts-avulsos-plan. Depende da 20260830000001
-- (workflow_posts.cliente_id sempre presente; igual ao cliente do workflow
-- enquanto anexado; workflow_id agora nullable para o post avulso).
--
-- Copy-forward: cada funcao abaixo e a definicao completa da sua canonica,
-- com APENAS a troca de "achar o cliente via JOIN workflows/clientes" por
-- "ler cliente_id direto de workflow_posts". Nenhuma mudanca de
-- comportamento para post anexado (cliente_id == cliente do workflow, pela
-- invariante da 20260830000001); post avulso deixa de ser descartado pelo
-- JOIN. Mensagens de erro e RETURNS TABLE identicos as canonicas.

-- ============================================================
-- 1) claim_posts_for_publishing
-- Canonica: origin/main:supabase/migrations/20260829000001_ig_trial_reels.sql
-- (superou 20260807000002_claim_skip_nonretryable.sql depois de escrito o
-- copy-forward original desta migration -- main mesclou o reel de teste com
-- a coluna ig_trial_strategy e o codigo TRIAL_INELIGIBLE antes deste branch
-- mesclar; como 20260830 > 20260829, sem este rebase nosso copy-forward
-- aplicaria por cima e reverteria silenciosamente o trial). Reconferido
-- verbatim contra a canonica: CASE p_phase, CTEs claimed/updated,
-- publish_processing_at, RETURNS TABLE (agora com ig_trial_strategy no
-- final), o DROP FUNCTION (mudanca de shape exige) e o NOT IN do retry (agora
-- com 'TRIAL_INELIGIBLE') ficam intactos. Unica troca: o SELECT final perde
-- "JOIN workflows w / JOIN clientes c" e passa a achar a conta IG por "JOIN
-- instagram_accounts ia ON ia.client_id = u.cliente_id", devolvendo
-- u.cliente_id AS client_id -- exatamente o join que, sem esta troca,
-- descartaria um post avulso preso em 'agendado' para sempre.
-- ============================================================
DROP FUNCTION IF EXISTS claim_posts_for_publishing(text, integer);
CREATE OR REPLACE FUNCTION claim_posts_for_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  ig_caption text,
  scheduled_at timestamptz,
  instagram_container_id text,
  instagram_media_id text,
  publish_retry_count smallint,
  tipo text,
  story_segments jsonb,
  encrypted_access_token text,
  instagram_user_id text,
  client_id bigint,
  ig_trial_strategy text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE
      wp.platform IN ('instagram','both')
      AND CASE p_phase
        WHEN 'container' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now() + interval '1 hour'
          AND wp.instagram_media_id IS NULL
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NULL)
            OR (wp.tipo = 'stories' AND (
              wp.story_segments IS NULL
              OR EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
            ))
          )
        WHEN 'publish' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now()
          AND wp.instagram_media_id IS NULL
          AND (
            (wp.tipo <> 'stories' AND wp.instagram_container_id IS NOT NULL)
            OR (wp.tipo = 'stories'
              AND wp.story_segments IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'container_id' IS NULL
              )
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(wp.story_segments) s
                WHERE s->>'media_id' IS NULL
              )
            )
          )
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.publish_retry_count < 3
          AND wp.instagram_media_id IS NULL
          AND (wp.publish_error_code IS NULL
               OR wp.publish_error_code NOT IN
                 ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED','TRIAL_INELIGIBLE'))
      END
      AND (wp.publish_processing_at IS NULL
           OR wp.publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id AS post_id,
    u.workflow_id,
    u.ig_caption,
    u.scheduled_at,
    u.instagram_container_id,
    u.instagram_media_id,
    u.publish_retry_count,
    u.tipo,
    u.story_segments,
    ia.encrypted_access_token,
    ia.instagram_user_id,
    u.cliente_id AS client_id,
    u.ig_trial_strategy
  FROM updated u
  JOIN instagram_accounts ia ON ia.client_id = u.cliente_id;
$$;
-- service_role only; FROM public sozinho nao basta em hosted Supabase, onde os
-- default privileges concedem EXECUTE direto a anon/authenticated (mesmo
-- gotcha documentado no bloco do sweep mais abaixo, 20260806000002) -- e o
-- DROP+CREATE acima reseta a ACL desta funcao para esses defaults.
REVOKE ALL ON FUNCTION claim_posts_for_publishing(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_posts_for_publishing(text, int) TO service_role;

-- ============================================================
-- 2) claim_posts_for_tiktok_publishing
-- Canonica: 20260720000005_tiktok_publishing.sql. Mesma reforma: o SELECT
-- final perde "JOIN workflows w / JOIN clientes c" e acha a conta TikTok por
-- "JOIN tiktok_accounts ta ON ta.client_id = u.cliente_id AND
-- ta.authorization_status = 'active'" (predicado conferido verbatim contra a
-- canonica), devolvendo u.cliente_id AS client_id.
-- ============================================================
CREATE OR REPLACE FUNCTION claim_posts_for_tiktok_publishing(
  p_phase text,          -- 'init' | 'status' | 'retry'
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  tipo text,
  scheduled_at timestamptz,
  caption text,                 -- tiktok_caption fallback ig_caption resolved here
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
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE wp.platform IN ('tiktok','both')
      AND CASE p_phase
        WHEN 'init' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now()
          AND wp.tiktok_publish_status IS NULL
        WHEN 'status' THEN
          wp.status = 'agendado'
          AND wp.tiktok_publish_status IN ('initiated','processing')
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.tiktok_publish_status = 'failed'
          AND wp.tiktok_publish_retry_count < 3
      END
      AND (wp.tiktok_publish_processing_at IS NULL
           OR wp.tiktok_publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET tiktok_publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id AS post_id,
    u.workflow_id,
    u.tipo,
    u.scheduled_at,
    COALESCE(u.tiktok_caption, u.ig_caption, '') AS caption,
    u.tiktok_title,
    u.tiktok_settings,
    u.tiktok_publish_id,
    u.tiktok_publish_retry_count,
    ta.encrypted_access_token,
    ta.encrypted_refresh_token,
    ta.access_token_expires_at,
    ta.id AS tiktok_account_id,
    ta.tiktok_open_id,
    ta.username AS tiktok_username,
    u.cliente_id AS client_id
  FROM updated u
  JOIN tiktok_accounts ta ON ta.client_id = u.cliente_id AND ta.authorization_status = 'active';
$$;
-- service_role only; FROM public sozinho nao basta em hosted Supabase, onde os
-- default privileges concedem EXECUTE direto a anon/authenticated (mesmo
-- gotcha documentado no bloco do sweep mais abaixo, 20260806000002) -- e a ACL
-- ja existente em prod para esta funcao carrega esses grants diretos.
REVOKE ALL ON FUNCTION claim_posts_for_tiktok_publishing(text, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_posts_for_tiktok_publishing(text, int) TO service_role;

-- ============================================================
-- 3) reorder_post_schedules
-- Canonica: 20260813000003_generalize_post_schedule_reorder.sql. Nos DOIS
-- blocos de posse (lock e count) o join com workflows sai; a checagem de
-- posse passa a ser direta em workflow_posts.cliente_id/conta_id. Resto da
-- funcao (allowlist de status, guarda de publicacao em andamento, loop de
-- update) intacto. hub_reorder_post_schedules (wrapper) NAO muda -- continua
-- delegando para esta funcao e nao precisa ser recriado aqui.
-- ============================================================
CREATE OR REPLACE FUNCTION reorder_post_schedules(
  p_cliente_id       bigint,
  p_conta_id         uuid,
  p_updates          jsonb,
  p_allowed_statuses text[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        UPDATE workflow_posts
        SET scheduled_at = v_new_at,
            instagram_container_id = CASE
              WHEN v_media_id IS NULL THEN NULL
              ELSE instagram_container_id
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

REVOKE ALL ON FUNCTION reorder_post_schedules(bigint, uuid, jsonb, text[]) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION reorder_post_schedules(bigint, uuid, jsonb, text[]) TO service_role;

-- ============================================================
-- 4) Familia ICA (instagram_comment_automations <-> workflow_posts).
-- Canonica: 20260820000003_ica_workflow_post_triggers.sql. As triggers
-- (ica_a1_resolve_workflow_post_target, workflow_posts_z3_link_ig_automations,
-- workflow_posts_z4_tombstone_ig_automations) NAO sao recriadas aqui --
-- CREATE OR REPLACE FUNCTION preserva o oid/assinatura e elas continuam
-- apontando para a definicao nova automaticamente.
-- ============================================================

-- ---------- (a) resolver/validador na automacao -----------------------------
-- Unica troca: o SELECT que le tipo/platform/cliente/media/permalink do post
-- alvo perde o "JOIN workflows w" e le wp.cliente_id diretamente. Comentario
-- deliberado de no-lock (SELECT simples, sem FOR SHARE/FOR UPDATE) preservado
-- verbatim -- a razao (ordem post -> automacao vs. deadlock com
-- mark_platform_published) nao muda.
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
    IF COALESCE(v_platform, 'instagram') = 'tiktok' THEN
      RAISE EXCEPTION 'instagram automation target cannot be a tiktok-only post';
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
     AND COALESCE(v_platform, 'instagram') <> 'tiktok'
     AND v_tipo <> 'stories' THEN
    NEW.ig_media_id := v_media;
    NEW.media_permalink := COALESCE(NEW.media_permalink, v_permalink);
  END IF;
  RETURN NEW;
END $$;

-- ---------- (b) ligacao na publicacao ---------------------------------------
-- Unica troca: a terceira guarda de deriva (workflow movido para outro
-- cliente nao pode ligar a automacao do cliente antigo) passa de
-- "EXISTS (SELECT 1 FROM workflows w WHERE w.id = NEW.workflow_id AND
-- w.cliente_id = a.client_id)" para "NEW.cliente_id = a.client_id", lido
-- direto do post que disparou o trigger.
CREATE OR REPLACE FUNCTION link_pending_instagram_automations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Guardas de deriva: o post pode ter virado stories ou so-TikTok depois que
  -- a automacao o escolheu. Sai calado -- a publicacao nao pode falhar por
  -- causa disso, e a automacao fica pendente ate o usuario reescolher.
  IF NEW.tipo = 'stories' OR COALESCE(NEW.platform, 'instagram') = 'tiktok' THEN
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

-- ---------- (c) tombstone no DELETE do post ---------------------------------
-- Copy-forward sem mudanca logica: nao referencia workflows.
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

-- ---------- (d) sweep (chamado pelo instagram-automation-cron) ---------------
-- Unica troca: remove "JOIN workflows w" e usa "wp.cliente_id = a.client_id"
-- diretamente na mesma guarda de deriva do z3.
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
     AND COALESCE(wp.platform, 'instagram') <> 'tiktok';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- service_role only. REVOKE FROM PUBLIC tambem tira o default do service_role:
-- o GRANT explicito abaixo e obrigatorio (gotcha da casa, 20260806000002).
-- anon/authenticated na lista: em prod/staging as default privileges concedem
-- EXECUTE direto a esses papeis, e REVOKE FROM PUBLIC nao alcanca grant direto
-- (drift ja visto nas claim RPCs; local nao reproduz porque os defaults locais
-- nao concedem nada).
REVOKE ALL ON FUNCTION sweep_pending_instagram_automation_links() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION sweep_pending_instagram_automation_links() TO service_role;
