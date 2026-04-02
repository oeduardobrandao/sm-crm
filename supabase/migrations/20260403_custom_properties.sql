-- ============================================================
-- custom_properties — template-level property fields for posts
-- ============================================================

-- 1. Property definitions (schema, defined on a template)
CREATE TABLE IF NOT EXISTS template_property_definitions (
  id             bigserial PRIMARY KEY,
  template_id    bigint NOT NULL REFERENCES workflow_templates(id) ON DELETE CASCADE,
  conta_id       uuid NOT NULL,
  name           text NOT NULL,
  type           text NOT NULL CHECK (type IN (
                   'text','number','select','multiselect','status',
                   'date','person','checkbox','url','email','phone','created_time'
                 )),
  config         jsonb NOT NULL DEFAULT '{}',
  portal_visible boolean NOT NULL DEFAULT false,
  display_order  integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpd_template ON template_property_definitions(template_id);
CREATE INDEX IF NOT EXISTS idx_tpd_conta ON template_property_definitions(conta_id);

-- 2. Property values (one row per post × definition)
CREATE TABLE IF NOT EXISTS post_property_values (
  id                     bigserial PRIMARY KEY,
  post_id                bigint NOT NULL REFERENCES workflow_posts(id) ON DELETE CASCADE,
  property_definition_id bigint NOT NULL REFERENCES template_property_definitions(id) ON DELETE CASCADE,
  value                  jsonb,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, property_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_ppv_post ON post_property_values(post_id);
CREATE INDEX IF NOT EXISTS idx_ppv_definition ON post_property_values(property_definition_id);
CREATE INDEX IF NOT EXISTS idx_ppv_value ON post_property_values USING GIN (value);

-- 3. Per-workflow additional select options (on-the-fly additions)
CREATE TABLE IF NOT EXISTS workflow_select_options (
  id                     bigserial PRIMARY KEY,
  workflow_id            bigint NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  property_definition_id bigint NOT NULL REFERENCES template_property_definitions(id) ON DELETE CASCADE,
  conta_id               uuid NOT NULL,
  option_id              uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  label                  text NOT NULL,
  color                  text NOT NULL DEFAULT '#94a3b8',
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wso_workflow ON workflow_select_options(workflow_id);
CREATE INDEX IF NOT EXISTS idx_wso_definition ON workflow_select_options(property_definition_id);

-- ============================================================
-- RLS
-- ============================================================

ALTER TABLE template_property_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_property_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_select_options ENABLE ROW LEVEL SECURITY;

-- template_property_definitions: workspace members access own conta
DROP POLICY IF EXISTS "workspace_tpd_all" ON template_property_definitions;
CREATE POLICY "workspace_tpd_all" ON template_property_definitions
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

-- post_property_values: check via parent post's conta_id
DROP POLICY IF EXISTS "workspace_ppv_all" ON post_property_values;
CREATE POLICY "workspace_ppv_all" ON post_property_values
  FOR ALL USING (
    post_id IN (
      SELECT wp.id FROM workflow_posts wp
      WHERE wp.conta_id IN (SELECT public.get_my_conta_id())
    )
  )
  WITH CHECK (
    post_id IN (
      SELECT wp.id FROM workflow_posts wp
      WHERE wp.conta_id IN (SELECT public.get_my_conta_id())
    )
  );

-- workflow_select_options: workspace members access own conta
DROP POLICY IF EXISTS "workspace_wso_all" ON workflow_select_options;
CREATE POLICY "workspace_wso_all" ON workflow_select_options
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (conta_id IN (SELECT public.get_my_conta_id()));

-- Service role bypass (edge functions)
DROP POLICY IF EXISTS "service_role_bypass_tpd" ON template_property_definitions;
CREATE POLICY "service_role_bypass_tpd" ON template_property_definitions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_bypass_ppv" ON post_property_values;
CREATE POLICY "service_role_bypass_ppv" ON post_property_values
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_bypass_wso" ON workflow_select_options;
CREATE POLICY "service_role_bypass_wso" ON workflow_select_options
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================================
-- Triggers
-- ============================================================

-- Trigger to auto-update updated_at on post_property_values
CREATE OR REPLACE FUNCTION set_post_property_values_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_post_property_values_updated_at
  BEFORE UPDATE ON post_property_values
  FOR EACH ROW EXECUTE FUNCTION set_post_property_values_updated_at();
