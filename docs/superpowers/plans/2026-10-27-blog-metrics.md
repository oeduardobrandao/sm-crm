# Blog Metrics in the Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open/copy any live blog post from the Admin, list the hand-written posts there, count anonymous views, and show daily-synced Google Search Console performance and index status per post.

**Architecture:** Everything is keyed by slug. Views: the CRM blog page pings a new public `blog-view` function, which stores a salted, day-scoped hash (no personal data) in `blog_page_views`. Search Console: a daily `blog-search-console-cron` authenticates with a service account, writes `blog_search_daily` / `blog_index_status`, and the Admin reads both through two new `platform-admin` actions.

**Tech Stack:** React 19 + TanStack Query (Admin, CRM), Deno edge functions, Postgres (pg_cron, vault), WebCrypto (RS256 JWT), react-chartjs-2.

**Spec:** `docs/superpowers/specs/2026-10-27-blog-metrics-design.md`

## Global Constraints

- Canonical live URL: `https://www.mesaas.com.br/blog/<encodeURIComponent(slug)>`. Admin open links add `?ref=admin`; "Copiar link" copies without it.
- "Live" = `status in ('publicado','publicando')` or a `BLOG_FILE_POSTS` slug.
- Portuguese copy, no em-dashes in user-facing strings. Icons `lucide-react`. Toasts `sonner`.
- Every new table: RLS on, no policies, `revoke all ... from public, anon, authenticated`, `grant ... to service_role`. Every new function: `revoke all ... from public, anon, authenticated` (+ `service_role` where it must not call), then explicit grants. Each role named.
- Migration prefixes must be unique and above main's tail at PR time (main's tail today: `20261030000002`). Planned: `20261031000001` … `20261031000004`.
- New public/cron functions deploy with `--no-verify-jwt`. Edge errors: log internally, return generic bodies.
- No module-level `window`/`document`/`localStorage` in CRM code reachable from the blog page (single-file SSR prerender).
- Admin cannot import `apps/crm`; shared shapes are declared in `apps/admin/src/pages/blog/blog-view.ts`.
- Before every push: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`.

## Review Focus

1. **A live post being republished (`publicando`) after an edit** must keep counting views, keep its open link and metrics, including in the Aguardando tab. Pinned in Task 4 (`isLiveItem`) and Task 6 (`blog-view` accepts `publicando`).
2. **Slug with unusual characters or an unknown slug hitting `blog-view`** must 204 without inserting. Pinned in Task 6.
3. **Search Console reports `mesaas.com.br/blog/x`, `www.mesaas.com.br/blog/x?utm=…` and `/blog/x#h2` for one post** must fold into one `(slug, day)` with impression-weighted position; `/blog` and `/blog/` are skipped. Pinned in Task 11.
4. **A day Google revises to no data** disappears from `blog_search_daily`. Pinned in Task 10 (replace RPC test).
5. **Search Console never configured** (no secret, no run): Admin shows views and "Search Console não configurado" with no errors. Pinned in Tasks 8 and 13.

## Delivery

Three PRs, each off `main` after the previous merges (after a squash merge, `git rebase --onto main <old-base>`):

- **PR 1** — Tasks 1-4 (no migration; deploy `platform-admin` + `mcp-admin` before merging).
- **PR 2** — Tasks 5-9 (views).
- **PR 3** — Tasks 10-14 (Search Console).

---

## PR 1: Open link + hand-written posts

### Task 1: Open / copy link

**Files:**
- Modify: `apps/admin/src/pages/blog/blog-view.ts` (add `liveUrl`)
- Modify: `apps/admin/src/pages/blog/BlogDetail.tsx` (move `LIVE_BASE` out; toolbar buttons)
- Modify: `apps/admin/src/pages/blog/BlogList.tsx` (row icon link)
- Create: `apps/admin/src/pages/blog/LiveLinkButtons.tsx`
- Test: `apps/admin/src/pages/blog/__tests__/blog-view.test.ts`, `apps/admin/src/pages/blog/__tests__/LiveLinkButtons.test.tsx`

**Interfaces:**
- Produces: `liveUrl(slug: string, opts?: { fromAdmin?: boolean }): string` in `blog-view.ts`; `<LiveLinkButtons slug={string} />` (toolbar "Abrir no site" + "Copiar link"); `<LiveRowLink slug={string} title={string} />` (row icon).

- [ ] **Step 1: Write failing tests**

