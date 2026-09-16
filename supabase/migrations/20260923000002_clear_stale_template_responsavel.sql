-- =====================================================================
-- 20260923000002_clear_stale_template_responsavel.sql
-- Bug: migrate_workflow_template correctly rejects a destination template
-- whose etapas carry a responsavel_id for a membro that no longer exists
-- in the workspace ('invalid_responsavel', by design -- see
-- docs/superpowers/specs/2026-08-19-workflow-template-migration-design.md
-- line 103 and test (e5) in supabase/tests/migrate_workflow_template.sql).
-- But nothing was supposed to ever produce that state: workflow_etapas.
-- responsavel_id is a real column with `REFERENCES membros(id) ON DELETE
-- SET NULL` (20260301_baseline_schema.sql), and post_process_steps.
-- responsavel_id has the same guarantee via a composite FK
-- (20260918000002_post_processes_schema.sql) -- an ACTIVE workflow or
-- process self-heals the moment a team member is removed.
-- workflow_templates.etapas is JSONB: the same responsavel_id is just a
-- number inside a blob with no FK, so deleting a `membros` row leaves it
-- dangling forever. Confirmed on prod (2026-09-16): 8 stale references
-- across 5 templates in 4 workspaces, including the exact template/etapa a
-- user hit while migrating a fluxo ("Posts (Estáticos e Carrosséis)",
-- etapa "Design", membro id 3, long since removed from that workspace).
-- The same stale id also breaks creating a NEW workflow from that template
-- (addWorkflowEtapa's INSERT would hit the real FK) and
-- propagate_template_to_workflows (its UPDATE writes the raw JSON value
-- into workflow_etapas.responsavel_id with no existence check) -- this is
-- a data-integrity gap in one place, not a migration-only bug.
--
-- Two parts, mirroring the ON DELETE SET NULL semantics used everywhere
-- else responsavel_id is stored:
--   1. A trigger on membros so future removals clean up
--      workflow_templates.etapas the same way the real FK columns already
--      clean themselves up.
--   2. A one-time backfill nulling the stale references that already
--      exist.
-- migrate_workflow_template's invalid_responsavel guard is untouched and
-- stays exactly as the spec/tests pin it: a defense-in-depth backstop, not
-- the fix.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.clear_stale_template_responsavel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE workflow_templates t
  SET etapas = (
    SELECT jsonb_agg(
      CASE WHEN x.elem ->> 'responsavel_id' = OLD.id::text
           THEN jsonb_set(x.elem, '{responsavel_id}', 'null'::jsonb)
           ELSE x.elem
      END
      ORDER BY x.ord
    )
    FROM jsonb_array_elements(t.etapas) WITH ORDINALITY AS x(elem, ord)
  )
  WHERE t.conta_id = OLD.conta_id
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(t.etapas) AS e(elem)
      WHERE e.elem ->> 'responsavel_id' = OLD.id::text
    );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_stale_template_responsavel ON public.membros;
CREATE TRIGGER trg_clear_stale_template_responsavel
  AFTER DELETE ON public.membros
  FOR EACH ROW
  EXECUTE FUNCTION public.clear_stale_template_responsavel();

-- ---- one-time backfill: references already left dangling ----
-- Per-template loop with its own exception handler (mirrors
-- 20260920000002_backfill_default_workflow_template.sql): one malformed
-- etapas blob must never abort the backfill for every other template, nor
-- abort the migration / db push.
DO $$
DECLARE
  t RECORD;
  v_new_etapas jsonb;
BEGIN
  FOR t IN
    SELECT id, conta_id, etapas FROM workflow_templates
    WHERE etapas IS NOT NULL AND jsonb_typeof(etapas) = 'array' AND jsonb_array_length(etapas) > 0
  LOOP
    BEGIN
      SELECT jsonb_agg(
        CASE
          WHEN x.elem ->> 'responsavel_id' IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM membros m
              WHERE m.conta_id = t.conta_id AND m.id::text = x.elem ->> 'responsavel_id'
            )
          THEN jsonb_set(x.elem, '{responsavel_id}', 'null'::jsonb)
          ELSE x.elem
        END
        ORDER BY x.ord
      )
      INTO v_new_etapas
      FROM jsonb_array_elements(t.etapas) WITH ORDINALITY AS x(elem, ord);

      IF v_new_etapas IS DISTINCT FROM t.etapas THEN
        UPDATE workflow_templates SET etapas = v_new_etapas WHERE id = t.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'clear_stale_template_responsavel backfill skipped for template % (sqlstate %): %', t.id, sqlstate, sqlerrm;
    END;
  END LOOP;
END $$;
