-- Add Hub-related columns to workspaces that were created manually in
-- production but never captured in a migration. Required by hub-bootstrap.

ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS hub_enabled boolean NOT NULL DEFAULT true;

-- Backfill slugs from the contas table where available.
UPDATE workspaces w
  SET slug = c.slug
  FROM contas c
  WHERE c.id = w.id
    AND w.slug IS NULL
    AND c.slug IS NOT NULL;

-- For any remaining workspaces without a slug, generate one from the name.
UPDATE workspaces
  SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'))
             || '-' || substr(replace(id::text, '-', ''), 1, 8)
  WHERE slug IS NULL;

-- Now enforce uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces (slug);
