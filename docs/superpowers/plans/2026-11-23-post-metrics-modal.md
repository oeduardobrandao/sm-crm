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
- **Links:** every external `href` goes through `sanitizeUrl()`. It never returns `''`: an unsafe
  or empty URL comes back as `'#'` (`utils/security.ts:18,29`). An Instagram link is hidden when
  `!permalink || sanitizeUrl(permalink) === '#'`. `permalink` is nullable in the DB, so type it
  `string | null` wherever this feature takes it.
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
2. **The open post leaves `posts`** (period changed, refetch dropped it). The pop-up closes once
   the list has settled, never during a refetch, instead of showing stale data or crashing.
   Test in A5.
3. **Opening the pop-up from the "Ver mais" Sheet.** The Sheet stays open, and focus returns to
   the clicked row on close. Tested in A4 (real Radix), wired in A5, and confirmed in the A7
   browser check.
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

Test-harness facts every Part A task needs:
- `AnalyticsContaPage.test.tsx` mocks `@tanstack/react-query` (`:57`), `@/components/ui/dialog`
  (`:157`) and `@/components/ui/sheet` (`:207`).
  - Query data comes from `queryState['<key>']`, with posts at `queryState['analytics-posts']`.
  - The Dialog mock renders an unnamed `<div role="dialog">` and exports only `Dialog`,
    `DialogContent`, `DialogHeader`, `DialogFooter` and `DialogTitle`. So `PostMetricsDialog`
    imports only those (no `DialogDescription`, no `DialogClose`), or the whole suite throws.
- **Behaviour that needs real Radix gets its own test file without those mocks:**
  - focus return
  - Sheet under Dialog
  - the close button

### Task A1: Post id is a string; `synced_at` is typed

**Files:**
- Modify: `apps/crm/src/services/analytics.ts`:
  - `PostAnalytics` at :128
  - `tagMap: Record<number, PostTag[]>` at :757, which becomes `Record<string, …>`; tsc won't flag it
  - `assignTagToPost` and `removeTagFromPost` at :1021 and :1029
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`:
  - `expandedPostId` at :1044
  - `handleToggleTag` at :1441 and `handleAssignTag` at :1450
- Modify: `apps/crm/src/pages/analytics-conta/phone/ContaPhone.tsx:246`
- Modify: `apps/crm/src/pages/analytics-conta/phone/PostDetailSheet.tsx:48` (`tabState.postId`)
- Modify the tests:
  - `__tests__/AnalyticsContaPage.test.tsx`: numeric fixture ids at :364, :382, :703, :764 and :818,
    and the `PostCommentsPanel` mock's `post: { id: number }` at :258
  - `AnalyticsContaPage.phone.test.tsx`
  - any other fixture found by grepping `apps/crm/src` for `PostAnalytics`

**Interfaces:**
- Produces:
  - `PostAnalytics.id: string`
  - `PostAnalytics.permalink: string | null`
  - `PostAnalytics.synced_at: string | null`
  - `assignTagToPost(postId: string, tagId: number)` and `removeTagFromPost(postId: string, tagId: number)`

`instagram_post_tag_assignments.post_id` is already `uuid`, so there is no runtime change.
`PostAnalytics` has no consumer outside the CRM.

- [ ] **Step 1: Change the types.** Map `synced_at: p.synced_at ?? null` in `getPostsAnalytics`.
  Change every post-id `useState<number | null>` to `string | null`.
- [ ] **Step 2: Typecheck.** Run `npx tsc -p apps/crm/tsconfig.json --noEmit`, then fix what it
  reports. If `permalink: string | null` surfaces call sites, wrap them as `sanitizeUrl(p.permalink ?? '')`.
- [ ] **Step 3: Run the tests.** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/pages/analytics apps/crm/src/services`.
  Expected: PASS.
- [ ] **Step 4: Commit** with `fix(crm): id de post do Instagram é uuid (string)`.

