-- Express posts sent for client approval have no scheduled_at; hub-approve
-- uses this flag to skip the min-10-minutes date check and self-schedule
-- the post at approval time when auto_publish_on_approval is on.
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS is_express boolean NOT NULL DEFAULT false;
