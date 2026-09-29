-- ============================================================
-- post_targets: destinos de cada post (P1)
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
--
-- P1: esta tabela é a fonte de QUAIS destinos um post tem (e da legenda dos
-- destinos que não são Instagram/TikTok). O estado de publicação de Instagram
-- e TikTok continua nas colunas legadas de workflow_posts até P4 (TikTok) e
-- P5 (Instagram); status aqui fica 'pendente' para essas linhas até lá.
--
-- workflow_posts.platform vira DERIVADO dos destinos:
--   instagram+tiktok -> both | instagram -> instagram | tiktok -> tiktok | resto -> other
-- 'other' é o que impede um post só Geral de casar com o claim do Instagram
-- (20260925000013:34) e com as automações de comentário (migration 3).
--
-- Triggers (GUC de recursão app.post_targets_sync):
--   z4b  BEFORE INSERT em workflow_posts: calcula platform ANTES de gravar, para
--        o RETURNING do insert do CRM já vir certo (e antes do z5 do trial).
--   z6   AFTER INSERT em workflow_posts: cria os destinos (GUC ligado).
--   a2   BEFORE UPDATE OF platform: o PlatformSelector atual grava platform;
--        traduz para destinos e devolve o platform derivado.
--   z7   AFTER UPDATE OF tipo: virou stories -> destino TikTok sai.
--   sync AFTER INSERT/DELETE/UPDATE OF platform em post_targets: recalcula platform.
-- Regras de destino (espelham supportsFormat do registro):
--   TikTok não tem stories; Instagram só entra se o quadro lista Instagram ou o
--   post já tem o destino (TikTok não é checado contra o quadro: legado, ver
--   desvio 2 do plano P1).
-- ============================================================

-- ---------- CHECK de platform ganha 'other' --------------------------------
-- A CHECK inline de 20260720000005:25-26 tem nome gerado; acha pelo corpo.
-- '(platform = ANY' não casa com '(tiktok_publish_status = ANY'.
DO $$
DECLARE r record; v_dropped int := 0;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.workflow_posts'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%(platform = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE public.workflow_posts DROP CONSTRAINT %I', r.conname);
    v_dropped := v_dropped + 1;
  END LOOP;
  IF v_dropped <> 1 THEN
    RAISE EXCEPTION 'esperava 1 CHECK de platform em workflow_posts, achei %', v_dropped;
  END IF;
END $$;
ALTER TABLE public.workflow_posts
  ADD CONSTRAINT workflow_posts_platform_check
  CHECK (platform IN ('instagram','tiktok','both','other'));

-- ---------- tabela ----------------------------------------------------------
CREATE TABLE public.post_targets (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id      uuid   NOT NULL,
  post_id       bigint NOT NULL,
  platform      text   NOT NULL
                CHECK (platform IN ('instagram','tiktok','geral')),
  format        text,
  caption       text,
  title         text,
  settings      jsonb  NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at  timestamptz,
  status        text   NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente','agendado','processando','publicado','falha','disponivel')),
  external_id   text,
  permalink     text,
  error         text,
  error_code    text,
  retry_count   int    NOT NULL DEFAULT 0,
  processing_at timestamptz,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_targets_post_platform_uq UNIQUE (post_id, platform),
  -- FK composta tenant-safe (par workflow_posts_id_conta_uq, 20260820000002:18):
  -- o conta_id da linha é sempre o do post, então a RLS pode confiar nele.
  CONSTRAINT post_targets_post_same_tenant
    FOREIGN KEY (post_id, conta_id) REFERENCES public.workflow_posts (id, conta_id)
    ON DELETE CASCADE
);
CREATE INDEX post_targets_conta_idx ON public.post_targets (conta_id);

ALTER TABLE public.post_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY post_targets_workspace_all ON public.post_targets
  FOR ALL TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY post_targets_service_role ON public.post_targets
  FOR ALL TO service_role USING (true) WITH CHECK (true);
-- O default ACL hospedado dá ALL em tabela nova; TRUNCATE ignora RLS. Revoga
-- tudo e re-concede só o necessário (mesmo formato de 20260925000030:405-413).
REVOKE ALL ON TABLE public.post_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.post_targets TO authenticated;
GRANT ALL ON TABLE public.post_targets TO service_role;

