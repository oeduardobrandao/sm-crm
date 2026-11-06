-- Linha editorial: the monthly content plan the agency builds per client, sends to the Hub
-- for approval and converts into posts (spec docs/superpowers/specs/2026-10-26-linha-editorial-design.md,
-- sections 4 and 5).
--
-- Flag: plans.feature_linha_editorial is born false on every plan and turned on per workspace
-- through workspace_plan_overrides.feature_overrides ({"feature_linha_editorial": true}). It is
-- AUTHORIZATION, not just UI: every INSERT/UPDATE/DELETE policy below requires it, while SELECT
-- stays open to the conta so the data survives a downgrade and shows again if the flag returns.
-- Deploy order: this migration (staging, then prod) -> redeploy of the functions that import
-- _shared/entitlements.ts once FEATURE_COLUMNS gains the key (platform-admin spreads
-- FEATURE_COLUMNS into plan inserts/updates, so the column must exist before that redeploy).
--
-- State machine columns (status, rodada, enviada_*, decidida_at) and the conversion columns
-- (post_id, convertido_*) are written only by the SECURITY DEFINER RPCs of
-- 20261031000002/3 and by the FK cascade: the column-level grants below leave authenticated
-- no way to touch them through PostgREST.
--
-- linha_nome_norm() wraps extensions.unaccent as IMMUTABLE so it can back the unique index on
-- colunas. unaccent itself is only STABLE because its dictionary file can change: if the
-- unaccent dictionary (unaccent.rules) is ever changed, REINDEX
-- linha_editorial_colunas_conta_nome_norm_uq, or the index may hold stale keys.

SET LOCAL lock_timeout = '5s';

-- ============ (0) FLAG ============
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_linha_editorial boolean NOT NULL DEFAULT false;

-- ============ (1) NAME NORMALIZATION ============
-- The two-argument form names the dictionary explicitly, so the result does not depend on
-- the caller's search_path.
CREATE OR REPLACE FUNCTION public.linha_nome_norm(text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT lower(extensions.unaccent('extensions.unaccent', trim($1)))
$$;
-- The unique index evaluates it as the inserting role.
REVOKE ALL ON FUNCTION public.linha_nome_norm(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.linha_nome_norm(text) TO authenticated, service_role;

-- ============ (2) TABLES ============

-- 4.1 One linha per client per month.
CREATE TABLE public.linhas_editoriais (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  cliente_id   bigint NOT NULL,
  periodo      date NOT NULL CHECK (extract(day FROM periodo) = 1),
  status       text NOT NULL DEFAULT 'rascunho'
                 CHECK (status IN ('rascunho', 'enviada', 'ajustes', 'aprovada')),
  enviada_at   timestamptz,
  enviada_por  uuid,
  decidida_at  timestamptz,
  rodada       integer NOT NULL DEFAULT 0 CHECK (rodada >= 0),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linhas_editoriais_conta_cliente_periodo_uq UNIQUE (conta_id, cliente_id, periodo),
  -- Target of the (linha_id, conta_id) composite FKs of itens and respostas.
  CONSTRAINT linhas_editoriais_id_conta_uq UNIQUE (id, conta_id),
  -- Same tenant client (clientes_id_conta_uq, 20260815000002).
  CONSTRAINT linhas_editoriais_cliente_same_tenant
    FOREIGN KEY (cliente_id, conta_id) REFERENCES public.clientes (id, conta_id) ON DELETE CASCADE
);
CREATE INDEX idx_linhas_editoriais_cliente ON public.linhas_editoriais (cliente_id, periodo);

-- 4.2 Workspace-level extra columns.
CREATE TABLE public.linha_editorial_colunas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  nome            text NOT NULL CHECK (length(trim(nome)) > 0),
  tipo            text NOT NULL
                    CHECK (tipo IN ('text', 'number', 'select', 'multiselect', 'date', 'person', 'checkbox', 'url')),
  config          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  visivel_cliente boolean NOT NULL DEFAULT true,
  oculta          boolean NOT NULL DEFAULT false,
  ordem           integer NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
-- "Pilar" and "pílar " cannot coexist, so the name mapping of the conversion is deterministic.
CREATE UNIQUE INDEX linha_editorial_colunas_conta_nome_norm_uq
  ON public.linha_editorial_colunas (conta_id, public.linha_nome_norm(nome));

-- 4.3 The rows.
CREATE TABLE public.linha_editorial_itens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  linha_id       uuid NOT NULL,
  data           date,
  tipo           text NOT NULL CHECK (tipo IN ('feed', 'carrossel', 'reels', 'stories')),
  titulo         text NOT NULL DEFAULT '',
  direcao        text NOT NULL DEFAULT '',
  valores        jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(valores) = 'object'),
  ordem          integer NOT NULL,
  post_id        bigint,
  convertido_at  timestamptz,
  convertido_por uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linha_editorial_itens_id_conta_uq UNIQUE (id, conta_id),
  -- Target of the respostas (item_id, linha_id) FK: a reply attaches only to an item of its linha.
  CONSTRAINT linha_editorial_itens_id_linha_uq UNIQUE (id, linha_id),
  CONSTRAINT linha_editorial_itens_linha_same_tenant
    FOREIGN KEY (linha_id, conta_id) REFERENCES public.linhas_editoriais (id, conta_id) ON DELETE CASCADE,
  -- Same tenant post (workflow_posts_id_conta_uq, 20260820000002). The column list keeps the
  -- NOT NULL conta_id when the post is deleted (precedent 20260918000002); a bare SET NULL
  -- would null conta_id too and fail. Deleting the post releases the row for a new conversion.
  CONSTRAINT linha_editorial_itens_post_same_tenant
    FOREIGN KEY (post_id, conta_id) REFERENCES public.workflow_posts (id, conta_id) ON DELETE SET NULL (post_id)
);
CREATE INDEX idx_linha_editorial_itens_linha_ordem ON public.linha_editorial_itens (linha_id, ordem);
CREATE INDEX idx_linha_editorial_itens_post ON public.linha_editorial_itens (post_id) WHERE post_id IS NOT NULL;

