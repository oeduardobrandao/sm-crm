-- Make auth.users.encrypted_password the authority on "can this person log in",
-- instead of the drift-prone profiles.onboarding_complete flag.
--
-- The Supabase admin API does not expose encrypted_password, and last_sign_in_at
-- cannot substitute: clicking an invite link mints a session without any password
-- ever being set. invite-user needs a DB-side answer.
--
-- Applied by hand to PROD on 2026-07-21 (SQL editor) ahead of this file; both
-- statements are idempotent, so re-application is a no-op.

CREATE OR REPLACE FUNCTION public.user_has_password(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(u.encrypted_password, '') <> ''
  FROM auth.users u
  WHERE u.id = p_user_id;
$$;

-- "Does this address have a password" is an account-enumeration primitive.
-- Service role only.
--
-- PUBLIC is the one that matters: Postgres grants EXECUTE on a new function to
-- PUBLIC by default, and every role inherits it. Revoking from anon/authenticated
-- alone leaves the function callable by any signed-in user. The named roles are
-- listed too so the intent survives a future default-privileges change.
REVOKE EXECUTE ON FUNCTION public.user_has_password(uuid) FROM PUBLIC, anon, authenticated;

-- Revoking PUBLIC (above) also removes service_role, which reaches public schema
-- functions only through the implicit PUBLIC grant. invite-user calls this with
-- the service-role key, so it must be granted back explicitly -- without this the
-- RPC always errors, degrades to "unknown", and the veto never fires.
GRANT EXECUTE ON FUNCTION public.user_has_password(uuid) TO service_role;

-- One-time repair. 20260629000001 blanket-set onboarding_complete = true for every
-- pre-existing profile as a safety measure against the destructive reinvite branch;
-- that marked passwordless invitees as onboarded, pinning them to the silent
-- add-direct path forever. No date filter: "has no password" is itself the correct
-- discriminator, so this also catches rows corrupted by the healPendingInvite bug
-- (PR #175). Safe because login is password-only — no OAuth/OTP sign-in exists in
-- either app, so no legitimate user has an empty password.
UPDATE profiles p
SET onboarding_complete = false
FROM auth.users u
WHERE u.id = p.id
  AND p.onboarding_complete = true
  AND coalesce(u.encrypted_password, '') = '';
