# Métricas do post em pop-up: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking any Instagram post on the analytics Conta page opens an Instagram-style metrics
pop-up (desktop dialog, phone sheet). The second PR adds every per-post metric the API offers and a
views/reach curve built from our own snapshots.

**Architecture:**
- One content component, `PostMetricsView`, rendered by two hosts: a desktop `Dialog` and the
  existing phone `PostDetailSheet`.
- PR 1 is frontend only, over the `instagram_posts` columns the CRM already reads.
- PR 2 adds nullable columns, a snapshot table written by the existing syncs through one shared
  helper, and a `SECURITY INVOKER` SQL function that returns the curve.

**Tech Stack:**
- Frontend: React 19, TanStack Query, shadcn Dialog/Sheet, lucide-react, Vitest + Testing Library.
- Backend: Deno edge functions, Postgres/RLS, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-11-23-post-metrics-modal-design.md` (read it first; this
plan argues from it). Mockups: https://claude.ai/artifact/M6GzjFooXT16NGcn1hWdoq

**Worktree:** `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/google-calendar-sync-issue-7b4cf8`
(lowercase `projects`), branch `claude/post-metrics-modal-redesign-510bbf`.
- Run `git -C <worktree> status` before claiming anything is committed.
- PR 2 goes on a new branch cut from `main` after PR 1 merges. If it is cut earlier, rebase it
  with `--onto main` after PR 1's squash merge.

## Global Constraints

- **Copy:**
  - All UI copy is pt-BR, with no em dashes. "—" is the missing-value glyph, not punctuation.
  - "API oficial" is allowed; never write "aprovado pela Meta".
- **Missing data:** NULL renders "—" with a reason, never `0`.
- **Post ids:** a post id is a `string` (uuid) everywhere in the frontend.
- **Reels:** a Reel is `media_type === 'VIDEO'`.
- **Publication time:** formatted with `timeZone: 'America/Sao_Paulo'`.
- **Icons:** `lucide-react` only. The Instagram glyph is lucide `Instagram`.
- **Links:** every external `href` goes through `sanitizeUrl()`, and the link is hidden when that
  returns an empty string.
- **Styling:**
  - the CRM legacy tokens (`--card-bg`, `--surface-1`, `--surface-2`, `--text-main`,
    `--text-muted`, `--text-light`, `--border-color`, `--success`)
  - numbers use `font-variant-numeric: tabular-nums`
  - curve color `#c8169f`
- **CSS file:** new CSS goes in `apps/crm/app.css` (signed-in shell only). `cssSplitBoundary.test.ts`
  must stay green.
- **Phone shell:** a phone-shell layout rule uses the phone or desktop shell query, never a bare
  width query (`phoneShellCss.test.ts`).
- **Never `useBlocker`.**
- **Before pushing, run all of these:**
  - `npm run lint` and `npm run format:check`
  - the five typechecks: `npx tsc -p apps/crm/tsconfig.json --noEmit`, the same for `apps/hub`,
    `apps/admin` and `apps/mcp-widgets`, and `npx tsc -p tsconfig.scripts.json`
  - `npm run test`
  - for PR 2 also `npm run check:functions` and `npm run test:functions`
- **Formatters:** run prettier on your own paths only, never repo-wide.
- **PR 2 deploy order** (spec §5): migration (staging, then prod) → `instagram-sync-cron` +
  `instagram-integration` with `--no-verify-jwt` → merge. Inverting the first two breaks every
  sync. Prod deploys need the user's OK.

## Review Focus

1. **A post whose `permalink` is empty or unsafe.** The card, row and pop-up still open the
   metrics; only the Instagram link disappears. Test in A4 and A5.
2. **The open post leaves `posts`** (period changed, refetch dropped it). The pop-up closes
   instead of showing stale data or crashing. Test in A5.
3. **Opening the pop-up from the "Ver mais" Sheet.** The Sheet stays open, and focus returns to
   the clicked row on close. Test in A5.
4. **A Reel.**
   - The follows and profile-visits cards show "—" with the Reels reason.
   - PR 2 only: no feed-only rows (profile actions) appear, and the watch-time cards do appear.
   Tests in A3 and B6.
5. **A rejected or partial Graph response in PR 2.**
   - It never writes a history row from preserved values.
   - It never nulls columns another request returned.
   Tests in B3 and B4.

---

# Part A: PR 1 (frontend only, no deploy)

### Task A1: Post id is a string; `synced_at` is typed

**Files:**
- Modify: `apps/crm/src/services/analytics.ts` (`PostAnalytics` at :128, `assignTagToPost` and
  `removeTagFromPost` at :1021 and :1029)
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (`expandedPostId` :1044,
  `handleAssignTag` :1450, and any other post-id `number`)