-- 4.4 Client and team messages, decisions (mirrors post_approvals).
CREATE TABLE public.linha_editorial_respostas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  linha_id          uuid NOT NULL,
  -- NULL = a comment on the whole linha.
  item_id           uuid,
  acao              text NOT NULL CHECK (acao IN ('comentario', 'aprovado', 'ajustes')),
  comentario        text,
  -- Stamped from the linha by linha_resposta_guard; whatever the caller sends is ignored.
  rodada            integer NOT NULL,
  is_workspace_user boolean NOT NULL,
  author_user_id    uuid,
  token             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT linha_editorial_respostas_linha_same_tenant
    FOREIGN KEY (linha_id, conta_id) REFERENCES public.linhas_editoriais (id, conta_id) ON DELETE CASCADE,
  -- Deleting an item keeps its replies as linha-level comments.
  CONSTRAINT linha_editorial_respostas_item_same_linha
    FOREIGN KEY (item_id, linha_id) REFERENCES public.linha_editorial_itens (id, linha_id) ON DELETE SET NULL (item_id)
);
CREATE INDEX idx_linha_editorial_respostas_linha ON public.linha_editorial_respostas (linha_id, created_at);
CREATE INDEX idx_linha_editorial_respostas_item ON public.linha_editorial_respostas (item_id) WHERE item_id IS NOT NULL;

-- ============ (3) TRIGGERS ============
-- Both guards are SECURITY INVOKER on purpose: for authenticated the parent linha is read
-- under RLS, so a linha of another conta is "not found" and raises, on top of the RLS
-- WITH CHECK. The RPCs (owner) and the FK cascades (run as the table owner) see every row.

CREATE OR REPLACE FUNCTION public.linha_item_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conta   uuid;
  v_periodo date;
  v_total   integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- A row can't move to another linha (another client's) or another conta
    -- (follows post_move_requires_rpc, 20260830000001).
    IF NEW.linha_id IS DISTINCT FROM OLD.linha_id THEN
      RAISE EXCEPTION 'linha_item_linha_imutavel';
    END IF;
    IF NEW.conta_id IS DISTINCT FROM OLD.conta_id THEN
      RAISE EXCEPTION 'linha_item_conta_imutavel';
    END IF;
    -- Converted rows are frozen: the post is the source of truth. Only while post_id stays
    -- the same, so the FK's ON DELETE SET NULL (itself an UPDATE) releases the row.
    IF OLD.post_id IS NOT NULL
       AND NEW.post_id IS NOT DISTINCT FROM OLD.post_id
       AND (NEW.data, NEW.tipo, NEW.titulo, NEW.direcao, NEW.valores)
           IS DISTINCT FROM (OLD.data, OLD.tipo, OLD.titulo, OLD.direcao, OLD.valores) THEN
      RAISE EXCEPTION 'linha_item_convertido';
    END IF;
    -- linha_id and conta_id are unchanged, so only a new date needs the parent.
    IF NEW.data IS NOT DISTINCT FROM OLD.data THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT l.conta_id, l.periodo INTO v_conta, v_periodo
    FROM public.linhas_editoriais l
   WHERE l.id = NEW.linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'linha_nao_encontrada';
  END IF;
  IF v_conta IS DISTINCT FROM NEW.conta_id THEN
    RAISE EXCEPTION 'linha_item_conta_divergente';
  END IF;
  IF NEW.data IS NOT NULL AND date_trunc('month', NEW.data)::date <> v_periodo THEN
    RAISE EXCEPTION 'linha_item_data_fora_do_mes';
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Serialize inserts per linha so two concurrent ones can't both pass the count.
    PERFORM pg_advisory_xact_lock(hashtext('linha_editorial_itens:' || NEW.linha_id::text));
    SELECT count(*) INTO v_total FROM public.linha_editorial_itens WHERE linha_id = NEW.linha_id;
    IF v_total >= 100 THEN
      RAISE EXCEPTION 'linha_item_limite';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.linha_item_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER linha_item_guard
  BEFORE INSERT OR UPDATE ON public.linha_editorial_itens
  FOR EACH ROW EXECUTE FUNCTION public.linha_item_guard();

