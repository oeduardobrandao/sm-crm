-- ============================================================
-- Plataformas por quadro, template e cliente (P1)
-- Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
-- Ids válidos = PLATFORM_IDS de supabase/functions/_shared/platform-registry.ts.
-- Plataforma nova = ampliar os três CHECKs abaixo e o de post_targets.platform.
-- ============================================================

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS plataformas text[] NOT NULL DEFAULT '{instagram}';
ALTER TABLE public.workflows
  ADD CONSTRAINT workflows_plataformas_valid
  CHECK (cardinality(plataformas) >= 1
         AND plataformas <@ ARRAY['instagram','tiktok','geral']::text[]);

ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS plataformas text[] NOT NULL DEFAULT '{instagram}';
ALTER TABLE public.workflow_templates
  ADD CONSTRAINT workflow_templates_plataformas_valid
  CHECK (cardinality(plataformas) >= 1
         AND plataformas <@ ARRAY['instagram','tiktok','geral']::text[]);

-- Plataformas dos posts avulsos do cliente. Todos começam em Instagram: cliente
-- sem conta conectada produz conteúdo de Instagram hoje (spec, desvio 4 do plano).
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS plataformas_padrao text[] NOT NULL DEFAULT '{instagram}';
ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_plataformas_padrao_valid
  CHECK (cardinality(plataformas_padrao) >= 1
         AND plataformas_padrao <@ ARRAY['instagram','tiktok','geral']::text[]);

-- Quadros que já têm post TikTok passam a declarar TikTok. Sem evento de
-- workflow: é backfill, não edição de usuário.
SELECT set_config('app.suppress_workflow_events', '1', true);
UPDATE public.workflows w
   SET plataformas = ARRAY['instagram','tiktok']
 WHERE EXISTS (SELECT 1 FROM public.workflow_posts wp
                WHERE wp.workflow_id = w.id AND wp.platform IN ('tiktok','both'));
SELECT set_config('app.suppress_workflow_events', '', true);

-- ---------- allowlist de SELECT de clientes (trio da armadilha 20260728000002)
-- Lista INTEIRA copiada de 20260904000001:23-28 (a mais recente) + plataformas_padrao.
REVOKE SELECT ON public.clientes FROM authenticated;
GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis,
  foto_url, send_event_email, event_email_unsub_at, plataformas_padrao
) ON public.clientes TO authenticated;

-- clientes_v: SELECT vigente copiado de 20260904000001:35-45, coluna nova
-- APENDADA POR ÚLTIMO (inserir no meio renomeia colunas por ordinal).
CREATE OR REPLACE VIEW public.clientes_v WITH (security_barrier = true) AS
  SELECT c.id, c.user_id, c.conta_id, c.nome, c.sigla, c.cor, c.plano,
         c.email, c.telefone, c.status, c.created_at, c.notion_page_url,
         c.data_pagamento, c.especialidade, c.data_aniversario, c.dia_entrega,
         c.auto_publish_on_approval, c.send_report_email, c.include_ai_analysis,
         CASE WHEN public.can_see_financials()
              THEN c.valor_mensal ELSE NULL END AS valor_mensal,
         c.foto_url,
         c.send_event_email, c.event_email_unsub_at,
         c.plataformas_padrao
  FROM public.clientes c
  WHERE c.conta_id = public.get_my_conta_id();