### Task A2: Shared helpers (format, thumbnail, benchmark)

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/contaFormat.ts`
- Create: `apps/crm/src/pages/analytics-conta/components/PostThumbnail.tsx`
- Modify: `AnalyticsContaPage.tsx`. Move `formatMediaType` (:131), `mediaAccentColor` (:166) and
  `PostThumbnail` (:179) out, and import them back.
- Test: `apps/crm/src/pages/analytics-conta/__tests__/contaFormat.test.ts` (create it if absent)

**Interfaces:**
- Consumes: `selectRateSamples(format, dists)` (`lib/ig-rates.ts:179`, format first, already falls
  back to `overall`), `quartiles`, `MIN_SAMPLE`, `RateDistributions` and `RateKey`.
- Produces:
  - `formatMediaType(type: string): string` and `mediaAccentColor(type: string): string`, both
    moved to `contaFormat.ts` with unchanged output ("Reel", "Carrossel", "Imagem").
  - `PostThumbnail({ post, size }: { post: Pick<PostAnalytics,'thumbnail_url'|'media_type'>; size: 'card'|'list'|'metrics' })`.
    `metrics` uses 100% width and height of its box.
  - `formatPublishedAt(iso: string): string`, giving `'Publicado em 21 de nov. às 18:02'` in São
    Paulo time.
  - `formatSyncedAgo(iso: string | null, now?: Date): string | null`. It returns
    `'Atualizado agora'` under 1 min, `'Atualizado há N min'` under 1 h, `'Atualizado há N h'`
    under 48 h, otherwise `'Atualizado há N dias'`, and `null` for null input.
  - `rateBenchmark(dists: RateDistributions | undefined, mediaType: string, key: RateKey):
    { p50: number; p75: number } | null`. It is null when `dists` is undefined, or when the sample
    `selectRateSamples` picked has fewer than `MIN_SAMPLE` values. Check the length yourself:
    `quartiles` only returns null for an empty sample.

- [ ] **Step 1: Write the failing tests**

```ts
it('formats the publication instant in São Paulo time', () => {
  expect(formatPublishedAt('2026-11-21T21:02:00Z')).toBe('Publicado em 21 de nov. às 18:02');
  expect(formatPublishedAt('2026-11-22T02:30:00Z')).toBe('Publicado em 21 de nov. às 23:30');
});
it('formats the sync age', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  expect(formatSyncedAgo('2026-11-23T10:00:00Z', now)).toBe('Atualizado há 2 h');
  expect(formatSyncedAgo('2026-11-23T11:45:00Z', now)).toBe('Atualizado há 15 min');
  expect(formatSyncedAgo('2026-11-20T12:00:00Z', now)).toBe('Atualizado há 3 dias');
  expect(formatSyncedAgo(null, now)).toBeNull();
});
it('rateBenchmark: quartiles of the chosen sample, null below MIN_SAMPLE or without dists', () => {
  // dists = buildRateDistributions(rows): 5 VIDEO rows, 2 IMAGE rows
  expect(rateBenchmark(dists, 'VIDEO', 'like_rate')).toEqual({ p50: expect.any(Number), p75: expect.any(Number) });
  expect(rateBenchmark(smallDists /* 3 rows total */, 'IMAGE', 'like_rate')).toBeNull();
  expect(rateBenchmark(undefined, 'VIDEO', 'like_rate')).toBeNull();
});
```

- [ ] **Step 2: Run the tests.** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta/__tests__/contaFormat.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** `formatPublishedAt` uses `Intl.DateTimeFormat('pt-BR', { timeZone:
  'America/Sao_Paulo', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  hourCycle: 'h23' })` with `formatToParts`. Then do the move.
- [ ] **Step 4: Run the tests again**, with and without `TZ=UTC`, plus the analytics-conta folder.
  Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): formatadores, miniatura e referência de taxa para métricas do post`.

### Task A3: `PostMetricsView` (the shared content)

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/components/PostMetricsView.tsx`
- Create: `apps/crm/src/pages/analytics-conta/components/__tests__/PostMetricsView.test.tsx`
- Modify: `apps/crm/src/services/analytics.ts`. Add `reposts: number | null` to `PostAnalytics`,
  mapped with `toNullableCount`.
- Modify: `apps/crm/app.css`, adding the `.post-metrics*` classes.
- Modify: `packages/i18n/locales/pt/analyticsComments.json` and `.../en/analyticsComments.json`.
  Add `common.tabOverview` ("Visão geral" / "Overview") and `common.tabEngagement` ("Engajamento" /
  "Engagement"). Keep `tabInsights`, since the old components still use it until A5/A6.
- Leave `PostInsightsDetail.tsx` and `ExpandedPostDetail` untouched. A5 deletes them.

**Interfaces:**
- Consumes: A2's helpers, `missingActionMetricTitle`, `PostCommentsPanel` and `SegmentedControl`.
  `SegmentedControl` needs `aria-label` (use `t('common.tabsAriaLabel')`) and `semantics="tablist"`.
- Produces:

```ts
export function PostMetricsView(props: {
  post: PostAnalytics;
  clientId: number;
  dists?: RateDistributions;
  commentsEnabled: boolean;
  variant: 'dialog' | 'sheet';
  overviewFooter?: ReactNode;
}): JSX.Element;
```

Content and copy follow spec §2 items 2 to 7:
- **Thumbnail:** `PostThumbnail size="metrics"` in a box sized per variant and per Reel.
- **Format label:** `formatMediaType`. The phone sheet's label changes from "Reels" to "Reel",
  which is accepted.
- **Icon row:** the Reposts column renders only when `typeof post.reposts === 'number'`.
- **Tabs:**
  - labels from i18n: `tabOverview`, `tabEngagement`, `tabComments` (with `n`)
  - the dialog variant uses underline tabs with `role="tablist"`/`tab`/`tabpanel`
  - the sheet variant uses `SegmentedControl`
  - Visão geral and Engajamento always render; Comentários only with `commentsEnabled`, and its
    panel mounts lazily
- **Tab reset:** `{postId, tab}` state decided during render, like `PostDetailSheet.tsx:48`.
- **Caption:** the clamp's "Ver mais" is a `<button>`.
- **Por visualização:** uses `rateBenchmark`. The tick is omitted when it returns null, and the
  block is hidden when `dists` is undefined.
- **Footer:** `formatSyncedAgo(post.synced_at)`.
- **`overviewFooter`:** rendered at the end of the Visão geral panel only.

- [ ] **Step 1: Write the failing tests.** Wrap with a real `QueryClientProvider`, and mock
  `PostCommentsPanel` to a stub that counts mounts.
  - `it('shows the icon row with pt-BR numbers and hides Reposts when null')`: likes 2515 shows
    as `2.515`; `queryByText('Reposts')` is null.
  - `it('shows Reposts when the post has a number')`.
  - `it('Resumo for a carousel shows views, reach, profile visits and new followers')`.
  - `it('Resumo for a Reel shows "—" with the Reels reason for follows and profile visits')`:
    `media_type: 'VIDEO'`, `follows: null`, and the text
    `'O Instagram não fornece este dado para Reels'`.
  - `it('shows the publication time in São Paulo')`.
  - `it('Engajamento lists actions, interactions and the reach-per-follower line')`: reach 74209
    and follows 24 give `'1 novo seguidor a cada 3.092 contas alcançadas'`.
  - `it('hides the rate block without dists and omits the median tick below MIN_SAMPLE')`.
  - `it('mounts the comments panel only after its tab is opened, and only with the flag')`.
  - `it('returns to Visão geral when the post changes')`.
  - `it('renders overviewFooter at the end of Visão geral only')`.
  - `it('sheet variant renders a SegmentedControl tablist')`.
- [ ] **Step 2: Run the tests.** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta/components`.
  Expected: FAIL.
