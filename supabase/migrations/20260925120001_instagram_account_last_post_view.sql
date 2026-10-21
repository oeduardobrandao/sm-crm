-- Latest post date per Instagram account, for the portfolio "Último Post" column.
--
-- Both callers (instagram-analytics /portfolio and getPortfolioSummary in the CRM)
-- used to fetch every instagram_posts row of the workspace ordered by posted_at
-- and keep the first per account. PostgREST caps responses at 1000 rows, so in
-- workspaces past that (3 in prod on 2026-09-24, the newest 1000 rows spanning
-- ~108 days in the largest) an account idle longer than the window silently lost
-- its last post. This returns one row per account instead.
--
-- security_invoker: callers keep instagram_posts' RLS ("posts_via_account"), so
-- the CRM's authenticated client only sees its own workspace's accounts. The
-- account filter is pushed below the GROUP BY onto idx_ig_posts_account_posted
-- (index-only scan; 2.5 ms for 25 accounts / 2.4k posts in prod).

CREATE OR REPLACE VIEW public.instagram_account_last_post
  WITH (security_invoker = true) AS
SELECT instagram_account_id, max(posted_at) AS last_post_at
  FROM public.instagram_posts
 GROUP BY instagram_account_id;

REVOKE ALL ON public.instagram_account_last_post FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.instagram_account_last_post TO authenticated, service_role;
