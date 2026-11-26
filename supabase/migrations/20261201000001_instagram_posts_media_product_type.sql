-- Tipo de produto do post na Graph API (FEED, REELS, STORY, AD). Nulo = post
-- sincronizado antes desta coluna; o próximo sync preenche.
alter table public.instagram_posts add column if not exists media_product_type text;
