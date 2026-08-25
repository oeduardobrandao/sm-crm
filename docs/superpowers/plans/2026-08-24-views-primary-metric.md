# Views as Primary Metric Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace "alcance" (reach) with "visualizações" (views) as the primary performance metric across all analytics surfaces.

**Architecture:** No schema migration. The DB column `impressions` already stores Instagram API `views`. Frontend types already alias `views = impressions`. The change is purely query-order, sort-logic, and label/value swaps across 6 files.

**Tech Stack:** React 19, TypeScript, Supabase PostgREST, TanStack Query, Deno edge functions

## Global Constraints

- Engagement rate formula stays `interactions / reach * 100` — never change it
- DB column `impressions` = Instagram `views`. No new columns or migrations.
- Portuguese-language UI — all labels in Portuguese
- `post.views` on CRM types (aliased from `impressions`), `post.impressions` on Hub types (no alias)
- Query filter `.or('impressions.gt.0,reach.gt.0')` instead of `.gt('impressions', 0)` to keep posts with unavailable views data rankable

---

### Task 1: Service Layer + Hub Backend

**Files:**
- Modify: `apps/crm/src/services/analytics.ts:422-465` (getPortfolioSummary query + sort)
- Modify: `apps/crm/src/services/analytics.ts:518-541` (getAnalyticsOverview select)
- Modify: `apps/crm/src/services/analytics.ts:714-726` (getPostsAnalytics validCols)
- Modify: `supabase/functions/hub-dashboard/handler.ts:76-109` (top posts query)

**Interfaces:**
- Consumes: existing `instagram_posts` table columns `impressions`, `reach`
- Produces: `getPortfolioSummary` returns posts sorted by views (descending). `getPostsAnalytics` accepts `'views'` as a sort column. Hub handler returns top 5 posts by views.

- [ ] **Step 1: Update `getPortfolioSummary` query and sort**

In `apps/crm/src/services/analytics.ts`, change the query at line 429-431:

```typescript
// Before:
    .gt('reach', 0)
    .order('reach', { ascending: false })
    .limit(200);

// After:
    .or('impressions.gt.0,reach.gt.0')
    .order('impressions', { ascending: false })
    .limit(200);
```

And the JS sort at line 465:

```typescript
// Before:
    .sort((a, b) => b.reach - a.reach);

// After:
    .sort((a, b) => b.views - a.views);
```

- [ ] **Step 2: Add `impressions` to `getAnalyticsOverview` select**

In `apps/crm/src/services/analytics.ts`, change the two `.select()` calls at lines 520 and 539:

```typescript
// Before (line 520):
    .select('likes, comments, saved, shares, reach')

// After:
    .select('likes, comments, saved, shares, reach, impressions')

// Before (line 539):
    .select('likes, comments, saved, shares, reach')

// After:
    .select('likes, comments, saved, shares, reach, impressions')
```

- [ ] **Step 3: Add `'views'` to `getPostsAnalytics` validCols**

In `apps/crm/src/services/analytics.ts`, add `'views'` to the `validCols` array at line 714:

```typescript
  const validCols = [
    'posted_at',
    'reach',
    'impressions',
    'views',
    'engagement_rate',
    'saves_rate',
    'saved',
    'likes',
    'comments',
    'shares',
  ];
```

- [ ] **Step 4: Update Hub backend handler**

In `supabase/functions/hub-dashboard/handler.ts`, change lines 81-109:

```typescript
// Before (lines 81-83):
      .gt("reach", 0)
      .order("reach", { ascending: false })
      .limit(20);

// After:
      .or('impressions.gt.0,reach.gt.0')
      .order("impressions", { ascending: false })
      .order("posted_at", { ascending: false })
      .limit(5);
```

Remove the secondary sort and slice at lines 106-109:

