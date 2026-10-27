# Blog: métricas no Admin (views + Search Console) e abrir o post

**Date:** 2026-10-27
**Status:** design, pending approval

## Why

Eduardo publishes blog posts through the Admin (`/admin/blog`, spec
`2026-10-23-blog-automatico-design.md`) and has no way to tell which ones get read or found on
Google. To open a published post he copies the path, adds the domain by hand and pastes it into
a browser. He wants, per post:

1. a one-click way to open (and copy) the live URL;
2. how many people view it;
3. how it performs in Google Search Console: clicks, impressions, position, and whether Google
   has indexed it, with a shortcut to the Search Console page where he can request indexing.

The six hand-written posts in `apps/crm/src/content/blog/*.md` get the same metrics and join the
Admin list.

## Goals

- Open / copy the live URL from the list row and from the post toolbar.
- Count every view of every blog post, with no consent banner dependency.
- Show Search Console search performance and index status per post, refreshed daily.
- Hand-written posts appear in the Admin list (read-only) with the same metrics.

## Non-goals

- Referrers, scroll depth, read time, countries, devices. Views only.
- Search queries (keywords) per post. Possible later from the same API; not now.
- Requesting indexing from the Admin. Google's Indexing API is only for job postings and live
  streams; requesting indexing stays a click inside Search Console, which the Admin links to.
- Metrics for `/blog` (the index page) or other public pages.
- Editing hand-written posts from the Admin. Their text lives in the repo.
- Exposing these metrics in the `mcp-admin` tools.

## Anti-goals

- Storing anything that identifies a reader (raw IP, cookie, persistent ID). The counter must be
  defensible as "no personal data" under LGPD, which is why it can run without consent.
- Calling Google from an Admin page load. Slow, and the URL Inspection quota is per day.
- Making the Search Console part a blocker for the rest: without the Google secrets the Admin
  shows "Search Console não configurado" and everything else works.

## Ship order

Four independent deliverables, each mergeable alone, in this order:

1. **Abrir / copiar link** (Admin only).
2. **Posts escritos à mão na lista** (Admin + `platform-admin`).
3. **Contador de views** (migration, new public function, CRM blog page, Admin).
4. **Search Console** (migration, Google auth helper, daily cron, Admin).

## Canonical URL

Every piece uses the same canonical form: `https://www.mesaas.com.br/blog/<slug>`
(`SITE_URL` in `apps/crm/src/content/site-meta.ts`, `LIVE_BASE` in `BlogDetail.tsx`). Views and
Search Console data are keyed by **slug**, not `blog_posts.id`, because hand-written posts have no
id and a slug is what the URL and Google know.

**"Live" means what the code already means:** `status in ('publicado', 'publicando')` (`LIVE` in
`platform-admin/blog-posts.ts`, `isLive()` in `blog-view.ts`, and the anon read policy that
`blog:sync` builds the site from), plus every hand-written post. A `publicando` row is on the site
(a new approval waiting for the list to confirm it, or a live post being republished after an
edit), so it counts views, gets inspected, and shows the links and metrics wherever it appears,
including the Aguardando tab.

---

## 1. Abrir / copiar link

Today `BlogDetail.tsx` has an "Abrir no site" link only in the sidebar `SideSection "No ar"`.

- **Toolbar** of `BlogDetail`: when the post is live (see Canonical URL), an outline `Button` "Abrir no site" (`ExternalLink` icon, `<a target="_blank"
  rel="noopener noreferrer">`) and an icon button "Copiar link" (`Link`/`Copy` icon) that writes
  the canonical URL to the clipboard and toasts "Link copiado". The sidebar "No ar" link stays.
- **List row** (`BlogList.tsx`): on live rows, a small icon link (`ExternalLink`, aria-label
  "Abrir <título> no site") on the right edge of the row. Its click must `stopPropagation()` so it
  does not also select the row, and it must be a real `<a>` so cmd-click works.
- The link appends `?ref=admin` (see §3, so the Admin's own opens don't count as views). The page
  has a canonical tag, so the query string does not create a duplicate URL for Google. *(Builder:
  confirm `BlogPostPage` emits `<link rel="canonical">` without the query string.)* "Copiar link"
  copies the clean URL, without `?ref=admin`.
- Build the URL from the constant origin + `encodeURIComponent(slug)`, as `liveHref` does today.

## 2. Posts escritos à mão na lista

`supabase/functions/_shared/blog-file-posts.ts` `BLOG_FILE_POSTS` gains `date`, `category` and
`description`, copied from each file's frontmatter. It must stay a JSON-like literal;
`blog-rules-parity.test.ts` grows assertions that each new field equals the frontmatter, like
`title` today.

