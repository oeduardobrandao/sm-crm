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
- Filter **before** signing and serializing. Phase 2 still queries with the full id list (no
  extra round trip; the waste is a few DB rows server-side), so every response field is then
  pruned to the visible set. With `V` = visible post ids and `W` = their non-null
  `workflow_id`s:
  - `posts`: only `V`.
  - `postApprovals`, `propertyValues`: rows whose `post_id` is in `V`.
  - `workflowSelectOptions`, `autoPublishSuspendedWorkflowIds`: entries whose workflow is in `W`.
  - `autoPublishSuspendedPostIds`: ids in `V`.
  - Media links and inline content keys (post `conteudo` and pending suggestions): only for `V`,
    so nothing outside it is signed.
- **Row cap.** Lookups whose row count grows as posts × N go through `fetchAllRows`
  (`_shared/paginate.ts`) with a total order ending in `id`, as the helper's contract requires:
  `post_approvals` (`created_at, id`), `post_file_links` (`sort_order, id`),
  `post_property_values` (`display_order, id`; the select gains `id` for that), and both
  `post_edit_suggestions` lookups (pending by `id`, rejected by `updated_at desc, id`). Pending
  is at most one per post, but it is paged too: the test mock dequeues `post_edit_suggestions`
  in call order, and `fetchAllRows` starts its first page before `Promise.all` touches plain
  builders, so paging only the rejected lookup would swap the two.
  The helper throws on a page error; catch it and keep today's behaviour per lookup (log and
  continue with `[]`).
- The rest have a cardinality bounded per post or per workflow, stated here so it is a
  decision rather than an oversight: `post_processes` (one `ativo` per avulso post), `post_process_steps` (a handful per process),
  `workflow_select_options` (per workflow, not per post), and the posts query itself (bounded
  by PR 2). Each of these logs `[hub-posts] row cap reached: <table>` when it returns exactly
  1000 rows, so truncation is never silent.
