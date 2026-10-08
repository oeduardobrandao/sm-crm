-- supabase/migrations/20261010100007_feature_multiplatform.sql
-- Flag de rollout das plataformas por quadro (spec 2026-09-29-platform-agnostic-posts).
-- Nasce desligada em todos os planos e é ligada por workspace via
-- workspace_plan_overrides.feature_overrides ({"feature_multiplatform": true}),
-- no mesmo desenho de feature_agenda (20261005000001). Lançamento = ligar a coluna
-- nos planos.
--
-- Com a flag desligada o CRM esconde os seletores de plataforma e o banco recusa
-- gravar em workflows.plataformas, workflow_templates.plataformas ou
-- clientes.plataformas_padrao qualquer valor diferente de {instagram} (o default).
-- Todo quadro fica {instagram} e os triggers de post_targets se comportam como
-- antes de P1: o PlatformSelector por post (TikTok, a2) segue funcionando.
--
-- UPDATE só é checado quando a coluna muda de valor: um workspace que teve a flag
-- e a perdeu continua editando os outros campos de um quadro {geral}. Cópias
-- (duplicate_workflow, move_posts_to_new_flow) de um quadro fora de {instagram}
-- num workspace sem a flag levantam o mesmo erro.

SET lock_timeout = '5s';

ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_multiplatform boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.guard_feature_multiplatform()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_new text[];
  v_old text[];
BEGIN
  IF TG_TABLE_NAME = 'clientes' THEN
    v_new := NEW.plataformas_padrao;
    IF TG_OP = 'UPDATE' THEN v_old := OLD.plataformas_padrao; END IF;
  ELSE
    v_new := NEW.plataformas;
    IF TG_OP = 'UPDATE' THEN v_old := OLD.plataformas; END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_new IS NOT DISTINCT FROM v_old THEN
    RETURN NEW;
  END IF;
  IF v_new IS NOT DISTINCT FROM ARRAY['instagram']::text[] THEN
    RETURN NEW;
  END IF;
  IF NOT public.effective_plan_feature(NEW.conta_id, 'feature_multiplatform') THEN
    RAISE EXCEPTION 'feature_disabled:feature_multiplatform' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_feature_multiplatform() FROM public, anon, authenticated;

-- Prefixo a0: roda antes dos demais BEFORE triggers (ordem alfabética).
DROP TRIGGER IF EXISTS workflows_a0_guard_feature_multiplatform ON public.workflows;
CREATE TRIGGER workflows_a0_guard_feature_multiplatform
  BEFORE INSERT OR UPDATE OF plataformas ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.guard_feature_multiplatform();

DROP TRIGGER IF EXISTS workflow_templates_a0_guard_feature_multiplatform ON public.workflow_templates;
CREATE TRIGGER workflow_templates_a0_guard_feature_multiplatform
  BEFORE INSERT OR UPDATE OF plataformas ON public.workflow_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_feature_multiplatform();

DROP TRIGGER IF EXISTS clientes_a0_guard_feature_multiplatform ON public.clientes;
CREATE TRIGGER clientes_a0_guard_feature_multiplatform
  BEFORE INSERT OR UPDATE OF plataformas_padrao ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.guard_feature_multiplatform();
