-- Add website_clicks_28d column to instagram_accounts
ALTER TABLE instagram_accounts
  ADD COLUMN IF NOT EXISTS website_clicks_28d integer DEFAULT 0;
