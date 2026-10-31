-- YouTube history tables and the report-PDF purge queue
-- (spec docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md, section 5.1;
-- Phase 2 plan task 1).
--
-- Every history table has conta_id as the FIRST column of its primary key and NO foreign key to
-- youtube_channels: two workspaces linking the same channel never share a row, and the purge
-- (youtube_purge_channel, a later migration) deletes history explicitly, filtered by
-- (conta_id, channel_id), instead of relying on a cascade. All six tables are service-role only
-- (RLS on, no policies, REVOKE ALL from PUBLIC/anon/authenticated); the CRM reads them through
-- dedicated analytics edge functions.
--
-- Nullable metrics: Google does not split every metric by creatorContentType, so the split rows
-- ('shorts' | 'long' | 'live') leave the unsplit ones NULL. Only the 'all' row is expected to be
-- complete.
--
-- youtube_video_daily.engaged_views is beyond spec section 5.1's per-video list: the video table
-- in the analytics mockup has an "Engajadas" column (plan ruling P8).
-- youtube_videos.daily_through is the per-video resume cursor for the capped per-video daily
-- reports (plan ruling P7).
--
-- last_sync_attempt_at on youtube_channels and gbp_locations is the cron queue stamp (plan
-- ruling P1): written for every candidate a run looks at, before any work, so a unit that can
-- never sync rotates to the back of the queue instead of starving it.

SET LOCAL lock_timeout = '5s';

-- ============ (1) youtube_channel_daily ============
CREATE TABLE IF NOT EXISTS public.youtube_channel_daily (
  conta_id uuid NOT NULL,
  channel_id text NOT NULL,
  day date NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('all', 'shorts', 'long', 'live')),
  views bigint,
  engaged_views bigint,
  estimated_minutes_watched bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  subscribers_gained bigint,
  subscribers_lost bigint,
  average_view_duration_s numeric,
  PRIMARY KEY (conta_id, channel_id, day, content_type)
);

-- ============ (2) youtube_traffic_daily ============
CREATE TABLE IF NOT EXISTS public.youtube_traffic_daily (
  conta_id uuid NOT NULL,
  channel_id text NOT NULL,
  day date NOT NULL,
  source_type text NOT NULL,
  views bigint,
  PRIMARY KEY (conta_id, channel_id, day, source_type)
);

-- ============ (3) youtube_demographics ============
-- 28-day snapshot refreshed daily; window_end is the last day of the window.
CREATE TABLE IF NOT EXISTS public.youtube_demographics (
  conta_id uuid NOT NULL,
  channel_id text NOT NULL,
  window_end date NOT NULL,
  age_group text NOT NULL,
  gender text NOT NULL,
  viewer_pct numeric,
  PRIMARY KEY (conta_id, channel_id, window_end, age_group, gender)
);

-- ============ (4) youtube_videos ============
CREATE TABLE IF NOT EXISTS public.youtube_videos (
  conta_id uuid NOT NULL,
  channel_id text NOT NULL,
  video_id text NOT NULL,
  title text,
  published_at timestamptz,
  duration_s int,
  is_short boolean,
  thumbnail_url text,
  view_count bigint,
  like_count bigint,
  comment_count bigint,
  metadata_refreshed_at timestamptz,
  daily_through date,
  PRIMARY KEY (conta_id, channel_id, video_id)
);

-- ============ (5) youtube_video_daily ============
CREATE TABLE IF NOT EXISTS public.youtube_video_daily (
  conta_id uuid NOT NULL,
  channel_id text NOT NULL,
  video_id text NOT NULL,
  day date NOT NULL,
  views bigint,
  engaged_views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  subscribers_gained bigint,
  average_view_duration_s numeric,
  average_view_percentage numeric,
  PRIMARY KEY (conta_id, channel_id, video_id, day)
);

-- ============ (6) youtube_pdf_purges ============
-- Storage objects of report PDFs that carried YouTube data (spec section 4.6). The purge RPC
-- queues the path in the same transaction that clears report_documents.pdf_storage_path; the
-- calling function deletes the object after commit and youtube-sync-cron retries leftovers.
CREATE TABLE IF NOT EXISTS public.youtube_pdf_purges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id uuid NOT NULL,
  client_id bigint NOT NULL,
  storage_path text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS youtube_pdf_purges_conta_client_idx
  ON public.youtube_pdf_purges (conta_id, client_id);

-- ============ (7) cron queue stamp ============
ALTER TABLE public.youtube_channels ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;
ALTER TABLE public.gbp_locations ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;

-- ============ (8) access: service role only ============
ALTER TABLE public.youtube_channel_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_traffic_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_demographics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_video_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_pdf_purges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.youtube_channel_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.youtube_traffic_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.youtube_demographics FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.youtube_videos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.youtube_video_daily FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.youtube_pdf_purges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.youtube_channel_daily TO service_role;
GRANT ALL ON TABLE public.youtube_traffic_daily TO service_role;
GRANT ALL ON TABLE public.youtube_demographics TO service_role;
GRANT ALL ON TABLE public.youtube_videos TO service_role;
GRANT ALL ON TABLE public.youtube_video_daily TO service_role;
GRANT ALL ON TABLE public.youtube_pdf_purges TO service_role;
