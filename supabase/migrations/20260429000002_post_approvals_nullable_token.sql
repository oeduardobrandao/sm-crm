-- Allow workspace user replies without a portal token
ALTER TABLE post_approvals ALTER COLUMN token DROP NOT NULL;
