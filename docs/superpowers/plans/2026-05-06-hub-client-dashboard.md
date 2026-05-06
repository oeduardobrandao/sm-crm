# Hub Client Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a performance dashboard section to the Hub Home page showing top Instagram posts by engagement and follower/reach growth charts with a 30/60/90 day period selector.

**Architecture:** New `hub-dashboard` edge function returns all dashboard data in one request (top posts, follower history, reach history, account snapshot). Frontend adds a `DashboardSection` component to `HomePage.tsx` between the welcome hero and nav cards, composed of `PeriodSelector`, `TopPostsRow`, `FollowerChart`, and `ReachChart` subcomponents. Chart.js via `react-chartjs-2` handles visualizations.

**Tech Stack:** Deno edge functions (Supabase), React 19, TanStack Query, Chart.js + react-chartjs-2, Tailwind CSS

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `supabase/functions/hub-dashboard/index.ts` | Edge function entry point — wires deps and calls handler |
| `supabase/functions/hub-dashboard/handler.ts` | Token validation, DB queries, response mapping |
| `apps/hub/src/components/dashboard/DashboardSection.tsx` | Container — period state, data fetching, loading/empty/error states |
| `apps/hub/src/components/dashboard/PeriodSelector.tsx` | Segmented control (30d/60d/90d) |
| `apps/hub/src/components/dashboard/TopPostsRow.tsx` | Horizontal scrollable post cards with metrics |
| `apps/hub/src/components/dashboard/FollowerChart.tsx` | Chart.js line chart — follower trend |
| `apps/hub/src/components/dashboard/ReachChart.tsx` | Chart.js bar chart — reach per post-day |

### Modified files
| File | Change |
|------|--------|
| `apps/hub/src/types.ts` | Add `HubDashboardResponse` and sub-types |
| `apps/hub/src/api.ts` | Add `fetchDashboard(token, period)` function |
| `apps/hub/src/pages/HomePage.tsx` | Import and render `DashboardSection` between hero and cards |

### Test files
| File | What it tests |
|------|--------------|
| `supabase/functions/__tests__/hub-dashboard_test.ts` | Edge function: happy path, no IG account, invalid token, period defaults |
| `apps/hub/src/components/__tests__/DashboardSection.test.tsx` | Container: loading, empty, error, data rendering |
| `apps/hub/src/components/__tests__/PeriodSelector.test.tsx` | Selection callback, active state |
| `apps/hub/src/components/__tests__/TopPostsRow.test.tsx` | Renders cards, links, metrics, empty state |

---

### Task 1: Add types and API function

**Files:**
- Modify: `apps/hub/src/types.ts`
- Modify: `apps/hub/src/api.ts`

- [ ] **Step 1: Add dashboard types to `apps/hub/src/types.ts`**

Append after the `HubPostsResponse` interface (line 178):

```typescript
export interface DashboardTopPost {
  id: string;
  thumbnailUrl: string | null;
  mediaType: string;
  permalink: string;
  postedAt: string;
  likes: number;
  comments: number;
  reach: number;
  impressions: number;
  saved: number;
  shares: number;
  engagementRate: number;
}

export interface DashboardFollowerEntry {
  date: string;
  followerCount: number;
}

export interface DashboardReachEntry {
  date: string;
  reach: number;
  impressions: number;
}

export interface DashboardAccount {
  followerCount: number;
  followingCount: number;
  mediaCount: number;
  reach28d: number;
  impressions28d: number;
  lastSyncedAt: string | null;
}

export interface HubDashboardResponse {
  topPosts: DashboardTopPost[];
  followerHistory: DashboardFollowerEntry[];
  reachHistory: DashboardReachEntry[];
  account: DashboardAccount | null;
  period: number;
}
```

- [ ] **Step 2: Add `fetchDashboard` to `apps/hub/src/api.ts`**

Add the import at the top of the file, extending the existing import:

```typescript
// In the existing import from './types', add HubDashboardResponse:
import type {
  HubBootstrap, HubPost, PostApproval, HubPostProperty, HubSelectOption, HubBrand, HubBrandFile,
  HubPage, HubPageFull, BriefingQuestion, HubIdeia, IdeiaReaction,
  InstagramFeedData, HubPostsResponse, HubDashboardResponse
} from './types';
```

Add the function at the end of the file:

