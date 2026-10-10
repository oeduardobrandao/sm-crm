-- ============================================================
-- P4 (1/3): estado de publicação do TikTok passa a morar em post_targets.
-- Spec: docs/superpowers/specs/2026-10-09-tiktok-publish-state-post-targets-design.md
--   §1, §2a (publish_ref), §2b (backfill + paridade), §2h (privilégios + guarda).
-- Plano: docs/superpowers/plans/2026-10-09-tiktok-publish-state-post-targets.md (Task 1).
--
-- Depois desta migration as colunas tiktok_* de publicação em workflow_posts
-- (tiktok_publish_status/id/error/retry_count/processing_at, tiktok_post_id/url)
-- ficam congeladas: o backfill abaixo é a última leitura delas por escrita.
-- 20261014000002 traz os writers; 20261014000003 o claim novo.
-- ============================================================

-- CREATE TRIGGER e ALTER em post_targets pedem lock forte: desiste em 5s em vez
-- de enfileirar o tráfego (mesmo cabeçalho de 20261010100002).
SET LOCAL lock_timeout = '5s';

-- ---------- a. publish_ref --------------------------------------------------
-- Handle do provedor para uma publicação em voo (TikTok: publish_id temporário,
-- o que o webhook usa para achar a linha). external_id segue sendo o id público.
-- Não é UNIQUE: tiktok_publish_id nunca foi, e uma duplicata no legado
-- derrubaria a migration sem ganho. O webhook resolve duplicata pela linha mais nova.
ALTER TABLE public.post_targets ADD COLUMN publish_ref text;
CREATE INDEX post_targets_publish_ref_idx
  ON public.post_targets (platform, publish_ref)
  WHERE publish_ref IS NOT NULL;

