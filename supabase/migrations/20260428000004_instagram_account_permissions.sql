ALTER TABLE instagram_accounts
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{}';
