-- Revoking an MCP connection must also end it on the Supabase OAuth server.
--
-- Until now, revoking a connection (mcp-oauth-consent revoke-grant / revoke-admin-grant) only set
-- revoked_at on OUR grant (mcp_oauth_grants / admin_mcp_oauth_grants). Supabase's own consent
-- (auth.oauth_consents) and the client's sessions (auth.sessions.oauth_client_id) stayed alive, so:
--   * the client kept refreshing a valid user JWT (refused by `mcp`, but a user token all the same);
--   * reconnecting looped: Supabase saw the old consent and auto-approved, the consent page jumped
--     straight to the callback without re-recording our grant, and `mcp` kept answering 401.
--
-- mcp_revoke_oauth_client_access ends the consent and deletes the sessions (refresh tokens cascade)
-- for one user + client, but only while that user holds no ACTIVE grant for the client in either
-- table: the same OAuth client may back a workspace grant and a platform-admin grant. A trigger on
-- both grant tables runs it whenever revoked_at goes from NULL to a value, so every revoke path
-- (mcp-oauth-consent, platform-admin single and revoke-all, the Admin MCP grants, plain SQL) ends
-- the client's access; a failure there only warns, it never undoes the revocation itself.
-- mcp_oauth_prepare_authorization runs it for the client behind a pending authorization, before
-- the consent page asks Supabase for the details (that call is what auto-approves), so a stale
-- consent turns back into a normal consent screen.
--
-- Both are SECURITY DEFINER (auth.* is owned by supabase_auth_admin; postgres may write it) and
-- EXECUTE is service_role only: mcp-oauth-consent passes the caller's verified user id.
-- plpgsql on purpose: a SQL-language body is resolved at CREATE time, and auth.oauth_* only exists
-- where the OAuth server is enabled.

CREATE OR REPLACE FUNCTION public.mcp_revoke_oauth_client_access(p_user_id uuid, p_client_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client uuid;
BEGIN
  IF p_user_id IS NULL OR p_client_id IS NULL THEN
    RETURN false;
  END IF;
  BEGIN
    v_client := p_client_id::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  IF EXISTS (SELECT 1 FROM public.mcp_oauth_grants
              WHERE user_id = p_user_id AND client_id = p_client_id AND revoked_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.admin_mcp_oauth_grants
                 WHERE user_id = p_user_id AND client_id = p_client_id AND revoked_at IS NULL) THEN
    RETURN false;
  END IF;

  UPDATE auth.oauth_consents
     SET revoked_at = now()
   WHERE user_id = p_user_id AND client_id = v_client AND revoked_at IS NULL;

  DELETE FROM auth.sessions
   WHERE user_id = p_user_id AND oauth_client_id = v_client;

  RETURN true;
END;
$$;

-- Returns 'repaired' when the client behind this pending authorization had no active grant of the
-- caller (the caller's consent and sessions for it were cleared), 'ok' when nothing needed
-- clearing, 'not_found' when there is no such live pending authorization, or it is bound to
-- another user. Supabase only binds user_id when the consent page fetches the details, which is
-- exactly the call this runs before, so an unbound authorization is the normal case. That is safe:
-- the authorization only names the client, and the only thing ever touched is p_user_id's (the
-- JWT-verified caller's) own consent and sessions for that client.
CREATE OR REPLACE FUNCTION public.mcp_oauth_prepare_authorization(p_authorization_id text, p_user_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_client uuid;
BEGIN
  SELECT client_id INTO v_client
    FROM auth.oauth_authorizations
   WHERE authorization_id = p_authorization_id
     AND (user_id IS NULL OR user_id = p_user_id)
     AND status = 'pending'
     AND expires_at > now();
  IF v_client IS NULL THEN
    RETURN 'not_found';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.oauth_consents
                  WHERE user_id = p_user_id AND client_id = v_client AND revoked_at IS NULL) THEN
    RETURN 'ok';
  END IF;

  IF public.mcp_revoke_oauth_client_access(p_user_id, v_client::text) THEN
    RETURN 'repaired';
  END IF;
  RETURN 'ok';
END;
$$;

CREATE OR REPLACE FUNCTION public.mcp_oauth_grant_revoked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  BEGIN
    PERFORM public.mcp_revoke_oauth_client_access(NEW.user_id, NEW.client_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'mcp_oauth_grant_revoked: could not end OAuth client access (%)', SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mcp_oauth_grant_revoked ON public.mcp_oauth_grants;
CREATE TRIGGER trg_mcp_oauth_grant_revoked
  AFTER UPDATE OF revoked_at ON public.mcp_oauth_grants
  FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION public.mcp_oauth_grant_revoked();

DROP TRIGGER IF EXISTS trg_admin_mcp_oauth_grant_revoked ON public.admin_mcp_oauth_grants;
CREATE TRIGGER trg_admin_mcp_oauth_grant_revoked
  AFTER UPDATE OF revoked_at ON public.admin_mcp_oauth_grants
  FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION public.mcp_oauth_grant_revoked();

REVOKE ALL ON FUNCTION public.mcp_revoke_oauth_client_access(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_prepare_authorization(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mcp_oauth_grant_revoked() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_revoke_oauth_client_access(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mcp_oauth_prepare_authorization(text, uuid) TO service_role;

-- Backfill: connections revoked before this migration. Same rule as the function: only user +
-- client pairs with no active grant left in either table.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('auth.oauth_consents') IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT DISTINCT user_id, client_id FROM public.mcp_oauth_grants WHERE revoked_at IS NOT NULL
    UNION
    SELECT DISTINCT user_id, client_id FROM public.admin_mcp_oauth_grants WHERE revoked_at IS NOT NULL
  LOOP
    PERFORM public.mcp_revoke_oauth_client_access(r.user_id, r.client_id);
  END LOOP;
END;
$$;