```typescript
export function fetchDashboard(token: string, period: number) {
  return get<HubDashboardResponse>('hub-dashboard', { token, period: String(period) });
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run build:hub 2>&1 | head -20`
Expected: No type errors related to the new types.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/types.ts apps/hub/src/api.ts
git commit -m "feat(hub): add dashboard types and API function"
```

---

### Task 2: Edge function — `hub-dashboard` handler

**Files:**
- Create: `supabase/functions/hub-dashboard/handler.ts`

- [ ] **Step 1: Write the edge function test**

Create `supabase/functions/__tests__/hub-dashboard_test.ts`:

```typescript
import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubDashboardHandler } from "../hub-dashboard/handler.ts";

const now = () => "2026-04-17T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createHubDashboardHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
}

Deno.test("hub-dashboard returns top posts, follower history, reach history, and account for a valid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      id: "ig-acc-1",
      follower_count: 15300,
      following_count: 892,
      media_count: 42,
      reach_28d: 89000,
      impressions_28d: 120000,
      last_synced_at: "2026-04-17T10:00:00.000Z",
    },
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      {
        instagram_post_id: "ig-post-1",
        thumbnail_url: "https://cdn.ig/thumb1.jpg",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/abc",
        posted_at: "2026-04-10T10:00:00.000Z",
        likes: 120,
        comments: 15,
        reach: 5000,
        impressions: 6000,
        saved: 80,
        shares: 25,
      },
      {
        instagram_post_id: "ig-post-2",
        thumbnail_url: null,
        media_type: "VIDEO",
        permalink: "https://instagram.com/p/def",
        posted_at: "2026-04-05T14:00:00.000Z",
        likes: 90,
        comments: 10,
        reach: 4000,
        impressions: 5000,
        saved: 50,
        shares: 15,
      },
    ],
    error: null,
  });
  db.queue("instagram_follower_history", "select", {
    data: [
      { date: "2026-03-18", follower_count: 14000 },
      { date: "2026-04-17", follower_count: 15300 },
    ],
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      { posted_at: "2026-04-05T14:00:00.000Z", reach: 4000, impressions: 5000 },
      { posted_at: "2026-04-10T10:00:00.000Z", reach: 5000, impressions: 6000 },
    ],
    error: null,
  });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123&period=30"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.topPosts.length, 2);
  assertEquals(body.topPosts[0].id, "ig-post-1");
  assertEquals(body.topPosts[0].engagementRate, 4.8);
  assertEquals(body.followerHistory.length, 2);
  assertEquals(body.reachHistory.length, 2);
  assertEquals(body.account.followerCount, 15300);
  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard returns empty data when no Instagram account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123"));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.topPosts, []);
  assertEquals(body.followerHistory, []);
  assertEquals(body.reachHistory, []);
  assertEquals(body.account, null);
  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard rejects missing token with 400", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard"));
  assertEquals(response.status, 400);
});

Deno.test("hub-dashboard returns 404 for invalid tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-dashboard defaults period to 30 when not specified", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = makeHandler(db);
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123&period=999"));
  const body = await response.json();

  assertEquals(body.period, 30);
});

Deno.test("hub-dashboard handles CORS preflight", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard", { method: "OPTIONS" }));
  assertEquals(response.status, 200);
});