File posts are a **separate, discriminated shape**, not a `BlogPostRow` with fake values, so no
existing component ever reads a field a file post does not have.

`platform-admin`:

- `list-blog-posts` keeps its `posts` array of DB rows unchanged and, only for `tab =
  'publicados'`, adds a sibling `file_posts: FilePostRow[]`:
  ```ts
  interface FilePostRow { kind: 'arquivo'; slug: string; title: string; description: string;
                          category: string; date: string /* YYYY-MM-DD */ }
  ```
  Other tabs return `file_posts: []`.
- No `get-blog-post` change: the Admin builds the file-post detail from the list row it already
  has. No mutating action ever sees a file post (there is no id to send).

Admin:

- `blog-view.ts` gains `FilePostRow` and a list item union `BlogListItem = { kind: 'rotina'; row:
  BlogPostRow } | { kind: 'arquivo'; row: FilePostRow }`. `BlogPage` merges both for Publicados,
  sorted by publication date desc (`date` for both; a DB row without `date` falls back to
  `approved_at`, then `created_at`).
- `BlogList` renders each kind with its own branch: the file branch shows the `ImageOff`
  placeholder, category, date, title, an "Escrito à mão" badge, the open link (§1) and the metric
  line (§5). No `chipsFor()` call on it.
- Route: `blogFilePostPath(slug)` → `/blog/arquivo/<slug>?tab=publicados`. `BlogPage` resolves it
  from the merged list and renders a new `FilePostDetail` (not `BlogDetail`): badge, title,
  description, date, link buttons, "Desempenho" (§5), and the note "Este post vive no código
  (apps/crm/src/content/blog). Edite pelo repositório." No preview, editor, checks or approval.
  An unknown slug shows the existing not-found state.

## 3. Contador de views

### Data

