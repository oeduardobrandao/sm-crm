-- Create contas table and user_role enum if missing.
-- Both were created manually in production via Supabase dashboard
-- but never captured in a migration. This covers existing DBs;
-- the baseline (20260301) handles fresh installs.

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'admin', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS contas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  slug text,
  created_at timestamptz DEFAULT now()
);

-- Ensure profiles.role uses the enum type (idempotent).
-- On fresh installs the baseline creates it as text; the cast makes it enum.
DO $$ BEGIN
  ALTER TABLE profiles ALTER COLUMN role TYPE user_role USING role::user_role;
EXCEPTION WHEN others THEN NULL;
END $$;