- Modify: `apps/crm/src/pages/analytics-conta/phone/ContaPhone.tsx:246`
- Modify: `apps/crm/src/pages/analytics-conta/phone/PostDetailSheet.tsx:48`
- Modify: any test fixture that builds a `PostAnalytics` with a numeric `id`. Grep
  `apps/crm/src/**/__tests__` and `apps/crm/src/test` for `PostAnalytics` and `instagram_post_id`.

**Interfaces:**
- Produces:
  - `PostAnalytics.id: string`
  - `PostAnalytics.synced_at: string | null`
  - `assignTagToPost(postId: string, tagId: number)` and `removeTagFromPost(postId: string, tagId: number)`

- [ ] **Step 1: Change the types.** `id: string`, and add `synced_at: string | null` after
  `posted_at`. In `getPostsAnalytics`, map `synced_at: p.synced_at ?? null`. Change every
  `useState<number | null>` that holds a post id to `string | null`.
- [ ] **Step 2: Typecheck.** Run `npx tsc -p apps/crm/tsconfig.json --noEmit`.
  Expected: errors only in fixtures that use numeric ids. Fix them to uuid-like strings
  (`'post-1'`).
- [ ] **Step 3: Run the affected suites.** Run
  `npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/pages/analytics apps/crm/src/services`.
  Expected: PASS.
- [ ] **Step 4: Commit** with `fix(crm): id de post do Instagram é uuid (string)`.

### Task A2: Formatting and benchmark helpers

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/contaFormat.ts`
- Test: `apps/crm/src/pages/analytics-conta/__tests__/contaFormat.test.ts` (create it if absent)

**Interfaces:**
- Consumes: `selectRateSamples`, `quartiles`, `MIN_SAMPLE`, `RateDistributions` and `RateKey` from
  `@/lib/ig-rates`.
- Produces:
  - `formatPublishedAt(iso: string): string`. Example: `'Publicado em 21 de nov. às 18:02'`, São
    Paulo time.
  - `formatSyncedAgo(iso: string | null, now?: Date): string | null`. Returns `'Atualizado há 2 h'`,
    `'Atualizado há 15 min'`, `'Atualizado agora'` under 1 min, `'Atualizado há 3 dias'` from 48 h
    on, and `null` for null input.
  - `rateBenchmark(dists: RateDistributions | undefined, mediaType: string, key: RateKey):
    { p50: number; p75: number } | null`. Returns null when the sample is below `MIN_SAMPLE` or
    `dists` is undefined.

- [ ] **Step 1: Write the failing tests**

```ts
it('formats the publication instant in São Paulo time', () => {
  expect(formatPublishedAt('2026-11-21T21:02:00Z')).toBe('Publicado em 21 de nov. às 18:02');
  expect(formatPublishedAt('2026-11-22T02:30:00Z')).toBe('Publicado em 21 de nov. às 23:30'); // crosses UTC midnight
});
it('formats the sync age', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  expect(formatSyncedAgo('2026-11-23T10:00:00Z', now)).toBe('Atualizado há 2 h');
  expect(formatSyncedAgo('2026-11-23T11:45:00Z', now)).toBe('Atualizado há 15 min');
  expect(formatSyncedAgo(null, now)).toBeNull();
});
it('rateBenchmark returns quartiles of the per-format sample, null below MIN_SAMPLE', () => {
  // build dists with buildRateDistributions from 5 VIDEO rows and 2 IMAGE rows
  expect(rateBenchmark(dists, 'VIDEO', 'like_rate')).toEqual({ p50: expect.any(Number), p75: expect.any(Number) });
  expect(rateBenchmark(undefined, 'VIDEO', 'like_rate')).toBeNull();
});
```

- [ ] **Step 2: Run** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta/__tests__/contaFormat.test.ts`.
  Expected: FAIL, the functions are not exported.
- [ ] **Step 3: Implement.**
  - `formatPublishedAt` uses `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day:
    '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })` with `formatToParts`, to build
    `Publicado em {day} de {month} às {hh}:{mm}`. The month keeps Intl's own abbreviation and dot
    ("nov.").
  - `rateBenchmark` = `selectRateSamples` → `quartiles` → `{ p50, p75 }`.
- [ ] **Step 4: Run the tests again**, with and without `TZ=UTC`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): formatadores e referência de taxa para métricas do post`.

### Task A3: `PostMetricsView` (the shared content)

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/components/PostMetricsView.tsx`
- Create: `apps/crm/src/pages/analytics-conta/components/__tests__/PostMetricsView.test.tsx`
- Delete: `apps/crm/src/pages/analytics-conta/components/PostInsightsDetail.tsx` and its test.
  First move `ActionMetricValue` into `PostMetricsView.tsx` and re-export it; the table cells
  import it.