- [ ] **Step 3: Implement the component and its CSS.**
- [ ] **Step 4: Run the tests again, plus `apps/crm/src/__tests__/cssSplitBoundary.test.ts` and the
  i18n parity tests** (grep `packages/i18n` for a keys test). Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): visão de métricas do post no estilo do Instagram`.

### Task A4: Desktop host and the Instagram link chip

**Files:**
- Create: `apps/crm/src/components/instagram/InstagramLinkButton.tsx`
- Create: `apps/crm/src/pages/analytics-conta/components/PostMetricsDialog.tsx`
- Test: `apps/crm/src/pages/analytics-conta/components/__tests__/PostMetricsDialog.test.tsx`. This
  file uses real Radix; do not mock `ui/dialog`.

**Interfaces:**
- Consumes: `PostMetricsView` (A3).
- Produces:

```ts
export function hasInstagramLink(permalink: string | null | undefined): boolean; // !!p && sanitizeUrl(p) !== '#'
export function InstagramLinkButton(props: {
  permalink: string | null; size?: 32 | 36; shape?: 'round' | 'square'; className?: string;
}): JSX.Element | null; // null when !hasInstagramLink(permalink)
export function PostMetricsDialog(props: {
  post: PostAnalytics | null;           // null = closed
  onOpenChange: (open: boolean) => void;
  clientId: number;
  dists?: RateDistributions;
  commentsEnabled: boolean;
  returnFocusTo?: React.RefObject<HTMLElement | null>;
}): JSX.Element;
```

`InstagramLinkButton`:
- `<a target="_blank" rel="noopener noreferrer" aria-label="Abrir no Instagram" title="Abrir no
  Instagram">` with lucide `Instagram` at 16 px
- `onClick` calls `e.stopPropagation()`

`PostMetricsDialog` imports only `Dialog`, `DialogContent`, `DialogHeader` and `DialogTitle`:
- `DialogContent` has `className="max-w-[720px] … overflow-y-auto z-[9021]"` and
  `overlayClassName="z-[9020]"`. This is the `MediaAdjustmentDialog.tsx:301-307` precedent, so the
  dialog and its overlay sit above an open Sheet (`z-[9010]`/`[9011]`).
- `onCloseAutoFocus`: `e.preventDefault(); returnFocusTo?.current?.focus()`.
- A visible `DialogTitle` "Métricas do post", with `InstagramLinkButton` in the header.
- The built-in close stays.
- Rendered on the desktop branch only. On phones `DialogContent` turns into a bottom sheet; the
  phone path uses `PostDetailSheet`.

- [ ] **Step 1: Write the failing tests:**
  - `it('renders the title, the view and the Instagram link with the sanitized permalink')`
  - `it('hides the Instagram link for an unsafe or empty permalink')`: `'javascript:alert(1)'`, `''`, `null`
  - `it('returns focus to returnFocusTo on close')`: click the close button (filter `.sr-only`
    duplicates, per the CI flake note), then `await waitFor(() =>
    expect(document.activeElement).toBe(opener))`
  - `it('stays open above an open Sheet and closing it keeps the Sheet open')`: render a real
    `Sheet` whose `SheetContent` guards `onInteractOutside` with `e.preventDefault()` while the
    dialog is open, as A5 does; open the dialog, then close it; the Sheet's content stays in the DOM
- [ ] **Step 2: Run the test file.** Expected: FAIL.
- [ ] **Step 3: Implement both components.**
- [ ] **Step 4: Run the test file again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): pop-up de métricas do post no desktop`.

### Task A5: Desktop wiring (carousel, "Ver mais", table) and removal of the expanded row

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`:
  - `RankedPostCard` (:220) and `RankedPostsSection` (:375)
  - the ranked drawer rows (:2548)
  - the posts table (:1925-2100)
  - delete `ExpandedPostDetail` (:929-1012), the `post-detail-row`, `expandedPostId`, and the
    import at :93
  - repoint the `ActionMetricValue` import (:2027) to `components/PostMetricsView` and move
    `ActionMetricValue` there, re-exported
- Delete: `components/PostInsightsDetail.tsx` and `components/__tests__/PostInsightsDetail.test.tsx`.
  Their assertions are already covered by A3.
- Modify: `apps/crm/app.css`:
  - Delete `#posts-table tbody tr.post-detail-row` (:2273) and `.post-detail-row td` (:5012).
  - Add `.analytics-post-card__open`: a button reset that fills the card, with the focus ring on
    `.analytics-post-card:has(.analytics-post-card__open:focus-visible)` or
    `.analytics-post-card:focus-within`.
  - Add `.analytics-post-card__ig`: the absolute chip at top: 8px, right: 8px.
  - Don't change the shared `.analytics-post-card` rules: `AnalyticsPage.tsx`,
    `TikTokOverviewPage.tsx` and `TikTokRankedVideos.tsx` use them.
