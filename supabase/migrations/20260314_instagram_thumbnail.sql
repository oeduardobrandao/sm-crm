-- Add thumbnail_url to instagram_posts for image previews
ALTER TABLE instagram_posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
