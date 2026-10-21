-- Finish 20260408_fix_user_delete_cascade.sql.
--
-- That migration switched these FKs to auth.users to ON DELETE SET NULL so a
-- deleted user's workspace data survives, but left the columns NOT NULL. The
-- SET NULL action then violates the constraint and the whole DELETE FROM
-- auth.users errors. Since 20260920000001 every fresh signup owns a seeded
-- "Padrão" workflow_templates row, so no signup-created user could be deleted.
--
-- Prod already had workflow_templates.user_id and workflows.user_id made
-- nullable out of band; staging and migration-built databases did not, and
-- invites.invited_by was NOT NULL everywhere. DROP NOT NULL is a no-op on a
-- column that is already nullable, so this is safe on every environment.
--
-- RLS on these tables keys on conta_id, not user_id; a NULL user_id only means
-- "creator no longer exists".

ALTER TABLE public.workflow_templates ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.workflows ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.invites ALTER COLUMN invited_by DROP NOT NULL;