- Modify: `apps/crm/app.css` (`.post-metrics*` classes)

**Interfaces:**
- Consumes:
  - `formatPublishedAt`, `formatSyncedAgo` and `rateBenchmark` (A2)
  - `formatMediaType` (move it from `AnalyticsContaPage.tsx` to `contaFormat.ts` and export it)
  - `missingActionMetricTitle`
  - `PostCommentsPanel`
  - `SegmentedControl` (sheet variant)
- Produces:

```ts
export type PostMetricsTab = 'overview' | 'engagement' | 'comments';
export function PostMetricsView(props: {
  post: PostAnalytics;
  clientId: number;
  dists?: RateDistributions;
  commentsEnabled: boolean;
  variant: 'dialog' | 'sheet';
  overviewFooter?: ReactNode;
}): JSX.Element;
export function ActionMetricValue(/* unchanged signature */): JSX.Element;
```

Layout and copy follow spec §2 items 2 to 7 exactly:
- the thumbnail sizes, per variant and for Reels
- a five-column icon row; the Reposts column renders only when `post.reposts` is a number
  (`reposts` is added to `PostAnalytics` as `number | null`, mapped with `toNullableCount`)
- the tab labels "Visão geral", "Engajamento", "Comentários · N"
- Resumo cards by type, and the ratio strip: Engajamento, then IG Score "N de 100" when non-null
- Ações after viewing, Interações, "Por visualização" bars, footnote and footer copy

The caption clamp "Ver mais" is a real `<button>`. The tab resets to `'overview'` when `post.id`
changes: keep `{postId, tab}` state and decide during render, like `PostDetailSheet.tsx:48`. The
dialog variant uses underline tabs with `role="tablist"`/`tab`/`tabpanel`, and the sheet variant
uses `SegmentedControl semantics="tablist"`.

- [ ] **Step 1: Write the failing tests** (render with a QueryClient wrapper; mock
  `PostCommentsPanel` to a stub that records mounts):
  - `it('shows the icon row with pt-BR numbers and hides Reposts when null')`: likes 2515 →
    `'2.515'`; no element named `Reposts`.
  - `it('shows Reposts when the post has a number')`.
  - `it('Resumo for a carousel shows views, reach, profile visits and new followers')`: labels
    `Visualizações`, `Contas alcançadas`, `Visitas ao perfil`, `Novos seguidores`.
  - `it('Resumo for a Reel shows "—" with the Reels reason for follows and profile visits')`:
    `media_type: 'VIDEO'`, `follows: null` → text `'O Instagram não fornece este dado para Reels'`.
  - `it('shows the publication time in São Paulo')`.
  - `it('Engajamento lists actions, interactions and the reach-per-follower line')`: reach 74209,
    follows 24 → `'1 novo seguidor a cada 3.092 contas alcançadas'`.
  - `it('hides the rate bars without dists and draws no median tick below MIN_SAMPLE')`.
  - `it('mounts the comments panel only after its tab is opened, and only with the flag')`.
  - `it('returns to Visão geral when the post changes')`.
  - `it('renders overviewFooter at the end of Visão geral only')`.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/analytics-conta/components`. Expected: FAIL.
- [ ] **Step 3: Implement the component and its CSS** in `apps/crm/app.css`. Thumbnail:
  `post.thumbnail_url` through `sanitizeUrl`, with the same gradient fallback as the page's
  `PostThumbnail` (move that function to `components/PostThumbnail.tsx` and import it from both
  places).
- [ ] **Step 4: Run the tests again, plus `apps/crm/src/__tests__/cssSplitBoundary.test.ts`.**
  Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): visão de métricas do post no estilo do Instagram`.

### Task A4: Desktop host and the Instagram link chip

**Files:**
- Create: `apps/crm/src/components/instagram/InstagramLinkButton.tsx`
- Create: `apps/crm/src/pages/analytics-conta/components/PostMetricsDialog.tsx`
- Test: `apps/crm/src/pages/analytics-conta/components/__tests__/PostMetricsDialog.test.tsx`

**Interfaces:**
- Consumes: `PostMetricsView` (A3).
- Produces:

```ts
export function InstagramLinkButton(props: {
  permalink: string; size?: 32 | 36; shape?: 'round' | 'square'; className?: string;
}): JSX.Element | null; // null when sanitizeUrl(permalink) is ''
export function PostMetricsDialog(props: {
  post: PostAnalytics | null;           // null = closed
  onOpenChange: (open: boolean) => void;
  clientId: number;
  dists?: RateDistributions;
  commentsEnabled: boolean;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}): JSX.Element;
```