- Cost: the helper stops only on an empty page (safe whatever prod's `max-rows` is), so each
  paged lookup takes one extra round trip. They all run concurrently inside phase 2, so phase 2
  gets about one round trip longer in total. Accepted for correctness. Prod today: max 116
  approvals, 104 property values and 8 rejected suggestions per client.

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
The timestamp part is the 30th row's `published_at` string **exactly as PostgREST returned
it**: `published_at` comes from `now()` (trigger `20260601000001` and the publish pipeline), so
it carries microseconds, and re-serializing through `Date#toISOString()` truncates to
milliseconds, making `published_at.eq.<ts>` miss and silently skipping rows between the two
values. Validation parses the string to check it but never rewrites it.

**Cutoff.** Start of the UTC day 90 days before now. It only moves once a day, so refetches
within a day agree on what the shell holds.

**`published_at` and `scheduled_at` diverge.** Of 1,954 published posts with both dates, 264
were published more than a day after their scheduled date (up to 65 days) and 38 more than a
day before it (up to 30 days). The calendar and the Postagens month buckets place posts by
`scheduled_at`, so `published_at` paging cannot tell the calendar when a month is complete.
The calendar therefore gets its own date-range mode (below), and the shell includes a
published post if **either** date is recent.

**Default (shell).**

- Posts: `status <> 'postado'` OR `published_at >= cutoff` OR `scheduled_at >= cutoff`
  (`or=(status.neq.postado,published_at.gte.<cutoff>,scheduled_at.gte.<cutoff>)`),
  conta/cliente scoped as today. Every post with `scheduled_at >= cutoff` is therefore in the
  shell, so calendar months that start on or after the cutoff are complete without more
  requests.
- In parallel in phase 1, placed **after** the posts query in the `Promise.all` array: one
  row of `status = 'postado' AND published_at < cutoff` (`.limit(1)`, not `.maybeSingle()`),
  read as `Array.isArray(data) && data.length > 0`. If it exists, the response carries `olderCursor: "<cutoff>|0"` (with id 0,
  "older than" reduces to `published_at < cutoff`) and `historyCutoff: "<cutoff ISO>"`;
  otherwise both are `null`. A post in the shell because of its `scheduled_at` can also come
  back in a history page; the client dedupes by id.

**`?before=<cursor>` (history page).**

- Posts: `status = 'postado'` and older than the cursor, ordered by `published_at desc, id desc`,
  fetching 31 rows and returning 30.
- `nextCursor`: the cursor of the 30th row when a 31st exists, else `null`.
- No `olderCursor`. "Em produção" never applies (no internal statuses), so that lookup is
  skipped by its existing empty-list guard.

**`?from=<ISO>&to=<ISO>` (calendar range).**

- Posts: `status = 'postado'` and `scheduled_at` in `[from, to)`, ordered by
  `scheduled_at, id`. The browser sends its local month boundaries, so placement matches
  `PostCalendar`'s local-day bucketing.
- `to` must be after `from` and at most 45 days later, so one request is bounded to about a
  month; otherwise 400.
- Published posts with a null `scheduled_at` never appear on the calendar, so this mode never
  needs them.

**`?post_id=<int>` (single post).**

- `.eq("id", postId)` plus the conta/cliente scoping. A non-integer id is a 400.
- Returns `posts: [post]` with its approvals and the rest of the shape.
- A post that is missing, belongs to another client, or is filtered out by the visibility rule
  returns 404 `"Post não encontrado."`. A never-sent draft must never come back through this
  mode; an em-produção post (internal status, already seen by the client) is visible and comes
  back, as in the shell.

More than one of `before`, `from`/`to` and `post_id` is a 400. The PATCH branch is
unchanged.

**Types** (`apps/hub/src/types.ts`): `HubPostsResponse` gains optional
`olderCursor?: string | null`, `historyCutoff?: string | null` and
`nextCursor?: string | null`.

**No migration.** `idx_workflow_posts_cliente` narrows every mode to one client's rows, at most
116 today. Filtering and sorting a few hundred, or a couple of thousand, rows after the index
lookup costs well under a millisecond, while the payload this design removes is ~1 MB. A
partial index on `(cliente_id, published_at desc, id desc) where status = 'postado'` is the
next step if a client passes ~5,000 posts or the history query shows up in
`pg_stat_statements`. Not before.

### Frontend

**Query keys.** All four live under the existing `['hub-posts', token]` prefix, so the
current `invalidateQueries({ queryKey: ['hub-posts', token] })` after approve/correction
refreshes them and they inherit the 30s staleTime from `createHubQueryClient`:

| Key                                            | Query                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `['hub-posts', token]`                         | shell (unchanged; prefetch, badges, Aprovações, polling)                                         |
| `['hub-posts', token, 'history', olderCursor]` | `useInfiniteQuery`, `initialPageParam` = `olderCursor`, `getNextPageParam` = page's `nextCursor` |
| `['hub-posts', token, 'range', from]`          | calendar range for one older month                                                               |
| `['hub-posts', token, 'post', id]`             | single post                                                                                      |

**Invalidation after approve/correction.** A plain prefix invalidation would refetch every
loaded history page (TanStack refetches all pages of an infinite query, in sequence) and every
cached range month: one `hub-read` hit each, per action, for rows the action cannot change
(history and ranges are `postado` only). The two existing call sites (`PostagensPage.tsx:159`,
`AprovacoesPage.tsx:147`) become one helper, `invalidateHubPosts(qc, token)`, that refetches
the shell (`exact: true`) and active single-post queries, and marks history and range queries
stale with `refetchType: 'none'` (they refresh on next use).

`api.ts` gains `fetchOlderPosts(token, before)`, `fetchPostsInRange(token, from, to)` and
`fetchPost(token, postId)`.

**`useHubPosts(token, { history })`** (new, `queries.ts`):

- Reads the shell. With `history: true`, also reads the infinite query. `useInfiniteQuery`
  fetches its first page as soon as it is enabled, so `enabled` is a local flag that stays
  false until the first `loadOlder()` call (and requires a non-null `olderCursor`); later calls
  use `fetchNextPage`. Mounting Postagens therefore makes no history request.
- The history key includes `olderCursor`. When the cutoff rolls over at midnight UTC in an open
  tab, the shell's refetch drops a day of published posts and returns a new cursor; keying on
  it starts a fresh history from that cursor instead of leaving the dropped day in neither
  list.
- `hasOlder` is `history.data === undefined ? olderCursor != null : (hasNextPage ||
isFetchNextPageError)`. (`useInfiniteQuery` reports `hasNextPage === false` with no data, so
  a bare `hasNextPage` would hide the button after a failed first page.) A failed page leaves
  the button in place with "Tentar novamente"; `loadOlder()` retries it (`refetch` for the
  first page, `fetchNextPage` after). History and range queries use `retry: 1`, so the error
  shows in about a second rather than after the default three retries.
- `postApprovals` are merged too: shell plus every history page, deduped by approval id.
  Without this, a published post opened from a history page shows an empty Histórico tab
  (`PostagensPage.tsx:131` reads the shell's approvals into `PostDetailDialog`).
- Returns `{ data, posts, postApprovals, isLoading, isError, loadOlder, hasOlder,
isLoadingOlder, olderError }`.
  `posts` is the shell's posts plus all history pages, deduplicated by id with the shell's copy
  winning. `data` is the shell response (KPIs, `autoPublish*`, `instagramProfile`).
- Postagens uses it with `history: true`. Home, Aprovações, `usePendingApprovalsCount` and
  `HubPostChip` read the shell only: every pending post is always in it, and the Home calendar
  uses the range mode instead.

**Postagens** (`PostagensPage.tsx`):

- `allVisible`, filters and the month dropdown run over the merged `posts`.
- While `hasOlder`: a "Carregar posts anteriores" button (spinner while `isLoadingOlder`),
  rendered **regardless of the grid's state**. Today `PostagensPage.tsx:219` replaces the grid
  with "Nenhuma postagem disponível ainda." when `allVisible` is empty, and the no-results
  branch skips it too; a client whose agency stopped publishing more than 90 days ago has an
  empty shell and must still reach its history. With `hasOlder`, the empty copy becomes
  "Nenhuma postagem recente." above the button.
- Every read of `data?.posts` / `data?.postApprovals` on the page moves to the merged lists,
  including `selectedPosts` (line 142, feed preview selection) and `approvals` (line 131).
- Status chip counts for Aguardando / Correção / Aprovados stay exact (always in the shell).
  "Todos", per-month counts and media counts reflect what is loaded.
- The publishing poll (`refetchInterval`) stays on the shell query.
- Copy is Portuguese, period/colon instead of em-dashes, through the existing `hubPosts`
  i18n namespace.

**Home calendar** (`HomePage.tsx`, `PostCalendar.tsx`):

- `PostCalendar` gets an optional `onMonthChange(year, month)` and `loading` prop.
- Home tracks the displayed month. When the shell has a `historyCutoff` and the month's local
  start is before it, Home runs the range query for that month (`from` = local month start,
  `to` = next month's local start) and merges its posts with the shell's, deduped by id.
  Months starting on or after the cutoff, or any month when `historyCutoff` is null, need no
  request.
- One request per older month visited; revisiting it within the staleTime is free.
- `loading` shows a light overlay on the grid; month navigation stays usable. A failed range
  request shows the shell's posts for that month with a small "Não foi possível carregar este
  mês" line and a retry.
- KPIs keep reading the shell. "Taxa de aprovação" counts current `aprovado_cliente` vs
  `correcao_cliente`, both always in the shell, so it is unchanged by the bound.

**Deep links** (`/postagens/:id`):

- When the id is not in the merged `posts` and the shell has loaded, `PostagensPage` runs the
  single-post query and passes the result to `PostDetailDialog` as a one-post list, with that
  response's `postApprovals`.
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
non-null and the range mode when `historyCutoff` is non-null, neither of which the old backend
sends, and it reads single posts with
`posts.find(id)`, so the old backend's full list (ignoring `post_id`) still works. The old
frontend against the new backend loses posts older than 90 days in an already-open tab until
the silent update reloads it.

So, unlike our usual order: **merge the frontend first, then deploy `hub-posts`** (staging,
smoke, prod). PR 1 has no contract change and deploys the function before merging, as usual.

## Testing

Deno (`supabase/functions/__tests__/`, existing `supabaseMock`):

- PR 1: never-sent draft dropped and its media not signed; em-produção internal post kept;
  approvals and media read through paging past one page.
- PR 1 pruning: a draft's approvals, property values, select options of a draft-only
  workflow and its suspension ids are absent from the response.
- PR 2: shell keeps a 200-day-old `enviado_cliente`/`aprovado_cliente` post, drops a
  `postado` whose two dates are both older than the cutoff, and keeps one with an old
  `published_at` but recent `scheduled_at`; `olderCursor`/`historyCutoff` null vs set; a
  history page breaks a tie on `published_at` by id and returns `nextCursor: null` on the last
  page; range mode returns by `scheduled_at` (including a post published 60 days after its
  scheduled date) and rejects `to <= from` and ranges over 45 days; malformed cursor and any
  two modes together → 400; `post_id` of a draft and of another client's post → 404.
- `supabaseMock` dequeues per `table:select`, defaults to `{ data: [] }`, and `Promise.all`
  starts the thenables in array order. With the older check after the posts query, existing
  `workflow_posts` fixtures keep working (the check gets `[]`, so `olderCursor` is `null`); new
  tests queue two `workflow_posts` entries. A test asserts `olderCursor: null` for an existing
  fixture, which catches a `.maybeSingle()`/truthiness mistake (`[]` is truthy).
- The mock does not execute PostgREST filters, so tests assert the recorded `.or()` arguments
  (cutoff, cursor timestamp with microseconds kept verbatim, range bounds), and the three modes
  are smoke-tested on staging before prod.
- Cursor precision: a history fixture with microsecond `published_at` values sharing a
  millisecond, checking the `nextCursor` string equals the row's value byte for byte.
- `post_id` of an em-produção post (has an `enviado_cliente` event) → 200; of a never-sent
  draft (no such event) → 404.

Vitest (`apps/hub`):

- `useHubPosts`: dedupe with the shell winning; mounting with a non-null `olderCursor` makes
  zero history requests; history disabled when `olderCursor` is null/absent (old backend); a
  new `olderCursor` starts a fresh history.
- Postagens: button shows and loads, hides when exhausted, stays with "Tentar novamente" after
  a failed first page; an empty shell with `olderCursor` shows the button; a post from a
  history page shows its approvals; deep link outside the list loads via single-post with its
  approvals, 404 shows "não disponível", prev/next hidden.
- `invalidateHubPosts`: refetches the shell, does not refetch loaded history pages or range
  months.
- Home calendar: a month before `historyCutoff` fetches exactly its local range once; a month
  after it, or with `historyCutoff` null, fetches nothing; range posts merge with the shell's.
- HubPostChip: hover on an id outside the shell uses the single-post query.

Browser: Hub on :5175 against prod (`node scripts/with-env.mjs npm run dev:hub`) with the
deployed function: first-load payload size before/after for a large client, "Carregar posts
anteriores", calendar back-navigation, an old deep link.

## Out of scope

- Rendering portal-visible properties in `PostDetailDialog` (separate task).
- `blur_data_url` weight (~325 KB raw for the largest client): could move to the media
  thumbnails or be dropped for off-screen tiles; not addressed here.
- Postagens month dropdown completeness: it lists months among loaded posts. An older month
  appears once "Carregar posts anteriores" reaches it, which the visible button makes clear.
- Stale `aprovado_cliente`/`enviado_cliente` posts that never advance: they stay in the shell
  by design (pending must never disappear), so a client with many of them still gets a larger
  first load.