-- INSERT only: respostas have no UPDATE path for authenticated, and the item FK's
-- SET NULL (item_id) cascade must not depend on the linha still being there.
CREATE OR REPLACE FUNCTION public.linha_resposta_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_conta  uuid;
  v_rodada integer;
BEGIN
  SELECT l.conta_id, l.rodada INTO v_conta, v_rodada
    FROM public.linhas_editoriais l
   WHERE l.id = NEW.linha_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'linha_nao_encontrada';
  END IF;
  IF v_conta IS DISTINCT FROM NEW.conta_id THEN
    RAISE EXCEPTION 'linha_resposta_conta_divergente';
  END IF;
  NEW.rodada := v_rodada;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.linha_resposta_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER linha_resposta_guard
  BEFORE INSERT ON public.linha_editorial_respostas
  FOR EACH ROW EXECUTE FUNCTION public.linha_resposta_guard();

CREATE OR REPLACE FUNCTION public.linha_editorial_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.linha_editorial_touch_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER linhas_editoriais_touch_updated_at
  BEFORE UPDATE ON public.linhas_editoriais
  FOR EACH ROW EXECUTE FUNCTION public.linha_editorial_touch_updated_at();
CREATE TRIGGER linha_editorial_itens_touch_updated_at
  BEFORE UPDATE ON public.linha_editorial_itens
  FOR EACH ROW EXECUTE FUNCTION public.linha_editorial_touch_updated_at();

-- ============ (4) RLS ============
-- Access follows workflow_posts: conta only, no module permission. Every write also needs
-- the flag. Policies exist for every command even where no grant does (linhas INSERT/DELETE,
-- respostas UPDATE/DELETE), so a future grant can't open a write that skips the flag.

ALTER TABLE public.linhas_editoriais ENABLE ROW LEVEL SECURITY;
CREATE POLICY linhas_editoriais_select ON public.linhas_editoriais FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY linhas_editoriais_insert ON public.linhas_editoriais FOR INSERT TO authenticated
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));
CREATE POLICY linhas_editoriais_update ON public.linhas_editoriais FOR UPDATE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));
CREATE POLICY linhas_editoriais_delete ON public.linhas_editoriais FOR DELETE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));

ALTER TABLE public.linha_editorial_colunas ENABLE ROW LEVEL SECURITY;
CREATE POLICY linha_editorial_colunas_select ON public.linha_editorial_colunas FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY linha_editorial_colunas_insert ON public.linha_editorial_colunas FOR INSERT TO authenticated
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));
CREATE POLICY linha_editorial_colunas_update ON public.linha_editorial_colunas FOR UPDATE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));
CREATE POLICY linha_editorial_colunas_delete ON public.linha_editorial_colunas FOR DELETE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));

ALTER TABLE public.linha_editorial_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY linha_editorial_itens_select ON public.linha_editorial_itens FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY linha_editorial_itens_insert ON public.linha_editorial_itens FOR INSERT TO authenticated
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));
CREATE POLICY linha_editorial_itens_update ON public.linha_editorial_itens FOR UPDATE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));
CREATE POLICY linha_editorial_itens_delete ON public.linha_editorial_itens FOR DELETE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));

-- Team replies only: the client's rows and the decisions come from the service-role RPCs.
ALTER TABLE public.linha_editorial_respostas ENABLE ROW LEVEL SECURITY;
CREATE POLICY linha_editorial_respostas_select ON public.linha_editorial_respostas FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));
CREATE POLICY linha_editorial_respostas_insert ON public.linha_editorial_respostas FOR INSERT TO authenticated
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial')
              AND is_workspace_user
              AND author_user_id = (SELECT auth.uid())
              AND acao = 'comentario');
CREATE POLICY linha_editorial_respostas_update ON public.linha_editorial_respostas FOR UPDATE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id())
              AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));
CREATE POLICY linha_editorial_respostas_delete ON public.linha_editorial_respostas FOR DELETE TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND public.effective_plan_feature(conta_id, 'feature_linha_editorial'));