- Modify: `apps/crm/src/styles/vidro-body/cards.css`, mirroring the focus rule for the new button
  if `:99-110` styles the `<a>`'s focus.
- Modify the tests:
  - `apps/crm/src/__tests__/phoneShellCss.test.ts:136`: remove the `post-detail-row` entry.
  - `vidroBody.cards.test.ts:95,123-127`, if the pinned selectors change.
  - `__tests__/AnalyticsContaPage.test.tsx`: the existing tests at :805, :853, :858-900, :867 and
    :1262 use `tr.post-detail-row` and the "Insights" / "Comentários · 142" tabs. Rewrite them
    against the dialog.

**Interfaces:**
- Consumes: `PostMetricsDialog`, `InstagramLinkButton` and `hasInstagramLink` (A4).
- Produces, in the page's desktop branch:
  - `const [openPostId, setOpenPostId] = useState<string | null>(null)`
  - `const openPost = posts.find((p) => p.id === openPostId) ?? null`
  - `const openerRef = useRef<HTMLElement | null>(null)`

Behaviour:
- **Closing when the post disappears:** an effect clears `openPostId` only when the posts query
  has settled (`isSuccess && !isFetching`) and `openPost` is null. A key change (the
  `baselineQuery.dataUpdatedAt` part of the posts key, `:1083-1097`) briefly empties `posts`
  (`:1118`) and must not close the dialog.
- **`RankedPostCard({ post, tone, onOpen })`:** a `div.analytics-post-card` wrapper (relative)
  holding:
  - `<button type="button" className="analytics-post-card__open" aria-label={`Ver métricas: ${caption excerpt or 'Sem legenda'}`}>`
    with today's body; its `onClick` does `openerRef.current = e.currentTarget; onOpen(post)`
  - a sibling `<InstagramLinkButton className="analytics-post-card__ig" size={32} shape="round" />`
- **Drawer rows:** a `<div>` row with the same button body, plus a trailing
  `InstagramLinkButton size={36} shape="square"`. Its `SheetContent` gets `onInteractOutside`,
  `onPointerDownOutside` and `onFocusOutside` handlers that `e.preventDefault()` while
  `openPostId !== null`.
