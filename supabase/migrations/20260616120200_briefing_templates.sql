CREATE TABLE briefing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  title text NOT NULL,
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ question: string, section: string|null }]
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one default template per workspace.
CREATE UNIQUE INDEX briefing_templates_one_default
  ON briefing_templates (conta_id) WHERE is_default;

ALTER TABLE briefing_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefing_templates_select" ON briefing_templates;
CREATE POLICY "briefing_templates_select" ON briefing_templates
  FOR SELECT USING ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefing_templates_insert" ON briefing_templates;
CREATE POLICY "briefing_templates_insert" ON briefing_templates
  FOR INSERT WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefing_templates_update" ON briefing_templates;
CREATE POLICY "briefing_templates_update" ON briefing_templates
  FOR UPDATE USING ( conta_id IN (SELECT public.get_my_conta_id()) )
  WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefing_templates_delete" ON briefing_templates;
CREATE POLICY "briefing_templates_delete" ON briefing_templates
  FOR DELETE USING ( conta_id IN (SELECT public.get_my_conta_id()) );

-- Transactional set-default: clears the workspace's other defaults, sets this one.
-- SECURITY INVOKER so RLS still applies (a user only sees/touches their own workspace rows;
-- passing a foreign template id makes the SELECT return NULL -> raises).
CREATE OR REPLACE FUNCTION set_default_briefing_template(p_template_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_conta_id uuid;
BEGIN
  SELECT conta_id INTO v_conta_id FROM briefing_templates WHERE id = p_template_id;
  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'Template not found';
  END IF;
  UPDATE briefing_templates SET is_default = false
    WHERE conta_id = v_conta_id AND is_default AND id <> p_template_id;
  UPDATE briefing_templates SET is_default = true WHERE id = p_template_id;
END;
$$;
