-- Provenance for MCP agent-created rows. Default 'human' keeps every existing row
-- and the CRM/Express-Post insert paths correct with no code change; MCP sets 'agent'.
ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human'
  CHECK (created_via IN ('human', 'agent'));

ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'human'
  CHECK (created_via IN ('human', 'agent'));