- **Table rows:** there is no caption cell and no Instagram link today; the first cell is
  thumbnail plus date (`:1955-1990`).
  - Wrap that cell's content in `<button type="button" className="post-row-open"
    aria-label={`Ver métricas do post de ${date}`}>`. Its click sets `openerRef` and opens the post.
  - `<tr onClick>` opens the same post, setting `openerRef.current` to the row's
    `.post-row-open` button (found with `e.currentTarget.querySelector`), never to the `<tr>`.
  - The Tags cell keeps `stopPropagation`.
- **Dialog mount:** once, in the desktop return: `<PostMetricsDialog post={openPost}
  onOpenChange={(o) => { if (!o) setOpenPostId(null); }} returnFocusTo={openerRef}
  dists={baselineQuery.data?.dists} commentsEnabled={commentsAiEnabled} clientId={clientId} />`.

- [ ] **Step 1: Update and add the page tests** (mocked harness: assert on the mock's
  `role="dialog"` plus the text "Métricas do post"):
  - `it('a Melhores Posts card opens the metrics dialog; its Instagram chip links out')`. The link
    "Abrir no Instagram" has `href` equal to the permalink and `target="_blank"`. Clicking it does
    not render the dialog.
  - `it('a "Ver mais" row opens the dialog while the sheet stays rendered')`.
  - `it('a posts table row opens the dialog; clicking a tag does not')`.
  - `it('closes the dialog when the open post leaves a settled list, not while refetching')`. Set
    `queryState['analytics-posts']` to `{ data: { posts: [] }, isFetching: true }`: the dialog
    stays. With `isFetching: false`, it closes.
  - `it('a post with an empty permalink still opens; no Instagram link')`.
  - Rewrite the :805/:853/:858-900/:867/:1262 tests to open the dialog by clicking the row button,
    and to use the new tab labels.
- [ ] **Step 2: Run the page test file.** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement the wiring, the CSS and the deletions.**
- [ ] **Step 4: Run** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/__tests__/phoneShellCss.test.ts apps/crm/src/__tests__/cssSplitBoundary.test.ts`
  and the vidro tests (`npx vitest run vidro`). Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): clicar no post abre as métricas em vez do Instagram`.

### Task A6: Phone wiring

**Files:**
- Modify: `apps/crm/src/pages/analytics/phone/RankedPostStrip.tsx`
- Modify: `apps/crm/src/pages/analytics/phone/AllPostsSheet.tsx`
- Modify: `apps/crm/src/pages/analytics/phone/analyticsPhone.css`. The `.phone-an-post-card`
  rules at :408-460 live here; they gain the button and chip variants.
- Modify: `apps/crm/src/pages/analytics-conta/phone/ContaPhone.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/phone/PostDetailSheet.tsx`
- Modify: `AnalyticsContaPage.tsx`, which passes `dists={baselineQuery.data?.dists}` to `ContaPhone`
- Modify the tests:
  - `__tests__/AnalyticsContaPage.phone.test.tsx`: the existing assertions at :339 (link "Ver no
    Instagram"), :345 ("não tem abas", now false because Visão geral and Engajamento always
    render) and :355-449 (tab "Insights", the sheet title "Post de …").
  - `pages/analytics/__tests__/AnalyticsPage.phone.test.tsx` and the TikTok phone tests, if they
    assert strip or row links.
- Remove `common.tabInsights` from both locale files if nothing references it any more.

**Interfaces:**
- Consumes: `PostMetricsView` (A3), and `InstagramLinkButton` and `hasInstagramLink` (A4).
- Produces:
  - `RankedPostStrip` and `RankedPostCard` gain `onSelect?: (post: P) => void`.
    - With it: a `<button type="button" className="phone-an-post-card">` with the same body and
      aria-label minus the "abrir no Instagram" tail, plus a sibling `InstagramLinkButton size={32}`.
    - Without it: exactly today's markup.
  - `AllPostsRow` gains `onSelect?: () => void`.
    - With it: `<button type="button" className="phone-cell__main">` plus a trailing
      `InstagramLinkButton size={36} shape="square"` (`href` stays on the row for the link).
    - Without it: unchanged.
  - `ContaPhone` gains `dists?: RateDistributions`. Its strips and its all-posts rows pass
    `onSelect` → `setSelectedPostId(post.id)`. The `AllPostsSheet` stays open underneath; the
    `BottomSheet` stack already handles a sheet over a sheet, so confirm in A7.
  - `PostDetailSheet` gains `dists?: RateDistributions`. It renders `<PostMetricsView
    variant="sheet" … overviewFooter={tagsGroup} />`.
    - `tagsGroup` is today's `GroupedList header="Tags"`, unchanged.
    - `BottomSheet` gets `title="Métricas do post"`, and
      `headerTrailing={hasInstagramLink(p.permalink) ? <InstagramLinkButton … /> : undefined}`
      plus `showClose`. `BottomSheet` hides Fechar whenever `headerTrailing` is set
      (`packages/ios-kit/src/BottomSheet.tsx:172`).
    - Delete the "Ver no Instagram" cell, the old insights body and the local tab state.

- [ ] **Step 1: Write and update the tests.**
  - In the phone page test:
    - `it('a ranked strip card opens the post sheet; its Instagram chip links out')`
    - `it('a "Ver mais" row opens the post sheet over the list')`
    - `it('the post sheet keeps Fechar, the Tags group and Nova tag')`
    - `it('the post sheet shows the Reel reason for follows')`
    - rewrite :339/:345/:355-449
  - In the portfolio phone test: `it('portfolio strip cards still link to Instagram')`.
- [ ] **Step 2: Run the tests.** `TZ=UTC npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/pages/analytics apps/crm/src/pages/analytics-tiktok`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the same folders plus `apps/crm/src/__tests__/phoneShellCss.test.ts` and
  `apps/crm/src/pages/analytics/phone/__tests__/analyticsPhoneCss.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): métricas do post no celular abrem pelo carrossel e pela lista`.

### Task A7: Verify PR 1 and open it

- [ ] **Step 1: Run the whole gate:** `npm run lint`, `npm run format:check`, the five `tsc`
  commands and `TZ=UTC npm run test`. Expected: all green, coverage gate included.
- [ ] **Step 2: Browser check.** Use `npm run dev:env` via `preview_start`, with the seed-login
  recipe, on a client with Instagram connected. Screenshot each of:
  - desktop Vidro, classic, and dark mode
  - the "Ver mais" Sheet: it stays open and dimmed under the dialog, and focus returns to the row
  - a Reel
  - a table row via the keyboard
  - the phone shell (`resize_window` mobile, then reload): strip, "Ver mais" over the list, tags,
    and Fechar

  Reset the viewport afterwards.
- [ ] **Step 3: Open the PR.** Push, then run `gh pr create` with a pt-BR title, the screenshots
  and "sem deploy". Bind it with `ccd_pr`.

---

# Part B: PR 2 (metrics, snapshots, curve)

New branch from `main` after PR 1 merges. Migration version: the next free prefix above main's
tail at PR-open time. Today the tail is `20261127000001`, so this would be
`20261128000001_instagram_post_metrics_v2.sql`. Re-check before `gh pr create`.

**Reel rule in the backend:** `media_product_type === 'REELS'`, the same as `fetchPostInsights`
today (`_shared/instagram-metrics.ts:164`; the sites pass `post.media_product_type`). The
frontend keeps `media_type === 'VIDEO'`. Don't mix the two.

### Task B1: Probe the Graph metrics (user-gated)

- [ ] **Step 1: Ask the user which account to use.** Either:
  - a staging account with Instagram connected, run through a staging function
  - a read-only call against a prod account they choose (needs their explicit OK)

  Never put a token on the command line: use `--env-file` with a temporary file.
- [ ] **Step 2: Request the metrics.** For one IMAGE, one CAROUSEL_ALBUM and one REELS media id,
  call `GET https://graph.instagram.com/v25.0/{id}/insights` with:
  - `metric=reposts,total_interactions` for the image and the carousel
  - `metric=reposts,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate`
    for the Reel
  - each metric on its own as well
- [ ] **Step 3: Record the result** in a short "Probe result (date)" section of the spec (committed),
  and again in the PR description later:
  - which metrics returned
  - the `reels_skip_rate` value and unit (fraction 0–1 or percent)
  - the watch-time units
  - the rate-limit headers (`x-app-usage` / `x-business-use-case-usage`)
- [ ] **Step 4: Settle the metric lists.** Fix `PROBED_EXTRA_METRICS` (B3) to the accepted lists.
  Every rejected metric is dropped from B2's columns, B3's request and preserved columns, and B6's
  UI. If `reposts` is rejected, the existing column stays and remains null, and it is not in
  `PRESERVED_METRIC_COLUMNS`.

### Task B2: Migration (columns, history table, curve function) and its SQL suite

