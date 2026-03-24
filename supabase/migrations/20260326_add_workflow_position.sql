-- Add position column to workflows for persistent card ordering within kanban columns
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Backfill distinct positions for existing active workflows
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY template_id, etapa_atual
           ORDER BY id
         ) - 1 AS new_position
  FROM workflows
  WHERE status = 'ativo'
)
UPDATE workflows
SET position = ranked.new_position
FROM ranked
WHERE workflows.id = ranked.id;