-- ---------- backfill (antes dos triggers: não pode reescrever platform) ----
INSERT INTO public.post_targets (conta_id, post_id, platform)
SELECT wp.conta_id, wp.id, p.platform
  FROM public.workflow_posts wp
 CROSS JOIN LATERAL unnest(
   CASE wp.platform WHEN 'both' THEN ARRAY['instagram','tiktok']
                    ELSE ARRAY[wp.platform] END) AS p(platform);

-- ---------- helpers ----------------------------------------------------------
-- Plataformas do "quadro" de um post: fluxo, ou o padrão do cliente se avulso.
CREATE OR REPLACE FUNCTION public.post_board_platforms(p_workflow_id bigint, p_cliente_id bigint)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    CASE WHEN p_workflow_id IS NOT NULL
         THEN (SELECT plataformas FROM public.workflows WHERE id = p_workflow_id)
         ELSE (SELECT plataformas_padrao FROM public.clientes WHERE id = p_cliente_id)
    END,
    ARRAY['instagram']);
$$;
REVOKE ALL ON FUNCTION public.post_board_platforms(bigint, bigint) FROM public, anon, authenticated;

-- Lista de destinos -> valor de workflow_posts.platform.
CREATE OR REPLACE FUNCTION public.platform_from_targets(p_targets text[])
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
           WHEN 'instagram' = ANY(p_targets) AND 'tiktok' = ANY(p_targets) THEN 'both'
           WHEN 'instagram' = ANY(p_targets) THEN 'instagram'
           WHEN 'tiktok'    = ANY(p_targets) THEN 'tiktok'
           ELSE 'other'
         END;
$$;
REVOKE ALL ON FUNCTION public.platform_from_targets(text[]) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.derive_post_platform(p_post_id bigint)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.platform_from_targets(
    COALESCE(array_agg(platform), ARRAY[]::text[]))
    FROM public.post_targets WHERE post_id = p_post_id;
$$;
REVOKE ALL ON FUNCTION public.derive_post_platform(bigint) FROM public, anon, authenticated;

-- Destinos de um post NOVO. p_platform é o valor do INSERT: 'instagram' é o
-- default da coluna, então nesse caso o quadro decide a parte social; qualquer
-- outro valor foi escrito de propósito (testes, MCP legado) e manda.
CREATE OR REPLACE FUNCTION public.post_seed_targets(
  p_workflow_id bigint, p_cliente_id bigint, p_platform text, p_tipo text)
RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_board  text[] := public.post_board_platforms(p_workflow_id, p_cliente_id);
  v_social text[];
  v_all    text[];
BEGIN
  v_social := CASE p_platform
    WHEN 'both'   THEN ARRAY['instagram','tiktok']
    WHEN 'tiktok' THEN ARRAY['tiktok']
    WHEN 'other'  THEN ARRAY[]::text[]
    ELSE ARRAY(SELECT x FROM unnest(v_board) x WHERE x IN ('instagram','tiktok'))
  END;
  v_all := v_social || ARRAY(SELECT x FROM unnest(v_board) x WHERE x NOT IN ('instagram','tiktok'));
  IF p_tipo = 'stories' THEN
    v_all := array_remove(v_all, 'tiktok');
  END IF;
  RETURN v_all;
END $$;
REVOKE ALL ON FUNCTION public.post_seed_targets(bigint, bigint, text, text) FROM public, anon, authenticated;

-- ---------- z4b: platform certo já no INSERT -----------------------------
-- Nome escolhido para rodar DEPOIS de post_a0_sync_cliente (preenche cliente_id)
-- e ANTES de workflow_posts_z5_clear_ig_trial (BEFORE INSERT OR UPDATE, que
-- limpa o trial reel quando platform não é Instagram).
CREATE OR REPLACE FUNCTION public.workflow_posts_platform_on_insert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.platform := public.platform_from_targets(
    public.post_seed_targets(NEW.workflow_id, NEW.cliente_id, NEW.platform, NEW.tipo));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_platform_on_insert() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_z4b_platform_on_insert
  BEFORE INSERT ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.workflow_posts_platform_on_insert();

-- ---------- z6: cria os destinos do post novo ----------------------------
CREATE OR REPLACE FUNCTION public.post_targets_seed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_prev text := current_setting('app.post_targets_sync', true);
  v_social text[];
  v_all text[];
