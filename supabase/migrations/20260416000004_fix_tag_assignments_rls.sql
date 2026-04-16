-- Fix RLS policy on instagram_post_tag_assignments to also verify
-- post ownership, preventing cross-workspace tag injection.

DROP POLICY IF EXISTS "tag_assignments_via_tags" ON instagram_post_tag_assignments;

CREATE POLICY "tag_assignments_via_tags" ON instagram_post_tag_assignments
  FOR ALL
  USING (
    tag_id IN (
      SELECT id FROM instagram_post_tags
      WHERE conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
    )
    AND post_id IN (
      SELECT ip.id FROM instagram_posts ip
      JOIN instagram_accounts ia ON ip.instagram_account_id = ia.id
      JOIN clientes c ON ia.client_id = c.id
      WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
    )
  )
  WITH CHECK (
    tag_id IN (
      SELECT id FROM instagram_post_tags
      WHERE conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
    )
    AND post_id IN (
      SELECT ip.id FROM instagram_posts ip
      JOIN instagram_accounts ia ON ip.instagram_account_id = ia.id
      JOIN clientes c ON ia.client_id = c.id
      WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
    )
  );
