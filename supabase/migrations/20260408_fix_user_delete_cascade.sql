-- Fix FK constraints that block auth.users deletion.
-- Change NO ACTION to SET NULL so users can be deleted
-- without losing their data (workflows, workspaces, etc).

ALTER TABLE workflow_templates
  DROP CONSTRAINT IF EXISTS workflow_templates_user_id_fkey,
  ADD CONSTRAINT workflow_templates_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE workflows
  DROP CONSTRAINT IF EXISTS workflows_user_id_fkey,
  ADD CONSTRAINT workflows_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE invites
  DROP CONSTRAINT IF EXISTS invites_invited_by_fkey,
  ADD CONSTRAINT invites_invited_by_fkey
    FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE workspaces
  DROP CONSTRAINT IF EXISTS workspaces_created_by_fkey,
  ADD CONSTRAINT workspaces_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
