-- Create user_role enum if missing (was created manually in production).
-- Also cast profiles.role to the enum type if it's still text.
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('owner', 'admin', 'agent');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE profiles ALTER COLUMN role TYPE user_role USING role::user_role;
EXCEPTION WHEN others THEN NULL;
END $$;
