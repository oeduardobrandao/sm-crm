CREATE TABLE hub_briefing_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id bigint NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