**Files:**
- Create: `supabase/migrations/20261128000001_instagram_post_metrics_v2.sql`
- Create: `supabase/tests/entitlements/99_instagram_post_metrics_history.sql`. Model the
  restricted-member setup on `99_acesso_por_cliente_agenda.sql`, and the grants block on
  `99_youtube_history.sql`.

**Interfaces:**
- Produces (spec §3 and §4, the probed subset):
  - columns on `instagram_posts`: `total_interactions int`, `profile_call_clicks`,
    `profile_direction_clicks`, `profile_email_clicks` and `profile_text_clicks int`,
    `reels_avg_watch_time_ms int`, `reels_total_watch_time_ms bigint`, `reels_skip_rate numeric`
  - the table `instagram_post_metrics_history(id bigint generated always as identity primary key,
    post_id uuid not null references instagram_posts(id) on delete cascade, captured_at
    timestamptz not null default now(), views int not null, reach int not null)`, with an index
    on `(post_id, captured_at)`
  - the function `instagram_post_curve(p_post_id uuid) returns jsonb language sql stable security
    invoker set search_path = public`. It returns `null` when `instagram_posts` (under the
    caller's RLS) has no such id, else `jsonb_build_object('posted_at', …, 'points',
    coalesce(jsonb_agg(… order by captured_at), '[]'), 'history_since', (select min(h.captured_at)
    from history h join instagram_posts p2 on p2.id = h.post_id where p2.instagram_account_id =
    <the post's account>))`
  - Grants:
    - table: RLS on; policy `history_via_post` `FOR SELECT TO authenticated USING (post_id IN
      (SELECT id FROM instagram_posts))`; `REVOKE ALL ON … FROM PUBLIC, anon, authenticated;
      GRANT SELECT ON … TO authenticated`
    - function: `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO
      authenticated`
  - A header comment pointing to the spec. It also notes that `report-docs/snapshot-source.ts:369`
    and `instagram-integration/index.ts:1019` use `select('*')` and will carry the new columns,
    which is harmless.

- [ ] **Step 1: Write the SQL suite**, excluding the new table from `et_grant_hosted_parity`.
  Assert:
  - `authenticated` has `select` and no other privilege on the table; `anon` has none.
  - Member A gets A's post curve, with points ascending and `history_since` equal to the earliest
    snapshot across A's account (seed a second A post with an older snapshot).
  - Member A gets `null` for B's post, and counts 0 of B's history rows.
  - A restricted member with no assignments gets `null` for A's post and counts 0 history rows.
  - Deleting a post cascades its history rows.
- [ ] **Step 2: Apply the local DB and run.** Start the local DB (colima, per the local-Supabase
  note) and run `npm run test:db`. Expected: the new suite FAILS.
- [ ] **Step 3: Write the migration.** Apply it locally with `npx supabase migration up --local`
  (or `npx supabase db reset --local`).
- [ ] **Step 4: Run `npm run test:db` again.** Expected: PASS, including
  `99_acesso_por_cliente_drift.sql`. If Docker is unavailable, say so; CI covers it.
- [ ] **Step 5: Commit** with `feat(db): métricas novas e histórico de visualizações por post do Instagram`.

### Task B3: `_shared/instagram-metrics.ts`: profile actions, extras request, complete payload

**Files:**
- Modify: `supabase/functions/_shared/instagram-metrics.ts`, including the header comment
  (:5-17), which goes stale.
- Modify: `supabase/functions/__tests__/instagram-metrics_test.ts`

**Interfaces:**
- Produces:

```ts
export const PROBED_EXTRA_METRICS: { feed: readonly string[]; reels: readonly string[] }; // from B1
type ExtraCounts = {
  reposts?: number | null;                // only if B1 accepted it
  total_interactions: number | null;
  profile_call_clicks: number | null; profile_direction_clicks: number | null;
  profile_email_clicks: number | null; profile_text_clicks: number | null;
  reels_avg_watch_time_ms: number | null; reels_total_watch_time_ms: number | null;
  reels_skip_rate: number | null;
}; // minus anything B1 rejected
export type MetricFields = Counts & ActionCounts & ExtraCounts & { unavailable_metrics: string[] };
export function parseProfileActivity(data: unknown): Partial<Record<
  'bio_link_clicks' | 'profile_call_clicks' | 'profile_direction_clicks' | 'profile_email_clicks' | 'profile_text_clicks', number>>;
export const PRESERVED_METRIC_COLUMNS: readonly (keyof Omit<MetricFields, 'unavailable_metrics'>)[];
export function buildMetricFields(existing, insights, mediaNode, isReel: boolean): MetricFields;
// fetchPostInsights: same signature; `values` gains the new keys
```

- **`parseProfileActivity`:** dimension values `BIO_LINK_CLICKED`, `CALL`, `DIRECTION`, `EMAIL`
  and `TEXT`, compared case-insensitively. `OTHER` is ignored. Keep the semantics of
  `parseBioLinkClicks`: a valid response with nothing gives 0 for all, a malformed one gives `{}`.
  Keep `parseBioLinkClicks` as a wrapper.
- **Mappings:** `InsightValue` and `API_TO_COL` gain the new API names:
  - `ig_reels_avg_watch_time` → `reels_avg_watch_time_ms`
  - `ig_reels_video_view_total_time` → `reels_total_watch_time_ms`
  - the others map by name
- **The extras call:** versioned URL, `metric=${list.join(',')}`.
  - On an error whose message names metrics in the list, retry once without those.
  - A second failure leaves the extras absent.
  - `logRejection("extras", body)`.
- **`unavailable_metrics`:** lists a new key only when it applies:
  - profile-action keys when `!isReel`
  - Reels keys when `isReel`
  - `total_interactions` (and `reposts`) always

- [ ] **Step 1: Write the failing Deno tests**, and update the ones this breaks:
  - `:104` "reposts is never requested", which now follows `PROBED_EXTRA_METRICS`
  - `:116` and `:126` URL counts
  - `:245` `unavailable_metrics` equal `[]`, which needs the new required `isReel` and all fresh values

  New tests:
  - `parseProfileActivity: all five types, no breakdown with total 0 → all 0, malformed → {}`
  - `fetchPostInsights requests PROBED_EXTRA_METRICS.feed for FEED and .reels for REELS`, with a
    fake fetch recording URLs
  - `extras retry drops the metric named in the error and keeps the rest`
  - `an extras failure never removes core or action values`
  - `buildMetricFields returns exactly PRESERVED_METRIC_COLUMNS plus unavailable_metrics, for isReel true and false, existing=null`
  - `buildMetricFields preserves a new key's previous value when not returned`
  - `unavailable_metrics never lists Reels keys when !isReel nor profile-action keys when isReel`
- [ ] **Step 2: Run the tests.** `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/instagram-metrics_test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** The three sync sites will not typecheck until B5 (new required
  param). Do B5 in the same session before any push. Alternatively make `isReel` optional for one
  commit and required in B5; pick one and say which in the commit message.
- [ ] **Step 4: Run the tests again.** Then `ls node_modules/.deno`; if it exists, run `npm ci`.
- [ ] **Step 5: Commit** with `feat(edge): métricas extras e ações no perfil por post do Instagram`.

### Task B4: History helper

**Files:**
- Create: `supabase/functions/_shared/instagram-post-history.ts`
- Create: `supabase/functions/__tests__/instagram-post-history_test.ts`

**Interfaces:**
- Produces:

```ts
export type HistoryInput = {
  id: string; posted_at: string | null;
  metrics: { impressions: number; reach: number; unavailable_metrics: string[] };
};
export function historyRowsFor(saved: HistoryInput[], now: Date): { post_id: string; views: number; reach: number }[];
export async function recordPostHistory(supabase: SupabaseClient, rows: { post_id: string; views: number; reach: number }[]): Promise<void>;
```

`SupabaseClient` comes from the same import the other `_shared` modules use for it; grep
`_shared` for `SupabaseClient`. `recordPostHistory` logs and swallows errors, and is a no-op for `[]`.

Rules:
- a post is included only when `posted_at` is non-null and `now - posted_at <= 30 days`
- and neither `impressions` nor `reach` is in `unavailable_metrics`
- `views` is `metrics.impressions`
- a row is emitted on every call

- [ ] **Step 1: Write the failing tests:**
  - `includes a fresh post up to 30 days old`
  - `excludes older than 30 days and null posted_at`
  - `excludes when impressions or reach is unavailable`
  - `emits a row even when values equal the previous sync`
  - `recordPostHistory logs and resolves when insert errors`
  - `recordPostHistory skips insert for []`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Then run `npm run check:functions`, which covers `_shared/*.ts`.
  Expected: PASS.
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(edge): histórico de visualizações e alcance por sincronização`.

### Task B5: Wire the three sync sites

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts:286-345`
- Modify: `supabase/functions/instagram-integration/index.ts`, the connect path :510-552 and the
  refresh path :826-881
- Create: `supabase/functions/__tests__/instagram-sync-sites-structure_test.ts`

**Interfaces:**
- Consumes: B3 (`PRESERVED_METRIC_COLUMNS`, `buildMetricFields(…, isReel)`) and B4
  (`historyRowsFor`, `recordPostHistory`).

At each site:
1. The existing-row select becomes `` `instagram_post_id, thumbnail_url, ${PRESERVED_METRIC_COLUMNS.join(', ')}` ``.
2. `const m = buildMetricFields(existing, insights, post, post.media_product_type === 'REELS')`,
   kept in a `Map<instagram_post_id, { m, posted_at: post.timestamp }>`.
3. The payload spreads `...m` instead of naming metric keys.
4. Read back and record:
   - **Cron and refresh:** `.upsert(allPostData, { onConflict: 'instagram_post_id' }).select('id,
     instagram_post_id')`. On error or null data, skip history. Otherwise join each returned row
     to the map by `instagram_post_id`, build `HistoryInput[]`, and call `recordPostHistory`.
   - **Connect** (a per-post upsert in a loop, inside the best-effort `try`): add `.select('id').single()`
     to each upsert, push into a local `saved` array when there is no error, and call
     `recordPostHistory(serviceClient, historyRowsFor(saved, new Date()))` once after the loop,
     still inside the same `try`. `savedCount` is unchanged.

- [ ] **Step 1: Write the failing structural test** `sync sites use the shared metric columns and
  record history`. Read `instagram-sync-cron/index.ts` (expect 1) and
  `instagram-integration/index.ts` (expect 2) as text, and assert:
  - the count of `PRESERVED_METRIC_COLUMNS.join` and of `recordPostHistory(` matches those numbers
  - `buildMetricFields(` is always called with 4 arguments
  - no line matches `/profile_visits: m\.profile_visits/`
- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement the wiring.**
- [ ] **Step 4: Run `npm run check:functions` and `npm run test:functions`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(edge): syncs gravam métricas novas e histórico do post`.

### Task B6: Frontend, the new metric fields and rows

**Files:**
- Modify: `apps/crm/src/services/analytics.ts`. `PostAnalytics` gets the probed new keys as
  `number | null`, mapped with `toNullableCount`. `reels_skip_rate` is `number | null` with no
  rounding.
- Modify: `apps/crm/src/lib/post-action-metrics.ts`. Export `ExtraMetricKey`. Widen
  `missingActionMetricTitle(metric: ActionMetricKey | ExtraMetricKey, …)`, and branch by key class
  **before** the existing `VIDEO` check:
  - a Reels-only key on a non-`VIDEO` post → `'Só para Reels'`
  - a profile-action key on `VIDEO` → `'O Instagram só informa para posts do feed'`
  - an action key on `VIDEO` → the existing `'O Instagram não fornece este dado para Reels'`
  - otherwise the existing `unavailable`-based strings
- Modify: `apps/crm/src/pages/analytics-conta/contaFormat.ts`. Add `formatWatchTime(ms: number):
  string`: `14000` → `'14 s'`, `65000` → `'1 min 05 s'`, `19440000` → `'5 h 24 min'`.
- Modify: `apps/crm/src/pages/analytics-conta/components/PostMetricsView.tsx`, adding the spec §2
  PR 2 items:
  - Reel cards "Tempo médio assistido" and "Tempo total assistido"
  - "Pularam nos 3 primeiros segundos", formatted in B1's unit
  - Total de interações
  - the four profile-action rows, shown only when > 0
- Modify: `AnalyticsContaPage.tsx:2985`. Rewrite "Taxa de skip e repost não estão na API." to
  match B1.
- Tests: `PostMetricsView.test.tsx`, `lib/__tests__/post-action-metrics.test.ts` and `contaFormat.test.ts`.

- [ ] **Step 1: Write the failing tests:**
  - `formatWatchTime`, with the three values above
  - `shows profile-action rows only when above zero`
  - `shows Total de interações when present`
  - `a Reel shows the watch-time cards and no profile-action rows`
  - `missingActionMetricTitle explains Reels-only keys on a feed post and feed-only keys on a Reel`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): métricas novas no pop-up do post`.

### Task B7: Frontend, the curve

**Files:**
- Modify: `apps/crm/src/services/analytics.ts`
- Create: `apps/crm/src/pages/analytics-conta/components/PostCurveChart.tsx`
- Modify: `PostMetricsView.tsx`, adding the "Ao longo do tempo" section in Visão geral
- Test: `components/__tests__/PostCurveChart.test.tsx` (chart only) and `PostMetricsView.test.tsx`
  (section behaviour)
- Modify: the closed `services/analytics` mock factories in `AnalyticsContaPage.test.tsx:94` and
  `AnalyticsContaPage.phone.test.tsx:38`. Add `getPostCurve: vi.fn().mockResolvedValue(null)`.

**Interfaces:**
- Produces:

```ts
export interface PostCurve {
  posted_at: string; points: { t: string; views: number; reach: number }[]; history_since: string | null;
}
export async function getPostCurve(postId: string): Promise<PostCurve | null>; // supabase.rpc('instagram_post_curve', { p_post_id: postId }); throws on error
export function PostCurveChart(props: { curve: PostCurve; series: 'views' | 'reach' }): JSX.Element;
```

- **The section:**
  - `useQuery({ queryKey: ['ig-post-curve', post.id], queryFn: () => getPostCurve(post.id), staleTime: 5 * 60_000 })`
  - chips "Visualizações" and "Alcance" (`aria-pressed`)
  - while loading: a 210 px skeleton
  - on error or a `null` result: not rendered, plus `console.warn`
  - with zero points: the empty state, copy from spec §4, using `history_since`
- **`PostCurveChart`:**
  - an SVG in the style of `FollowerChart.tsx`, with pt-BR compact y labels ("75 mil")
  - the line starts at `(posted_at, 0)`
  - the gap segment is dashed and lighter when the first point is more than 8 h after `posted_at`
  - the x domain is `posted_at` to `max(last point, posted_at + 7 d)`
  - legend "Este post"
  - the note "Medido a cada sincronização, desde {dd de mmm às HHh}" in São Paulo time
  - `role="img"` with an `aria-label` that states the latest value

- [ ] **Step 1: Write the failing tests.**
  - `PostCurveChart`:
    - `draws a dashed gap segment when the first snapshot is more than 8 h after posting`
    - `no gap segment within 8 h`
    - `aria-label states the latest value`
  - `PostMetricsView`:
    - `empty state with history_since, and the fallback copy without it`
    - `hides the section when the RPC errors`
    - `switches series with the chips`
- [ ] **Step 2: Run the tests.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests again, plus both page test files.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat(crm): curva de visualizações e alcance do post`.

### Task B8: Verify, deploy in order, PR

- [ ] **Step 1: Run the full gate:** the Global Constraints list plus `check:functions` and
  `test:functions`. Expected: green.
- [ ] **Step 2: Staging.**
  - `npx supabase db push --linked`. Use a disposable checkout if the remote is ahead.
  - Deploy `instagram-sync-cron` and `instagram-integration` with `--no-verify-jwt`.
  - Trigger one sync. Confirm in SQL that history rows appear, and that the new columns are
    filled where B1 said they would be.
- [ ] **Step 3: Prod, only with the user's explicit OK, in the same order.** After the first cron
  run, check:
  - the function logs for `[ig-metrics] extras` rejections
  - `select count(*) from instagram_post_metrics_history`
- [ ] **Step 4: Browser check and PR.** Renumber the migration if main moved. Run `gh pr create`
  with the deploy order, the probe result and screenshots of the pop-up with a curve. Merge only
  after step 3.
