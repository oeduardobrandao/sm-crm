-- supabase/migrations/20260410_client_hub.sql

-- 1. Add workspace slug + hub branding to contas
ALTER TABLE contas
  ADD COLUMN IF NOT EXISTS slug text UNIQUE,
  ADD COLUMN IF NOT EXISTS brand_color text,
  ADD COLUMN IF NOT EXISTS hub_enabled boolean NOT NULL DEFAULT true;

-- Backfill slugs from existing workspace names (lowercase, spaces → hyphens)
UPDATE contas SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
  WHERE slug IS NULL;

ALTER TABLE contas ALTER COLUMN slug SET NOT NULL;

-- 2. Client hub tokens
CREATE TABLE IF NOT EXISTS client_hub_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id integer NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-create a token for every existing client
INSERT INTO client_hub_tokens (cliente_id, conta_id)
SELECT c.id, c.conta_id FROM clientes c
WHERE NOT EXISTS (
  SELECT 1 FROM client_hub_tokens t WHERE t.cliente_id = c.id
);

-- 3. Brand center
CREATE TABLE IF NOT EXISTS hub_brand (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id integer NOT NULL UNIQUE REFERENCES clientes(id) ON DELETE CASCADE,
  logo_url text,
  primary_color text,
  secondary_color text,
  font_primary text,
  font_secondary text
);

CREATE TABLE IF NOT EXISTS hub_brand_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  name text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL DEFAULT 'file',
  display_order integer NOT NULL DEFAULT 0
);

-- 4. Custom pages
CREATE TABLE IF NOT EXISTS hub_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id integer NOT NULL REFERENCES contas(id) ON DELETE CASCADE,
  cliente_id integer NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  title text NOT NULL,
  content jsonb NOT NULL DEFAULT '[]',
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