- `InstagramLinkButton` is an `<a target="_blank" rel="noopener noreferrer" aria-label="Abrir no
  Instagram" title="Abrir no Instagram">` with lucide `Instagram` at 16 px. Its `onClick` calls
  `e.stopPropagation()`.
- `PostMetricsDialog` is a shadcn `Dialog` whose `DialogContent` has `max-w-[720px]`, inner
  scrolling and a visible `DialogTitle` "Métricas do post". The header holds `InstagramLinkButton`
  plus the built-in close. `onCloseAutoFocus` focuses `returnFocusTo.current` when it is set
  (`e.preventDefault()` first).

- [ ] **Step 1: Write the failing tests:**
  - `it('renders the title, the view and the Instagram link with the sanitized permalink')`
  - `it('hides the Instagram link for an unsafe permalink')`: `'javascript:alert(1)'`
  - `it('returns focus to returnFocusTo on close')`: click "Fechar" (filter `.sr-only` duplicates
    per the CI flake note), then `await waitFor(() => expect(document.activeElement).toBe(btn))`
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement both components.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): pop-up de métricas do post no desktop`.

### Task A5: Desktop wiring (carousel, "Ver mais", table)

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`:
  - `RankedPostCard` (:221) and `RankedPostsSection` (:375)
  - the ranked drawer rows (:2548)
  - the posts table (:1930-2100)
  - delete `ExpandedPostDetail` (:925-1012) and the `post-detail-row`
- Modify: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`

**Interfaces:**
- Consumes: `PostMetricsDialog` and `InstagramLinkButton` (A4).
- Produces, in the page:
  - `const [openPostId, setOpenPostId] = useState<string | null>(null)`
  - `openPost = posts.find(p => p.id === openPostId) ?? null`
  - an effect that clears `openPostId` when `openPost` is null
  - `openerRef` (`useRef<HTMLElement | null>`), set to `e.currentTarget` by whichever button
    opened the post

Behaviour (spec §1):
- **`RankedPostCard({ post, tone, onOpen })`:** a wrapper `div.analytics-post-card` with
  `position: relative`, holding:
  - a `<button type="button" aria-label={`Ver métricas: ${caption excerpt}`}>` with today's card body
  - a sibling `InstagramLinkButton size={32} shape="round"`, absolutely placed at top: 8, right: 8
- **Drawer row:** a `<div>` row with the same `<button>` body and a trailing
  `InstagramLinkButton size={36} shape="square"`. The `Sheet`'s `SheetContent` gets
  `onInteractOutside={(e) => { if (openPostId) e.preventDefault(); }}`, and the same for
  `onPointerDownOutside` and `onFocusOutside`.
- **Table row:** the caption cell's content becomes `<button type="button"
  className="post-row-open">`, and the `<tr onClick>` opens the same post. The Tags cell keeps
  `stopPropagation`, and the row's existing Instagram link (if any) stops propagation too. Remove
  `expandedPostId`.
- **Dialog mount:** render `<PostMetricsDialog post={openPost} onOpenChange={(o) => !o &&
  setOpenPostId(null)} returnFocusTo={openerRef} dists={baselineQuery.data?.dists}
  commentsEnabled={commentsAiEnabled} clientId={clientId} />` once at the page root.

- [ ] **Step 1: Update and add tests** in `AnalyticsContaPage.test.tsx`:
  - Replace any assertion that a ranked card or drawer row is a link to the permalink with
    `it('a Melhores Posts card opens the metrics dialog; its Instagram chip links out')`.
    Assert: dialog role named "Métricas do post" appears; the link "Abrir no Instagram" has
    `href` = permalink and `target="_blank"`; clicking the link does not open the dialog.
  - `it('a "Ver mais" row opens the dialog over the sheet and focus returns to the row')`: the
    sheet's heading stays in the document while the dialog is open; after close, the row button
    is `document.activeElement` (`waitFor`).
  - `it('a posts table row opens the dialog; clicking a tag does not')`.
  - `it('closes the dialog when the open post leaves the list')`: rerender with a period whose
    mocked `getPostsAnalytics` omits the post, then the dialog is gone.
  - `it('a post with an empty permalink still opens; no Instagram link')`.
- [ ] **Step 2: Run** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement the wiring.**
- [ ] **Step 4: Run the whole `apps/crm/src/pages/analytics-conta` folder.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): clicar no post abre as métricas em vez do Instagram`.

### Task A6: Phone wiring

**Files:**
- Modify: `apps/crm/src/pages/analytics/phone/RankedPostStrip.tsx`
- Modify: `apps/crm/src/pages/analytics/phone/AllPostsSheet.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/phone/ContaPhone.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/phone/PostDetailSheet.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`, which passes
  `dists={baselineQuery.data?.dists}` to `ContaPhone`
