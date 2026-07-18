# Client Detail Responsive Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the client-detail calendar and Instagram sections geometrically consistent on narrow screens and replace the latest-publications table with a neutral, media-first carousel at every breakpoint.

**Architecture:** Keep calendar data and selection logic in `ClienteDetalhePage`, but add scoped layout hooks and shared grid constraints. Extract the Analytics post rail into a generic React carousel that never sorts its input; Analytics and client details supply their own ordering, labels, cards, and metrics. Replace the imperative latest-post table with a typed React query component while leaving the other imperative Instagram widgets intact.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest, Testing Library, CSS, lucide-react.

## Global Constraints

- “Últimas Publicações” uses the carousel at every screen size.
- The shared carousel is presentation-only and must not rank or sort posts.
- Client details supplies posts newest-first; Analytics retains its existing ranked order.
- Preserve server pagination for latest Instagram publications.
- Continue escaping raw-HTML user data and sanitizing all external URLs.
- Icon-only controls require accessible names and decorative icons require `aria-hidden`.
- Do not add dependencies.

---

### Task 1: Equal calendar tracks and contained selected-post cards

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:1082-1235`
- Modify: `apps/crm/style.css:3023-3540`
- Create: `apps/crm/src/pages/cliente-detalhe/__tests__/ClientePostCalendarResponsive.test.tsx`

**Interfaces:**
- Consumes: existing `MonthGrid`, `.calendar-grid`, `.calendar-day`, `.scheduled-panel`, and selected-event markup.
- Produces: scoped `.cliente-post-calendar` containment hook and global shrinkable seven-column calendar tracks.

- [ ] **Step 1: Write the failing layout-contract test**

```tsx
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('apps/crm/style.css', 'utf8');
const source = readFileSync(
  'apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx',
  'utf8',
);

