-- Add source column to distinguish API-synced vs manually entered follower counts.
-- Manual entries are protected from being overwritten by automatic syncs.
ALTER TABLE instagram_follower_history
  ADD COLUMN source text NOT NULL DEFAULT 'api'
  CHECK (source IN ('api', 'manual'));