-- ---------- b. backfill -----------------------------------------------------
-- Mapeamento legado -> destino, com a regra de reset (§2b): 'failed' num post
-- fora de publicação vira 'pendente' (mesma regra do trigger z9 de
-- 20261014000002, que só pega updates futuros). Fonte única para o backfill,
-- a paridade abaixo, scripts/tiktok-p4-reconcile.sql e os testes.
CREATE OR REPLACE FUNCTION public.tiktok_legacy_target_status(p_legacy text, p_post_status text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_legacy IN ('initiated','processing') THEN 'processando'
    WHEN p_legacy = 'published' THEN 'publicado'
    WHEN p_legacy = 'failed'
         AND p_post_status IN ('agendado','falha_publicacao','postado') THEN 'falha'
    ELSE 'pendente'
  END;
$$;
REVOKE ALL ON FUNCTION public.tiktok_legacy_target_status(text, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tiktok_legacy_target_status(text, text) TO service_role;

-- O backfill mora numa função para o teste exercitar o MESMO UPDATE da migration
-- (restrito ao workspace do teste) em vez de uma cópia. p_conta NULL = todos os
-- posts (a chamada da migration). Sai junto das colunas tiktok_* no follow-up.
-- publish_ref só onde o estado carrega uma publicação (o retry legado limpava o
-- status mas deixava tiktok_publish_id velho); error só em 'falha'. O reset
-- zera retry_count; nas demais linhas a contagem legada vem junto.
CREATE OR REPLACE FUNCTION public.tiktok_backfill_targets(p_conta uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.post_targets t SET
    status        = m.st,
    publish_ref   = CASE WHEN m.st IN ('processando','publicado','falha') THEN m.tiktok_publish_id END,
    external_id   = m.tiktok_post_id,
    permalink     = m.tiktok_post_url,
    error         = CASE WHEN m.st = 'falha' THEN m.tiktok_publish_error END,
    error_code    = NULL,
    retry_count   = CASE WHEN m.was_reset THEN 0 ELSE COALESCE(m.tiktok_publish_retry_count, 0) END,
    processing_at = m.tiktok_publish_processing_at,
    published_at  = CASE WHEN m.st = 'publicado' THEN m.published_at END,
    updated_at    = now()
  FROM (
    SELECT wp.id, wp.tiktok_publish_id, wp.tiktok_post_id, wp.tiktok_post_url,
           wp.tiktok_publish_error, wp.tiktok_publish_retry_count,
           wp.tiktok_publish_processing_at, wp.published_at,
           public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) AS st,
           (wp.tiktok_publish_status = 'failed'
            AND public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) = 'pendente') AS was_reset
      FROM public.workflow_posts wp
     WHERE p_conta IS NULL OR wp.conta_id = p_conta
  ) m
  WHERE t.post_id = m.id AND t.platform = 'tiktok';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.tiktok_backfill_targets(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tiktok_backfill_targets(uuid) TO service_role;

SELECT public.tiktok_backfill_targets(NULL);

-- Paridade: qualquer divergência derruba a migration inteira.
DO $$
DECLARE
  v_legacy jsonb;
  v_dest   jsonb;
  v_bad    bigint[];
BEGIN
  SELECT COALESCE(jsonb_object_agg(st, n), '{}'::jsonb) INTO v_legacy FROM (
    SELECT public.tiktok_legacy_target_status(wp.tiktok_publish_status, wp.status) AS st,
           count(*) AS n
      FROM public.workflow_posts wp
     WHERE wp.platform IN ('tiktok','both')
     GROUP BY 1) s;
  SELECT COALESCE(jsonb_object_agg(status, n), '{}'::jsonb) INTO v_dest FROM (
    SELECT t.status, count(*) AS n
      FROM public.post_targets t
     WHERE t.platform = 'tiktok'
     GROUP BY 1) s;
  IF v_legacy IS DISTINCT FROM v_dest THEN
    RAISE EXCEPTION 'P4 paridade: legado % <> destinos %', v_legacy, v_dest;
  END IF;

  SELECT array_agg(wp.id ORDER BY wp.id) INTO v_bad
    FROM public.workflow_posts wp
   WHERE wp.platform IN ('tiktok','both')
     AND (SELECT count(*) FROM public.post_targets t
           WHERE t.post_id = wp.id AND t.platform = 'tiktok') <> 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P4 paridade: posts tiktok/both sem exatamente um destino TikTok: %', v_bad;
  END IF;

  SELECT array_agg(t.post_id ORDER BY t.post_id) INTO v_bad
    FROM public.post_targets t
    JOIN public.workflow_posts wp ON wp.id = t.post_id
   WHERE t.platform = 'tiktok' AND wp.platform NOT IN ('tiktok','both');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P4 paridade: destino TikTok em post fora de tiktok/both: %', v_bad;
  END IF;

  -- P1 semeou TikTok sem filtrar tipo (20261010100002:110-115). Se isto falhar
  -- em prod, rodar a remediação de scripts/tiktok-p4-predeploy.sql antes.
  SELECT array_agg(t.post_id ORDER BY t.post_id) INTO v_bad
    FROM public.post_targets t
    JOIN public.workflow_posts wp ON wp.id = t.post_id
   WHERE t.platform = 'tiktok' AND wp.tipo = 'stories';
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'P4 paridade: destino TikTok em post stories: %', v_bad;
  END IF;
END $$;

-- ---------- h. privilégios --------------------------------------------------
-- authenticated não grava status/external_id/permalink/publish_ref/erro.
-- O CRM só escreve conta_id, post_id, platform e caption (store/postTargets.ts).
-- Os triggers de P1 que gravam platform/post_id são DEFINER: não são afetados.
REVOKE INSERT, UPDATE ON TABLE public.post_targets FROM authenticated;
GRANT INSERT (conta_id, post_id, platform, format, caption, title, settings)
  ON TABLE public.post_targets TO authenticated;
GRANT UPDATE (caption, title, settings, format)
  ON TABLE public.post_targets TO authenticated;

-- Guarda de DELETE: destino publicando ou publicado não sai enquanto o post
-- existe. A cascata do DELETE do post passa: a ação RI roda depois do DELETE
-- da linha pai, então o post já não existe aqui (mesma premissa de
-- post_targets_sync_platform, 20261010100002:263-264).
CREATE OR REPLACE FUNCTION public.post_targets_guard_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status IN ('processando','publicado')
     AND EXISTS (SELECT 1 FROM public.workflow_posts WHERE id = OLD.post_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0409', MESSAGE = 'target_not_removable';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.post_targets_guard_delete() FROM public, anon, authenticated;

CREATE TRIGGER post_targets_a0_guard_delete
  BEFORE DELETE ON public.post_targets
  FOR EACH ROW EXECUTE FUNCTION public.post_targets_guard_delete();

-- ---------- a2 copiado para frente ------------------------------------------
-- Canônica: 20261010100002_post_targets.sql:280-341. Única mudança (-- P4:):
-- os dois DELETEs pulam destinos em processando/publicado, que a guarda acima
-- recusaria com erro cru no editor. platform segue derivado do que restou.
CREATE OR REPLACE FUNCTION public.workflow_posts_platform_to_targets()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text := current_setting('app.post_targets_sync', true);
  v_want_ig boolean;
  v_want_tt boolean;
BEGIN
  IF v_prev = 'on' OR NEW.platform IS NOT DISTINCT FROM OLD.platform THEN
    RETURN NEW;
  END IF;
  -- Post Express é só Instagram: a escrita legada de platform não faz nada.
  IF NEW.is_express THEN
    NEW.platform := OLD.platform;
    RETURN NEW;
  END IF;
  -- Valor fora do domínio: deixa a CHECK recusar (não tocar em destinos).
  IF NEW.platform IS NULL OR NEW.platform NOT IN ('instagram','tiktok','both','other') THEN
    RETURN NEW;
  END IF;

  -- Instagram só entra se o quadro lista Instagram (ou o post já tem o destino):
  -- o auto-reparo de stories do PlatformSelector grava 'instagram' e não pode
  -- criar destino Instagram num quadro só TikTok. TikTok nunca em stories.
  v_want_ig := NEW.platform IN ('instagram','both')
    AND ('instagram' = ANY(public.post_board_platforms(NEW.workflow_id, NEW.cliente_id))
         OR EXISTS (SELECT 1 FROM public.post_targets
                     WHERE post_id = NEW.id AND platform = 'instagram'));
  v_want_tt := NEW.platform IN ('tiktok','both') AND NEW.tipo <> 'stories';

  -- Pedido de Instagram/TikTok que não sobra nenhum dos dois (quadro só TikTok
  -- e o usuário pede Instagram; stories e o usuário pede TikTok): em P1 não há
  -- editor de destinos para sair de 'other', então a escrita não faz nada e o
  -- platform volta a ser o dos destinos atuais. 'other' explícito (nenhuma UI
  -- grava) segue valendo: tira Instagram e TikTok de propósito.
  IF NEW.platform <> 'other' AND NOT v_want_ig AND NOT v_want_tt THEN
    NEW.platform := public.derive_post_platform(NEW.id);
    RETURN NEW;
  END IF;

  -- GUC ligado: os INSERT/DELETE abaixo não podem reescrever esta mesma linha
  -- (UPDATE dentro de BEFORE UPDATE da própria linha = erro 27000).
  PERFORM set_config('app.post_targets_sync', 'on', true);
  IF v_want_ig THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'instagram') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'instagram'
      AND status NOT IN ('processando','publicado');  -- P4: guarda de DELETE
  END IF;
  IF v_want_tt THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'tiktok') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok'
      AND status NOT IN ('processando','publicado');  -- P4: guarda de DELETE
  END IF;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);

  -- O pedido pode não ter sido atendido por inteiro (quadro sem Instagram,
  -- stories sem TikTok, P4: destino publicando/publicado que ficou): grava o
  -- que os destinos dizem.
  NEW.platform := public.derive_post_platform(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_platform_to_targets() FROM public, anon, authenticated;

-- ---------- z7 copiado para frente ------------------------------------------
-- Canônica: 20261010100002_post_targets.sql:351-357. Única mudança (-- P4:):
-- destino TikTok publicando/publicado fica. O trigger (z7, AFTER UPDATE OF tipo)
-- não muda e continua apontando para esta função.
CREATE OR REPLACE FUNCTION public.workflow_posts_stories_drop_tiktok()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok'
    AND status NOT IN ('processando','publicado');  -- P4: guarda de DELETE
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_stories_drop_tiktok() FROM public, anon, authenticated;