BEGIN
  -- NEW.platform já é o derivado (z4b): 'instagram' aqui é Instagram mesmo.
  v_social := CASE NEW.platform
    WHEN 'both'      THEN ARRAY['instagram','tiktok']
    WHEN 'instagram' THEN ARRAY['instagram']
    WHEN 'tiktok'    THEN ARRAY['tiktok']
    ELSE ARRAY[]::text[]
  END;
  v_all := v_social || ARRAY(
    SELECT x FROM unnest(public.post_board_platforms(NEW.workflow_id, NEW.cliente_id)) x
     WHERE x NOT IN ('instagram','tiktok'));

  -- platform já está certo: o sync não precisa reescrever a linha.
  PERFORM set_config('app.post_targets_sync', 'on', true);
  INSERT INTO public.post_targets (conta_id, post_id, platform)
  SELECT NEW.conta_id, NEW.id, x FROM unnest(v_all) x
  ON CONFLICT (post_id, platform) DO NOTHING;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.post_targets_seed() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_z6_seed_targets
  AFTER INSERT ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.post_targets_seed();

-- ---------- sync: destino mudou -> recalcula platform -------------------
CREATE OR REPLACE FUNCTION public.post_targets_sync_platform()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_post bigint;
  v_prev text := current_setting('app.post_targets_sync', true);
  v_derived text;
BEGIN
  IF v_prev = 'on' THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN v_post := OLD.post_id; ELSE v_post := NEW.post_id; END IF;
  -- DELETE em cascata do post: a linha pai já sumiu, nada a recalcular.
  IF NOT EXISTS (SELECT 1 FROM public.workflow_posts WHERE id = v_post) THEN
    RETURN NULL;
  END IF;
  v_derived := public.derive_post_platform(v_post);
  PERFORM set_config('app.post_targets_sync', 'on', true);
  UPDATE public.workflow_posts SET platform = v_derived
   WHERE id = v_post AND platform IS DISTINCT FROM v_derived;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.post_targets_sync_platform() FROM public, anon, authenticated;

CREATE TRIGGER post_targets_sync_platform
  AFTER INSERT OR DELETE OR UPDATE OF platform ON public.post_targets
  FOR EACH ROW EXECUTE FUNCTION public.post_targets_sync_platform();

-- ---------- a2: PlatformSelector grava platform -> destinos --------------
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

  -- GUC ligado: os INSERT/DELETE abaixo não podem reescrever esta mesma linha
  -- (UPDATE dentro de BEFORE UPDATE da própria linha = erro 27000).
  PERFORM set_config('app.post_targets_sync', 'on', true);
  IF v_want_ig THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'instagram') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'instagram';
  END IF;
  IF v_want_tt THEN
    INSERT INTO public.post_targets (conta_id, post_id, platform)
    VALUES (NEW.conta_id, NEW.id, 'tiktok') ON CONFLICT (post_id, platform) DO NOTHING;
  ELSE
    DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok';
  END IF;
  PERFORM set_config('app.post_targets_sync', COALESCE(v_prev, ''), true);

  -- O pedido pode não ter sido atendido por inteiro (quadro sem Instagram,
  -- stories sem TikTok): grava o que os destinos dizem.
  NEW.platform := public.derive_post_platform(NEW.id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_platform_to_targets() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_a2_platform_to_targets
  BEFORE UPDATE OF platform ON public.workflow_posts
  FOR EACH ROW EXECUTE FUNCTION public.workflow_posts_platform_to_targets();

-- ---------- z7: virou stories -> destino TikTok sai -----------------------
-- AFTER (não BEFORE): o DELETE dispara o sync, que faz UPDATE na mesma linha;
-- em AFTER isso é permitido, em BEFORE seria erro 27000.
CREATE OR REPLACE FUNCTION public.workflow_posts_stories_drop_tiktok()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.post_targets WHERE post_id = NEW.id AND platform = 'tiktok';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.workflow_posts_stories_drop_tiktok() FROM public, anon, authenticated;

CREATE TRIGGER workflow_posts_z7_stories_drop_tiktok
  AFTER UPDATE OF tipo ON public.workflow_posts
  FOR EACH ROW
  WHEN (NEW.tipo = 'stories' AND OLD.tipo IS DISTINCT FROM 'stories')
  EXECUTE FUNCTION public.workflow_posts_stories_drop_tiktok();
