-- Enable RLS on core Instagram tables
-- These tables were created via dashboard without RLS policies

-- 1. instagram_accounts
ALTER TABLE instagram_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_conta" ON instagram_accounts
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clientes c
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

-- 2. instagram_posts
ALTER TABLE instagram_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "posts_via_account" ON instagram_posts
  FOR ALL USING (instagram_account_id IN (
    SELECT ia.id FROM instagram_accounts ia
    JOIN clientes c ON c.id = ia.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

-- 3. instagram_follower_history
ALTER TABLE instagram_follower_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follower_history_via_account" ON instagram_follower_history
  FOR ALL USING (instagram_account_id IN (
    SELECT ia.id FROM instagram_accounts ia
    JOIN clientes c ON c.id = ia.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));