- Modify the tests: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.phone.test.tsx`,
  `apps/crm/src/pages/analytics/__tests__/AnalyticsPage.phone.test.tsx`, and the TikTok phone tests
  if they assert strip links

**Interfaces:**
- Consumes: `PostMetricsView` (A3) and `InstagramLinkButton` (A4).
- Produces:
  - `RankedPostStrip` and `RankedPostCard` gain `onSelect?: (post: P) => void`.
    - With it, the card is a `<button>` plus a sibling `InstagramLinkButton size={32}` (when the
      permalink sanitizes).
    - Without it, the card is byte-for-byte today's behaviour.
  - `AllPostsRow` gains `onSelect?: () => void`. With it, the row's main area is a `<button
    className="phone-cell__main">` plus a trailing `InstagramLinkButton size={36} shape="square"`.
    Without it, the row is unchanged.
  - `ContaPhone` gains `dists?: RateDistributions`. Its strips and its all-posts rows pass
    `onSelect` → `setSelectedPostId(post.id)`, and the `AllPostsSheet` stays open underneath.
  - `PostDetailSheet` gains `dists?: RateDistributions`. Its body becomes
    `<PostMetricsView variant="sheet" … overviewFooter={tagsGroup} />`.
    - `tagsGroup` is today's `GroupedList header="Tags"` with "Nova tag" (unchanged).
    - The "Ver no Instagram" cell is removed. The sheet's `headerTrailing`, or the equivalent
      `BottomSheet` slot (check its props), gets `InstagramLinkButton`.
    - The sheet title becomes "Métricas do post".
    - The old insights body and its local tab state are deleted, since `PostMetricsView` owns
      the tabs.

- [ ] **Step 1: Write and update the tests.**
  - `AnalyticsContaPage.phone.test.tsx`:
    - `it('a ranked strip card opens the post sheet; its Instagram chip links out')`
    - `it('a "Ver mais" row opens the post sheet over the list')`
    - `it('the post sheet keeps the Tags group and Nova tag')`
    - `it('the post sheet shows the Reel reason for follows')`
  - `AnalyticsPage.phone.test.tsx`: `it('portfolio strip cards still link to Instagram')`, which
    is unchanged behaviour.
- [ ] **Step 2: Run** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/pages/analytics apps/crm/src/pages/analytics-tiktok`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement**, including any CSS for `phone-an-post-card` as a button in `apps/crm/app.css`.
- [ ] **Step 4: Run the same folders plus `apps/crm/src/**/phoneShellCss.test.ts` and
  `analyticsPhoneCss.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): métricas do post no celular abrem pelo carrossel e pela lista`.

### Task A7: Verify PR 1 and open it

- [ ] **Step 1: Run the whole gate.** Expected: everything green.
  - `npm run lint`
  - `npx prettier --check` on the changed files (or `npm run format:check`)
  - the five `tsc` commands
  - `TZ=UTC npm run test`
- [ ] **Step 2: Browser check.** Use `npm run dev:env` via `preview_start`, logged in with the
  seed-login recipe, on a client with Instagram connected. Check:
  - desktop Vidro, classic look, and dark mode
  - the "Ver mais" Sheet stays open under the dialog, and focus returns on close
  - a Reel post
  - the phone shell (`resize_window` mobile, then reload)

  Take a screenshot of each. Reset the viewport afterwards.
- [ ] **Step 3: Open the PR.**
  - Push, then run `gh pr create` with a pt-BR title and a body listing what changed, the
    screenshots, and "sem deploy".
  - Bind it with `ccd_pr`.

---

# Part B: PR 2 (metrics, snapshots, curve)

New branch from `main` after PR 1 merges. Migration version: take the next free prefix above
main's tail at PR-open time. Today the tail is `20261127000001`, so this would be
`20261128000001_instagram_post_metrics_v2.sql`. Re-check before `gh pr create`.

### Task B1: Probe the Graph metrics (user-gated)

**Files:**
- Create (scratch, not committed): `<scratchpad>/ig-probe.ts`

- [ ] **Step 1: Ask the user** which account to probe and where. Options:
  - a staging account with Instagram connected, through a staging function run
  - a read-only call against a prod account they choose

  Prod needs their explicit OK. Never put a token on the command line: use `--env-file` with a
  temporary file.
- [ ] **Step 2: Request the metrics.** For one IMAGE, one CAROUSEL_ALBUM and one REELS media id,
  request `GET https://graph.instagram.com/v25.0/{id}/insights` with:
  - `metric=reposts,total_interactions` for the image and the carousel
  - `metric=reposts,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate`
    for the Reel
  - each metric on its own as well, so a rejection names exactly one metric