describe('client post calendar responsive contracts', () => {
  it('uses seven shrinkable equal tracks and fixed cell heights', () => {
    expect(css).toMatch(
      /\.calendar-(?:weekdays|grid)[^{]*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(/\.calendar-day\s*\{[^}]*height:\s*110px[^}]*min-width:\s*0/s);
    expect(css).toMatch(
      /@media \(max-width:\s*600px\)[\s\S]*\.calendar-day\s*\{[^}]*height:\s*80px/s,
    );
  });

  it('scopes width containment and wrapping to the client selected-post panel', () => {
    expect(source).toContain('className="calendar-layout cliente-post-calendar"');
    expect(css).toMatch(
      /\.cliente-post-calendar[^}]*\.scheduled-panel[^{]*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/s,
    );
    expect(css).toMatch(
      /\.cliente-post-calendar \.item-title\s*\{[^}]*overflow-wrap:\s*anywhere/s,
    );
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npm run test -- apps/crm/src/pages/cliente-detalhe/__tests__/ClientePostCalendarResponsive.test.tsx`

Expected: FAIL because the grid still uses `repeat(7, 1fr)`, cells use `min-height`, and the scoped containment hook does not exist.

- [ ] **Step 3: Add the scoped markup hook and minimal CSS**

Change the client calendar wrapper to:

```tsx
<div className="calendar-layout cliente-post-calendar">
```

Update the shared calendar tracks and cell geometry, then add client-only containment:

```css
.calendar-weekdays,
.calendar-grid {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.calendar-day {
  width: 100%;
  min-width: 0;
  height: 110px;
  min-height: 0;
}

.cliente-post-calendar,
.cliente-post-calendar .calendar-main,
.cliente-post-calendar .scheduled-panel,
.cliente-post-calendar .scheduled-list,
.cliente-post-calendar .scheduled-item {
  min-width: 0;
  max-width: 100%;
}

.cliente-post-calendar .item-title {
  overflow-wrap: anywhere;
}

.cliente-post-calendar .item-top,
.cliente-post-calendar .item-meta {
  min-width: 0;
  flex-wrap: wrap;
}

@media (max-width: 600px) {
  .calendar-day {
    height: 80px;
    min-height: 0;
  }
}
```

Keep `.event-pill { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }` and add `min-width: 0` to `.day-events` if the focused test shows intrinsic pill width still escaping.

- [ ] **Step 4: Run focused calendar tests and verify GREEN**

Run: `npm run test -- apps/crm/src/pages/cliente-detalhe/__tests__/ClientePostCalendarResponsive.test.tsx apps/crm/src/pages/entregas/views/__tests__/CalendarView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit the calendar fix**

```bash
git add apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx apps/crm/style.css apps/crm/src/pages/cliente-detalhe/__tests__/ClientePostCalendarResponsive.test.tsx
git commit -m "fix(clients): stabilize mobile post calendar"
```

---

### Task 2: Extract a neutral post carousel and keep Analytics semantics in the caller

**Files:**
- Create: `apps/crm/src/components/instagram/InstagramPostCarousel.tsx`
- Create: `apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx:190-410`
- Modify: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx:470-530`
- Modify: `apps/crm/style.css:3843-3880`

**Interfaces:**
- Produces:

```ts
export interface InstagramPostCarouselProps<T> {
  title: string;
  description?: string;
  ariaLabel: string;
  icon?: ReactNode;
  posts: readonly T[];
  getKey: (post: T) => Key;
  renderPost: (post: T) => ReactNode;
  action?: ReactNode;
}

export function InstagramPostCarousel<T>(
  props: InstagramPostCarouselProps<T>,
): ReactElement | null;
```

- Consumes: caller-provided order and caller-provided cards. The component must render `posts.map(...)` directly and never call `sort()`.

- [ ] **Step 1: Write failing component tests**

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InstagramPostCarousel } from '../InstagramPostCarousel';

describe('InstagramPostCarousel', () => {
  it('keeps caller ordering and neutral section copy', () => {
    const posts = [{ id: 'new' }, { id: 'old' }];
    render(
      <InstagramPostCarousel
        title="Últimas Publicações"
        description="Publicações mais recentes"
        ariaLabel="Últimas Publicações"
        posts={posts}
        getKey={(post) => post.id}
        renderPost={(post) => <article>{post.id}</article>}
      />,
    );
    const region = screen.getByRole('region', { name: 'Últimas Publicações' });
    expect(within(region).getAllByRole('article').map((item) => item.textContent)).toEqual([
      'new',
      'old',
    ]);
  });

  it('renders the optional action without assigning ranking semantics', () => {
    render(
      <InstagramPostCarousel
        title="Melhores Posts"
        ariaLabel="Melhores Posts"
        posts={[{ id: 1 }]}
        getKey={(post) => post.id}
        renderPost={() => <article>post</article>}
        action={<button>Ver mais</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'Ver mais' })).toBeTruthy();
    expect(screen.queryByText(/rank/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx`

Expected: FAIL because `InstagramPostCarousel.tsx` does not exist.

- [ ] **Step 3: Implement the neutral component and shared rail class**

```tsx
import type { Key, ReactElement, ReactNode } from 'react';

export interface InstagramPostCarouselProps<T> {
  title: string;
  description?: string;
  ariaLabel: string;
  icon?: ReactNode;
  posts: readonly T[];
  getKey: (post: T) => Key;
  renderPost: (post: T) => ReactNode;
  action?: ReactNode;
}

export function InstagramPostCarousel<T>({
  title,
  description,
  ariaLabel,
  icon,
  posts,
  getKey,
  renderPost,
  action,
}: InstagramPostCarouselProps<T>): ReactElement | null {
  if (posts.length === 0) return null;
  return (
    <section className="card animate-up instagram-post-carousel" aria-label={ariaLabel}>
      <div className="dashboard-hub-card-header instagram-post-carousel__header">
        <div>
          <h3>{icon}{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      <div className="instagram-post-carousel__track" role="list">
        {posts.map((post) => (
          <div key={getKey(post)} className="instagram-post-carousel__item" role="listitem">
            {renderPost(post)}
          </div>
        ))}
      </div>
    </section>
  );
}
```

Use shared CSS at all widths:

```css
.instagram-post-carousel__track {
  display: flex;
  gap: 1rem;
  overflow-x: auto;
  padding: 0 0 0.5rem;
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}
.instagram-post-carousel__track::-webkit-scrollbar { display: none; }
.instagram-post-carousel__item {
  flex: 0 0 clamp(260px, 36vw, 360px);
  min-width: 0;
  scroll-snap-align: start;
}
.instagram-post-carousel__item > * { height: 100%; }
@media (max-width: 767px) {
  .instagram-post-carousel__item { flex-basis: min(84vw, 340px); }
}
```

- [ ] **Step 4: Refactor Analytics to configure the neutral component**

Replace `RankedPostsSection` markup with a small caller-owned adapter that passes the already-ranked array unchanged:

```tsx
function RankedPostsSection(props: RankedPostsSectionProps) {
  return (
    <InstagramPostCarousel
      title={props.title}
      description={props.description}
      ariaLabel={props.title}
      icon={props.icon}
      posts={props.posts}
      getKey={(post) => post.id}
      renderPost={(post) => <RankedPostCard post={post} tone={props.tone} />}
      action={props.canSeeMore ? (
        <Button variant="ghost" size="sm" onClick={props.onSeeMore}>
          Ver mais <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      ) : undefined}
    />
  );
}
```

Add an Analytics assertion that the seeded ranked captions occur in their existing order within the “Melhores Posts” region.

- [ ] **Step 5: Run shared and Analytics tests and verify GREEN**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the neutral carousel extraction**

```bash
git add apps/crm/src/components/instagram/InstagramPostCarousel.tsx apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx apps/crm/style.css
git commit -m "refactor(instagram): extract neutral post carousel"
```

---

### Task 3: Render newest Instagram publications through the shared carousel

**Files:**
- Modify: `apps/crm/src/services/instagram.ts:123-140`
- Create: `apps/crm/src/components/instagram/LatestInstagramPosts.tsx`
- Create: `apps/crm/src/components/instagram/__tests__/LatestInstagramPosts.test.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx:120-135,2390-2460`
- Delete: `apps/crm/src/components/instagram/InstagramPostsTable.ts`
- Delete: `apps/crm/src/components/instagram/__tests__/InstagramPostsTable.test.ts`
- Modify: `apps/crm/style.css:8525-8615`

**Interfaces:**
- Produces typed service data:

```ts
export interface InstagramPostSummary {
  id: string;
  posted_at: string;
  media_type: string;
  caption: string | null;
  thumbnail_url: string | null;
  permalink: string | null;
  likes: number;
  comments: number;
  reach: number;
  impressions: number;
}

export interface InstagramPostsPage {
  posts: InstagramPostSummary[];
  total: number;
}
```

- Produces: `LatestInstagramPosts({ clienteId }: { clienteId: number }): ReactElement`.
- Consumes: `InstagramPostCarousel`, `getInstagramPosts`, `sanitizeUrl`, and the `clients` translation namespace.

- [ ] **Step 1: Write failing latest-publications tests**

Mock `getInstagramPosts` with posts deliberately out of order and assert the caller normalizes them newest-first before passing them to the neutral rail:

```tsx
it('renders newest-first media cards in the Últimas Publicações carousel', async () => {
  mockedGetInstagramPosts.mockResolvedValue({
    total: 2,
    posts: [olderPost, newerPost],
  });
  renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);
  const region = await screen.findByRole('region', { name: 'Últimas Publicações' });
  expect(within(region).getAllByRole('article').map((card) => card.textContent)).toEqual([
    expect.stringContaining(newerPost.caption),
    expect.stringContaining(olderPost.caption),
  ]);
});

it('shows media, metrics, sanitized link, and accessible pagination', async () => {
  mockedGetInstagramPosts.mockResolvedValue({ posts: [newerPost], total: 11 });
  renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);
  expect(await screen.findByText('Carrossel')).toBeTruthy();
  expect(screen.getByText(/75/)).toBeTruthy();
  expect(screen.getByText(/321/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Abrir publicação' })).toHaveAttribute(
    'href',
    'https://instagram.com/p/safe',
  );
  expect(screen.getByRole('button', { name: 'Próxima página' })).toBeTruthy();
});
```

Also add a source assertion that `ClienteDetalhePage.tsx` renders `<LatestInstagramPosts clienteId={clienteId} />` and no longer imports or calls `renderInstagramPostsTable`.

- [ ] **Step 2: Run the latest-post tests and verify RED**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/LatestInstagramPosts.test.tsx`

Expected: FAIL because `LatestInstagramPosts.tsx` and typed service interfaces do not exist.

- [ ] **Step 3: Type the Instagram posts service**

Change `getInstagramPosts` to `Promise<InstagramPostsPage>` without changing request, cache, or error behavior. Normalize missing arrays/counts at the boundary:

```ts
const data = await res.json();
const result: InstagramPostsPage = {
  posts: Array.isArray(data.posts) ? data.posts : [],
  total: Number(data.total) || 0,
};
setCache(cacheKey, result);
return result;
```

- [ ] **Step 4: Implement `LatestInstagramPosts` with caller-owned ordering**

Use `useQuery` with key `['instagram-posts', clienteId, page]`. In the component, derive:

```tsx
const newestFirst = useMemo(
  () => [...(data?.posts ?? [])].sort(
    (a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime(),
  ),
  [data?.posts],
);
```

Pass `newestFirst` to `InstagramPostCarousel`. Render each item as an `<article className="latest-instagram-post-card">` containing a sanitized media preview, localized media type, clamped caption, date, likes/comments, reach/impressions, and a sanitized external link. Pagination changes `page`, disables boundaries, and keeps the `Pg X de Y` indicator.

Do not add sorting to `InstagramPostCarousel`.

- [ ] **Step 5: Replace the imperative table integration**

Remove `igPostsRef`, `renderInstagramPostsTable`, and its effect call. Render:

```tsx
{!loadingIg && igSummary?.account?.last_synced_at && (
  <LatestInstagramPosts clienteId={clienteId} />
)}
```

Delete the raw table helper, its obsolete tests, and the `.ig-posts-list*` CSS. Keep any generic accessible utility class still used elsewhere.

- [ ] **Step 6: Run latest-post, shared-carousel, and security tests and verify GREEN**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/LatestInstagramPosts.test.tsx apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx apps/crm/src/__tests__/security.test.ts apps/crm/src/utils/__tests__/security.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the latest-publications carousel**

```bash
git add apps/crm/src/services/instagram.ts apps/crm/src/components/instagram/LatestInstagramPosts.tsx apps/crm/src/components/instagram/__tests__/LatestInstagramPosts.test.tsx apps/crm/src/pages/cliente-detalhe/ClienteDetalhePage.tsx apps/crm/style.css
git add -u apps/crm/src/components/instagram/InstagramPostsTable.ts apps/crm/src/components/instagram/__tests__/InstagramPostsTable.test.ts
git commit -m "feat(instagram): show latest posts in shared carousel"
```

---

### Task 4: Compact the account metrics and enlarge the expiry badge

**Files:**
- Modify: `apps/crm/src/components/instagram/InstagramOverviewCard.ts:45-150`
- Create: `apps/crm/src/components/instagram/__tests__/InstagramOverviewCard.test.ts`
- Modify: `apps/crm/style.css:8480-8545`

**Interfaces:**
- Consumes: existing imperative overview renderer and escaped translations.
- Produces: `.instagram-overview__profile`, `.instagram-overview__token-badge`, and `.instagram-overview__account-kpis` hooks.

- [ ] **Step 1: Write the failing overview contract test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderInstagramOverviewCard } from '../InstagramOverviewCard';

const css = readFileSync('apps/crm/style.css', 'utf8');

it('keeps three account metrics in one equal row and the expiry label on one line', () => {
  vi.setSystemTime(new Date('2026-07-18T12:00:00Z'));
  const container = document.createElement('div');
  renderInstagramOverviewCard(container, 42, accountExpiringIn38Days, vi.fn());
  expect(container.querySelectorAll('.instagram-overview__account-kpis .kpi-card')).toHaveLength(3);
  expect(container.querySelector('.instagram-overview__token-badge')).toHaveTextContent(
    /38.*restantes/i,
  );
  expect(css).toMatch(
    /\.instagram-overview__account-kpis\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
  );
  expect(css).toMatch(
    /\.instagram-overview__token-badge\s*\{[^}]*white-space:\s*nowrap[^}]*min-height:\s*36px/s,
  );
});
```

- [ ] **Step 2: Run the overview test and verify RED**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/InstagramOverviewCard.test.ts`

Expected: FAIL because the dedicated hooks and rules do not exist.

- [ ] **Step 3: Replace inline layout ownership with scoped classes**

Add the hooks to the existing escaped HTML:

```html
<div class="instagram-overview__profile">...</div>
<span class="token-badge instagram-overview__token-badge" ...>...</span>
<div class="kpi-grid instagram-overview__account-kpis">...</div>
```

Use CSS:

```css
.instagram-overview__account-kpis {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.75rem;
}
.instagram-overview__token-badge {
  min-height: 36px;
  padding-inline: 0.75rem !important;
  font-size: 0.78rem !important;
  white-space: nowrap;
}
@media (max-width: 600px) {
  .instagram-overview__account-kpis .kpi-card { padding: 0.85rem 0.6rem; min-width: 0; }
  .instagram-overview__account-kpis .kpi-label { font-size: 0.58rem; }
  .instagram-overview__account-kpis .kpi-value { font-size: clamp(1.05rem, 5vw, 1.4rem); }
  .instagram-overview__profile { align-items: flex-start; gap: 1rem; }
}
```

Preserve the status colors and tooltip behavior.

- [ ] **Step 4: Run overview tests and verify GREEN**

Run: `npm run test -- apps/crm/src/components/instagram/__tests__/InstagramOverviewCard.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the Instagram summary fix**

```bash
git add apps/crm/src/components/instagram/InstagramOverviewCard.ts apps/crm/src/components/instagram/__tests__/InstagramOverviewCard.test.ts apps/crm/style.css
git commit -m "fix(instagram): compact client account summary"
```

---

### Task 5: Integrated verification and cleanup

**Files:**
- Modify only files implicated by a failing verification command.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: a clean, typechecked feature branch with focused regression coverage.

- [ ] **Step 1: Run all focused responsive tests**

Run:

```bash
npm run test -- \
  apps/crm/src/pages/cliente-detalhe/__tests__/ClientePostCalendarResponsive.test.tsx \
  apps/crm/src/components/instagram/__tests__/InstagramPostCarousel.test.tsx \
  apps/crm/src/components/instagram/__tests__/LatestInstagramPosts.test.tsx \
  apps/crm/src/components/instagram/__tests__/InstagramOverviewCard.test.ts \
  apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run security parity checks**

Run:

```bash
rg -n "innerHTML|href=|src=" \
  apps/crm/src/components/instagram/InstagramOverviewCard.ts \
  apps/crm/src/components/instagram/LatestInstagramPosts.tsx
```

Expected: overview raw HTML interpolations remain escaped/sanitized; React external `href` and `src` values pass through `sanitizeUrl`.

- [ ] **Step 3: Run the full test suite**

Run: `npm run test`

Expected: all test files pass; repository-known jsdom/React warning output may remain unchanged.

- [ ] **Step 4: Run the CRM production build**

Run: `npm run build`

Expected: TypeScript and Vite build succeed. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 5: Inspect the final diff and branch state**

Run:

```bash
git diff --check
git status --short
git log --oneline -8
```

Expected: no whitespace errors and no uncommitted implementation files.

- [ ] **Step 6: Commit verification-only fixes if required**

If Steps 1-5 required code changes, stage only those files and commit:

```bash
git commit -m "fix(mobile): address responsive follow-up review"
```

If no changes were required, do not create an empty commit.
