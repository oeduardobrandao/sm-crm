# Central de Ajuda: view counts in the Admin

**Date:** 2026-10-01
**Status:** approved design, pending implementation plan

## Goal

Platform admins need to know which Central de Ajuda articles and tutorial videos are
actually used. The Admin's article list (`KbArticlesPage`) and video list (`KbVideosPage`)
each gain a view-count readout: **total views and unique users, for the last 30 days and
all time**. Video rows also show how many people finished the video.

## Non-goals

- Charts, per-day series, or a selectable period. Two fixed windows (30d, all time) only.
- Per-workspace breakdown in the UI. `conta_id` is stored so it can be added later.
- View counts in the `mcp-admin` tools.
- Backfilling history. Counting starts at deploy; every item starts at 0, completions
  included (see `completed_total`).
- Counting Hub or anonymous traffic. The Central de Ajuda lives in the CRM only.

## Why not PostHog or counter columns

- PostHog only loads after cookie consent (LGPD, PR #556) and is stripped by ad blockers,
  so it undercounts by an unknown factor, and it does not see video plays.
- A `view_count` column per row cannot give unique users or a 30-day window.

## Data model

Migration `20261001000001_kb_content_views.sql` (renumber above main's tail at PR time).

```sql
CREATE TABLE kb_content_views (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  article_id uuid   REFERENCES kb_articles(id) ON DELETE CASCADE,
  video_id   bigint REFERENCES kb_videos(id)   ON DELETE CASCADE,
  user_id    uuid   REFERENCES auth.users(id)  ON DELETE SET NULL,
  conta_id   uuid,
  viewed_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kb_content_views_one_target CHECK (num_nonnulls(article_id, video_id) = 1)
);
CREATE INDEX kb_content_views_article ON kb_content_views (article_id, viewed_at) WHERE article_id IS NOT NULL;
CREATE INDEX kb_content_views_video   ON kb_content_views (video_id, viewed_at)   WHERE video_id IS NOT NULL;
CREATE INDEX kb_content_views_user    ON kb_content_views (user_id, viewed_at);
```

- `user_id ON DELETE SET NULL`: deleting a user keeps their past views in the totals; they
  drop out of unique-user counts, since `count(DISTINCT user_id)` ignores NULL.
- `conta_id` is `get_my_conta_id()` at record time, nullable, with no FK. It's informational only.
- RLS is enabled with **no policies**. `REVOKE ALL ... FROM anon, authenticated`, because the
  hosted default ACL grants ALL on new tables. The CRM never reads or writes the table directly.

### Write path: `record_kb_view`

```sql
record_kb_view(p_article_id uuid DEFAULT NULL, p_video_id bigint DEFAULT NULL) RETURNS void
-- SECURITY DEFINER, search_path = public
```

1. `auth.uid()` NULL: raise `42501`.
2. Exactly one argument must be non-null; otherwise raise `22023`.
3. Visibility uses the same rules as the existing SELECT policies:
   - an article must be `status = 'published'`;
   - a video must be `published` and `ready`, in a `published` series.

   Hidden or nonexistent targets return silently. The call never errors on them, so a draft
   cannot be told apart from a missing id.
4. **30-minute dedupe.** If this user already has a row for this target with
   `viewed_at > now() - interval '30 minutes'`, return without inserting, so refreshes and
   React StrictMode double effects don't inflate the count. Under concurrency two rows can
   occasionally slip in; that's acceptable for analytics.
5. Insert `(target, auth.uid(), get_my_conta_id())`.

Platform admins are recorded like anyone else. They are excluded at **read** time (below),
so one rule, "is this user a platform admin now", governs every metric.

Grants: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role`, then
`GRANT EXECUTE ... TO authenticated`. Every role is listed explicitly, per the repo convention.

### Read path: `kb_view_stats`

```sql
kb_view_stats() RETURNS TABLE (
  kind text,              -- 'article' | 'video'
  item_id text,           -- uuid for articles, bigint-as-text for videos
  views_30d bigint, users_30d bigint,
  views_total bigint, users_total bigint,
  completed_total bigint  -- videos only; NULL for articles
)
-- SECURITY DEFINER, STABLE, search_path = public
```

- One `GROUP BY` over `kb_content_views` per target column, using `count(*)` and
  `count(DISTINCT user_id)`, each total plain and with `FILTER (WHERE viewed_at > now() - interval '30 days')`.
- **Platform-admin exclusion is query-time, for every metric.** Every count skips rows whose
  `user_id` is in `platform_admins` when the stats are read. Promoting a user removes their
  past views and completions from the numbers. Removing an admin restores them. Rows with
  `user_id IS NULL` (deleted users) still count.
- `completed_total` is the number of distinct users with `kb_video_progress.completed_at IS NOT
  NULL` for the video **who also have at least one `kb_content_views` row for it**. Tying
  completions to recorded viewers means pre-feature completions don't count, matching the
  "starts at 0" rule, so a video can never show completions without views. A user who
  completed a video before deploy and plays it again afterwards does count, since the play
  records a view.
- Only items with at least one view or completion are returned. The client treats missing items as zeros.
- Grants: `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE ... TO service_role`.

## Edge function: `platform-admin` action `kb-view-stats`

A new handler `handleKbViewStats(svc, headers)` in `supabase/functions/platform-admin/kb-views.ts`,
following the `kb-videos.ts` pattern (exported for direct tests; authorization against
`platform_admins` has already happened in `index.ts`).

- It calls `svc.rpc('kb_view_stats')` and reshapes the result into
  `{ articles: Record<uuid, Stats>, videos: Record<videoId, Stats & { completed: number }> }`
  with numbers coerced from bigint strings.
- On error it logs internally and returns a generic 500, per the repo security rule.
- Wired into the `switch` in `platform-admin/index.ts`.

## CRM: recording views

`apps/crm/src/store/kb.ts` gains `recordKbView(target: { articleId } | { videoId })`, which calls
the RPC. Callers fire-and-forget it: errors are swallowed and debug-logged, never toasted, and
never block rendering.

- **Article:** `ArtigoPage` records once `article` has loaded with `status === 'published'`.
  It fires in an effect keyed on `article.id`, so navigating to another article records again.
- **Video:** `VideoStage` records on the first `play` event per mounted video id. A ref
  tracks the ids already recorded, so pause/resume and seeking don't count again.
  Loading the Ajuda home or a video page without pressing play records nothing.
  `autoPlay` starts out false and only turns on after a user choice or the next-up advance,
  so an auto-advanced video counts as a real view.

## Admin UI

- `apps/admin/src/lib/api.ts`: `getKbViewStats()` calls the new action. The query key is
  `['admin', 'kb-view-stats']`, with `staleTime` around 60s.
- A small shared component `apps/admin/src/components/KbViewStats.tsx` renders one item's stats:
  - Line 1 (30 days, primary): **`48 visualizações · 12 pessoas`**, with the label
    "últimos 30 dias" in a tooltip or `aria-label`.
  - Line 2 (muted, `text-xs`): **`Total: 210 · 64 pessoas`**, plus on videos
    **`· 31 concluíram`**.
  - Zero state: `Sem visualizações` (muted). No em-dashes in copy.
  - Singulars: `1 visualização`, `1 pessoa`.
- **KbArticlesPage:** a new desktop grid column "Visualizações" before the edit icon. On mobile the
  stats join the existing meta line.
- **KbVideosPage:** the stats go in the row's meta area under the title, after the badges,
  because the row has no column grid.
- The stats load in a separate query from the lists. While it loads the cell shows a small
  skeleton. If it fails, the cell stays empty and the lists still render.

## Testing

- **Entitlements** (`supabase/tests/entitlements/99_kb_content_views.sql`):
  - anon cannot execute `record_kb_view`, and authenticated cannot execute `kb_view_stats`;
  - authenticated has no SELECT, INSERT or UPDATE on `kb_content_views` (checked via `has_table_privilege`);
  - recording a draft article, a pending video, or a video in a draft series inserts nothing;
  - a second call within 30 minutes inserts nothing, while a backdated row older than 30 minutes allows a new one;
  - a platform admin's call inserts a row, but `kb_view_stats` excludes it; promoting a viewer
    removes their views and completions from the stats, and removing the admin restores them;
  - a `kb_video_progress` completion without a matching view row is not counted;
  - passing both or neither argument raises an error;
  - `kb_view_stats` returns the right 30d and total counts, unique users and completions.
- **Deno** (`supabase/functions/__tests__/`): reshaping and number coercion in the handler,
  generic 500 on an RPC error, empty result.
- **Vitest:**
  - `ArtigoPage` records once per article id and not for a missing article;
  - `VideoStage` records on the first play only;
  - `recordKbView` failures are swallowed;
  - `KbViewStats` handles plural and singular, the zero state, and the completions line;
  - both Admin pages render stats from a mocked query and still render the list when stats fail.

## Rollout

Apply the migration first, then deploy `platform-admin`, then merge. The merge deploys the
CRM and Admin frontends immediately, and the CRM calling a missing RPC would only fail
silently, but the Admin would 400 on the unknown action. Staging follows the same order.
