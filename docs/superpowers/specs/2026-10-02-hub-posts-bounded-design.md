# Hub: bounded `hub-posts` (recent posts first, older on demand)

Date: 2026-10-02
Status: design approved, pending spec review

## Problem

`hub-posts` GET returns every post a client has ever had, with signed URLs for all of
their media, on every Hub page load: `prefetchHubShell` (`apps/hub/src/queries.ts`) fires
it on every route because the nav badge reads it.

Prod, 2026-10-02 (product ~5 months old, oldest post 2026-04-20):

|                              |                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clients with posts           | 245                                                                                                                                                                                     |
| Posts per client             | p50 12, p90 57, max 116                                                                                                                                                                 |
| Largest client               | 116 posts, 412 media links                                                                                                                                                              |
| Raw payload, largest clients | ~1.4 MB estimated: ~520 KB of text (`conteudo` JSON + `conteudo_plain` + `ig_caption`), ~325 KB of `blur_data_url`, ~400 media links × 2 signed URLs (URL length assumed, not measured) |

Roughly 12 KB per post. Only `postado` grows without limit; every other status is work in
flight. A client posting 25 times a month adds ~300 posts a year.

Two related findings:

1. **Never-sent drafts leave the server.** The query has no status filter. 1,078 `rascunho`,
   79 `revisao_interna` and 28 `aprovado_interno` posts exist in prod; ~940 of them never
   reached `enviado_cliente`. Their full `conteudo`, caption and signed media URLs go to the
   client's browser, and only `isPostClientVisible` (`apps/hub/src/lib/postView.ts`) hides
   them on screen.
2. **Silent row cap.** `post_approvals` and `post_file_links` are read with `.in(postIds)` and
   no paging. PostgREST's `max-rows` (1000 by default; confirm prod's value during
   implementation) would silently cut them off for a large enough client.

## Decisions

- **Recent first, older on demand.** The first load carries every in-flight post plus the
  last ~90 days of published posts. Postagens gets "Carregar posts anteriores"; the Home
  calendar loads older months as the client navigates to them. Every past post stays
  reachable.
