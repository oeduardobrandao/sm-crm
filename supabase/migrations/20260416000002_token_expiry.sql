-- Add expires_at to portal_tokens (default: 90 days from creation for existing rows)
ALTER TABLE portal_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE portal_tokens
  SET expires_at = created_at + interval '90 days'
  WHERE expires_at IS NULL;

ALTER TABLE portal_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '90 days'),
  ALTER COLUMN expires_at SET NOT NULL;

-- Add expires_at to client_hub_tokens (default: never — set to year 2100 for existing rows)
ALTER TABLE client_hub_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE client_hub_tokens
  SET expires_at = '2100-01-01'::timestamptz
  WHERE expires_at IS NULL;

ALTER TABLE client_hub_tokens
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '365 days'),
  ALTER COLUMN expires_at SET NOT NULL;