Migration (unique version prefix above main's tail at PR time):

```sql
create table blog_page_views (
  id           bigint generated always as identity primary key,
  slug         text not null,
  viewed_at    timestamptz not null default now(),
  visitor_hash text not null          -- hex sha-256, see Privacy
);
create index blog_page_views_slug_time on blog_page_views (slug, viewed_at);

create table blog_view_salts (
  day  date primary key,              -- America/Sao_Paulo calendar day
  salt text not null                  -- 32 random bytes, hex
);
```

RLS on, no policies; `revoke all ... from public, anon, authenticated`; `grant ... to
service_role` (hosted Supabase has no default ACL for migration-created objects, see
`20260925130001_metrics_snapshots.sql`). Same lockdown on every function below, with each role
named explicitly.

- `record_blog_view(p_slug text, p_visitor_hash text) returns text` (SECURITY DEFINER,
  service_role only): returns without inserting if the same `(slug, visitor_hash)` has a row in
  the last 30 minutes (same dedupe window as `record_kb_view`, returns `'duplicate'`), or if the
  post already has 1000 rows in the last hour (returns `'capped'`, see the endpoint's step 4);
  otherwise inserts and returns `'inserted'`. Occasional duplicates and a slight overshoot of the
  cap under concurrency are acceptable.
- `blog_view_salt_today() returns text` (service_role only): returns today's salt (São Paulo
  day), inserting one with `gen_random_bytes` on conflict-do-nothing if absent, and deletes every
  salt with `day < today` in the same call. A pg_cron job (`blog-view-salt-prune`, `23 3 * * *` UTC = 00:23 São Paulo) runs the same delete,
  so a salt never outlives its day by more than a few minutes even on a day with no views.
- `blog_view_stats() returns table (slug text, views_7d bigint, views_30d bigint, views_total
  bigint)` and `blog_view_daily(p_slug text, p_days int) returns table (day date, views bigint)`
  (service_role only), days in America/Sao_Paulo, zero-filled by the caller.

### Privacy

`visitor_hash = sha256(salt_of_today || ip || user_agent || slug)` (inputs in that order), used
only for the 30-minute dedupe. The slug is part of the hash so the same reader gets a different
hash on every post: the stored rows never form a per-reader reading trail, not even within one
day. The salt lives for its São Paulo calendar day and is deleted at the turn of the day, so after
that no one, including us, can link a hash back to an IP (Supabase backups/PITR keep a deleted
salt for the backup window). Raw IP and UA are
never stored. No cookie, no localStorage. Unique visitors are deliberately not reported (the
hash changes daily, so cross-day uniques are impossible by design).

Builder: add one sentence to the measurement section of `pages/politica-privacidade` (and `/lgpd`
if it lists tools) describing this anonymous count. If neither page has such a section, add it
to the privacy policy only.

### Endpoint: `blog-view` (new edge function, `--no-verify-jwt`)

Modeled on `affiliate-public` (public, no user auth). `POST { slug }`.

1. CORS via `buildCorsHeaders(req)`; `ALLOWED_ORIGINS` must contain
   `https://www.mesaas.com.br` (verify the prod secret; staging origin for staging).
2. Drop (204, no work) when the UA matches a bot pattern (`bot|crawl|spider|slurp|preview|
   headless|lighthouse|pagespeed|facebookexternalhit|whatsapp|telegram|curl|wget|python`,
   case-insensitive) or is empty.
3. Validate the slug: shape `^[a-z0-9-]{1,120}$`, and it must be a `blog_posts` row with
   a live status (see Canonical URL) or a `BLOG_FILE_POSTS` slug. Unknown slug: 204, no insert.
4. Rate limit per source, independent of the User-Agent (so rotating the UA does not escape it):
   `ip_key = sha256(salt_of_today || ip)`, `checkRateLimit(svc, "blog-view:" + ip_key, 120, 3600)`.
   The key carries the salted hash, never the IP (`rate_limit_log` is pruned hourly). Over the
   limit: 204. The IP is the left-most `X-Forwarded-For`, which the client controls, so this
   bounds an honest source only. A second cap bounds writes per post whatever the source: inside
   `record_blog_view`, after the dedupe, a post with 1000 rows in the last hour gets no new row
   (far above one post's real traffic). Because it sits after the dedupe, only new rows spend it;
   reloads do not. Accepted cost: someone rotating the header can exhaust a post's cap and
   suppress its real views for up to an hour (bounded suppression over unbounded inflation; a
   vanity counter, not billing). The function logs one line with the slug when the cap trips.
   Supabase's own gateway limits apply on top.
5. `record_blog_view(slug, hash)`, which returns `'inserted'`, `'duplicate'` or `'capped'`.
   Always answer 204; errors are logged, never returned.

### CRM blog page

In `BlogPostPage` (`apps/crm/src/pages/blog/BlogPostPage.tsx`), a `useRecordBlogView(slug)` hook,
effect-only (the page is prerendered and the SSR bundle is single-file, so nothing may touch
`window`/`document` at module scope or during render):

- Skips unless `location.hostname === 'www.mesaas.com.br'` (staging, previews, localhost do not
  count), skips when the URL has `ref=admin`, skips when `navigator.webdriver` is true.
- Waits until `document.visibilityState === 'visible'` (prerender/background tabs), then sends one
  `fetch(`${VITE_SUPABASE_URL}/functions/v1/blog-view`, { method: 'POST', keepalive: true, body:
  JSON.stringify({ slug }), headers: { 'Content-Type': 'application/json' } })`, fire-and-forget,
  errors swallowed. Once per slug per mount (a ref guards StrictMode's double effect).
- CSP `connect-src` already allows `*.supabase.co`.

Counting starts at deploy; no backfill.

## 4. Search Console

### Setup (Eduardo, one time; the plan documents the steps)

Google Cloud project → enable "Google Search Console API" → create a service account → JSON key →
in Search Console, property `sc-domain:mesaas.com.br` → Settings → Users and permissions → add
the service-account e-mail with **Restricted** (read) permission.

### Secrets (document in CLAUDE.md "Edge functions")

- `GSC_SERVICE_ACCOUNT_JSON`: the full JSON key. Optional, no default: unset, the cron logs and
  exits 200 doing nothing, and the Admin shows "Search Console não configurado".
- `GSC_SITE_URL`: property id, default `sc-domain:mesaas.com.br`.
- Only prod needs them. Staging can share the same key; it reads the same prod property.

### Auth: `supabase/functions/_shared/google-sa.ts`

`getGoogleAccessToken(serviceAccountJson, scope)`: builds an RS256 JWT (iss = client_email, aud
`https://oauth2.googleapis.com/token`, 1 h exp), signs it with WebCrypto (`importKey('pkcs8')` from
the PEM `private_key`), exchanges it at the token endpoint (`grant_type=
urn:ietf:params:oauth:grant-type:jwt-bearer`). Scope `https://www.googleapis.com/auth/
webmasters.readonly`. All fetches carry `AbortSignal.timeout`. Never log the key or token.

### Data

```sql
create table blog_search_daily (
  slug        text not null,
  day         date not null,          -- Search Console's date (Pacific time, as Google reports it)
  clicks      int  not null,
  impressions int  not null,
  position    numeric not null,       -- impression-weighted average over hosts
  primary key (slug, day)
);

create table blog_index_status (
  slug             text primary key,
  verdict          text,              -- PASS | NEUTRAL | FAIL | PARTIAL | VERDICT_UNSPECIFIED
  coverage_state   text,              -- Google's human string, e.g. "Submitted and indexed"
  last_crawl_time  timestamptz,
  google_canonical text,
  inspection_link  text,              -- inspectionResult.inspectionResultLink
  checked_at       timestamptz not null
);

create table blog_search_runs (       -- last run, for "Atualizado em" and failures
  id          bigint generated always as identity primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  error       text                    -- internal message, never returned raw
);
```

Same RLS/grant lockdown as §3.

### Cron: `blog-search-console-cron` (new, `--no-verify-jwt`, `x-cron-secret`)

Shape copied from `metrics-snapshot-cron` (bounded fetch, `reportCronFailure`), scheduled once a
day by pg_cron with the vault-secret pattern, at a minute the stagger migration
(`20260925110001_stagger_cron_schedules.sql`) leaves free, early morning UTC.

1. **Search Analytics.** `POST searchanalytics/query` on `GSC_SITE_URL` with dimensions `["date",
   "page"]`, a `page` `contains` `/blog/` filter, `rowLimit` 25000 with `startRow` paging. Map each
   page URL to its slug by path `/blog/<slug>` only (a domain property reports `mesaas.com.br` and
   `www` separately; both fold into one slug; query strings and fragments are dropped; the `/blog`
   index is skipped). Per `(slug, day)`: clicks and impressions summed, position averaged
   weighted by impressions.
   - **Window replace, not upsert.** Google omits days with no data, so each fetched window is
     written by one RPC `blog_search_replace(p_from date, p_to date, p_rows jsonb)` that, in a
     single transaction, deletes every `blog_search_daily` row with `day between p_from and p_to`
     and inserts the new rows. A day revised to zero therefore disappears.
   - **Daily refresh:** the last 10 days ending yesterday (Google revises recent days).
   - **Backfill** (history for the hand-written posts): 16 months back, in 30-day chunks walked
     newest to oldest, at most 4 chunks per run, each chunk written with the same replace RPC.
     Progress lives in `blog_search_state (id int primary key default 1 check (id = 1),
     backfill_before date)`: the oldest day already backfilled. A chunk that fails leaves the
     cursor where it was, so the next run retries it. Backfill is done when `backfill_before` is
     at or before the 16-month horizon. The daily refresh always runs first, every run,
     independent of backfill. Row completeness on long ranges is not guaranteed by Google; 30-day
     chunks keep each response far under the row cap for a blog this size.
2. **URL Inspection.** For the known slugs (live `blog_posts` + `BLOG_FILE_POSTS`), ordered by
   `checked_at` ascending, nulls first, at most 150 per run, `POST urlInspection/index:inspect`
   with `inspectionUrl` = canonical URL and `siteUrl` = `GSC_SITE_URL`. Upsert
   `blog_index_status`. Quota is 2,000/day and 600/min per property
   ([limits](https://developers.google.com/webmaster-tools/limits)); 150/day keeps every post
   re-checked at least every few days up to several hundred posts. A post published in the last
   3 days is always included regardless of the cap ordering.
3. Records the run in `blog_search_runs`. A failure in step 2 for one URL is logged and skipped;
   a token or step-1 failure fails the run (`reportCronFailure`). If every URL attempted in step 2
   fails, the run still closes `ok` (step 1 refreshed the data) but calls `reportCronFailure` and
   records the reason in `error`.

### Index status: tone and label

Tone comes from `verdict` alone: `PASS` → success, `PARTIAL` and `NEUTRAL` → warning, `FAIL` →
danger, anything else or no row → neutral. The label maps known `coverage_state` strings:

| Google `coverage_state` | Label |
|---|---|
| Submitted and indexed | Indexada |
| Indexed, not submitted in sitemap | Indexada (fora do sitemap) |
| Discovered - currently not indexed | Descoberta, ainda não indexada |
| Crawled - currently not indexed | Rastreada, não indexada |
| URL is unknown to Google | Desconhecida pelo Google |
| Duplicate, Google chose different canonical than user | Duplicada (Google escolheu outra canônica) |
| Page with redirect | Página com redirecionamento |
| Excluded by 'noindex' tag | Bloqueada por noindex |
| Not found (404) | Não encontrada (404) |

An unmapped string is shown as Google wrote it. No row yet, or a row with no `coverage_state`:
"Ainda não verificada", always with the neutral tone (whatever the verdict).

### Admin "Ver no Search Console"

Uses the stored `inspection_link` (Google builds it, so it is correct for a domain property).
Before the first inspection of a post (no row, or a row with no verdict) there is no link; the UI
says "Ainda não verificado pelo Google". A checked row that came back without a link shows
nothing there.

## 5. Admin UI

New `platform-admin` actions (authorized as today; generic 500 on error):

- `blog-metrics` → `{ gsc_updated_at: string | null (null = no successful sync yet: "Search Console não configurado"), posts: Record<slug,
  { views_7d, views_30d, views_total,
  search: { clicks, impressions, ctr, position } | null (28d window; position is null when
  Google reported none),
  index: { verdict, coverage_state, last_crawl_time, inspection_link, checked_at } | null }> }`.
  Fetched by `BlogPage` alongside the list on Publicados and Aguardando (for live rows there). Missing slug = zeros.
- `blog-post-metrics { slug, days: 90 }` → two separate zero-filled series, never joined on
  date because their days differ: `views: { day, views }[]` (São Paulo days, ending today) and
  `search: { day, clicks, impressions }[]` (Google's Pacific-time days, ending at the latest day
  stored).

"28d" for Search Console mirrors Search Console's own default window and ends at the latest day
Google has data for (2-3 days ago); views use 7d / 30d / total ending today. The UI labels say
which window each number is.

**List (Publicados tab).** Each row gains a compact metric line under the title: "1.240 views
(30d) · 38 cliques · posição 12,4" and an index badge (Indexada = success, Descoberta / Rastreada,
não indexada = warning, Erro = danger, sem verificação = neutral). A sort control in the tab
header: "Mais recentes" (default) / "Mais vistos" / "Mais cliques", persisted in the URL
(`?ordem=`).

**Detail.** A "Desempenho" section above the existing panels for live posts:
- KPI tiles: Views 7d, Views 30d, Views total; Cliques 28d, Impressões 28d, CTR, Posição média.
- Two 90-day daily charts, a new daily-series component built on the react-chartjs-2 setup and `getAdminChartTheme` from `apps/admin/src/pages/metricas/charts.tsx` (its existing charts take monthly data only): "Views por dia"
  and "Cliques e impressões por dia (datas do Google)". Separate charts because the two day
  boundaries differ (São Paulo vs. Pacific).
- Index card: status label (Portuguese mapping of `coverage_state`), last crawl date, "Ver no
  Search Console" (`inspection_link`, new tab), and a hint "Para pedir indexação, clique em
  Solicitar indexação na página do Google."
- Footer: "Search Console atualizado em <gsc_updated_at>. Os dados do Google chegam com 2 a 3 dias
  de atraso."
- Without GSC configured: the Search Console tiles and card are replaced by one line "Search
  Console não configurado." Views still show.

Phone layout follows the existing Admin iOS patterns used by the blog page.

## Builder notes

- Copy is Portuguese, no em-dashes in user-facing strings.
- Deploy order per repo rule: migrations and functions before merging the frontend. `blog-view`
  and `blog-search-console-cron` both deploy with `--no-verify-jwt`; redeploy `platform-admin`.
- Contract changes (`BLOG_FILE_POSTS`, list/get shapes) need tests updated in both
  `supabase/functions/__tests__` and the Admin/CRM vitest suites.
- The cron migration must not schedule before the function is deployed (see the note at the top
  of `20260925130001_metrics_snapshots.sql`).
- `mcp-admin/blog.ts` returns `BLOG_FILE_POSTS` to the Routine as is. Map it down to
  `{ slug, title }` there so the MCP tool's output does not change; `mcp-admin-blog_test.ts` pins it.
- File rows show `date` where DB rows show `created_at`.
- Mockups artifact ships with the plan.

## Calls made without Eduardo (check these)

- Own counter instead of PostHog for views (PostHog only sees visitors who accept cookies).
- Service account (not a personal OAuth login) for Search Console, read-only.
- Daily snapshot cron instead of live Google calls from the Admin.
- 30-minute dedupe per visitor, no unique-visitor metric, staging/preview/Admin opens not counted.
- First Search Console run backfills 16 months; views start at zero.
- 7d / 30d / total for views, 28d for Search Console, 90-day chart.
- Sort control on Publicados; "Copiar link" button.