Deno.test("hub-dashboard rejects non-GET methods with 405", async () => {
  const handler = makeHandler(createSupabaseQueryMock());
  const response = await handler(new Request("https://example.test/hub-dashboard?token=hub-123", { method: "POST" }));
  assertEquals(response.status, 405);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test supabase/functions/__tests__/hub-dashboard_test.ts --no-check 2>&1 | tail -5`
Expected: Compilation error — `handler.ts` does not exist yet.

- [ ] **Step 3: Implement the handler**

Create `supabase/functions/hub-dashboard/handler.ts`:

```typescript
import { createJsonResponder } from "../_shared/http.ts";

type DbClient = {
  from: (table: string) => any;
};

interface HubDashboardHandlerDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
}

const VALID_PERIODS = new Set([30, 60, 90]);

function parsePeriod(raw: string | null): number {
  const n = parseInt(raw ?? "", 10);
  return VALID_PERIODS.has(n) ? n : 30;
}

function computeEngagementRate(post: {
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  reach: number;
}): number {
  if (post.reach <= 0) return 0;
  const interactions = post.likes + post.comments + post.saved + post.shares;
  return Math.round((interactions / post.reach) * 1000) / 10;
}

export function createHubDashboardHandler(deps: HubDashboardHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token) return json({ error: "token required" }, 400);

    const period = parsePeriod(url.searchParams.get("period"));
    const db = deps.createDb();

    const { data: hubToken } = await db
      .from("client_hub_tokens")
      .select("cliente_id, conta_id, is_active")
      .eq("token", token)
      .gt("expires_at", deps.now())
      .maybeSingle();

    if (!hubToken || !hubToken.is_active) return json({ error: "Link inválido." }, 404);

    const { data: igAccount } = await db
      .from("instagram_accounts")
      .select("id, follower_count, following_count, media_count, reach_28d, impressions_28d, last_synced_at")
      .eq("client_id", hubToken.cliente_id)
      .maybeSingle();

    if (!igAccount) {
      return json({
        topPosts: [],
        followerHistory: [],
        reachHistory: [],
        account: null,
        period,
      });
    }

    const cutoff = new Date(
      new Date(deps.now()).getTime() - period * 24 * 60 * 60 * 1000,
    ).toISOString();

    const cutoffDate = cutoff.slice(0, 10);

    const { data: topPostsRaw } = await db
      .from("instagram_posts")
      .select("instagram_post_id, thumbnail_url, media_type, permalink, posted_at, likes, comments, reach, impressions, saved, shares")
      .eq("instagram_account_id", igAccount.id)
      .gte("posted_at", cutoff)
      .gt("reach", 0)
      .order("reach", { ascending: false })
      .limit(20);

    const postsWithRate = (topPostsRaw ?? [])
      .map((p: any) => ({
        id: p.instagram_post_id,
        thumbnailUrl: p.thumbnail_url,
        mediaType: p.media_type,
        permalink: p.permalink,
        postedAt: p.posted_at,
        likes: p.likes ?? 0,
        comments: p.comments ?? 0,
        reach: p.reach ?? 0,
        impressions: p.impressions ?? 0,
        saved: p.saved ?? 0,
        shares: p.shares ?? 0,
        engagementRate: computeEngagementRate(p),
      }))
      .sort((a: { engagementRate: number }, b: { engagementRate: number }) =>
        b.engagementRate - a.engagementRate,
      )
      .slice(0, 5);

    const { data: followerRows } = await db
      .from("instagram_follower_history")
      .select("date, follower_count")
      .eq("instagram_account_id", igAccount.id)
      .gte("date", cutoffDate)
      .order("date", { ascending: true });

    const { data: reachRows } = await db
      .from("instagram_posts")
      .select("posted_at, reach, impressions")
      .eq("instagram_account_id", igAccount.id)
      .gte("posted_at", cutoff)
      .order("posted_at", { ascending: true });

    const reachByDate = new Map<string, { reach: number; impressions: number }>();
    for (const row of reachRows ?? []) {
      const date = (row as any).posted_at.slice(0, 10);
      const existing = reachByDate.get(date) ?? { reach: 0, impressions: 0 };
      existing.reach += (row as any).reach ?? 0;
      existing.impressions += (row as any).impressions ?? 0;
      reachByDate.set(date, existing);
    }

    return json({
      topPosts: postsWithRate,
      followerHistory: (followerRows ?? []).map((r: any) => ({
        date: r.date,
        followerCount: r.follower_count,
      })),
      reachHistory: Array.from(reachByDate.entries())
        .map(([date, val]) => ({ date, reach: val.reach, impressions: val.impressions }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      account: {
        followerCount: igAccount.follower_count,
        followingCount: igAccount.following_count,
        mediaCount: igAccount.media_count,
        reach28d: igAccount.reach_28d,
        impressions28d: igAccount.impressions_28d,
        lastSyncedAt: igAccount.last_synced_at,
      },
      period,
    });
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test supabase/functions/__tests__/hub-dashboard_test.ts --no-check 2>&1 | tail -10`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-dashboard/handler.ts supabase/functions/__tests__/hub-dashboard_test.ts
git commit -m "feat(hub): add hub-dashboard edge function handler with tests"
```

---

### Task 3: Edge function — `hub-dashboard` entry point

**Files:**
- Create: `supabase/functions/hub-dashboard/index.ts`

- [ ] **Step 1: Create the entry point**

Create `supabase/functions/hub-dashboard/index.ts`:

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createHubDashboardHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

Deno.serve(createHubDashboardHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
}));
```

- [ ] **Step 2: Verify the Deno test suite still passes**

Run: `deno test supabase/functions/__tests__/ --no-check 2>&1 | tail -10`
Expected: All tests pass (including the new hub-dashboard tests).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/hub-dashboard/index.ts
git commit -m "feat(hub): add hub-dashboard edge function entry point"
```

---

### Task 4: PeriodSelector component

**Files:**
- Create: `apps/hub/src/components/dashboard/PeriodSelector.tsx`
- Create: `apps/hub/src/components/__tests__/PeriodSelector.test.tsx`

- [ ] **Step 1: Write the test**

Create `apps/hub/src/components/__tests__/PeriodSelector.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PeriodSelector } from '../dashboard/PeriodSelector';

describe('PeriodSelector', () => {
  it('renders all period options and highlights the active one', () => {
    render(<PeriodSelector value={60} onChange={vi.fn()} />);

    const btn30 = screen.getByRole('button', { name: '30d' });
    const btn60 = screen.getByRole('button', { name: '60d' });
    const btn90 = screen.getByRole('button', { name: '90d' });

    expect(btn30).not.toHaveAttribute('data-active', 'true');
    expect(btn60).toHaveAttribute('data-active', 'true');
    expect(btn90).not.toHaveAttribute('data-active', 'true');
  });

  it('calls onChange with the selected period', () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={30} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '90d' }));
    expect(onChange).toHaveBeenCalledWith(90);
  });

  it('does not call onChange when clicking the already active period', () => {
    const onChange = vi.fn();
    render(<PeriodSelector value={30} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: '30d' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run apps/hub/src/components/__tests__/PeriodSelector.test.tsx 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement PeriodSelector**

Create `apps/hub/src/components/dashboard/PeriodSelector.tsx`:

```tsx
const PERIODS = [30, 60, 90] as const;

interface PeriodSelectorProps {
  value: number;
  onChange: (period: number) => void;
}

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div className="flex rounded-lg bg-stone-100 dark:bg-white/[0.06] p-0.5 gap-0.5">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          data-active={p === value ? 'true' : undefined}
          onClick={() => p !== value && onChange(p)}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
            p === value
              ? 'bg-[#eab308] text-stone-900'
              : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
          }`}
        >
          {p}d
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --run apps/hub/src/components/__tests__/PeriodSelector.test.tsx 2>&1 | tail -10`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/dashboard/PeriodSelector.tsx apps/hub/src/components/__tests__/PeriodSelector.test.tsx
git commit -m "feat(hub): add PeriodSelector component with tests"
```

---

### Task 5: TopPostsRow component

**Files:**
- Create: `apps/hub/src/components/dashboard/TopPostsRow.tsx`
- Create: `apps/hub/src/components/__tests__/TopPostsRow.test.tsx`

- [ ] **Step 1: Write the test**

Create `apps/hub/src/components/__tests__/TopPostsRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TopPostsRow } from '../dashboard/TopPostsRow';
import type { DashboardTopPost } from '../../types';