- [ ] **Step 3: Write down the result** in `docs/superpowers/specs/2026-11-23-post-metrics-modal-design.md`
  under a new "Probe result (date)" heading, and commit it:
  - which metrics returned
  - the `reels_skip_rate` value and its unit (fraction 0–1 or percent)
  - the watch-time units
  - the rate-limit headers (`x-app-usage` / `x-business-use-case-usage`)
- [ ] **Step 4: Fix `PROBED_EXTRA_METRICS`** (used in B3) to the accepted lists. Drop every
  rejected metric from B2's columns, B3's request and B6's UI.

### Task B2: Migration (columns, history table, curve function) and its SQL suite

**Files:**
- Create: `supabase/migrations/20261128000001_instagram_post_metrics_v2.sql`
- Create: `supabase/tests/entitlements/99_instagram_post_metrics_history.sql`

**Interfaces:**
- Produces:
  - columns on `instagram_posts` (spec §3, probed subset): `total_interactions int`,
    `profile_call_clicks`, `profile_direction_clicks`, `profile_email_clicks` and
    `profile_text_clicks int`, `reels_avg_watch_time_ms int`, `reels_total_watch_time_ms bigint`,
    `reels_skip_rate numeric`
  - the table `instagram_post_metrics_history(id bigint identity pk, post_id uuid not null
    references instagram_posts(id) on delete cascade, captured_at timestamptz not null default
    now(), views int not null, reach int not null)`, with an index on `(post_id, captured_at)`
  - the function `instagram_post_curve(p_post_id uuid) returns jsonb`, `language sql stable
    security invoker`. It returns `null` when `instagram_posts` (under RLS) has no such id, else
    `{posted_at, points:[{t,views,reach}] ascending, history_since}`. `history_since` is the min
    `captured_at` over history rows of posts with the same `instagram_account_id`.
  - Grants:
    - table: RLS on; one policy `history_via_post` `FOR SELECT TO authenticated USING (post_id IN
      (SELECT id FROM instagram_posts))`; `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT
      SELECT … TO authenticated`
    - function: `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO authenticated`

- [ ] **Step 1: Write the SQL suite**, with `_helpers.sql` and `et_make_workspace` as in
  `99_youtube_history.sql`. Seed two workspaces, each with a client, an `instagram_accounts` row
  and posts, and a restricted member assigned to no client. Assert:
  - The new table's grants: `authenticated` has `select` only; `anon` has nothing. Exclude it from
    `et_grant_hosted_parity`.
  - Member A gets the curve of A's post, with points ascending and `history_since` equal to A's
    earliest snapshot (seed a second A post with an older snapshot).
  - Member A gets `null` for B's post.
  - The restricted member gets `null` for A's post, and `select count(*)` on the history table
    returns 0.
  - Deleting the post cascades its history rows.
  - `99_acesso_por_cliente_drift.sql` still passes.
- [ ] **Step 2: Run** `npm run test:db`, which needs Docker/colima per the local-Supabase note.
  Expected: the new suite FAILS (relation does not exist).
- [ ] **Step 3: Write the migration.** Start it with a comment header pointing at the spec.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS, drift suite included. If Docker is
  unavailable, say so; CI's `entitlement-tests` covers it.
- [ ] **Step 5: Commit** with `feat(db): métricas novas e histórico de visualizações por post do Instagram`.

### Task B3: `_shared/instagram-metrics.ts`: profile actions, extras request, complete payload

**Files:**
- Modify: `supabase/functions/_shared/instagram-metrics.ts`
- Modify: `supabase/functions/__tests__/instagram-metrics_test.ts`

**Interfaces:**
- Produces:

```ts
export const PROBED_EXTRA_METRICS: { feed: readonly string[]; reels: readonly string[] }; // from B1
export function parseProfileActivity(data: unknown): {
  bio_link_clicks?: number; profile_call_clicks?: number; profile_direction_clicks?: number;
  profile_email_clicks?: number; profile_text_clicks?: number;
};
// fetchPostInsights: same signature; values gain the new keys
export const PRESERVED_METRIC_COLUMNS: readonly string[]; // every key buildMetricFields returns except unavailable_metrics
export function buildMetricFields(existing, insights, mediaNode, mediaType?: string): MetricFields;
export type MetricFields = Counts & ActionCounts & ExtraCounts & { unavailable_metrics: string[] };
```

- **The extras call:** `metric=${list.join(',')}` on the versioned URL. On an error whose message
  names metrics in the list, retry once without them. Absent on a second failure.
- **`unavailable_metrics`:** lists only keys that apply to `mediaType` (`'VIDEO'` = Reel):
  - profile-action keys only for non-Reels
  - Reels keys only for Reels
- **The API name to column mapping:**
  - `ig_reels_avg_watch_time` → `reels_avg_watch_time_ms`
  - `ig_reels_video_view_total_time` → `reels_total_watch_time_ms`
  - the others map by name
