-- Comentários do Instagram + leitura por IA
-- (spec docs/superpowers/specs/2026-11-03-instagram-comments-sentiment-design.md).
--
-- 1. plans.feature_instagram_comments_ai: nasce false em todos os planos e o piloto
--    liga por workspace_plan_overrides.feature_overrides ({"feature_instagram_comments_ai": true});
--    effective_plan_feature() lê como qualquer outra flag.
-- 2. instagram_comment_analyses: a última leitura da IA por post (scope 'post') ou por conta
--    (scope 'account'), uma linha por alvo. Só as edge functions (service_role) escrevem;
--    o CRM só lê, pelo workspace dono.
-- 3. ideias.origem_sugestao_id: id da sugestão da IA que virou ideia, para o "Virar ideia" não
--    duplicar (índice único parcial por workspace).
--
-- Ordem de deploy: esta migration (staging, depois prod) -> redeploy de `instagram-analytics` e
-- `instagram-integration` (o /disconnect apaga da tabela nova) e de cada function que importa
-- _shared/entitlements.ts (FEATURE_COLUMNS ganha a chave; o platform-admin espalha FEATURE_COLUMNS
-- no insert/update de planos, então a coluna precisa existir antes): automation-media, data-import,
-- equipe-chat-media, mcp-keys, mcp-oauth-consent, paywall-report, platform-admin e workspace-limits
-- -> merge (o frontend sai com o merge) -> override do piloto.

SET LOCAL lock_timeout = '5s';

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS feature_instagram_comments_ai boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.instagram_comment_analyses (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id                    uuid NOT NULL,
  instagram_account_id        uuid NOT NULL REFERENCES public.instagram_accounts(id) ON DELETE CASCADE,
  ig_user_id                  text NOT NULL,
  scope                       text NOT NULL CHECK (scope IN ('post', 'account')),
  instagram_post_id           text,
  comments_analyzed           int  NOT NULL,
  comments_count_at_analysis  int  NOT NULL,
  -- posts cujos comentários foram lidos e enviados à IA (1 no scope 'post'; null em linhas antigas)
  posts_analyzed              int,
  period_start                date,
  period_end                  date,
  result                      jsonb NOT NULL,
  model                       text NOT NULL,
  analyzed_by                 uuid,
  analyzed_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instagram_comment_analyses_scope_post_check
    CHECK ((scope = 'post') = (instagram_post_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS instagram_comment_analyses_target_uq
  ON public.instagram_comment_analyses (instagram_account_id, scope, instagram_post_id) NULLS NOT DISTINCT;

CREATE INDEX IF NOT EXISTS instagram_comment_analyses_conta_idx
  ON public.instagram_comment_analyses (conta_id);

ALTER TABLE public.instagram_comment_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instagram_comment_analyses_select ON public.instagram_comment_analyses;
CREATE POLICY instagram_comment_analyses_select ON public.instagram_comment_analyses
  FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id()));

-- REVOKE FROM PUBLIC sozinho não tira o que anon/authenticated já receberam por default
-- privileges: nomeia os papéis.
REVOKE ALL ON public.instagram_comment_analyses FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.instagram_comment_analyses TO authenticated;
GRANT ALL ON public.instagram_comment_analyses TO service_role;

ALTER TABLE public.ideias ADD COLUMN IF NOT EXISTS origem_sugestao_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ideias_workspace_origem_sugestao_uq
  ON public.ideias (workspace_id, origem_sugestao_id)
  WHERE origem_sugestao_id IS NOT NULL;
