-- Track which Instagram metrics the API did not return at last sync, so the MCP
-- rate layer can tell a real 0 from a missing value. Count columns stay numeric.
ALTER TABLE instagram_posts
  ADD COLUMN IF NOT EXISTS unavailable_metrics text[] NOT NULL DEFAULT '{}';

-- Backfill: the old sync fetched `shares` only for media_type = 'VIDEO'
-- (instagram-integration/index.ts), so historical image/carousel rows carry a
-- real-looking shares = 0 that would poison share-rate baselines. Mark them.
UPDATE instagram_posts
   SET unavailable_metrics = array_append(unavailable_metrics, 'shares')
 WHERE media_type <> 'VIDEO'
   AND NOT ('shares' = ANY(unavailable_metrics));
