-- Creates portal_tokens and client_hub_tokens tables.
-- These were originally created via dashboard; this migration ensures
-- they exist for fresh database setups (e.g. staging).

-- 1. portal_tokens — links a workflow to a shareable token for the portal
CREATE TABLE IF NOT EXISTS portal_tokens (
  id          bigserial PRIMARY KEY,
  workflow_id bigint NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  conta_id    uuid NOT NULL,
  token       uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workflow_id)
);

ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portal_tokens_workspace_all" ON portal_tokens
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "portal_tokens_service_role" ON portal_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. client_hub_tokens — links a client to a hub access token
CREATE TABLE IF NOT EXISTS client_hub_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id    uuid NOT NULL,
  token       uuid NOT NULL DEFAULT gen_random_uuid(),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(token)
);

ALTER TABLE client_hub_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_hub_tokens_workspace_all" ON client_hub_tokens
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "client_hub_tokens_service_role" ON client_hub_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. hub_brand — client branding for the Hub portal
CREATE TABLE IF NOT EXISTS hub_brand (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE UNIQUE,
  logo_url        text,
  primary_color   text,
  secondary_color text,
  font_primary    text,
  font_secondary  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hub_brand ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_brand_workspace_all" ON hub_brand
  FOR ALL USING (cliente_id IN (SELECT id FROM clientes WHERE conta_id IN (SELECT public.get_my_conta_id())))
  WITH CHECK (cliente_id IN (SELECT id FROM clientes WHERE conta_id IN (SELECT public.get_my_conta_id())));

CREATE POLICY "hub_brand_service_role" ON hub_brand
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. hub_brand_files — brand assets
CREATE TABLE IF NOT EXISTS hub_brand_files (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  name            text NOT NULL,
  file_url        text NOT NULL,
  file_type       text NOT NULL,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hub_brand_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_brand_files_workspace_all" ON hub_brand_files
  FOR ALL USING (cliente_id IN (SELECT id FROM clientes WHERE conta_id IN (SELECT public.get_my_conta_id())))
  WITH CHECK (cliente_id IN (SELECT id FROM clientes WHERE conta_id IN (SELECT public.get_my_conta_id())));

CREATE POLICY "hub_brand_files_service_role" ON hub_brand_files
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. hub_pages — client portal pages
CREATE TABLE IF NOT EXISTS hub_pages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id        uuid NOT NULL,
  cliente_id      bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  title           text NOT NULL,
  content         jsonb NOT NULL DEFAULT '[]'::jsonb,
  display_order   int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE hub_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_pages_workspace_all" ON hub_pages
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY "hub_pages_service_role" ON hub_pages
  FOR ALL TO service_role USING (true) WITH CHECK (true);
