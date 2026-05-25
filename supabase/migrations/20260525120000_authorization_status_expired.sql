-- Add 'expired' to the authorization_status check constraint
ALTER TABLE instagram_accounts
  DROP CONSTRAINT IF EXISTS instagram_accounts_authorization_status_check;

ALTER TABLE instagram_accounts
  ADD CONSTRAINT instagram_accounts_authorization_status_check
  CHECK (authorization_status IN ('active', 'revoked', 'disconnected', 'expired'));
