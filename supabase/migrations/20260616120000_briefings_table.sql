CREATE TABLE briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX briefings_cliente_id_idx ON briefings (cliente_id);

ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "briefings_select" ON briefings;
CREATE POLICY "briefings_select" ON briefings
  FOR SELECT USING ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefings_insert" ON briefings;
CREATE POLICY "briefings_insert" ON briefings
  FOR INSERT WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefings_update" ON briefings;
CREATE POLICY "briefings_update" ON briefings
  FOR UPDATE USING ( conta_id IN (SELECT public.get_my_conta_id()) )
  WITH CHECK ( conta_id IN (SELECT public.get_my_conta_id()) );

DROP POLICY IF EXISTS "briefings_delete" ON briefings;
CREATE POLICY "briefings_delete" ON briefings
  FOR DELETE USING ( conta_id IN (SELECT public.get_my_conta_id()) );