- **Logging:** keep `logRejection("extras", body)`.

- [ ] **Step 1: Write the failing Deno tests:**
  - `parseProfileActivity: all five action types, missing breakdown with total 0 → all 0, malformed → {}`
  - `parseBioLinkClicks` callers still get the same values (keep it as a thin wrapper, or update
    the callers)
  - `fetchPostInsights requests the probed feed list for IMAGE and the reels list for REELS`, with
    a fake fetch that records URLs
  - `extras retry drops the metric named in the error and keeps the rest`
  - `extras failure never removes core values`
  - `buildMetricFields returns every PRESERVED_METRIC_COLUMNS key plus unavailable_metrics, for a Reel and for a feed post, with existing=null`
  - `buildMetricFields preserves the previous value of a new key when not returned`
  - `unavailable_metrics never lists Reels keys for a feed post nor profile-action keys for a Reel`
  - update the existing fetch-count assertions to the new number of calls
- [ ] **Step 2: Run** `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/instagram-metrics_test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run that test again, then `npm run check:functions`.** Expected: PASS. Then
  `ls node_modules/.deno` per the Deno-pollution note; if it is present, run `npm ci`.
- [ ] **Step 5: Commit** with `feat(edge): métricas extras e ações no perfil por post do Instagram`.

### Task B4: History helper

**Files:**
- Create: `supabase/functions/_shared/instagram-post-history.ts`
- Create: `supabase/functions/__tests__/instagram-post-history_test.ts`

**Interfaces:**
- Consumes: `MetricFields` (B3).
- Produces:

```ts
export function historyRowsFor(
  saved: { id: string; posted_at: string; metrics: MetricFields }[],
  now: Date,
): { post_id: string; views: number; reach: number }[];
export async function recordPostHistory(
  supabase: { from(t: string): { insert(rows: unknown[]): PromiseLike<{ error: unknown }> } },
  rows: { post_id: string; views: number; reach: number }[],
): Promise<void>; // logs and swallows errors; no-op for []
```

Rules (spec §4):
- a post is included only when `now - posted_at <= 30 days`
- and neither `impressions` nor `reach` is in `metrics.unavailable_metrics`
- `views` is `metrics.impressions`
- a row is emitted on every call, changed or not

- [ ] **Step 1: Write the failing tests:**
  - `includes a fresh post up to 30 days old`
  - `excludes a post older than 30 days`
  - `excludes a post whose impressions or reach is unavailable`
  - `emits a row even when values equal the previous sync`
  - `recordPostHistory logs and resolves when insert errors`
  - `recordPostHistory does not call insert for []`
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run it again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(edge): histórico de visualizações e alcance por sincronização`.

### Task B5: Wire the three sync sites

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts:286-345`
- Modify: `supabase/functions/instagram-integration/index.ts`, the connect path :510-552 and the
  refresh path :826-881
- Test: `supabase/functions/__tests__/instagram-sync-select_test.ts`. Extend it, or add a
  structural test that reads the three files.

At each site:
1. The existing-row select becomes `` `instagram_post_id, thumbnail_url, ${PRESERVED_METRIC_COLUMNS.join(', ')}` ``.
2. `buildMetricFields(existing, insights, post, post.media_type)`.
3. The payload spreads `...m` instead of naming metric keys.
4. Read back the post id.
   - Cron and refresh paths: `.upsert(allPostData, { onConflict: 'instagram_post_id' }).select('id, instagram_post_id, posted_at')`.
   - Connect path: `.select('id, posted_at').single()` on its per-post upsert.
5. `await recordPostHistory(client, historyRowsFor(saved, new Date()))`.

- [ ] **Step 1: Write the failing structural test** `sync sites build the existing-row select from
  PRESERVED_METRIC_COLUMNS and spread buildMetricFields`. Read the three source files as text and
  assert, for each of the three sites:
  - `PRESERVED_METRIC_COLUMNS` and `recordPostHistory` both appear
  - none of the old hand-written `profile_visits: m.profile_visits` lines remain
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement the wiring.**
- [ ] **Step 4: Run `npm run check:functions` and `npm run test:functions`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(edge): syncs gravam métricas novas e histórico do post`.

### Task B6: Frontend, the new metric fields and rows

**Files:**
- Modify: `apps/crm/src/services/analytics.ts`. `PostAnalytics` gets the probed new keys as
  `number | null`, mapped with `toNullableCount`. `reels_skip_rate` is `number | null` without
  rounding.