function makePost(overrides: Partial<DashboardTopPost> = {}): DashboardTopPost {
  return {
    id: 'ig-post-1',
    thumbnailUrl: 'https://cdn.ig/thumb.jpg',
    mediaType: 'IMAGE',
    permalink: 'https://instagram.com/p/abc',
    postedAt: '2026-04-10T10:00:00.000Z',
    likes: 120,
    comments: 15,
    reach: 5000,
    impressions: 6000,
    saved: 80,
    shares: 25,
    engagementRate: 4.8,
    ...overrides,
  };
}

describe('TopPostsRow', () => {
  it('renders post cards with metrics', () => {
    render(<TopPostsRow posts={[makePost()]} />);

    expect(screen.getByText('IMAGE')).toBeInTheDocument();
    expect(screen.getByText('4.8%')).toBeInTheDocument();
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('renders links to Instagram', () => {
    render(<TopPostsRow posts={[makePost()]} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://instagram.com/p/abc');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders multiple cards', () => {
    const posts = [
      makePost({ id: '1', engagementRate: 5.0 }),
      makePost({ id: '2', engagementRate: 3.2 }),
      makePost({ id: '3', engagementRate: 2.1 }),
    ];
    render(<TopPostsRow posts={posts} />);

    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('shows empty message when no posts', () => {
    render(<TopPostsRow posts={[]} />);

    expect(screen.getByText(/Nenhum post no período/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run apps/hub/src/components/__tests__/TopPostsRow.test.tsx 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement TopPostsRow**

Create `apps/hub/src/components/dashboard/TopPostsRow.tsx`:

```tsx
import type { DashboardTopPost } from '../../types';

const TIPO_COLORS: Record<string, string> = {
  IMAGE: '#3b82f6',
  VIDEO: '#8b5cf6',
  CAROUSEL_ALBUM: '#10b981',
};

function formatNumber(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

interface TopPostsRowProps {
  posts: DashboardTopPost[];
}

export function TopPostsRow({ posts }: TopPostsRowProps) {
  if (posts.length === 0) {
    return (
      <p className="text-sm text-stone-400 py-4">
        Nenhum post no período selecionado.
      </p>
    );
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
      {posts.map((post) => {
        const color = TIPO_COLORS[post.mediaType] ?? '#6b7280';
        return (
          <a
            key={post.id}
            href={post.permalink}
            target="_blank"
            rel="noopener noreferrer"
            className="min-w-[160px] flex-shrink-0 rounded-2xl overflow-hidden border border-stone-200 dark:border-white/[0.06] bg-white dark:bg-[#1a1e26] transition-transform hover:scale-[1.02]"
          >
            <div
              className="h-[120px] flex items-center justify-center relative"
              style={{
                background: post.thumbnailUrl
                  ? `url(${post.thumbnailUrl}) center/cover no-repeat`
                  : `linear-gradient(135deg, ${color}, ${color}dd)`,
              }}
            >
              {!post.thumbnailUrl && (
                <div className="w-[60px] h-[60px] rounded-lg bg-white/15" />
              )}
              <span className="absolute top-2 left-2 bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold">
                {post.mediaType}
              </span>
            </div>
            <div className="p-3 space-y-1">
              <div className="flex justify-between">
                <span className="text-[11px] text-stone-500 dark:text-stone-400">Alcance</span>
                <span className="text-[11px] font-bold font-mono text-stone-900 dark:text-stone-100">
                  {formatNumber(post.reach)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-stone-500 dark:text-stone-400">Engajamento</span>
                <span className="text-[11px] font-bold font-mono text-emerald-500">
                  {post.engagementRate}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px] text-stone-500 dark:text-stone-400">Salvos</span>
                <span className="text-[11px] font-bold font-mono text-stone-900 dark:text-stone-100">
                  {post.saved}
                </span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --run apps/hub/src/components/__tests__/TopPostsRow.test.tsx 2>&1 | tail -10`
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/dashboard/TopPostsRow.tsx apps/hub/src/components/__tests__/TopPostsRow.test.tsx
git commit -m "feat(hub): add TopPostsRow component with tests"
```

---

### Task 6: FollowerChart component

**Files:**
- Create: `apps/hub/src/components/dashboard/FollowerChart.tsx`

- [ ] **Step 1: Implement FollowerChart**

Create `apps/hub/src/components/dashboard/FollowerChart.tsx`:

```tsx
import { useMemo, useRef, useEffect } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type { DashboardFollowerEntry, DashboardReachEntry } from '../../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

function formatAbbrev(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

interface FollowerChartProps {
  followerHistory: DashboardFollowerEntry[];
  reachHistory: DashboardReachEntry[];
}

export function FollowerChart({ followerHistory, reachHistory }: FollowerChartProps) {
  const canvasRef = useRef<ChartJS<'line'>>(null);

  const postDates = useMemo(
    () => new Set(reachHistory.map((r) => r.date)),
    [reachHistory],
  );

  const labels = followerHistory.map((e) => {
    const [, m, d] = e.date.split('-');
    return `${d}/${m}`;
  });

  const dataPoints = followerHistory.map((e) => e.followerCount);

  const pointRadius = followerHistory.map((e) =>
    postDates.has(e.date) ? 4 : 0,
  );

  const earliest = followerHistory.length > 0 ? followerHistory[0].followerCount : 0;
  const latest = followerHistory.length > 0 ? followerHistory[followerHistory.length - 1].followerCount : 0;
  const delta = earliest > 0 ? Math.round(((latest - earliest) / earliest) * 1000) / 10 : 0;

  const data = {
    labels,
    datasets: [
      {
        data: dataPoints,
        borderColor: '#eab308',
        borderWidth: 2.5,
        pointRadius,
        pointBackgroundColor: '#eab308',
        pointBorderColor: '#1a1e26',
        pointBorderWidth: 2,
        fill: true,
        backgroundColor: (ctx: any) => {
          const chart = ctx.chart;
          const { ctx: canvasCtx, chartArea } = chart;
          if (!chartArea) return 'transparent';
          const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(234, 179, 8, 0.3)');
          gradient.addColorStop(1, 'rgba(234, 179, 8, 0)');
          return gradient;
        },
        tension: 0.3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: any) => `${formatAbbrev(ctx.parsed.y)} seguidores`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: 'DM Mono, monospace', size: 10 },
          color: '#9ca3af',
          maxTicksLimit: 6,
        },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          font: { family: 'DM Mono, monospace', size: 10 },
          color: '#9ca3af',
          callback: (value: number | string) => formatAbbrev(Number(value)),
        },
      },
    },
  };

  if (followerHistory.length === 0) {
    return (
      <div className="hub-card p-5 flex items-center justify-center min-h-[260px]">
        <p className="text-sm text-stone-400">Nenhum dado de seguidores disponível.</p>
      </div>
    );
  }

  return (
    <div className="hub-card p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-4">
        Seguidores
      </h3>
      <div className="h-[180px]">
        <Line ref={canvasRef} data={data} options={options as any} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-lg font-bold text-stone-900 dark:text-stone-100">
          {formatAbbrev(latest)}
        </span>
        {delta !== 0 && (
          <span
            className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${
              delta > 0
                ? 'bg-emerald-500/10 text-emerald-500'
                : 'bg-red-500/10 text-red-500'
            }`}
          >
            {delta > 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build:hub 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/hub/src/components/dashboard/FollowerChart.tsx
git commit -m "feat(hub): add FollowerChart component"
```

---

### Task 7: ReachChart component

**Files:**
- Create: `apps/hub/src/components/dashboard/ReachChart.tsx`

- [ ] **Step 1: Implement ReachChart**

Create `apps/hub/src/components/dashboard/ReachChart.tsx`:

```tsx
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import type { DashboardReachEntry } from '../../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

function formatAbbrev(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

interface ReachChartProps {
  reachHistory: DashboardReachEntry[];
}

export function ReachChart({ reachHistory }: ReachChartProps) {
  const totalReach = reachHistory.reduce((sum, e) => sum + e.reach, 0);

  const labels = reachHistory.map((e) => {
    const [, m, d] = e.date.split('-');
    return `${d}/${m}`;
  });

  const maxReach = Math.max(...reachHistory.map((e) => e.reach), 1);

  const data = {
    labels,
    datasets: [
      {
        data: reachHistory.map((e) => e.reach),
        backgroundColor: reachHistory.map(
          (e) => `rgba(234, 179, 8, ${0.4 + 0.6 * (e.reach / maxReach)})`,
        ),
        borderRadius: 4,
        borderSkipped: false as const,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            const entry = reachHistory[ctx.dataIndex];
            return [
              `Alcance: ${formatAbbrev(entry.reach)}`,
              `Impressões: ${formatAbbrev(entry.impressions)}`,
            ];
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          font: { family: 'DM Mono, monospace', size: 10 },
          color: '#9ca3af',
          maxTicksLimit: 8,
        },
      },
      y: {
        grid: { color: 'rgba(255,255,255,0.04)' },
        ticks: {
          font: { family: 'DM Mono, monospace', size: 10 },
          color: '#9ca3af',
          callback: (value: number | string) => formatAbbrev(Number(value)),
        },
      },
    },
  };

  if (reachHistory.length === 0) {
    return (
      <div className="hub-card p-5 flex items-center justify-center min-h-[260px]">
        <p className="text-sm text-stone-400">Nenhum dado de alcance disponível.</p>
      </div>
    );
  }

  return (
    <div className="hub-card p-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-4">
        Alcance
      </h3>
      <div className="h-[180px]">
        <Bar data={data} options={options as any} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="font-mono text-lg font-bold text-stone-900 dark:text-stone-100">
          {formatAbbrev(totalReach)}
        </span>
        <span className="text-[11px] text-stone-500 dark:text-stone-400">
          total no período
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

Run: `npm run build:hub 2>&1 | head -20`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/hub/src/components/dashboard/ReachChart.tsx
git commit -m "feat(hub): add ReachChart component"
```

---

### Task 8: DashboardSection container component

**Files:**
- Create: `apps/hub/src/components/dashboard/DashboardSection.tsx`
- Create: `apps/hub/src/components/__tests__/DashboardSection.test.tsx`

- [ ] **Step 1: Write the test**

Create `apps/hub/src/components/__tests__/DashboardSection.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardSection } from '../dashboard/DashboardSection';
import type { HubDashboardResponse } from '../../types';

vi.mock('../../HubContext', () => ({
  useHub: () => ({ token: 'test-token' }),
}));

const mockResponse: HubDashboardResponse = {
  topPosts: [
    {
      id: 'ig-1',
      thumbnailUrl: null,
      mediaType: 'IMAGE',
      permalink: 'https://instagram.com/p/abc',
      postedAt: '2026-04-10T10:00:00.000Z',
      likes: 120,
      comments: 15,
      reach: 5000,
      impressions: 6000,
      saved: 80,
      shares: 25,
      engagementRate: 4.8,
    },
  ],
  followerHistory: [
    { date: '2026-03-18', followerCount: 14000 },
    { date: '2026-04-17', followerCount: 15300 },
  ],
  reachHistory: [
    { date: '2026-04-10', reach: 5000, impressions: 6000 },
  ],
  account: {
    followerCount: 15300,
    followingCount: 892,
    mediaCount: 42,
    reach28d: 89000,
    impressions28d: 120000,
    lastSyncedAt: '2026-04-17T10:00:00.000Z',
  },
  period: 30,
};

const emptyResponse: HubDashboardResponse = {
  topPosts: [],
  followerHistory: [],
  reachHistory: [],
  account: null,
  period: 30,
};

function renderWithQuery(fetchFn: () => Promise<HubDashboardResponse>) {
  vi.doMock('../../api', () => ({
    fetchDashboard: fetchFn,
  }));

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardSection />
    </QueryClientProvider>,
  );
}

describe('DashboardSection', () => {
  it('renders dashboard content when data is available', async () => {
    renderWithQuery(() => Promise.resolve(mockResponse));

    await waitFor(() => {
      expect(screen.getByText('Desempenho')).toBeInTheDocument();
    });

    expect(screen.getByText('Melhores Posts')).toBeInTheDocument();
  });

  it('shows empty state when no Instagram account is linked', async () => {
    renderWithQuery(() => Promise.resolve(emptyResponse));

    await waitFor(() => {
      expect(screen.getByText(/Conecte o Instagram/)).toBeInTheDocument();
    });
  });

  it('hides dashboard section on error', async () => {
    renderWithQuery(() => Promise.reject(new Error('network error')));

    await waitFor(() => {
      expect(screen.queryByText('Desempenho')).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- --run apps/hub/src/components/__tests__/DashboardSection.test.tsx 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement DashboardSection**

Create `apps/hub/src/components/dashboard/DashboardSection.tsx`:

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useHub } from '../../HubContext';
import { fetchDashboard } from '../../api';
import { PeriodSelector } from './PeriodSelector';
import { TopPostsRow } from './TopPostsRow';
import { FollowerChart } from './FollowerChart';
import { ReachChart } from './ReachChart';

export function DashboardSection() {
  const { token } = useHub();
  const [period, setPeriod] = useState(30);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['hub-dashboard', token, period],
    queryFn: () => fetchDashboard(token, period),
    staleTime: 5 * 60 * 1000,
  });

  if (isError) return null;

  if (isLoading) {
    return (
      <div className="mb-12">
        <div className="flex justify-between items-center mb-5">
          <div className="h-7 w-36 rounded-lg bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
          <div className="h-8 w-32 rounded-lg bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
        </div>
        <div className="flex gap-3 mb-6">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="min-w-[160px] h-[220px] rounded-2xl bg-stone-200 dark:bg-white/[0.06] animate-pulse flex-shrink-0" />
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-[280px] rounded-2xl bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
          <div className="h-[280px] rounded-2xl bg-stone-200 dark:bg-white/[0.06] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (!data.account) {
    return (
      <div className="mb-12 hub-card p-8 text-center">
        <p className="text-sm text-stone-400">
          Conecte o Instagram para ver métricas de desempenho.
        </p>
      </div>
    );
  }

  return (
    <div className="mb-12">
      <div className="flex justify-between items-center mb-5">
        <h2 className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">
          Desempenho
        </h2>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      <div className="mb-6">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400 mb-3">
          Melhores Posts
        </h3>
        <TopPostsRow posts={data.topPosts} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FollowerChart
          followerHistory={data.followerHistory}
          reachHistory={data.reachHistory}
        />
        <ReachChart reachHistory={data.reachHistory} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- --run apps/hub/src/components/__tests__/DashboardSection.test.tsx 2>&1 | tail -10`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components/dashboard/DashboardSection.tsx apps/hub/src/components/__tests__/DashboardSection.test.tsx
git commit -m "feat(hub): add DashboardSection container component with tests"
```

---

### Task 9: Integrate DashboardSection into HomePage

**Files:**
- Modify: `apps/hub/src/pages/HomePage.tsx`

- [ ] **Step 1: Add the import and render DashboardSection**

In `apps/hub/src/pages/HomePage.tsx`, add the import at the top:

```typescript
import { DashboardSection } from '../components/dashboard/DashboardSection';
```

Then insert `<DashboardSection />` between the hero section and the section cards grid. The modified return should be:

```tsx
  return (
    <div className="hub-fade-up">
      {/* Hero */}
      <div className="mb-10 sm:mb-12">
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          {bootstrap.workspace.name}
        </p>
        <h1 className="font-display text-[2.25rem] sm:text-[2.75rem] leading-[1.05] font-medium tracking-tight text-stone-900">
          Olá, <span className="italic font-normal">{firstName}</span>
          <span className="ml-2 inline-block">👋</span>
        </h1>
      </div>

      {/* Dashboard */}
      <DashboardSection />

      {/* Section cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-12">
        {SECTIONS.map(({ label, icon: Icon, path, description }, idx) => {
          const isPendente = path === '/aprovacoes' && pendingCount > 0;
          return (
            <button
              key={path}
              onClick={() => navigate(`${base}${path}`)}
              style={{ animationDelay: `${idx * 60}ms` }}
              className="hub-card hub-card-hover hub-fade-up relative flex flex-col items-start text-left p-5 sm:p-6 gap-4 group"
            >
              {isPendente && (
                <span className="absolute top-3 right-3 flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 dark:bg-red-500 text-white text-[11px] font-semibold leading-none">
                  {pendingCount}
                </span>
              )}
              <span className="flex items-center justify-center w-11 h-11 rounded-lg bg-stone-100 text-stone-700 group-hover:bg-[#FFBF30]/20 group-hover:text-stone-900 transition-colors">
                <Icon size={20} strokeWidth={1.75} />
              </span>
              <div className="space-y-1">
                <span className="block font-display text-[17px] font-semibold tracking-tight text-stone-900 leading-tight">
                  {label}
                </span>
                <span className="block text-[12.5px] text-stone-500 leading-snug">
                  {description}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : (
        <PostCalendar posts={posts} />
      )}
    </div>
  );
```

- [ ] **Step 2: Typecheck the build**

Run: `npm run build:hub 2>&1 | tail -10`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Run the full Hub test suite**

Run: `npm run test -- --run apps/hub/ 2>&1 | tail -15`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/hub/src/pages/HomePage.tsx
git commit -m "feat(hub): integrate DashboardSection into Home page"
```

---

### Task 10: Visual verification

**Files:** None (manual testing)

- [ ] **Step 1: Start the Hub dev server**

Run: `npm run dev:hub`
Open browser to `http://localhost:5175`

- [ ] **Step 2: Test with a client that has Instagram linked**

Navigate to a valid hub URL (`/:workspace/hub/:token`). Verify:
- Dashboard section appears between hero and section cards
- Period selector shows 30d/60d/90d and toggling refetches data
- Top posts row shows cards with thumbnails, metrics, and links
- Follower chart renders a line chart with gradient fill
- Reach chart renders a bar chart
- Charts are side-by-side on desktop, stacked on mobile (resize browser)
- Clicking a top post card opens Instagram in a new tab

- [ ] **Step 3: Test with a client that has no Instagram linked**

Navigate to a hub URL for a client without Instagram. Verify:
- Empty state message "Conecte o Instagram para ver métricas de desempenho" appears
- No charts or post cards rendered
- Rest of the page (cards, calendar) works normally

- [ ] **Step 4: Test loading state**

Throttle network in DevTools to Slow 3G. Reload the page. Verify:
- Skeleton placeholders appear for the dashboard while loading
- No layout shift when data loads

- [ ] **Step 5: Run the full Deno edge function test suite**

Run: `deno test supabase/functions/__tests__/ --no-check 2>&1 | tail -15`
Expected: All tests pass, including the new hub-dashboard tests.

- [ ] **Step 6: Final commit with any fixes**

If any visual/behavior fixes were needed, commit them:

```bash
git add -A
git commit -m "fix(hub): polish dashboard visual details"
```
