-- 1) New table
CREATE TABLE instagram_story_insights (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id uuid NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  instagram_media_id   text NOT NULL,
  media_type           text NOT NULL DEFAULT 'STORY',
  thumbnail_url        text,
  posted_at            timestamptz NOT NULL,
  expired_at           timestamptz NOT NULL,
  reach                integer,
  impressions          integer,
  replies              integer,
  taps_forward         integer,
  taps_back            integer,
  exits                integer,
  shares               integer,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, instagram_media_id)
);

CREATE INDEX idx_story_insights_account_posted
  ON instagram_story_insights (instagram_account_id, posted_at DESC);

ALTER TABLE instagram_story_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON instagram_story_insights
  USING (auth.role() = 'service_role');

-- 2) Daily columns
ALTER TABLE instagram_account_metrics_daily
  ADD COLUMN stories_count_day        integer,
  ADD COLUMN stories_reach_day        integer,
  ADD COLUMN stories_impressions_day  integer,
  ADD COLUMN stories_replies_day      integer,
  ADD COLUMN stories_taps_forward_day integer,
  ADD COLUMN stories_taps_back_day    integer,
  ADD COLUMN stories_exits_day        integer;

-- 3) Monthly columns
ALTER TABLE instagram_account_metrics_monthly
  ADD COLUMN stories_count_month        integer,
  ADD COLUMN stories_reach_month        integer,
  ADD COLUMN stories_impressions_month  integer,
  ADD COLUMN stories_replies_month      integer,
  ADD COLUMN stories_taps_forward_month integer,
  ADD COLUMN stories_taps_back_month    integer,
  ADD COLUMN stories_exits_month        integer;

-- 4) Updated RPC with stories columns
CREATE OR REPLACE FUNCTION upsert_metrics_daily(p_rows jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO instagram_account_metrics_daily AS t (
    instagram_account_id, snapshot_date,
    reach_day, views_day, saves_day, accounts_engaged_day,
    profile_views_day, website_clicks_day, follows_day, unfollows_day,
    stories_count_day, stories_reach_day, stories_impressions_day,
    stories_replies_day, stories_taps_forward_day, stories_taps_back_day,
    stories_exits_day
  )
  SELECT
    (r->>'instagram_account_id')::uuid,
    (r->>'snapshot_date')::date,
    (r->>'reach_day')::integer, (r->>'views_day')::integer,
    (r->>'saves_day')::integer, (r->>'accounts_engaged_day')::integer,
    (r->>'profile_views_day')::integer, (r->>'website_clicks_day')::integer,
    (r->>'follows_day')::integer, (r->>'unfollows_day')::integer,
    (r->>'stories_count_day')::integer, (r->>'stories_reach_day')::integer,
    (r->>'stories_impressions_day')::integer, (r->>'stories_replies_day')::integer,
    (r->>'stories_taps_forward_day')::integer, (r->>'stories_taps_back_day')::integer,
    (r->>'stories_exits_day')::integer
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (instagram_account_id, snapshot_date) DO UPDATE SET
    reach_day              = COALESCE(EXCLUDED.reach_day, t.reach_day),
    views_day              = COALESCE(EXCLUDED.views_day, t.views_day),
    saves_day              = COALESCE(EXCLUDED.saves_day, t.saves_day),
    accounts_engaged_day   = COALESCE(EXCLUDED.accounts_engaged_day, t.accounts_engaged_day),
    profile_views_day      = COALESCE(EXCLUDED.profile_views_day, t.profile_views_day),
    website_clicks_day     = COALESCE(EXCLUDED.website_clicks_day, t.website_clicks_day),
    follows_day            = COALESCE(EXCLUDED.follows_day, t.follows_day),
    unfollows_day          = COALESCE(EXCLUDED.unfollows_day, t.unfollows_day),
    stories_count_day      = COALESCE(EXCLUDED.stories_count_day, t.stories_count_day),
    stories_reach_day      = COALESCE(EXCLUDED.stories_reach_day, t.stories_reach_day),
    stories_impressions_day = COALESCE(EXCLUDED.stories_impressions_day, t.stories_impressions_day),
    stories_replies_day    = COALESCE(EXCLUDED.stories_replies_day, t.stories_replies_day),
    stories_taps_forward_day = COALESCE(EXCLUDED.stories_taps_forward_day, t.stories_taps_forward_day),
    stories_taps_back_day  = COALESCE(EXCLUDED.stories_taps_back_day, t.stories_taps_back_day),
    stories_exits_day      = COALESCE(EXCLUDED.stories_exits_day, t.stories_exits_day);
$$;

REVOKE ALL ON FUNCTION upsert_metrics_daily(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) FROM authenticated;
