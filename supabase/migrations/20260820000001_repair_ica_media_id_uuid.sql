-- Reparo: AutomationFormDialog gravava instagram_posts.id (uuid interno) em
-- ig_media_id; o media ID real do Graph e instagram_posts.instagram_post_id
-- (UNIQUE). Automacoes "post especifico" nunca casaram no webhook por isso.
UPDATE instagram_comment_automations a
SET ig_media_id = p.instagram_post_id
FROM instagram_posts p
WHERE a.ig_media_id IS NOT NULL
  AND a.ig_media_id = p.id::text;
