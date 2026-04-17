-- VULN-007: When token refresh fails (user revoked access, token expired),
-- the UI still shows "Connected" because there is no status column.
-- Add authorization_status so the cron can flag revoked tokens.

ALTER TABLE instagram_accounts
  ADD COLUMN IF NOT EXISTS authorization_status text NOT NULL DEFAULT 'active'
  CHECK (authorization_status IN ('active', 'revoked'));