```ts
test('liveUrl builds the canonical URL', () => {
  expect(liveUrl('mesaas-vs-mlabs')).toBe('https://www.mesaas.com.br/blog/mesaas-vs-mlabs');
  expect(liveUrl('a b')).toBe('https://www.mesaas.com.br/blog/a%20b');
  expect(liveUrl('x', { fromAdmin: true })).toBe('https://www.mesaas.com.br/blog/x?ref=admin');
});
```
`LiveLinkButtons.test.tsx`: the "Abrir no site" link has `href` ending `?ref=admin`, `target="_blank"`, `rel="noopener noreferrer"`; clicking "Copiar link" calls `navigator.clipboard.writeText('https://www.mesaas.com.br/blog/x')` and `toast` with "Link copiado". `LiveRowLink`: aria-label `Abrir <title> no site`; a click does not call the row's `onClick` (render inside an `<li onClick={spy}>`, assert `spy` not called).

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/admin/src/pages/blog` → `liveUrl is not exported`.
- [ ] **Step 3: Implement.** `LIVE_BASE` moves to `blog-view.ts`. `LiveLinkButtons`: outline `Button asChild` wrapping `<a>` with `ExternalLink` icon, and an icon `Button` (`Link` icon, aria-label "Copiar link"). Clipboard failure toasts "Não foi possível copiar o link". `LiveRowLink`: `<a>` with `ExternalLink size={15}`, `onClick={e => e.stopPropagation()}`. In `BlogDetail` render `LiveLinkButtons` at the start of the toolbar's right-hand group when `isLive(post)`; the sidebar "No ar" link uses `liveUrl(slug, { fromAdmin: true })`. In `BlogList` render `LiveRowLink` at the row's right edge when `isLive(r)`.
- [ ] **Step 4: Run, expect PASS** — same command.
- [ ] **Step 5: Commit** — `feat(admin/blog): abrir e copiar o link do post no ar`.

### Task 2: `BLOG_FILE_POSTS` carries date, category, description

**Files:**
- Modify: `supabase/functions/_shared/blog-file-posts.ts`
- Create: `supabase/functions/_shared/blog-live.ts`
- Modify: `supabase/functions/mcp-admin/blog.ts:49`
- Modify: `supabase/functions/platform-admin/blog-posts.ts:57` (import `BLOG_LIVE_STATUSES` instead of local `LIVE`)
- Test: `apps/crm/src/content/__tests__/blog-rules-parity.test.ts`, `supabase/functions/__tests__/mcp-admin-blog_test.ts`, `supabase/functions/__tests__/blog-live_test.ts`

**Interfaces:**
- Produces: `BLOG_FILE_POSTS: ReadonlyArray<{ slug: string; title: string; description: string; category: string; date: string }>` (JSON-like literal). In `_shared/blog-live.ts`: `BLOG_LIVE_STATUSES = ["publicado", "publicando"] as const`; `BLOG_SLUG_RE = /^[a-z0-9-]{1,120}$/`; `isLiveBlogSlug(db: SupabaseClient, slug: string): Promise<boolean>`; `liveBlogSlugs(db: SupabaseClient): Promise<Array<{ slug: string; date: string | null }>>` (DB live rows + file posts; `date` for the "published in the last 3 days" rule).

- [ ] **Step 1: Failing tests.** Parity test: add `test('carries each file post date, category and description from its frontmatter')` mirroring the existing title test, asserting `post.date === String(data.date)`, `post.category === data.category`, `post.description === data.description`. `mcp-admin-blog_test.ts`: assert the tool's `file_posts` entries have exactly the keys `["slug","title"]`. `blog-live_test.ts`: with a fake db returning `[{slug:'a', status:'publicando', date:null}]`, `isLiveBlogSlug(db,'a')` is true, `isLiveBlogSlug(db,'mesaas-vs-mlabs')` is true without a db hit, `isLiveBlogSlug(db,'nope')` is false; `liveBlogSlugs` returns the DB row plus all six file slugs.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/crm/src/content/__tests__/blog-rules-parity.test.ts` and `deno test --no-check supabase/functions/__tests__/mcp-admin-blog_test.ts supabase/functions/__tests__/blog-live_test.ts`.
- [ ] **Step 3: Implement.** Copy the three fields from each `.md` frontmatter (`date` as `YYYY-MM-DD` string). `mcp-admin/blog.ts`: `file_posts: BLOG_FILE_POSTS.map(({ slug, title }) => ({ slug, title }))`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(blog): metadados dos posts escritos à mão e helper de posts no ar`.

### Task 3: `list-blog-posts` returns `file_posts`

**Files:**
- Modify: `supabase/functions/platform-admin/blog-posts.ts:237-273`
- Modify: `apps/admin/src/lib/api.ts:1139` (response type)
- Test: `supabase/functions/__tests__/platform-admin-blog_test.ts`

**Interfaces:**
- Consumes: `BLOG_FILE_POSTS` (Task 2).
- Produces: `list-blog-posts` response `{ posts: BlogPostRow[]; last_draft_at: string | null; file_posts: FilePostRow[] }`, `FilePostRow = { kind: 'arquivo'; slug; title; description; category; date }`. `file_posts` is non-empty only for `tab: 'publicados'`.

- [ ] **Step 1: Failing tests** — `list publicados includes the six file posts with kind "arquivo"` (length 6, each has `kind === 'arquivo'` and the five fields); `list aguardando has file_posts []`; `get-blog-post with id "file:mesaas-vs-mlabs" is 400` (pins that no `file:` id reaches any handler).
- [ ] **Step 2: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/platform-admin-blog_test.ts`.
- [ ] **Step 3: Implement** in `handleListBlogPosts`; type `listBlogPosts` with `file_posts: FilePostRow[]` (type from Task 4's `blog-view.ts`; declare it there in this task).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(platform-admin): posts escritos à mão na aba Publicados`.

### Task 4: Admin list union + `FilePostDetail`

**Files:**
- Modify: `apps/admin/src/pages/blog/blog-view.ts`
- Modify: `apps/admin/src/pages/blog/BlogList.tsx`, `apps/admin/src/pages/BlogPage.tsx`, `apps/admin/src/router.tsx`, `apps/admin/src/lib/routes.ts`
- Create: `apps/admin/src/pages/blog/FilePostDetail.tsx`
- Test: `apps/admin/src/pages/blog/__tests__/blog-view.test.ts`, `apps/admin/src/pages/blog/__tests__/FilePostDetail.test.tsx`, `apps/admin/src/pages/blog/__tests__/BlogList.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `FilePostRow`, `liveUrl`, `LiveLinkButtons`, `LiveRowLink`.
- Produces: `type BlogListItem = { kind: 'rotina'; row: BlogPostRow } | { kind: 'arquivo'; row: FilePostRow }`; `itemsFor(tab: BlogTab, posts: BlogPostRow[], files: FilePostRow[], now: Date): BlogListItem[]` (Aguardando/Rejeitados: `sortQueue(posts)` wrapped; Publicados: merged, date desc, DB fallback `date ?? approved_at ?? created_at`); `isLiveItem(item): boolean`; `itemSlug(item): string`; `itemPath(item, tab): string`; `blogFilePostPath(slug: string): string` → `/admin/blog/arquivo/${encodeURIComponent(slug)}?tab=publicados`. `BlogList` prop `rows` becomes `items: BlogListItem[]`; `selectedId` becomes `selectedKey: string | null` (`id` for rotina, `arquivo:<slug>` for files).

- [ ] **Step 1: Failing tests.** `itemsFor('publicados', [dbRow date '2026-10-20'], [file date '2026-10-25', file date '2026-07-01'], now)` → kinds in order `arquivo, rotina, arquivo`; a DB row with `date: null, approved_at: '2026-10-22…'` sorts by approved_at; `isLiveItem` true for `arquivo`, true for `publicando`, false for `despublicado`. `BlogList` with a file item: shows title, "Escrito à mão" badge, `formatDay(date)` (not created_at), the row link `href` is `/admin/blog/arquivo/<slug>?tab=publicados`. `FilePostDetail`: renders title, description, the note "Este post vive no código (apps/crm/src/content/blog). Edite pelo repositório.", `LiveLinkButtons`, and no "Editar texto"/"Despublicar" buttons.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/admin/src/pages/blog`.
- [ ] **Step 3: Implement.** Router: add `{ path: 'blog/arquivo/:slug', ... }` before `blog/:id`, same `BlogPage` element. `BlogPage`: read `slug` param; when present, force `tab = 'publicados'`, find the file row in `list.data.file_posts`, render `FilePostDetail` (or the existing not-found state when missing) in the detail pane, and skip the `getBlogPost` query. `BlogList` branches on `item.kind`; the file branch never calls `chipsFor`.
- [ ] **Step 4: Run, expect PASS.** Then the four `tsc` commands.
- [ ] **Step 5: Verify in the browser** (`npm run dev:admin`, seed login per memory): Publicados lists the six hand-written posts interleaved by date; opening one shows `FilePostDetail`; row icon opens the live post in a new tab; phone width (375px) works.
- [ ] **Step 6: Commit** — `feat(admin/blog): posts escritos à mão na lista, somente leitura`.

---

## PR 2: View counter

### Task 5: Views schema

**Files:**
- Create: `supabase/migrations/20261031000001_blog_page_views.sql`
- Test: `supabase/tests/entitlements/99_blog_page_views.sql` (pattern: `99_kb_content_views.sql`, call `et_grant_hosted_parity(array['blog_page_views','blog_view_salts'])`)

**Interfaces:**
- Produces (all `service_role` only): tables `blog_page_views`, `blog_view_salts` (spec §3); `record_blog_view(p_slug text, p_visitor_hash text) returns void`; `blog_view_salt_today() returns text`; `blog_view_prune_salts() returns void` (deletes `day < (now() at time zone 'America/Sao_Paulo')::date`); `blog_view_stats() returns table (slug text, views_7d bigint, views_30d bigint, views_total bigint)`; `blog_view_daily(p_slug text, p_days int) returns table (day date, views bigint)` (only days with views; caller zero-fills). A pg_cron job `blog-view-salt-prune` at `5 3 * * *` UTC (00:05 São Paulo) running `select public.blog_view_prune_salts()` (check the stagger migration `20260925110001_stagger_cron_schedules.sql` and pick an adjacent free minute if 03:05 is busy). Windows: `views_7d` = `viewed_at > now() - interval '7 days'`, likewise 30.

- [ ] **Step 1: Write the entitlement suite** asserting: anon/authenticated have no SELECT on either table and no EXECUTE on any of the five functions; `record_blog_view('a','h')` twice → 1 row; with the first row's `viewed_at` moved back 31 min, a third call → 2 rows; a different hash → +1; `blog_view_salt_today()` returns the same 64-hex value twice and leaves one row; insert a salt for yesterday, call `blog_view_salt_today()` → yesterday's row gone; `blog_view_stats()` with rows at now-1d, now-10d, now-40d → `(1, 2, 3)`; `blog_view_daily('a', 30)` excludes the 40-day row.
- [ ] **Step 2: Run, expect FAIL** — `npm run test:db` (needs Docker/colima; otherwise CI's `entitlement-tests` is the gate).
- [ ] **Step 3: Write the migration.** `gen_random_bytes` comes from `pgcrypto` (`extensions` schema on hosted; reference it as `extensions.gen_random_bytes`). Functions `security definer`, `set search_path = public`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(db): contagem anônima de views do blog`.

### Task 6: `blog-view` edge function

**Files:**
- Create: `supabase/functions/blog-view/index.ts`, `handler.ts`, `logic.ts`
- Test: `supabase/functions/__tests__/blog-view_test.ts`

**Interfaces:**
- Consumes: `isLiveBlogSlug` (Task 2), RPCs from Task 5, `checkRateLimit`/`getClientIP`, `buildCorsHeaders`.
- Produces: `logic.ts`: `isBotUserAgent(ua: string | null): boolean` (pattern from spec §3 step 2, case-insensitive; empty/null → true); `sha256Hex(value: string): Promise<string>`. `handler.ts`: `createBlogViewHandler(deps: { buildCorsHeaders(req: Request): Record<string,string>; db: SupabaseClient; rateLimit(key: string, max: number, windowSeconds: number): Promise<boolean>; getClientIP(req: Request): string }): (req: Request) => Promise<Response>`. `visitor_hash = sha256Hex(salt + ip + ua)`, rate key `"blog-view:" + sha256Hex(salt + ip)`, limit `120` / `3600`.

- [ ] **Step 1: Failing tests** (fake db recording rpc calls): OPTIONS → 204 with CORS headers; POST valid live slug, browser UA → 204 and one `record_blog_view` call whose hash is 64 hex and is not the raw IP; `publicando` slug counts; UA `Googlebot/2.1` → 204, no rpc; empty UA → no rpc; slug `../x` or `A` → no rpc; unknown slug → no rpc; rate limit false → no `record_blog_view`; the rate key does not change when only the UA changes (two calls, different UAs, same IP → same key); same IP+UA → same visitor hash, different UA → different hash; the raw IP string never appears in any rpc argument or rate key; db error → still 204, body empty; non-POST → 405.
- [ ] **Step 2: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/blog-view_test.ts`.
- [ ] **Step 3: Implement** following `affiliate-public/index.ts` wiring (service-role client with `AbortSignal.timeout(10_000)` fetch as in `metrics-snapshot-cron`).
- [ ] **Step 4: Run, expect PASS**; `npm run check:functions`.
- [ ] **Step 5: Commit** — `feat(functions): blog-view, contador público de views`.

### Task 7: CRM records views + privacy line

**Files:**
- Create: `apps/crm/src/pages/blog/useRecordBlogView.ts`
- Modify: `apps/crm/src/pages/blog/BlogPostPage.tsx` (call the hook with `post.slug` when a post resolves)
- Modify: `apps/crm/src/pages/lgpd/LgpdPage.tsx` (one line in the tools/measurement list)
- Test: `apps/crm/src/pages/blog/__tests__/useRecordBlogView.test.tsx` (pattern: `apps/crm/src/pages/ajuda/__tests__/useRecordKbView.test.tsx`)

**Interfaces:**
- Produces: `useRecordBlogView(slug: string | null): void`.

- [ ] **Step 1: Failing tests** (stub `fetch`, `location`, `document.visibilityState`): on `www.mesaas.com.br` + visible → one POST to `${VITE_SUPABASE_URL}/functions/v1/blog-view` with body `{"slug":"x"}` and `keepalive: true`; StrictMode double mount → still one call; `localhost` → none; `?ref=admin` → none; `navigator.webdriver = true` → none; hidden then a `visibilitychange` to visible → one call; slug change `x`→`y` → second call; fetch rejection → no throw.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/crm/src/pages/blog/__tests__/useRecordBlogView.test.tsx`.
- [ ] **Step 3: Implement** (all browser reads inside `useEffect`). LGPD line, under legítimo interesse/medição: "Contagem anônima de leituras do blog: sem cookies, sem guardar IP; um código diário descartado no fim do dia evita contar a mesma leitura duas vezes." (The privacy policy's section 7 already covers "medição agregada de acessos"; no change there.)
- [ ] **Step 4: Run, expect PASS**; `npm run build && npm run prerender` must still emit `data-ssr="landing"` (smoke for module-level access).
- [ ] **Step 5: Commit** — `feat(blog): registrar views na página do post`.

### Task 8: `platform-admin` metrics actions (views; Search Console fields null)

**Files:**
- Create: `supabase/functions/platform-admin/blog-metrics.ts`
- Modify: `supabase/functions/platform-admin/index.ts` (cases `blog-metrics`, `blog-post-metrics`)
- Modify: `apps/admin/src/lib/api.ts` (`getBlogMetrics()`, `getBlogPostMetrics(slug)`)
- Modify: `apps/admin/src/pages/blog/blog-view.ts` (types)
- Test: `supabase/functions/__tests__/platform-admin-blog-metrics_test.ts`

**Interfaces:**
- Produces:
```ts
interface IndexStatus { verdict: string | null; coverage_state: string | null;
  last_crawl_time: string | null; inspection_link: string | null; checked_at: string }
interface SearchTotals { clicks: number; impressions: number; ctr: number; position: number | null }
interface PostMetrics { views_7d: number; views_30d: number; views_total: number;
  search: SearchTotals | null; index: IndexStatus | null }
interface BlogMetricsResponse { gsc_updated_at: string | null; posts: Record<string, PostMetrics> }
interface BlogPostMetricsResponse { views: Array<{ day: string; views: number }>;
  search: Array<{ day: string; clicks: number; impressions: number }> }
```
`handleBlogMetrics(svc, headers)`, `handleBlogPostMetrics(svc, body: { slug: string; days?: number }, headers)` (`days` clamped to 1-365, default 90; `views` zero-filled São Paulo days ending today; `search` `[]` in this task). **Deviation from spec, my call:** no `configured_gsc` boolean; "not configured" = `gsc_updated_at === null` (no successful cron run), so `platform-admin` never needs the Google secret.

- [ ] **Step 1: Failing tests** — bigint strings coerce to numbers; slugs with no views are absent from `posts`; `blog-post-metrics` with `days: 3` and one row 2 days ago → 3 entries with zeros elsewhere; invalid slug (`BLOG_SLUG_RE` fails) → 400; rpc error → 500 with generic body; `gsc_updated_at` null and `search`/`index` null in this task.
- [ ] **Step 2: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/platform-admin-blog-metrics_test.ts`.
- [ ] **Step 3: Implement.** Zero-fill uses `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })` for "today".
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(platform-admin): métricas de views do blog`.

### Task 9: Admin metrics UI (views)

**Files:**
- Create: `apps/admin/src/pages/blog/BlogPerformance.tsx`, `apps/admin/src/pages/blog/DailyChart.tsx`
- Modify: `apps/admin/src/pages/blog/blog-view.ts`, `BlogList.tsx`, `BlogDetail.tsx`, `FilePostDetail.tsx`, `apps/admin/src/pages/BlogPage.tsx`
- Test: `apps/admin/src/pages/blog/__tests__/blog-view.test.ts`, `apps/admin/src/pages/blog/__tests__/BlogPerformance.test.tsx`

**Interfaces:**
- Consumes: `getBlogMetrics`, `getBlogPostMetrics`, `PostMetrics`, `BlogListItem`.
- Produces: `type BlogSort = 'recentes' | 'vistos' | 'cliques'`; `parseSort(v: string | null): BlogSort`; `sortItems(items: BlogListItem[], metrics: Record<string, PostMetrics>, sort: BlogSort): BlogListItem[]` (stable; ties keep date order); `metricLine(m: PostMetrics | undefined, gscReady: boolean): string`; `<DailyChart days={string[]} datasets={Array<{ label: string; data: number[] }>} ariaLabel={string} />` (bar for one dataset, line for two; uses `getAdminChartTheme` and the react-chartjs-2 registration from `apps/admin/src/pages/metricas/charts.tsx`); `<BlogPerformance slug={string} metrics={PostMetrics | undefined} gscUpdatedAt={string | null} />`.

- [ ] **Step 1: Failing tests.** `metricLine({views_30d:1240, search:{clicks:38, position:12.4,...}}, true)` → `"1.240 views (30d) · 38 cliques · posição 12,4"`; with `gscReady=false` → `"1.240 views (30d)"`; undefined metrics → `"0 views (30d)"`. `sortItems(…, 'vistos')` orders by `views_30d` desc; `'cliques'` by `search.clicks` desc (null = 0). `BlogPerformance` with metrics and `gscUpdatedAt=null`: shows tiles "Views 7 dias", "Views 30 dias", "Views total" and the text "Search Console não configurado."; renders a chart titled "Views por dia".
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/admin/src/pages/blog`.
- [ ] **Step 3: Implement.** `BlogPage` fetches `getBlogMetrics` (`['admin','blog','metrics']`, staleTime 5 min) when the tab is Publicados or Aguardando; the Publicados header gets a `SegmentedControl` (Mais recentes / Mais vistos / Mais cliques) bound to `?ordem=`; "Mais cliques" is hidden while `gsc_updated_at` is null. Live rows render `metricLine` under the title. `BlogDetail` (live posts) and `FilePostDetail` render `BlogPerformance` above existing panels.
- [ ] **Step 4: Run, expect PASS**; four `tsc` commands.
- [ ] **Step 5: Verify in the browser** against staging data (seed a few `blog_page_views` rows on staging via `supabase db query --linked` if empty): list metric line, sort control, detail tiles + chart, phone width.
- [ ] **Step 6: Commit** — `feat(admin/blog): views por post na lista e no detalhe`.

**PR 2 deploy order:** migration → `blog-view` (`--no-verify-jwt`) → `platform-admin` → confirm `ALLOWED_ORIGINS` contains `https://www.mesaas.com.br` → merge.

---

## PR 3: Search Console

### Task 10: Search Console schema

**Files:**
- Create: `supabase/migrations/20261031000003_blog_search_console.sql`
- Test: `supabase/tests/entitlements/99_blog_search_console.sql`

**Interfaces:**
- Produces (service_role only): tables `blog_search_daily`, `blog_index_status`, `blog_search_runs` (spec §4) and `blog_search_state (id int primary key default 1 check (id = 1), backfill_before date)`; `blog_search_replace(p_from date, p_to date, p_rows jsonb) returns void` (rows: `[{slug, day, clicks, impressions, position}]`; deletes the window then inserts, one transaction; raises `22023` if any row's day is outside the window); `blog_search_stats(p_days int default 28) returns table (slug text, clicks bigint, impressions bigint, ctr numeric, position numeric)` over the `p_days` days ending at `max(day)` in the table, position impression-weighted, ctr = clicks/impressions (0 when no impressions); `blog_search_series(p_slug text, p_days int) returns table (day date, clicks int, impressions int)` ending at `max(day)`.

- [ ] **Step 1: Entitlement suite:** grants as Task 5; replace with window `[d1,d3]` over existing rows on d1,d2,d3 and new rows only for d1 → d2/d3 gone, d1 updated, a row on d4 untouched; out-of-window row raises; `blog_search_stats(28)` weighted position: (impr 10, pos 2) + (impr 30, pos 6) → 5.0; `blog_search_state` rejects `id = 2`.
- [ ] **Step 2: Run, expect FAIL.** `npm run test:db`.
- [ ] **Step 3: Write the migration.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `feat(db): tabelas do Search Console do blog`.

### Task 11: Google service-account auth + Search Console logic

**Files:**
- Create: `supabase/functions/_shared/google-sa.ts`
- Create: `supabase/functions/blog-search-console-cron/logic.ts`
- Test: `supabase/functions/__tests__/google-sa_test.ts`, `supabase/functions/__tests__/blog-search-console-logic_test.ts`

**Interfaces:**
- Produces, `google-sa.ts`: `interface ServiceAccountKey { client_email: string; private_key: string; token_uri?: string }`; `parseServiceAccount(json: string): ServiceAccountKey` (throws `Error("invalid service account")`, never echoing input); `getGoogleAccessToken(sa: ServiceAccountKey, scope: string, deps?: { fetch?: typeof fetch; now?: () => Date }): Promise<string>` (RS256 JWT, `exp = iat + 3600`, POST form to `token_uri ?? "https://oauth2.googleapis.com/token"`, 10 s timeout, throws `Error("google token exchange failed: <status>")` without the body).
- Produces, `logic.ts`: `GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"`; `slugFromPageUrl(url: string): string | null` (host `mesaas.com.br` or `www.mesaas.com.br`, path `/blog/<slug>` with optional trailing `/`, slug must match `BLOG_SLUG_RE`; else null); `aggregateRows(rows: Array<{ keys: [string, string]; clicks: number; impressions: number; position: number }>): Array<{ slug: string; day: string; clicks: number; impressions: number; position: number }>` (keys = `[date, page]`); `pacificYesterday(now: Date): string`; `refreshWindow(now: Date): { from: string; to: string }` (10 days ending Pacific yesterday); `backfillChunks(backfillBefore: string, horizon: string, max = 4): Array<{ from: string; to: string }>` (30-day chunks ending the day before `backfillBefore`, newest first, never past `horizon`); `backfillHorizon(now: Date): string` (Pacific today minus 486 days); `pickInspectionTargets(live: Array<{ slug: string; date: string | null }>, checked: Record<string, string /* checked_at */>, now: Date, cap = 150): string[]` (all posts with `date` within 3 days first, then never-checked, then oldest `checked_at`; deduped; length ≤ cap); `INDEX_LINK_RE = /^https:\/\/search\.google\.com\//`.

- [ ] **Step 1: Failing tests.** `google-sa`: generate an RSA key with `crypto.subtle.generateKey` (RSASSA-PKCS1-v1_5, SHA-256), export pkcs8 → PEM; call with a fake fetch; assert the request body has `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, the JWT header `{"alg":"RS256","typ":"JWT"}`, claims `iss`, `scope`, `aud`, `exp-iat === 3600`, and the signature verifies with the public key; non-200 → throws with message lacking the response body; `parseServiceAccount('{}')` throws `invalid service account`. Logic: the three URL variants from Review Focus #3 map to `x`; `/blog`, `/blog/`, `https://evil.com/blog/x`, `/blog/X%20Y` → null; two hosts same day aggregate to summed clicks/impressions and weighted position; `backfillChunks('2026-10-17', '2025-06-28')` → 4 chunks `2026-09-17..2026-10-16`, `2026-08-18..2026-09-16`, …; near horizon the last chunk is clipped at `horizon` and further calls return `[]`; `pickInspectionTargets` with cap 2 puts a 1-day-old post first even if recently checked.
- [ ] **Step 2: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/google-sa_test.ts supabase/functions/__tests__/blog-search-console-logic_test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; `npm run check:functions`.
- [ ] **Step 5: Commit** — `feat(functions): autenticação Google por service account e lógica do Search Console`.

### Task 12: `blog-search-console-cron`

**Files:**
- Create: `supabase/functions/blog-search-console-cron/handler.ts`, `index.ts`
- Create: `supabase/migrations/20261031000004_blog_search_console_cron.sql` (schedule; vault-secret pattern from `20260925130001_metrics_snapshots.sql`; daily at a free minute ~06:00-08:00 UTC per the stagger migration; header comment "deploy the function BEFORE applying")
- Test: `supabase/functions/__tests__/blog-search-console-cron_test.ts`

**Interfaces:**
- Consumes: Task 10 RPCs/tables, Task 11 exports, `liveBlogSlugs` (Task 2), `timingSafeEqual`, `reportCronFailure`.
- Produces: `createBlogSearchConsoleHandler(deps: { db: SupabaseClient; cronSecret: string; getToken: (() => Promise<string>) | null; fetch: typeof fetch; now: () => Date; siteUrl: string }): (req: Request) => Promise<Response>`. `index.ts` sets `getToken = null` when `GSC_SERVICE_ACCOUNT_JSON` is unset, `siteUrl = Deno.env.get("GSC_SITE_URL") ?? "sc-domain:mesaas.com.br"`.

Run order: bad/missing `x-cron-secret` → 401. `getToken === null` → log, 200 `{ skipped: "not_configured" }`, no `blog_search_runs` row. Else insert run → refresh window query (paged by `startRow` while a page returns 25000 rows) → `blog_search_replace` → backfill: read `blog_search_state` (null `backfill_before` = refresh `from`), for each chunk query + replace + update `backfill_before = chunk.from`, stop at the first failure (logged) → inspection: `pickInspectionTargets`, one `index:inspect` per slug sequentially, upsert `blog_index_status` (store `inspection_link` only if it matches `INDEX_LINK_RE`), per-URL failures logged and skipped → mark run `ok = true, finished_at`. A token or refresh failure: run `ok = false`, `error` = message, `reportCronFailure`, 500 generic. Search Analytics request body: `{ startDate, endDate, dimensions: ["date","page"], dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: "/blog/" }] }], rowLimit: 25000, startRow }`, endpoint `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`. Inspection endpoint `https://searchconsole.googleapis.com/v1/urlInspection/index:inspect`, body `{ inspectionUrl, siteUrl }`. All Google fetches `AbortSignal.timeout(15_000)`.

- [ ] **Step 1: Failing tests** (fake db + fake fetch): 401 on wrong secret; not-configured → 200 skipped, zero fetches; happy path: one refresh replace with the expected window, up to 4 backfill replaces, `backfill_before` updated to the last chunk's `from`, inspections upserted; a backfill chunk failing → earlier chunks kept, cursor at the last success, run still `ok`; an inspection 429 for one slug → others still upserted; refresh failure → run `ok=false`, 500, body has no Google error text; an `inspectionResultLink` not on `search.google.com` is stored as null; a 25000-row page triggers a second page request with `startRow: 25000`.
- [ ] **Step 2: Run, expect FAIL** — `deno test --no-check supabase/functions/__tests__/blog-search-console-cron_test.ts`.
- [ ] **Step 3: Implement** (shape of `metrics-snapshot-cron/index.ts`: bounded service-role fetch, `reportCronFailure`).
- [ ] **Step 4: Run, expect PASS**; `npm run check:functions`.
- [ ] **Step 5: Commit** — `feat(functions): cron diário do Search Console do blog`.

### Task 13: Search Console in the metrics API and Admin

**Files:**
- Modify: `supabase/functions/platform-admin/blog-metrics.ts`
- Modify: `apps/admin/src/pages/blog/blog-view.ts`, `BlogPerformance.tsx`, `BlogList.tsx`
- Test: `supabase/functions/__tests__/platform-admin-blog-metrics_test.ts`, `apps/admin/src/pages/blog/__tests__/blog-view.test.ts`, `apps/admin/src/pages/blog/__tests__/BlogPerformance.test.tsx`

**Interfaces:**
- Consumes: `blog_search_stats`, `blog_search_series`, `blog_index_status`, `blog_search_runs`.
- Produces: `gsc_updated_at` = latest `finished_at` with `ok = true`; `search` totals from `blog_search_stats(28)`; `index` from `blog_index_status`; `blog-post-metrics.search` zero-filled over the days `blog_search_series` covers. Admin: `indexStatusView(index: IndexStatus | null): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }` with the spec's verdict→tone rule and coverage-state table verbatim (unmapped → Google's string; null → "Ainda não verificada").

- [ ] **Step 1: Failing tests.** API: with a successful run and stats rows → `search` filled and `gsc_updated_at` set; a slug with only Search Console data (no views) appears with zero views. `indexStatusView`: `{verdict:'PASS', coverage_state:'Submitted and indexed'}` → `Indexada`/success; `{verdict:'NEUTRAL', coverage_state:'Discovered - currently not indexed'}` → `Descoberta, ainda não indexada`/warning; `{verdict:'FAIL', coverage_state:'Not found (404)'}` → `Não encontrada (404)`/danger; `{verdict:'PASS', coverage_state:'Something new'}` → `Something new`/success; null → `Ainda não verificada`/neutral. `BlogPerformance` with GSC: tiles "Cliques 28 dias", "Impressões 28 dias", "CTR", "Posição média"; chart "Cliques e impressões por dia (datas do Google)"; index card with label, last crawl date, "Ver no Search Console" link (`target="_blank"`, href = `inspection_link`), hint "Para pedir indexação, clique em Solicitar indexação na página do Google."; footer "Search Console atualizado em <dd/MM/yyyy HH:mm>. Os dados do Google chegam com 2 a 3 dias de atraso."; with `inspection_link` null → "Ainda não verificado pelo Google" and no link.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** List rows add the index `Badge` (tone from `indexStatusView`) next to the metric line; "Mais cliques" sort appears once `gsc_updated_at` is set.
- [ ] **Step 4: Run, expect PASS**; four `tsc` commands.
- [ ] **Step 5: Commit** — `feat(admin/blog): Search Console por post`.

### Task 14: Docs, setup and rollout

**Files:**
- Modify: `CLAUDE.md` (Edge functions env: `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL`; Gotchas: `blog-view` and `blog-search-console-cron` need `--no-verify-jwt`)
- Create: `docs/runbooks/search-console-service-account.md` (Google Cloud project → enable "Google Search Console API" → service account → JSON key → Search Console `sc-domain:mesaas.com.br` → Settings → Users and permissions → add the service-account e-mail as **Restricted** → `npx supabase secrets set --project-ref <PROD> GSC_SERVICE_ACCOUNT_JSON=@key.json` from a file, never inline) — check `docs/` for an existing runbooks folder first and follow its location.

- [ ] **Step 1:** Write both. Run `npm run format:check`.
- [ ] **Step 2:** Full pre-push suite (Global Constraints).
- [ ] **Step 3: Commit** — `docs: Search Console do blog (secrets e passo a passo)`.
- [ ] **Step 4: Rollout (after Eduardo sets the secret):** migration 10 → deploy `blog-search-console-cron` (`--no-verify-jwt`) and `platform-admin` → apply the schedule migration → trigger one run by hand with the cron secret header → confirm `blog_search_runs.ok`, rows in `blog_search_daily`, `blog_index_status` → open the Admin and check a post → merge.
