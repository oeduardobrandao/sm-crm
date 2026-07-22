-- Estúdio retirement: the editor, its edge functions and its MCP tools are gone, so these
-- plan gates no longer gate anything. Dropping them keeps effective_plan_feature() honest.
ALTER TABLE plans DROP COLUMN IF EXISTS feature_estudio;
ALTER TABLE plans DROP COLUMN IF EXISTS feature_ai_images;
ALTER TABLE plans DROP COLUMN IF EXISTS rate_ai_images_per_month;
