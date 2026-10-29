-- Google connections and the per-client links for YouTube and Google Meu Negócio
-- (spec docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md, section 4).
--
-- google_connections: one row per (workspace, Google account), tokens encrypted with
--   TOKEN_ENCRYPTION_KEY by the edge functions. refresh_lock_at serializes token refreshes.
-- google_revocations: queue of tokens still to be revoked at Google (retried by a cron).
-- youtube_channels: one channel per client, unique per workspace.
-- gbp_locations: Google Meu Negócio units, many per client, unique per workspace. A
--   disconnected unit keeps its row (and later its history) after its connection is gone,
--   which is why connection_id is ON DELETE SET NULL and only 'disconnected' may lose it.
--
-- All four are service-role only: RLS on, no policies, nothing granted to anon or
-- authenticated. The CRM reads them through the google-integration edge function, which is
-- why gbp_locations is tightened from the spec's "RLS: client's workspace".
--
-- youtube_channels.connection_id is ON DELETE NO ACTION, not RESTRICT: deleting a workspace
-- cascades to both google_connections and clientes -> youtube_channels in the same
-- statement, and RESTRICT would fail mid-cascade where NO ACTION checks at the end.
--
-- oauth_states.provider gains 'google' (one provider for both products; the state payload
-- carries which product the flow is for).

SET LOCAL lock_timeout = '5s';

-- ============ (1) google_connections ============
CREATE TABLE IF NOT EXISTS public.google_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  google_sub text NOT NULL,
  email text NOT NULL,
  display_name text,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  refresh_lock_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, google_sub)
);
CREATE INDEX IF NOT EXISTS google_connections_google_sub_idx
  ON public.google_connections (google_sub);

-- ============ (2) google_revocations ============
CREATE TABLE IF NOT EXISTS public.google_revocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub text NOT NULL,
  encrypted_token text NOT NULL,
  token_kind text NOT NULL CHECK (token_kind IN ('refresh', 'access')),
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============ (3) youtube_channels ============
CREATE TABLE IF NOT EXISTS public.youtube_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id bigint NOT NULL UNIQUE REFERENCES public.clientes(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.google_connections(id) ON DELETE NO ACTION,
  channel_id text NOT NULL,
  title text,
  handle text,
  avatar_url text,
  uploads_playlist_id text,
  subscriber_count bigint,
  view_count bigint,
  video_count bigint,
  shorts_count int,
  long_count int,
  authorization_status text NOT NULL DEFAULT 'active'
    CHECK (authorization_status IN ('active', 'revoked')),
  revoked_at timestamptz,
  last_synced_at timestamptz,
  data_through date,
  content_type_through date,
  traffic_through date,
  videos_through date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, channel_id)
);
CREATE INDEX IF NOT EXISTS youtube_channels_connection_id_idx
  ON public.youtube_channels (connection_id);

-- ============ (4) gbp_locations ============
CREATE TABLE IF NOT EXISTS public.gbp_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  client_id bigint NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  connection_id uuid REFERENCES public.google_connections(id) ON DELETE SET NULL,
  account_name text NOT NULL,
  location_name text NOT NULL,
  title text,
  address_line text,
  website text,
  has_voice_of_merchant boolean NOT NULL DEFAULT false,
  average_rating numeric(2,1),
  total_review_count int,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disconnected', 'revoked')),
  disconnected_at timestamptz,
  last_synced_at timestamptz,
  data_through date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conta_id, location_name),
  CONSTRAINT gbp_locations_disconnected_at_check
    CHECK ((status = 'active') = (disconnected_at IS NULL)),
  CONSTRAINT gbp_locations_connection_check
    CHECK (status = 'disconnected' OR connection_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS gbp_locations_client_id_idx
  ON public.gbp_locations (client_id);
CREATE INDEX IF NOT EXISTS gbp_locations_connection_id_idx
  ON public.gbp_locations (connection_id);

-- ============ (5) access: service role only ============
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.google_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_locations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.google_connections FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.google_revocations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.youtube_channels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gbp_locations FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.google_connections TO service_role;
GRANT ALL ON TABLE public.google_revocations TO service_role;
GRANT ALL ON TABLE public.youtube_channels TO service_role;
GRANT ALL ON TABLE public.gbp_locations TO service_role;

-- ============ (6) updated_at triggers ============
CREATE OR REPLACE FUNCTION public.set_google_connections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_google_connections_updated_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS google_connections_updated_at ON public.google_connections;
CREATE TRIGGER google_connections_updated_at
  BEFORE UPDATE ON public.google_connections
  FOR EACH ROW EXECUTE FUNCTION public.set_google_connections_updated_at();

CREATE OR REPLACE FUNCTION public.set_youtube_channels_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_youtube_channels_updated_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS youtube_channels_updated_at ON public.youtube_channels;
CREATE TRIGGER youtube_channels_updated_at
  BEFORE UPDATE ON public.youtube_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_youtube_channels_updated_at();

CREATE OR REPLACE FUNCTION public.set_gbp_locations_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.set_gbp_locations_updated_at() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS gbp_locations_updated_at ON public.gbp_locations;
CREATE TRIGGER gbp_locations_updated_at
  BEFORE UPDATE ON public.gbp_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_gbp_locations_updated_at();

-- ============ (7) oauth_states.provider gains 'google' ============
-- The CHECK from 20260718000001_tiktok_core.sql:85-87 is inline, so its name is generated:
-- find it by body. '(provider = ANY' matches only the provider CHECK.
DO $$
DECLARE r record; v_dropped int := 0;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.oauth_states'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%(provider = ANY%'
  LOOP
    EXECUTE format('ALTER TABLE public.oauth_states DROP CONSTRAINT %I', r.conname);
    v_dropped := v_dropped + 1;
  END LOOP;
  IF v_dropped <> 1 THEN
    RAISE EXCEPTION 'expected 1 provider CHECK on oauth_states, found %', v_dropped;
  END IF;
END $$;
ALTER TABLE public.oauth_states
  ADD CONSTRAINT oauth_states_provider_check
  CHECK (provider IN ('instagram', 'tiktok', 'google'));