- Modify: `apps/crm/src/lib/post-action-metrics.ts`. Widen `missingActionMetricTitle` to `metric:
  ActionMetricKey | ExtraMetricKey`, where `ExtraMetricKey` is the probed new keys. Add these reasons:
  - Reels-only keys on non-Reels: `'Só para Reels'`
  - profile-action keys on Reels: `'O Instagram só informa para posts do feed'`
- Modify: `apps/crm/src/pages/analytics-conta/components/PostMetricsView.tsx`, adding the spec §2
  items marked PR 2:
  - Reel cards "Tempo médio assistido" (`14 s` / `1 min 05 s`) and "Tempo total assistido"
    (`5 h 24 min`)
  - "Pularam nos 3 primeiros segundos" in the unit B1 found
  - Total de interações
  - the four profile-action rows, shown only when > 0
- Modify: `AnalyticsContaPage.tsx:2985`. Rewrite "Taxa de skip e repost não estão na API." to
  match B1.
- Tests: `PostMetricsView.test.tsx`, `lib/__tests__/post-action-metrics.test.ts` (or the
  existing file).

- [ ] **Step 1: Write the failing tests:**
  - `it('formats Reel watch times')`: 14000 ms → `'14 s'`, 65000 → `'1 min 05 s'`, 19440000 →
    `'5 h 24 min'`
  - `it('shows profile-action rows only when above zero')`
  - `it('shows Total de interações when present')`
  - `it('a Reel shows the watch-time cards and no profile-action rows')`
  - `it('missingActionMetricTitle explains Reels-only keys on a feed post')`
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The watch-time formatter is `formatWatchTime(ms: number): string` in
  `contaFormat.ts`.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): métricas novas no pop-up do post`.

### Task B7: Frontend, the curve

**Files:**
- Modify: `apps/crm/src/services/analytics.ts`
- Create: `apps/crm/src/pages/analytics-conta/components/PostCurveChart.tsx`
- Modify: `PostMetricsView.tsx`, adding the "Ao longo do tempo" section in Visão geral
- Test: `components/__tests__/PostCurveChart.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface PostCurve {
  posted_at: string; points: { t: string; views: number; reach: number }[]; history_since: string | null;
}
export async function getPostCurve(postId: string): Promise<PostCurve | null>; // supabase.rpc('instagram_post_curve', { p_post_id }); throws on error
export function PostCurveChart(props: { curve: PostCurve; series: 'views' | 'reach'; now?: Date }): JSX.Element;
```

- **The section:**
  - `useQuery({ queryKey: ['ig-post-curve', post.id], queryFn: () => getPostCurve(post.id), staleTime: 5 * 60_000 })`
  - Chips "Visualizações" and "Alcance" (`aria-pressed`).
  - While loading: a 210 px skeleton.
  - On error or a `null` result: the section is not rendered, and the error goes to
    `console.warn`.
  - With zero points: the empty state, copy from spec §4.
- **`PostCurveChart`:**
  - an SVG in the style of `FollowerChart.tsx` (axes, gridlines, pt-BR compact y labels like
    "75 mil")
  - the line starts at `(posted_at, 0)`
  - the gap segment is dashed and lighter when the first point is more than 8 h after `posted_at`
  - the x domain is `posted_at` to `max(last point, posted_at + 7 d)`
  - legend "Este post"
  - the note "Medido a cada sincronização, desde {dd de mmm às HHh}", in São Paulo time
  - `role="img"` with an `aria-label` summarizing the latest value

- [ ] **Step 1: Write the failing tests:**
  - `it('draws a dashed gap segment when the first snapshot is more than 8 h after posting')`
    (query the path with `stroke-dasharray`)
  - `it('has no gap segment when the first snapshot is within 8 h')`
  - `it('shows the empty state with history_since, and the fallback copy without it')`
  - `it('hides the section when the RPC errors')`
  - `it('switches series with the chips')`
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): curva de visualizações e alcance do post`.

### Task B8: Verify, deploy in order, PR

- [ ] **Step 1: Run the full gate**, Global Constraints list plus `check:functions` and
  `test:functions`. Expected: green.
- [ ] **Step 2: Staging.**
  - `npx supabase db push --linked`. Use a disposable checkout if the remote is ahead (see that
    memory note).
  - Deploy `instagram-sync-cron` and `instagram-integration` with `--no-verify-jwt`.
  - Trigger one sync and confirm in SQL that history rows appear, and that new columns are filled
    where B1 said they would be.
- [ ] **Step 3: Prod, with the user's explicit OK, in the same order.** After the first cron run,
  check:
  - the function logs for `[ig-metrics] extras` rejections
  - `select count(*) from instagram_post_metrics_history`
- [ ] **Step 4: Open the PR and run the browser check.**
  - Renumber the migration if main moved.
  - Run `gh pr create` with the deploy order, the probe result, and screenshots of the pop-up
    with a curve.
  - Merge only after step 3.
