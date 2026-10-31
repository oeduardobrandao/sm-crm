-- Google Meu Negócio history tables
-- (spec docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md, section 5.2;
-- Phase 2 plan task 2).
--
-- Same shape as the YouTube history (20261112000010): conta_id is the FIRST column of every
-- primary key and there is NO foreign key to gbp_locations, because a disconnected or revoked
-- unit keeps its history for 30 days and gbp-sync-cron purges it explicitly, filtered by
-- (conta_id, location_name). Two workspaces linking the same location never share a row. All
-- four tables are service-role only (RLS on, no policies, REVOKE ALL from PUBLIC/anon/
-- authenticated).
--
-- gbp_metrics_daily: the ten Business Profile Performance metrics as lower snake case columns,
-- NOT NULL DEFAULT 0, because the API leaves zero days out and the sync stores the days up to
-- data_through that it omits as zeros. BUSINESS_CONVERSATIONS (removed) and
-- BUSINESS_FOOD_ORDERS (deprecated) are not stored.
-- gbp_search_keywords_monthly: Google gives either an exact value or a threshold ("menos de N"),
-- never both.
-- gbp_reviews: the latest 200 per location (older pruned by the sync); reviewer_name is nullable
-- (anonymous reviewers) and is personal data covered by the privacy policy update.
-- gbp_rating_daily.day is the São Paulo date of the sync.
--
-- gbp_locations.maps_uri comes from Business Information metadata.mapsUri; every "Abrir no
-- Google" link points there.

SET LOCAL lock_timeout = '5s';

-- ============ (1) gbp_metrics_daily ============
CREATE TABLE IF NOT EXISTS public.gbp_metrics_daily (
  conta_id uuid NOT NULL,
  location_name text NOT NULL,
  day date NOT NULL,
  business_impressions_desktop_maps int NOT NULL DEFAULT 0,
  business_impressions_desktop_search int NOT NULL DEFAULT 0,
  business_impressions_mobile_maps int NOT NULL DEFAULT 0,
  business_impressions_mobile_search int NOT NULL DEFAULT 0,
  call_clicks int NOT NULL DEFAULT 0,
  business_direction_requests int NOT NULL DEFAULT 0,
  website_clicks int NOT NULL DEFAULT 0,
  messaging_clicks int NOT NULL DEFAULT 0,
  business_bookings int NOT NULL DEFAULT 0,
  business_food_menu_clicks int NOT NULL DEFAULT 0,
  PRIMARY KEY (conta_id, location_name, day)
);

-- ============ (2) gbp_search_keywords_monthly ============
CREATE TABLE IF NOT EXISTS public.gbp_search_keywords_monthly (
  conta_id uuid NOT NULL,
  location_name text NOT NULL,
  month date NOT NULL,
  keyword text NOT NULL,
  value int,
  threshold int,
  PRIMARY KEY (conta_id, location_name, month, keyword),
  CONSTRAINT gbp_search_keywords_value_xor_threshold
    CHECK ((value IS NULL) <> (threshold IS NULL))
);

-- ============ (3) gbp_reviews ============
CREATE TABLE IF NOT EXISTS public.gbp_reviews (
  conta_id uuid NOT NULL,
  location_name text NOT NULL,
  review_id text NOT NULL,
  reviewer_name text,
  star_rating smallint NOT NULL CHECK (star_rating BETWEEN 1 AND 5),
  comment text,
  create_time timestamptz,
  update_time timestamptz,
  has_reply boolean NOT NULL DEFAULT false,
  PRIMARY KEY (conta_id, location_name, review_id)
);

-- ============ (4) gbp_rating_daily ============
CREATE TABLE IF NOT EXISTS public.gbp_rating_daily (
  conta_id uuid NOT NULL,
  location_name text NOT NULL,
  day date NOT NULL,
  average_rating numeric(2,1),
  total_review_count int,
  PRIMARY KEY (conta_id, location_name, day)
);

-- ============ (5) gbp_locations.maps_uri ============
ALTER TABLE public.gbp_locations ADD COLUMN IF NOT EXISTS maps_uri text;

-- ============ (6) access: service role only ============
ALTER TABLE public.gbp_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_search_keywords_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_rating_daily ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.gbp_metrics_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gbp_search_keywords_monthly FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gbp_reviews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.gbp_rating_daily FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.gbp_metrics_daily TO service_role;
GRANT ALL ON TABLE public.gbp_search_keywords_monthly TO service_role;
GRANT ALL ON TABLE public.gbp_reviews TO service_role;
GRANT ALL ON TABLE public.gbp_rating_daily TO service_role;