- **One endpoint, three modes** (`hub-posts` default / `?before=` / `?post_id=`), all returning
  the `HubPostsResponse` shape and sharing one enrichment path. Rejected: separate functions
  (duplicated enrichment, three deploys and config-audit entries); paginating only the
  rendering (doesn't reduce the download).
- **Portal-visible properties stay in the payload** (`propertyValues`,
  `workflowSelectOptions`), limited to the posts each response returns. No Hub screen renders
  them today (the last reader went away in #541, while 15 definitions in 7 templates are marked
  `portal_visible`); showing them again is a separate task, out of scope here.
- **Two PRs.** PR 1 is the privacy/correctness fix with no contract change; PR 2 is the bound.

## PR 1: visibility filter and row cap

`supabase/functions/hub-posts/handler.ts`, GET only:

- After phase 2 (where `emProducaoByPost` is computed alongside the other lookups), keep only
  posts where status is client-visible, or status is internal and `emProducaoByPost.has(id)`.
  This mirrors `isPostClientVisible`; the visible-status set already exists in
  `em-producao.ts` (`CLIENT_VISIBLE_STATUSES`), so export it and reuse it rather than adding a
  third copy.
- Filter **before** signing: media links, approvals, suggestions, property values and inline
  content keys of dropped posts are discarded, and nothing for them is signed or returned.
  Phase 2 still queries with the full id list, so there is no extra round trip; the waste is a
  few DB rows server-side.
- `post_approvals` and `post_file_links` go through `fetchAllRows` (`_shared/paginate.ts`) with
  a stable order ending in `id` (`created_at, id` and `sort_order, id`), as the helper's
  contract requires. The helper throws on a page error; catch it there and keep today's
  behaviour: log and continue with `[]`.
- Cost: the helper stops only on an empty page (safe whatever prod's `max-rows` is), so these
  two lookups take one extra round trip each. They run inside the parallel phase 2, so phase 2
  gets about one round trip longer. Accepted for correctness.

Behaviour change, visible to clients: Home's "Posts este mês" and "Próximo post" count every
status today (`HomePage.tsx` reads the unfiltered list), so drafts the client never saw stop
counting. That is the intent.

No frontend change is required; the client-side filters stay as defence in depth.

## PR 2: the bound

### Backend modes

All modes share the token check, rate limit (`hub-read`, one hit per request) and the phase 1
token-scoped rows (`instagram_accounts`, `clientes.auto_publish_on_approval`), then run the
same enrichment and PR 1 visibility filter over whatever posts the mode selected.

**Cursor.** Opaque to the client: `"<published_at ISO>|<id>"`. "Older than the cursor"
means `(published_at, id) < (ts, id)`, in PostgREST
`or=(published_at.lt.<ts>,and(published_at.eq.<ts>,id.lt.<id>))`. Paging is on
`published_at` because every `postado` row has it, while 191 have a null `scheduled_at`. A
malformed cursor (unparseable date, non-integer id) is a 400.

**Cutoff.** Start of the UTC day 90 days before now. It only moves once a day, so refetches
within a day agree on what the shell holds.

**Default (shell).**

- Posts: `status <> 'postado'` OR `published_at >= cutoff`
  (`or=(status.neq.postado,published_at.gte.<cutoff>)`), conta/cliente scoped as today.
- In parallel in phase 1: one row of `status = 'postado' AND published_at < cutoff`
  (`limit 1`). If it exists, the response carries `olderCursor: "<cutoff>|0"` (with id 0,
  "older than" reduces to `published_at < cutoff`); otherwise `olderCursor: null`.

**`?before=<cursor>` (history page).**

- Posts: `status = 'postado'` and older than the cursor, ordered by `published_at desc, id desc`,
  fetching 31 rows and returning 30.
- `nextCursor`: the cursor of the 30th row when a 31st exists, else `null`.
- No `olderCursor`. "Em produção" never applies (no internal statuses), so that lookup is
  skipped by its existing empty-list guard.

**`?post_id=<int>` (single post).**

- `.eq("id", postId)` plus the conta/cliente scoping. A non-integer id is a 400.
- Returns `posts: [post]` with its approvals and the rest of the shape.
- A post that is missing, belongs to another client, or is filtered out by the visibility rule
  returns 404 `"Post não encontrado."`. A draft must never come back through this mode.

`before` and `post_id` together is a 400. The PATCH branch is unchanged.

**Types** (`apps/hub/src/types.ts`): `HubPostsResponse` gains optional
`olderCursor?: string | null` and `nextCursor?: string | null`.

No migration: `idx_workflow_posts_cliente` already narrows to a client's rows.

### Frontend

**Query keys.** All three live under the existing `['hub-posts', token]` prefix, so the
current `invalidateQueries({ queryKey: ['hub-posts', token] })` after approve/correction
refreshes them and they inherit the 30s staleTime from `createHubQueryClient`:

| Key                                            | Query                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `['hub-posts', token]`                         | shell (unchanged; prefetch, badges, Aprovações, polling)                                         |
| `['hub-posts', token, 'history', olderCursor]` | `useInfiniteQuery`, `initialPageParam` = `olderCursor`, `getNextPageParam` = page's `nextCursor` |
| `['hub-posts', token, 'post', id]`             | single post                                                                                      |

`api.ts` gains `fetchOlderPosts(token, before)` and `fetchPost(token, postId)`.

**`useHubPosts(token, { history })`** (new, `queries.ts`):

- Reads the shell. With `history: true`, also reads the infinite query. `useInfiniteQuery`
  fetches its first page as soon as it is enabled, so `enabled` is a local flag that stays
  false until the first `loadOlder()` call (and requires a non-null `olderCursor`); later calls
  use `fetchNextPage`. Mounting Home or Postagens therefore makes no history request.
- The history key includes `olderCursor`. When the cutoff rolls over at midnight UTC in an open
  tab, the shell's refetch drops a day of published posts and returns a new cursor; keying on
  it starts a fresh history from that cursor instead of leaving the dropped day in neither
  list.
- Returns `{ data, posts, isLoading, isError, loadOlder, hasOlder, isLoadingOlder }`.
  `posts` is the shell's posts plus all history pages, deduplicated by id with the shell's copy
  winning. `data` is the shell response (KPIs, `autoPublish*`, `instagramProfile`).
- Home and Postagens use it with `history: true`. Aprovações, `usePendingApprovalsCount` and
  `HubPostChip` keep reading the shell only: every pending post is always in it.

**Postagens** (`PostagensPage.tsx`):

- `allVisible`, filters and the month dropdown run over the merged `posts`.
- Under the grid, while `hasOlder`: a "Carregar posts anteriores" button (spinner while
  `isLoadingOlder`).
- Status chip counts for Aguardando / Correção / Aprovados stay exact (always in the shell).
  "Todos", per-month counts and media counts reflect what is loaded.
- The publishing poll (`refetchInterval`) stays on the shell query.
- Copy is Portuguese, period/colon instead of em-dashes, through the existing `hubPosts`
  i18n namespace.

**Home calendar** (`HomePage.tsx`, `PostCalendar.tsx`):

- `PostCalendar` gets an optional `onMonthChange(year, month)` and `loading` prop.
- Home tracks the displayed month. While its first day is earlier than the oldest
  `published_at` among loaded published posts (minus one day of slack for the
  `scheduled_at`/`published_at` gap) and `hasOlder`, it calls `loadOlder()`, one page at a
  time, never two in flight.
- `loading` shows a light overlay on the grid; month navigation stays usable.
- KPIs keep reading the shell. "Taxa de aprovação" counts current `aprovado_cliente` vs
  `correcao_cliente`, both always in the shell, so it is unchanged by the bound.

**Deep links** (`/postagens/:id`):

- When the id is not in the merged `posts` and the shell has loaded, `PostagensPage` runs the
  single-post query and passes the result to `PostDetailDialog` as a one-post list.
- While it loads, the dialog is not mounted (same as while the shell loads today,
  `PostagensPage` only renders it once data is in), so "não disponível" never flashes. On 404
  it mounts with no match and shows "Esta postagem não está disponível." as today.
- Prev/next and the "X de Y" counter are hidden for a post opened this way.
- The filter-reset effect keys on the merged list, as now.
- `/aprovacoes/:id` keeps its current rule (pending posts only, no fallback).

**HubPostChip:** when the hovered id is not in the shell, the hover card uses the single-post
query (`enabled` only while open, so hovering costs at most one request per post per 30s).
The link is unchanged.

### Rollout

The new frontend tolerates the old backend: it only calls `?before=` when `olderCursor` is
non-null, which the old backend never sends, and it reads single posts with
`posts.find(id)`, so the old backend's full list (ignoring `post_id`) still works. The old
frontend against the new backend loses posts older than 90 days in an already-open tab until
the silent update reloads it.

So, unlike our usual order: **merge the frontend first, then deploy `hub-posts`** (staging,
smoke, prod). PR 1 has no contract change and deploys the function before merging, as usual.

## Testing

Deno (`supabase/functions/__tests__/`, existing `supabaseMock`):

- PR 1: never-sent draft dropped and its media not signed; em-produção internal post kept;
  approvals and media read through paging past one page.
- PR 2: shell keeps a 200-day-old `enviado_cliente`/`aprovado_cliente` post and drops a
  `postado` older than the cutoff; `olderCursor` null vs set; a history page breaks a tie on
  `published_at` by id and returns `nextCursor: null` on the last page; malformed cursor and
  `before`+`post_id` → 400; `post_id` of a draft and of another client's post → 404.
- `supabaseMock` dequeues per table + operation, so the new phase 1 `workflow_posts` select
  (the `limit 1` older check) shifts the queue for every existing hub-posts case in
  `hub-functions_test.ts`, including the single `files` query case from #622. Update those
  fixtures in the same PR.

Vitest (`apps/hub`):

- `useHubPosts`: dedupe with the shell winning; mounting with a non-null `olderCursor` makes
  zero history requests; history disabled when `olderCursor` is null/absent (old backend); a
  new `olderCursor` starts a fresh history.
- Postagens: button shows and loads, hides when exhausted; deep link outside the list loads
  via single-post, 404 shows "não disponível", prev/next hidden.
- Home calendar: navigating past the loaded range loads pages until covered, then stops.
- HubPostChip: hover on an id outside the shell uses the single-post query.

Browser: Hub on :5175 against prod (`node scripts/with-env.mjs npm run dev:hub`) with the
deployed function: first-load payload size before/after for a large client, "Carregar posts
anteriores", calendar back-navigation, an old deep link.

## Out of scope

- Rendering portal-visible properties in `PostDetailDialog` (separate task).
- `blur_data_url` weight (~325 KB raw for the largest client): could move to the media
  thumbnails or be dropped for off-screen tiles; not addressed here.
- Stale `aprovado_cliente`/`enviado_cliente` posts that never advance: they stay in the shell
  by design (pending must never disappear), so a client with many of them still gets a larger
  first load.