-- ============ (5) GRANTS ============
-- Hosted Supabase's default ACL grants ALL on new tables to anon and authenticated, and a
-- column-level grant only restricts once the table-level grant is gone (20260728000002,
-- 20261027000002). Revoke everything first, then grant exactly what the CRM needs. The local
-- stack lacks that default ACL, so the entitlement suite cannot see a missing REVOKE: this
-- block and the assertion after it are the only defense.
REVOKE ALL ON TABLE public.linhas_editoriais, public.linha_editorial_colunas,
  public.linha_editorial_itens, public.linha_editorial_respostas FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.linhas_editoriais, public.linha_editorial_colunas,
  public.linha_editorial_itens, public.linha_editorial_respostas TO service_role;
GRANT SELECT ON TABLE public.linhas_editoriais, public.linha_editorial_colunas,
  public.linha_editorial_itens, public.linha_editorial_respostas TO authenticated;

-- linhas: no INSERT (only linha_editorial_criar, so nobody inserts one already 'aprovada'),
-- no DELETE. status, rodada, enviada_*, decidida_at move only through the RPCs.
GRANT UPDATE (updated_at) ON public.linhas_editoriais TO authenticated;

-- colunas: id and created_at are server-side. id is also excluded from UPDATE (stricter than
-- the spec's "everything but conta_id"): items' valores are keyed by coluna id.
GRANT INSERT (conta_id, nome, tipo, config, visivel_cliente, oculta, ordem)
  ON public.linha_editorial_colunas TO authenticated;
GRANT UPDATE (nome, tipo, config, visivel_cliente, oculta, ordem)
  ON public.linha_editorial_colunas TO authenticated;
GRANT DELETE ON public.linha_editorial_colunas TO authenticated;

-- itens: id is insertable so "Nova linha" can insert optimistically with a client uuid.
-- post_id and convertido_* are never writable here (conversion is linha_editorial_converter).
GRANT INSERT (id, linha_id, conta_id, data, tipo, titulo, direcao, valores, ordem)
  ON public.linha_editorial_itens TO authenticated;
GRANT UPDATE (data, tipo, titulo, direcao, valores, ordem)
  ON public.linha_editorial_itens TO authenticated;
GRANT DELETE ON public.linha_editorial_itens TO authenticated;

-- respostas: team comentario rows only (policy). rodada is stamped by the trigger, token is
-- the Hub's.
GRANT INSERT (conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id)
  ON public.linha_editorial_respostas TO authenticated;

DO $$
DECLARE
  v_expected constant jsonb := jsonb_build_object(
    'linhas_editoriais', 'SELECT',
    'linha_editorial_colunas', 'DELETE, SELECT',
    'linha_editorial_itens', 'DELETE, SELECT',
    'linha_editorial_respostas', 'SELECT');
  v_table text;
  v_got   text;
BEGIN
  FOR v_table IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_got
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_table AND grantee = 'authenticated';
    IF v_got IS DISTINCT FROM v_expected ->> v_table THEN
      RAISE EXCEPTION '%: authenticated holds table-level % (expected %)', v_table, v_got, v_expected ->> v_table;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
                WHERE table_schema = 'public' AND table_name = v_table AND grantee IN ('anon', 'PUBLIC'))
       OR EXISTS (SELECT 1 FROM information_schema.role_column_grants
                   WHERE table_schema = 'public' AND table_name = v_table AND grantee IN ('anon', 'PUBLIC')) THEN
      RAISE EXCEPTION '%: anon or PUBLIC holds a privilege', v_table;
    END IF;
  END LOOP;
  -- RPC-only columns: no INSERT or UPDATE for authenticated. linha_id is insertable (a new
  -- row names its linha) but never updatable.
  IF EXISTS (SELECT 1 FROM information_schema.role_column_grants
              WHERE table_schema = 'public' AND grantee = 'authenticated'
                AND privilege_type IN ('INSERT', 'UPDATE')
                AND (table_name, column_name) IN (
                  ('linhas_editoriais', 'status'), ('linhas_editoriais', 'rodada'),
                  ('linhas_editoriais', 'enviada_at'), ('linhas_editoriais', 'enviada_por'),
                  ('linhas_editoriais', 'decidida_at'),
                  ('linha_editorial_itens', 'post_id'), ('linha_editorial_itens', 'convertido_at'),
                  ('linha_editorial_itens', 'convertido_por'),
                  ('linha_editorial_respostas', 'rodada'), ('linha_editorial_respostas', 'token')))
     OR EXISTS (SELECT 1 FROM information_schema.role_column_grants
                 WHERE table_schema = 'public' AND grantee = 'authenticated' AND privilege_type = 'UPDATE'
                   AND table_name = 'linha_editorial_itens' AND column_name IN ('linha_id', 'conta_id')) THEN
    RAISE EXCEPTION 'linha editorial: authenticated can write an RPC-only column';
  END IF;
END
$$;