```typescript
// Before (lines 85-109):
    const topPosts = (topPostsRaw ?? [])
      .map((p: any) => ({
        ...
      }))
      .sort((a: { engagementRate: number }, b: { engagementRate: number }) =>
        b.engagementRate - a.engagementRate,
      )
      .slice(0, 5);

// After — remove .sort() and .slice(), keep only the .map():
    const topPosts = (topPostsRaw ?? [])
      .map((p: any) => ({
        id: p.instagram_post_id,
        thumbnailUrl: p.thumbnail_url as string | null,
        mediaType: p.media_type,
        permalink: p.permalink,
        postedAt: p.posted_at,
        likes: p.likes ?? 0,
        comments: p.comments ?? 0,
        reach: p.reach ?? 0,
        impressions: p.impressions ?? 0,
        saved: p.saved ?? 0,
        shares: p.shares ?? 0,
        engagementRate: computeEngagementRate({
          likes: p.likes ?? 0,
          comments: p.comments ?? 0,
          saved: p.saved ?? 0,
          shares: p.shares ?? 0,
          reach: p.reach ?? 0,
        }),
      }));
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

- [ ] **Step 6: Run existing tests**

```bash
npm run test -- --run
npm run test:functions -- --run
```

- [ ] **Step 7: Commit**

```bash
git add apps/crm/src/services/analytics.ts supabase/functions/hub-dashboard/handler.ts
git commit -m "feat(analytics): rank posts by views instead of reach in service layer and hub backend"
```

---

### Task 2: CRM Portfolio Page (`AnalyticsPage.tsx`)

**Files:**
- Modify: `apps/crm/src/pages/analytics/AnalyticsPage.tsx`

**Interfaces:**
- Consumes: `getPortfolioSummary` (now sorted by views from Task 1). `PortfolioAccount.impressions_28d` field.
- Produces: UI displays views as primary metric across post cards, KPI cards, drawer, and accounts table.

- [ ] **Step 1: Rename ranking memos (lines 431-439)**

```typescript
// Before:
  const reachRankedPosts = useMemo(() => {
    return [...(data?.allRankedPosts ?? [])].sort((a, b) => b.reach - a.reach);
  }, [data?.allRankedPosts]);

  const matureReachRankedPosts = useMemo(() => {
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    return [...(data?.allRankedPosts ?? [])]
      .filter((p) => new Date(p.posted_at).getTime() < cutoff48h)
      .sort((a, b) => a.reach - b.reach);

// After:
  const viewsRankedPosts = useMemo(() => {
    return [...(data?.allRankedPosts ?? [])].sort((a, b) => b.views - a.views);
  }, [data?.allRankedPosts]);

  const matureViewsRankedPosts = useMemo(() => {
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    return [...(data?.allRankedPosts ?? [])]
      .filter((p) => new Date(p.posted_at).getTime() < cutoff48h)
      .sort((a, b) => a.views - b.views);
```

Then update all references to the old names throughout the file: `reachRankedPosts` → `viewsRankedPosts`, `matureReachRankedPosts` → `matureViewsRankedPosts`.

- [ ] **Step 2: Update drawer default and reset (lines 414, 1617)**

```typescript
// Line 414, before:
  const [drawerOrderBy, setDrawerOrderBy] = useState<string>('reach');
// After:
  const [drawerOrderBy, setDrawerOrderBy] = useState<string>('views');

// Line 1617, before:
            setDrawerOrderBy('reach');
// After:
            setDrawerOrderBy('views');
```

- [ ] **Step 3: Add `case 'views'` to drawer switch (line 462)**

Add a new case before the existing `case 'reach'`:

```typescript
      case 'views':
        posts.sort((a, b) => (a.views - b.views) * dir);
        break;
```

- [ ] **Step 4: Update KPI cards (lines 779-831)**

Replace the "Alcance total (28d)" card. Add `totalViews` computation near `totalReach` (line 576):

```typescript
  const totalViews = filteredAccounts.reduce((s, a) => s + (a.impressions_28d || 0), 0);
```

Add `bestByViews` near `bestByReach` (line 569):

```typescript
  const bestByViews = [...filteredAccounts].sort((a, b) => (b.impressions_28d || 0) - (a.impressions_28d || 0))[0];
```

Replace the KPI card at line 779:

```typescript
// Before:
        <StatCard
          label="Alcance total (28d)"
          icon={Eye}
          tone="violet"
          value={formatNumber(totalReach)}
          sub="Soma de todas as contas"
        />

// After:
        <StatCard
          label="Visualizações totais (28d)"
          icon={Eye}
          tone="violet"
          value={formatNumber(totalViews)}
          sub="Soma de todas as contas"
        />
```

Replace the "Maior alcance" leader card at line 822:

```typescript
// Before:
        {bestByReach && bestByReach.reach_28d > 0 && (
          <StatCard
            label="Maior alcance"
            icon={Eye}
            tone="blue"
            compactValue
            value={bestByReach.client_name}
            sub={`${formatNumber(bestByReach.reach_28d)} alcance 28d`}
          />
        )}

// After:
        {bestByViews && (bestByViews.impressions_28d || 0) > 0 && (
          <StatCard
            label="Mais visualizações"
            icon={Eye}
            tone="blue"
            compactValue
            value={bestByViews.client_name}
            sub={`${formatNumber(bestByViews.impressions_28d || 0)} visualizações 28d`}
          />
        )}
```

- [ ] **Step 5: Update post card labels and values**

Top posts cards (line 970, 979):

```typescript
// Before:
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Alcance</span>
                    ...
                      {formatNumber(post.reach)}

// After:
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Visualizações</span>
                    ...
                      {formatNumber(post.views)}
```

Worst posts cards (line 1173, 1183):

```typescript
// Before:
                        Alcance
                      ...
                        {formatNumber(post.reach)}

// After:
                        Visualizações
                      ...
                        {formatNumber(post.views)}
```

- [ ] **Step 6: Update tooltips (lines 861, 1063)**

```typescript
// Line 861, before:
              <HelpTooltip content="Top 5 posts com maior alcance no período selecionado." />
// After:
              <HelpTooltip content="Top 5 posts com mais visualizações no período selecionado." />

// Line 1063, before:
                <HelpTooltip content="Posts com pelo menos 48h desde a publicação e menor alcance no período." />
// After:
                <HelpTooltip content="Posts com pelo menos 48h desde a publicação e menos visualizações no período." />
```

- [ ] **Step 7: Update drawer selector, description, and result rows**

Drawer description (line 1655):

```typescript
// Before:
                  Top 200 por alcance, reordenado por taxa
// After:
                  Top 200 por visualizações, reordenado por taxa
```

Drawer selector (line 1668) — add `views` option before `reach`:

```typescript
                <SelectContent>
                  <SelectItem value="views">Visualizações</SelectItem>
                  <SelectItem value="reach">Alcance</SelectItem>
                  <SelectItem value="engagement">Engajamento</SelectItem>
```

Drawer result rows (line 1850):

```typescript
// Before:
                    <span>
                      Alcance{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.reach)}
                      </strong>
                    </span>

// After:
                    <span>
                      Visualizações{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                        {formatNumber(post.views)}
                      </strong>
                    </span>
```

- [ ] **Step 8: Update accounts table + mobile**

Add `'impressions_28d'` to `SortCol` type (line 390):

```typescript
type SortCol =
  | 'client_name'
  | 'follower_count'
  | 'engagement_rate_avg'
  | 'impressions_28d'
  | 'reach_28d'
  | 'alcance_seg'
  | 'posts_last_30d'
  | 'website_clicks_28d'
```

Desktop table header (line 1282) — add "Visualizações (28d)" before "Alcance (28d)":

```typescript
                  {renderSortableHead('impressions_28d', 'Visualizações (28d)')}
                  {renderSortableHead('reach_28d', 'Alcance (28d)')}
```

Add a matching `<TableCell>` in the table body (near line 1365):

```typescript
                      <TableCell data-label="Visualizações (28d)">{formatNumber(a.impressions_28d || 0)}</TableCell>
                      <TableCell data-label="Alcance (28d)">{formatNumber(a.reach_28d)}</TableCell>
```

Handle `impressions_28d` in the `handleSort` comparator — find the sorted accounts `useMemo` and ensure it reads `(a as any)[sortColumn]` or add explicit handling if needed.

Mobile account line (line 1528):

```typescript
// Before:
                      <span>{formatNumber(a.reach_28d)} alcance</span>
// After:
                      <span>{formatNumber(a.impressions_28d || 0)} visualizações</span>
```

Mobile sort menu (line 1433) — add "Visualizações" before "Alcance":

```typescript
                <DropdownMenuRadioItem value="impressions_28d">Visualizações</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="reach_28d">Alcance</DropdownMenuRadioItem>
```

- [ ] **Step 9: Typecheck**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

- [ ] **Step 10: Verify in browser**

Start the CRM dev server and navigate to `/analytics`. Check:
1. KPI cards show "Visualizações totais (28d)" and "Mais visualizações"
2. Top posts are ranked by views, card labels say "Visualizações"
3. Worst posts card labels say "Visualizações"
4. Drawer defaults to "Visualizações" sort, selector has both "Visualizações" and "Alcance"
5. Accounts table has "Visualizações (28d)" column
6. Mobile view shows "visualizações" on account cards

- [ ] **Step 11: Commit**

```bash
git add apps/crm/src/pages/analytics/AnalyticsPage.tsx
git commit -m "feat(analytics): views-first portfolio page — rankings, KPIs, drawer, and accounts table"
```

---

### Task 3: CRM Per-Account Page (`AnalyticsContaPage.tsx`)

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`

**Interfaces:**
- Consumes: `PostAnalytics.views` (already aliased from `impressions`), `getAnalyticsOverview().impressions` (fixed in Task 1)
- Produces: UI displays views as primary metric across post rankings, KPI cards, content table, drawer, and print report.

- [ ] **Step 1: Update post ranking sorts (lines 1094-1099)**

```typescript
// Before:
  const rankedPosts = useMemo(() => [...posts].sort((a, b) => b.reach - a.reach), [posts]);
  const matureRankedPosts = useMemo(() => {
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    return [...posts]
      .filter((p) => new Date(p.posted_at).getTime() < cutoff48h)
      .sort((a, b) => a.reach - b.reach);
  }, [posts]);

// After:
  const rankedPosts = useMemo(() => [...posts].sort((a, b) => b.views - a.views), [posts]);
  const matureRankedPosts = useMemo(() => {
    const cutoff48h = Date.now() - 48 * 60 * 60 * 1000;
    return [...posts]
      .filter((p) => new Date(p.posted_at).getTime() < cutoff48h)
      .sort((a, b) => a.views - b.views);
  }, [posts]);
```

- [ ] **Step 2: Update `RankedPostCard` (lines 284-293)**

```typescript
// Before:
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Alcance</span>
          ...
            {formatNumber(post.reach)}

// After:
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Visualizações</span>
          ...
            {formatNumber(post.views)}
```

- [ ] **Step 3: Reorder KPI cards (lines 1613-1621)**

Swap the Alcance and Contas engajadas cards so the order is: Visualizações, Seguidores, Engajamento, Contas engajadas, Alcance, Cliques no link, Taxa de salvamentos, Posts publicados.

Move the `<KpiCard label="Contas engajadas" ...>` block (currently at line 1622) to appear before the `<KpiCard label="Alcance" ...>` block (currently at line 1613).

- [ ] **Step 4: Update `RankedPostOrderBy` type and drawer (lines 391-403, 1009, 1122, 1295-1306)**

Add `'views'` to the type:

```typescript
type RankedPostOrderBy =
  | 'engagement'
  | 'views'
  | 'reach'
  | 'likes'
  ...
```

Change default and reset from `'reach'` to `'views'`:

```typescript
// Line 1009, before:
  const [rankedOrderBy, setRankedOrderBy] = useState<RankedPostOrderBy>('reach');
// After:
  const [rankedOrderBy, setRankedOrderBy] = useState<RankedPostOrderBy>('views');

// Line 1297, before:
    setRankedOrderBy('reach');
// After:
    setRankedOrderBy('views');

// Line 1306, before:
    setRankedOrderBy('reach');
// After:
    setRankedOrderBy('views');
```

Add `case 'views'` to the switch at line 1122 (before `case 'reach'`):

```typescript
      case 'views':
        next.sort((a, b) => (a.views - b.views) * dir);
        break;
```

Update the drawer selector (line 2581) — add `views` before `reach`:

```html
                <option value="views">Visualizações</option>
                <option value="reach">Alcance</option>
```

- [ ] **Step 5: Update drawer result row metric (line 2756)**

```typescript
// Before:
                      <span>
                        Alcance{' '}
                        <strong ...>
                          {formatNumber(post.reach)}
                        </strong>
                      </span>

// After:
                      <span>
                        Visualizações{' '}
                        <strong ...>
                          {formatNumber(post.views)}
                        </strong>
                      </span>
```

- [ ] **Step 6: Update content table (line 1753)**

Reorder the columns so "Visualizações" (mapped to `impressions`) comes before "Alcance":

```typescript
                    { col: 'impressions', label: 'Visualizações' },
                    { col: 'reach', label: 'Alcance' },
```

Remove the old `{ col: 'impressions', label: 'Impressões' }` entry.

- [ ] **Step 7: Update print report (lines 3088-3106)**

Add "Visualizações" KPI card and demote "Alcance":

```typescript
// Line 3091, before:
            ${kpiCard('Alcance', fmtN(ov.reach?.current), ov.reach, '')}

// After:
            ${kpiCard('Visualizações', fmtN(ov.impressions?.current), ov.impressions, '')}
            ${kpiCard('Alcance', fmtN(ov.reach?.current), ov.reach, '')}
```

Add "Visualizações" column to the performance table header (line 3106):

```typescript
// Before:
            <thead><tr><th>Data</th><th>Tipo</th><th>Alcance</th><th>Engaj.</th><th>Salvos</th><th>Coment.</th><th>Compart.</th></tr></thead>

// After:
            <thead><tr><th>Data</th><th>Tipo</th><th>Visualizações</th><th>Alcance</th><th>Engaj.</th><th>Salvos</th><th>Coment.</th><th>Compart.</th></tr></thead>
```

Add the views value to each row (line 3024):

```typescript
// Before:
        <td style="font-weight:600;">${fmtN(p.reach)}</td>

// After:
        <td style="font-weight:600;">${fmtN(p.views)}</td>
        <td>${fmtN(p.reach)}</td>
```

- [ ] **Step 8: Typecheck**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

- [ ] **Step 9: Verify in browser**

Navigate to `/analytics/:clientId`. Check:
1. Post rankings sorted by views
2. RankedPostCard shows "Visualizações" with views value
3. KPI order: Visualizações, Seguidores, Engajamento, Contas engajadas, Alcance, ...
4. Content table has "Visualizações" before "Alcance"
5. Drawer defaults to "Visualizações", selector has both options
6. Print report (click "Salvar como PDF") shows Visualizações KPI and column

- [ ] **Step 10: Commit**

```bash
git add apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx
git commit -m "feat(analytics): views-first per-account page — rankings, KPIs, table, drawer, and print report"
```

---

### Task 4: Hub Client Portal + AI Prompts

**Files:**
- Modify: `apps/hub/src/components/dashboard/TopPostsRow.tsx:135-137`
- Modify: `supabase/functions/instagram-analytics/index.ts:1016-1060,1180-1241`

**Interfaces:**
- Consumes: `DashboardTopPost.impressions` (Hub). Per-account AI: `instagram_posts.impressions`. Portfolio AI: `instagram_accounts.impressions_28d`.
- Produces: Hub shows views on post cards. AI prompts frame views as primary metric.

- [ ] **Step 1: Update Hub `TopPostsRow` (lines 135-137)**

```typescript
// Before:
                  <span className="text-[11px] text-stone-500 dark:text-stone-400">Alcance</span>
                  <span className="text-[11px] font-bold text-stone-900 dark:text-stone-100">
                    {formatNumber(post.reach)}
                  </span>

// After:
                  <span className="text-[11px] text-stone-500 dark:text-stone-400">Visualizações</span>
                  <span className="text-[11px] font-bold text-stone-900 dark:text-stone-100">
                    {formatNumber(post.impressions)}
                  </span>
```

- [ ] **Step 2: Update per-account AI prompt post summary (line 1016-1021)**

Add `views` field to the post summary:

```typescript
// Before:
      const postsSummary = (posts || []).map(p => ({
        type: p.media_type,
        caption: (p.caption || '').slice(0, 120),
        likes: p.likes, comments: p.comments, saved: p.saved, shares: p.shares,
        reach: p.reach, date: p.posted_at?.split('T')[0],
        engRate: p.reach > 0 ? (((p.likes||0)+(p.comments||0)+(p.saved||0)+(p.shares||0)) / p.reach * 100).toFixed(2) + '%' : '0%',
      }));

// After:
      const postsSummary = (posts || []).map(p => ({
        type: p.media_type,
        caption: (p.caption || '').slice(0, 120),
        likes: p.likes, comments: p.comments, saved: p.saved, shares: p.shares,
        views: p.impressions, reach: p.reach, date: p.posted_at?.split('T')[0],
        engRate: p.reach > 0 ? (((p.likes||0)+(p.comments||0)+(p.saved||0)+(p.shares||0)) / p.reach * 100).toFixed(2) + '%' : '0%',
      }));
```

- [ ] **Step 3: Update per-account AI system prompt benchmark (line 1055-1060)**

```typescript
// Before:
BENCHMARKS DE REFERÊNCIA (contas de saúde 5k-50k seguidores):
- Taxa de engajamento saudável: 3-6%
- Proporção ideal Reels/Carrossel/Imagem: 40/40/20
- Crescimento orgânico bom: 2-5% ao mês
- Alcance médio por post: 20-40% da base de seguidores
Ajuste esses benchmarks proporcionalmente se a conta estiver fora dessa faixa de seguidores.

// After:
BENCHMARKS DE REFERÊNCIA (contas de saúde 5k-50k seguidores):
- Taxa de engajamento saudável: 3-6%
- Proporção ideal Reels/Carrossel/Imagem: 40/40/20
- Crescimento orgânico bom: 2-5% ao mês
- Visualizações é a métrica principal de distribuição. Compare os posts entre si, identifique quais tiveram distribuição acima ou abaixo da média do perfil.
Ajuste esses benchmarks proporcionalmente se a conta estiver fora dessa faixa de seguidores.
```

- [ ] **Step 4: Update portfolio AI — add `impressions_28d` to select and summary (lines 1180, 1218)**

```typescript
// Line 1180, before:
        .select('id, client_id, username, follower_count, profile_views_28d, reach_28d')

// After:
        .select('id, client_id, username, follower_count, profile_views_28d, reach_28d, impressions_28d')

// Line 1218, before:
          followers: acc.follower_count, reach28d: acc.reach_28d || 0,

// After:
          followers: acc.follower_count, views28d: acc.impressions_28d || 0, reach28d: acc.reach_28d || 0,
```

- [ ] **Step 5: Update portfolio AI system prompt benchmark (line 1237-1241)**

```typescript
// Before:
BENCHMARKS DE REFERÊNCIA (contas de saúde 5k-50k seguidores):
- Taxa de engajamento saudável: 3-6%
- Crescimento orgânico bom: 2-5% ao mês
- Alcance médio por post: 20-40% da base de seguidores
Ajuste proporcionalmente para contas fora dessa faixa.

// After:
BENCHMARKS DE REFERÊNCIA (contas de saúde 5k-50k seguidores):
- Taxa de engajamento saudável: 3-6%
- Crescimento orgânico bom: 2-5% ao mês
- Visualizações é a métrica principal de distribuição. Compare as contas entre si e identifique quais tiveram distribuição acima ou abaixo da média do portfólio.
Ajuste proporcionalmente para contas fora dessa faixa.
```

- [ ] **Step 6: Typecheck**

```bash
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/crm/tsconfig.json --noEmit
```

- [ ] **Step 7: Run tests**

```bash
npm run test -- --run
npm run test:functions -- --run
```

- [ ] **Step 8: Verify Hub in browser**

Start the Hub dev server and navigate to a client portal dashboard. Check:
1. "Melhores Posts" cards show "Visualizações" with views value
2. Posts are ordered by views (highest first)

- [ ] **Step 9: Commit**

```bash
git add apps/hub/src/components/dashboard/TopPostsRow.tsx supabase/functions/instagram-analytics/index.ts
git commit -m "feat(analytics): views-first Hub post cards and AI prompt updates"
```

---

### Task 5: Final Verification + Cleanup

**Files:**
- All files from previous tasks (no new modifications expected)

**Interfaces:**
- Consumes: all changes from Tasks 1-4
- Produces: passing CI checks

- [ ] **Step 1: Run full CI check suite**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test -- --run
npm run test:functions -- --run
npm run lint
npm run format:check
```

- [ ] **Step 2: Fix any lint/format issues**

```bash
npm run format
```

If format changed files, commit them:

```bash
git add -u
git commit -m "style: format views-primary-metric changes"
```

- [ ] **Step 3: Visual verification in browser**

Start both CRM and Hub dev servers. Walk through every changed surface:

1. **Portfolio page (`/analytics`):** KPI cards, top/worst posts, drawer (open, sort, close+reopen), desktop accounts table, mobile accounts list
2. **Per-account page (`/analytics/:id`):** KPI card order, post rankings, RankedPostCard, content table column order, drawer, print report
3. **Hub dashboard:** Top posts cards show "Visualizações" with views values

- [ ] **Step 4: Done**

All analytics surfaces now use views (visualizações) as the primary performance metric. Reach (alcance) remains as a secondary metric throughout.
