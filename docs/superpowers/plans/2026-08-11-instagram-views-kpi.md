# Visualizações (Instagram account views) KPI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Instagram's account-level Views as the first KPI card (before Seguidores) on the account analytics page, backed by a new cached edge-function route.

**Architecture:** A new `GET /views/:clientId` route on the existing `instagram-analytics` Deno edge function fetches the IG user-insights `views` metric for the selected period, chunked into ≤30-day windows and clamped to Instagram's 90-day retention, with a previous-period total for the delta when it fits the window. The CRM adds a `getAccountViews` service function and an independent TanStack query feeding a new first `KpiCard`.

**Tech Stack:** Deno edge function (Supabase), React 19 + TanStack Query, Vitest (jsdom) for the page, `deno test` for helpers.

**Spec:** `docs/superpowers/specs/2026-08-11-instagram-views-kpi-design.md` (approved). Read it before starting.

## Global Constraints

- No em-dashes in any user-facing copy. Exact pt-BR strings are given in the tasks; copy them verbatim.
- Edge functions return generic error messages to clients; details go to server logs only.
- Worktree gotcha: `node_modules` is MISSING here and a worktree silently borrows the parent's. Run `npm ci` inside this worktree before anything else.
- `npm run test:functions` dirties the root `deno.lock`; after Deno test runs, `git checkout -- deno.lock`.
- Branch is `claude/instagram-views-metric-a3fdd2`; commit after each task with the shown messages.
- Prettier is CI-enforced for `apps/**`: run `npx prettier --write <changed app files>` before each commit that touches them.
- No migration is involved anywhere in this plan.

---

### Task 1: Environment prep + pure range/chunk helpers (Deno, TDD)

**Files:**
- Create: `supabase/functions/instagram-analytics/views.ts`
- Create: `supabase/functions/__tests__/instagram-analytics-views_test.ts`

**Interfaces:**
- Consumes: nothing (pure module; only `./assert.ts` in tests).
- Produces (Task 2 relies on these exact signatures):
  - `parseViewsRange(params: URLSearchParams, nowSec: number): { ok: true; range: ViewsRange } | { ok: false; error: string }`
  - `interface ViewsRange { since: number; until: number; partial: boolean; prev: { since: number; until: number } | null }` (unix seconds, half-open `[since, until)`)
  - `chunkRange(since: number, until: number, maxDays?: number): { since: number; until: number }[]`
  - `fetchViewsTotal(fetchFn: typeof fetch, accessToken: string, since: number, until: number): Promise<number>`
  - `sumViewsRange(fetchFn: typeof fetch, accessToken: string, since: number, until: number): Promise<number>`

- [ ] **Step 1: Install dependencies in the worktree**

```bash
npm ci
```

- [ ] **Step 2: Write the failing tests**

Create `supabase/functions/__tests__/instagram-analytics-views_test.ts`. Test names are prefixed `views:` so `--filter views:` selects them. This repo's Deno tests inject `fetchFn` instead of stubbing globals (see `instagram-metrics_test.ts`); follow that pattern.

```ts
import { assert, assertEquals } from "./assert.ts";
import {
  parseViewsRange,
  chunkRange,
  fetchViewsTotal,
  sumViewsRange,
} from "../instagram-analytics/views.ts";

const DAY = 86400;
// Fixed "now": 2026-08-11T00:00:00Z, a stable reference for window math.
const NOW = Date.parse("2026-08-11T00:00:00Z") / 1000;

const params = (q: Record<string, string>) => new URLSearchParams(q);

const okFetch = (value: number) =>
  ((_u: string | URL | Request, _i?: RequestInit) =>
    Promise.resolve({
      json: () =>
        Promise.resolve({ data: [{ name: "views", total_value: { value } }] }),
    } as Response)) as typeof fetch;

Deno.test("views: rejects days and start/end together, and neither", () => {
  assertEquals(parseViewsRange(params({ days: "30", start: "2026-07-01", end: "2026-07-31" }), NOW).ok, false);
  assertEquals(parseViewsRange(params({}), NOW).ok, false);
  assertEquals(parseViewsRange(params({ start: "2026-07-01" }), NOW).ok, false);
});

Deno.test("views: days mode builds [now-30d, now) with adjacent previous window", () => {
  const r = parseViewsRange(params({ days: "30" }), NOW);
  assert(r.ok);
  assertEquals(r.range.until, NOW);
  assertEquals(r.range.since, NOW - 30 * DAY);
  assertEquals(r.range.partial, false);
  assertEquals(r.range.prev, { since: NOW - 60 * DAY, until: NOW - 30 * DAY });
});

Deno.test("views: days=90 fits the window but previous does not", () => {
  const r = parseViewsRange(params({ days: "90" }), NOW);
  assert(r.ok);
  assertEquals(r.range.since, NOW - 90 * DAY);
  assertEquals(r.range.partial, false);
  assertEquals(r.range.prev, null);
});

Deno.test("views: days=365 clamps to 90d, partial, no previous", () => {
  const r = parseViewsRange(params({ days: "365" }), NOW);
  assert(r.ok);
  assertEquals(r.range.since, NOW - 90 * DAY);
  assertEquals(r.range.partial, true);
  assertEquals(r.range.prev, null);
});

Deno.test("views: invalid days values are rejected", () => {
  for (const d of ["0", "731", "abc", "-5"]) {
    assertEquals(parseViewsRange(params({ days: d }), NOW).ok, false, `days=${d}`);
  }
});

Deno.test("views: range mode is inclusive on both calendar days", () => {
  // July 2026: since = Jul 1 00:00Z, until = Aug 1 00:00Z (end day included).
  const r = parseViewsRange(params({ start: "2026-07-01", end: "2026-07-31" }), NOW);
  assert(r.ok);
  assertEquals(r.range.since, Date.parse("2026-07-01T00:00:00Z") / 1000);
  assertEquals(r.range.until, Date.parse("2026-08-01T00:00:00Z") / 1000);
  assertEquals(r.range.partial, false);
  // Previous window: same 31-day length immediately before.
  assertEquals(r.range.prev, {
    since: Date.parse("2026-07-01T00:00:00Z") / 1000 - 31 * DAY,
    until: Date.parse("2026-07-01T00:00:00Z") / 1000,
  });
});

Deno.test("views: reversed range, future start, malformed dates are rejected", () => {
  assertEquals(parseViewsRange(params({ start: "2026-07-31", end: "2026-07-01" }), NOW).ok, false);
  assertEquals(parseViewsRange(params({ start: "2026-09-01", end: "2026-09-10" }), NOW).ok, false);
  assertEquals(parseViewsRange(params({ start: "07/01/2026", end: "2026-07-31" }), NOW).ok, false);
});

Deno.test("views: range entirely older than 90 days is rejected", () => {
  assertEquals(parseViewsRange(params({ start: "2026-01-01", end: "2026-02-01" }), NOW).ok, false);
});

Deno.test("views: chunkRange splits 90 days into three 30-day chunks with shared boundaries", () => {
  const chunks = chunkRange(NOW - 90 * DAY, NOW);
  assertEquals(chunks.length, 3);
  assertEquals(chunks[0], { since: NOW - 90 * DAY, until: NOW - 60 * DAY });
  assertEquals(chunks[1], { since: NOW - 60 * DAY, until: NOW - 30 * DAY });
  assertEquals(chunks[2], { since: NOW - 30 * DAY, until: NOW });
});

Deno.test("views: chunkRange keeps a short range as one chunk", () => {
  assertEquals(chunkRange(NOW - 7 * DAY, NOW), [{ since: NOW - 7 * DAY, until: NOW }]);
});

Deno.test("views: fetchViewsTotal sums the views total_value", async () => {
  assertEquals(await fetchViewsTotal(okFetch(1234), "tok", NOW - DAY, NOW), 1234);
});

Deno.test("views: fetchViewsTotal throws TOKEN_EXPIRED on Graph code 190", async () => {
  const expired = ((_u: string | URL | Request, _i?: RequestInit) =>
    Promise.resolve({
      json: () => Promise.resolve({ error: { code: 190, message: "expired" } }),
    } as Response)) as typeof fetch;
  let thrown: unknown = null;
  try {
    await fetchViewsTotal(expired, "tok", NOW - DAY, NOW);
  } catch (e) {
    thrown = e;
  }
  assertEquals((thrown as { code?: string })?.code, "TOKEN_EXPIRED");
});

Deno.test("views: sumViewsRange adds chunk totals", async () => {
  // 90 days = 3 chunks of 500 each.
  assertEquals(await sumViewsRange(okFetch(500), "tok", NOW - 90 * DAY, NOW), 1500);
});

Deno.test("views: sumViewsRange rejects when any chunk fails", async () => {
  let call = 0;
  const flaky = ((_u: string | URL | Request, _i?: RequestInit) => {
    call++;
    if (call === 2) {
      return Promise.resolve({
        json: () => Promise.resolve({ error: { code: 4, message: "rate limited" } }),
      } as Response);
    }
    return Promise.resolve({
      json: () => Promise.resolve({ data: [{ name: "views", total_value: { value: 500 } }] }),
    } as Response);
  }) as typeof fetch;
  let rejected = false;
  try {
    await sumViewsRange(flaky, "tok", NOW - 90 * DAY, NOW);
  } catch {
    rejected = true;
  }
  assertEquals(rejected, true);
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm run test:functions -- --filter "views:"
```

Expected: FAIL (module `../instagram-analytics/views.ts` not found).

- [ ] **Step 4: Implement `views.ts`**

Create `supabase/functions/instagram-analytics/views.ts`:

```ts
// Period math and Graph fetching for the account-level "views" KPI.
//
// Instagram constraints encoded here: user-insights data is stored for at
// most 90 days, and a single insights call covers at most ~30 days, so
// requested ranges are clamped to the window and fetched in chunks.
// All ranges are half-open [since, until) in unix seconds.

export const VIEWS_WINDOW_DAYS = 90;
export const VIEWS_CHUNK_DAYS = 30;
const DAY = 86400;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ViewsRange {
  since: number;
  until: number;
  partial: boolean;
  prev: { since: number; until: number } | null;
}

export function parseViewsRange(
  params: URLSearchParams,
  nowSec: number,
): { ok: true; range: ViewsRange } | { ok: false; error: string } {
  const days = params.get('days');
  const start = params.get('start');
  const end = params.get('end');

  const hasDays = days !== null;
  const hasRange = start !== null || end !== null;
  if (hasDays === hasRange) return { ok: false, error: 'exactly one of days or start+end is required' };

  let since: number;
  let until: number;

  if (hasDays) {
    const n = parseInt(days!, 10);
    if (isNaN(n) || n < 1 || n > 730) return { ok: false, error: 'days out of range' };
    until = nowSec;
    since = until - n * DAY;
  } else {
    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return { ok: false, error: 'start/end must be YYYY-MM-DD' };
    }
    const startMs = Date.parse(`${start}T00:00:00Z`);
    const endMs = Date.parse(`${end}T00:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { ok: false, error: 'invalid dates' };
    if (startMs > endMs) return { ok: false, error: 'start after end' };
    since = startMs / 1000;
    if (since > nowSec) return { ok: false, error: 'start in the future' };
    // Inclusive end day -> exclusive upper bound at the next midnight.
    until = Math.min(endMs / 1000 + DAY, nowSec);
  }

  const windowStart = nowSec - VIEWS_WINDOW_DAYS * DAY;
  const clamped = Math.max(since, windowStart);
  if (until <= clamped) return { ok: false, error: 'range outside the available window' };
  const partial = clamped > since;
  const len = until - clamped;
  const prevSince = clamped - len;
  const prev = !partial && prevSince >= windowStart ? { since: prevSince, until: clamped } : null;

  return { ok: true, range: { since: clamped, until, partial, prev } };
}

export function chunkRange(
  since: number,
  until: number,
  maxDays = VIEWS_CHUNK_DAYS,
): { since: number; until: number }[] {
  const step = maxDays * DAY;
  const chunks: { since: number; until: number }[] = [];
  for (let s = since; s < until; s += step) {
    chunks.push({ since: s, until: Math.min(s + step, until) });
  }
  return chunks;
}

export async function fetchViewsTotal(
  fetchFn: typeof fetch,
  accessToken: string,
  since: number,
  until: number,
): Promise<number> {
  const url =
    `https://graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day` +
    `&since=${since}&until=${until}&access_token=${accessToken}`;
  const res = await fetchFn(url, { signal: AbortSignal.timeout(10_000) });
  const data = await res.json();
  if (data.error?.code === 190) throw { code: 'TOKEN_EXPIRED', message: 'Instagram token expired' };
  if (data.error) throw new Error(data.error.message || 'Graph API error');
  let total = 0;
  for (const insight of data.data ?? []) {
    if (insight.name === 'views') total += insight.total_value?.value || 0;
  }
  return total;
}

export async function sumViewsRange(
  fetchFn: typeof fetch,
  accessToken: string,
  since: number,
  until: number,
): Promise<number> {
  const totals = await Promise.all(
    chunkRange(since, until).map((c) => fetchViewsTotal(fetchFn, accessToken, c.since, c.until)),
  );
  return totals.reduce((sum, t) => sum + t, 0);
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm run test:functions -- --filter "views:"
git checkout -- deno.lock
```

Expected: all `views:` tests PASS.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/instagram-analytics/views.ts supabase/functions/__tests__/instagram-analytics-views_test.ts
git commit -m "feat(analytics): period math and chunked views fetching helpers"
```

---

### Task 2: `GET /views/:clientId` route on `instagram-analytics`

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts` (the `getCachedOrFetch` helper at ~line 60 and a new route block right after the `/overview` block that ends at ~line 327)

**Interfaces:**
- Consumes (from Task 1): `parseViewsRange`, `sumViewsRange` from `./views.ts`.
- Produces (Task 3 relies on this): `GET {EDGE}/instagram-analytics/views/:clientId` with query `days=N` XOR `start=YYYY-MM-DD&end=YYYY-MM-DD`, plus optional `refresh=1`. Success body: `{ data: { current: number, previous: number | null, partial: boolean }, fromCache: boolean, fetchedAt: string }`. Errors: 400 `{ error: true, message: 'Parâmetros de período inválidos' }`; 401 TOKEN_EXPIRED and generic 500 come from the existing catch block unchanged.

- [ ] **Step 1: Add a cache-read bypass to `getCachedOrFetch`**

In `supabase/functions/instagram-analytics/index.ts`, change the helper signature and guard the read (the write path is untouched, so `refresh=1` still refreshes the stored cache):

```ts
async function getCachedOrFetch<T>(
  serviceClient: any,
  accountId: number,
  cacheKey: string,
  fetchFn: () => Promise<T>,
  maxAgeHours = 6,
  skipCacheRead = false
): Promise<{ data: T; fromCache: boolean; fetchedAt: string }> {
  if (!skipCacheRead) {
    const { data: cached } = await serviceClient
      .from('instagram_analytics_cache')
      .select('data, fetched_at')
      .eq('instagram_account_id', accountId)
      .eq('cache_key', cacheKey)
      .single();

    if (cached && cached.data) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      if (age < maxAgeHours * 60 * 60 * 1000) {
        return { data: cached.data as T, fromCache: true, fetchedAt: cached.fetched_at };
      }
    }
  }

  const freshData = await fetchFn();
  // ... rest of the function is unchanged
```

- [ ] **Step 2: Import the helpers**

Next to the existing `import { UUID_RE } from "./utils.ts";` line add:

```ts
import { parseViewsRange, sumViewsRange } from "./views.ts";
```

- [ ] **Step 3: Add the route**

Insert directly after the `/overview/:clientId` block (after its `return json(result);` and closing `}`), following the same comment-banner style:

```ts
    // ==========================================
    // GET /views/:clientId?days=N | ?start&end (optional refresh=1)
    // Account-level IG "views" total for the period. Ranges are clamped to
    // Instagram's 90-day insights retention; see views.ts.
    // ==========================================
    if (req.method === 'GET' && path.match(/^\/views\/\d+$/)) {
      const clientId = path.split('/')[2];
      await verifyClientOwnership(serviceClient, clientId, contaId);

      const parsed = parseViewsRange(url.searchParams, Math.floor(Date.now() / 1000));
      if (!parsed.ok) {
        console.error('[views] invalid params:', parsed.error, url.search);
        return json({ error: true, message: 'Parâmetros de período inválidos' }, 400);
      }
      const { range } = parsed;

      const { account, accessToken } = await getAccountWithToken(serviceClient, clientId);

      const daysParam = url.searchParams.get('days');
      const cacheKey = daysParam
        ? `views_${daysParam}`
        : `views_${url.searchParams.get('start')}_${url.searchParams.get('end')}`;
      const skipCacheRead = url.searchParams.get('refresh') === '1';

      const result = await getCachedOrFetch(serviceClient, account.id, cacheKey, async () => {
        const current = await sumViewsRange(fetch, accessToken, range.since, range.until);
        const previous = range.prev
          ? await sumViewsRange(fetch, accessToken, range.prev.since, range.prev.until)
          : null;
        return { current, previous, partial: range.partial };
      }, 6, skipCacheRead);

      return json(result);
    }
```

Notes for the implementer:
- Do NOT use the shared `graphFetch` here; `sumViewsRange` carries its own 10s per-call timeout and throws on any failure, which the existing catch block turns into 401 (TOKEN_EXPIRED) or a generic 500 with no cache write.
- The existing catch block's token-expiry handler extracts the clientId from the path with `/\/(\d+)(?:$|\/|\?)/`, which matches `/views/123`, so `authorization_status` upkeep works without changes.
- `feature-guard.ts` needs no change: unlisted paths fall through to the base `feature_instagram` flag.

- [ ] **Step 4: Run the Deno suite**

```bash
npm run test:functions
git checkout -- deno.lock
```

Expected: full suite PASS (no route-level test exists; the logic is covered by Task 1's unit tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts
git commit -m "feat(analytics): GET /views/:clientId route with 90d clamp and cache bypass"
```

---

### Task 3: Frontend service `getAccountViews`

**Files:**
- Modify: `apps/crm/src/services/analytics.ts` (export `makeDelta` at ~line 75; add the type + function near `getAnalyticsOverview` at ~line 487)

**Interfaces:**
- Consumes (from Task 2): the `/views/:clientId` route contract above.
- Produces (Task 4 relies on these exact signatures):
  - `export function makeDelta(current: number, previous: number): KpiDelta` (existing private helper, now exported — implementation unchanged)
  - `export interface AccountViews { current: number; previous: number | null; partial: boolean; fetchedAt: string }`
  - `export async function getAccountViews(clientId: number, days: number, dateRange?: { start: string; end: string }, refresh?: boolean): Promise<AccountViews | null>`

- [ ] **Step 1: Export `makeDelta`**

Change `function makeDelta(` to `export function makeDelta(` (~line 75). Body unchanged.

- [ ] **Step 2: Add the type and service function**

Add `AccountViews` next to the other exported interfaces (after `AnalyticsOverview`), and the function right after `getAnalyticsOverview`:

```ts
export interface AccountViews {
  current: number;
  previous: number | null;
  partial: boolean;
  fetchedAt: string;
}
```

```ts
// Account-level IG "views" for the period, via the edge function (the only
// KPI that needs a live Graph call; see the 2026-08-11 views KPI spec).
export async function getAccountViews(
  clientId: number,
  days: number,
  dateRange?: { start: string; end: string },
  refresh = false,
): Promise<AccountViews | null> {
  const params = new URLSearchParams();
  if (dateRange) {
    params.set('start', dateRange.start);
    params.set('end', dateRange.end);
  } else {
    params.set('days', String(days));
  }
  if (refresh) params.set('refresh', '1');

  const res = await fetchEdge<{
    data: { current: number; previous: number | null; partial: boolean };
    fetchedAt: string;
  }>(`${EDGE_URL}/views/${clientId}?${params}`);
  if (!res?.data) return null;
  return { ...res.data, fetchedAt: res.fetchedAt };
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
npx prettier --write apps/crm/src/services/analytics.ts
git add apps/crm/src/services/analytics.ts
git commit -m "feat(analytics): getAccountViews service for the views KPI"
```

---

### Task 4: Visualizações card on the page (TDD via the page test)

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx` (mock factory ~line 260; `seedCommonAnalyticsData` ~line 259+; new `it` blocks inside the existing `describe('AnalyticsContaPage')`)
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (lucide import ~line 14-24; services import ~line 57-81; `KpiCard` ~line 399-436; queries ~line 1010; `handleSync` ~line 1215; derived values near `periodTag` ~line 1423; KPI grid ~line 1533-1599)

**Interfaces:**
- Consumes (from Task 3): `getAccountViews`, `makeDelta`, `type AccountViews` from `../../services/analytics`.
- Produces: UI only; nothing downstream.

Context for the implementer: the page test mocks `@tanstack/react-query` so `useQuery` returns `queryState[String(queryKey[0])]` and NEVER calls `queryFn` — new queries are driven purely by seeding `queryState`. The `services/analytics` `vi.mock` factory must define every export the page imports.

- [ ] **Step 1: Extend the test file (failing tests first)**

In the `vi.mock('../../../services/analytics', ...)` factory add two entries:

```ts
  getAccountViews: vi.fn(),
  makeDelta: (current: number, previous: number) => ({
    current,
    previous,
    delta: current - previous,
    deltaPercent:
      previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : current > 0 ? 100 : 0,
    direction: current > previous ? 'up' : current < previous ? 'down' : ('stable' as const),
  }),
```

In `seedCommonAnalyticsData()` add:

```ts
  queryState['analytics-views'] = {
    data: { current: 45678, previous: 40000, partial: false, fetchedAt: '2026-04-18T12:00:00Z' },
    isLoading: false,
  };
```

Add two tests inside `describe('AnalyticsContaPage')`:

```tsx
  it('renders the Visualizações card first, before Seguidores', () => {
    seedCommonAnalyticsData();

    const { container } = render(<AnalyticsContaPage />);

    const labels = Array.from(container.querySelectorAll('.kpi-label')).map(
      (el) => el.textContent,
    );
    expect(labels[0]).toBe('Visualizações');
    expect(labels[1]).toBe('Seguidores');
    const card = screen.getByText('Visualizações').closest('.kpi-card');
    expect(card).toHaveTextContent((45678).toLocaleString('pt-BR'));
    expect(card).toHaveTextContent('vs período anterior');
  });

  it('omits the views delta when there is no previous period', () => {
    seedCommonAnalyticsData();
    queryState['analytics-views'] = {
      data: { current: 999999, previous: null, partial: false, fetchedAt: '2026-04-18T12:00:00Z' },
      isLoading: false,
    };

    render(<AnalyticsContaPage />);

    const card = screen.getByText('Visualizações').closest('.kpi-card');
    expect(card).toHaveTextContent((999999).toLocaleString('pt-BR'));
    expect(card).not.toHaveTextContent('vs período anterior');
  });
```

(If the existing tests use different render/`screen` import names, follow the file's conventions; both `render` and `screen` are already imported there.)

- [ ] **Step 2: Run the page test to verify the new tests fail**

```bash
npx vitest run apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
```

Expected: the two new tests FAIL (no `Visualizações` label); every pre-existing test still PASSES. If a pre-existing test fails at this step, stop and investigate before continuing.

- [ ] **Step 3: Implement the page changes**

All in `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`:

**(a)** Add `Play,` to the lucide-react import list (~line 14).

**(b)** In the `../../services/analytics` import block add `getAccountViews,` and `makeDelta,` (and `type AccountViews` is not needed; the query's return type is inferred).

**(c)** Make `KpiCard`'s `delta` optional and add a `sub` passthrough (StatCard's `delta` and `sub` props already exist and are optional):

```tsx
function KpiCard({
  label,
  value,
  delta,
  period,
  prevFormatted,
  icon,
  tone,
  sub,
}: {
  label: string;
  value: string;
  delta?: KpiDelta;
  period?: string;
  prevFormatted?: string;
  icon?: LucideIcon;
  tone?: StatTone;
  sub?: ReactNode;
}) {
  return (
    <StatCard
      label={label}
      value={value}
      icon={icon}
      tone={tone}
      delta={
        delta
          ? {
              direction: delta.direction,
              percent: delta.deltaPercent,
              caption: 'vs período anterior',
            }
          : undefined
      }
      sub={sub}
      footNote={
        <>
          {prevFormatted != null && <span>Anterior: {prevFormatted}</span>}
          {period && <span className="kpi-period-chip">{period}</span>}
        </>
      }
    />
  );
}
```

**(d)** Add the query directly after the `analytics-overview` `useQuery` (~line 1013), plus the ref. `useRef` is already imported.

```tsx
  // Manual sync must bypass the 6h server-side views cache exactly once.
  const viewsForceRefresh = useRef(false);
  const { data: viewsRes, isLoading: loadingViews } = useQuery({
    queryKey: ['analytics-views', clientId, overviewDays, periodStart, periodEnd],
    queryFn: () => {
      const refresh = viewsForceRefresh.current;
      viewsForceRefresh.current = false;
      return getAccountViews(clientId, overviewDays, dateRange, refresh);
    },
  });
```

**(e)** In `handleSync` (~line 1215), before the existing `invalidateQueries` calls add:

```ts
      viewsForceRefresh.current = true;
      qc.invalidateQueries({ queryKey: ['analytics-views', clientId] });
```

**(f)** Next to `const periodTag = periodLabel || \`${overviewDays}d\`;` (~line 1423) add the derived values:

```tsx
  const viewsDelta =
    viewsRes && viewsRes.previous != null ? makeDelta(viewsRes.current, viewsRes.previous) : undefined;
  const viewsValue = loadingViews ? '…' : viewsRes ? viewsRes.current.toLocaleString('pt-BR') : '—';
  const viewsSub = !loadingViews && !viewsRes
    ? 'Indisponível no momento'
    : viewsRes?.partial
      ? 'O Instagram fornece visualizações de no máximo 90 dias.'
      : undefined;
```

**(g)** In the KPI grid (~line 1533): change the comment to `{/* maxCols 8 keeps all eight metrics on a single row */}`, change `maxCols={7}` to `maxCols={8}`, and insert as the FIRST child (before the Seguidores card):

```tsx
        <KpiCard
          label="Visualizações"
          icon={Play}
          tone="violet"
          value={viewsValue}
          delta={viewsDelta}
          period={viewsRes?.partial ? 'máx. 90d' : periodTag}
          prevFormatted={
            viewsRes && viewsRes.previous != null
              ? viewsRes.previous.toLocaleString('pt-BR')
              : undefined
          }
          sub={viewsSub}
        />
```

- [ ] **Step 4: Run the page test to verify everything passes**

```bash
npx vitest run apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
```

Expected: ALL tests PASS (the two new ones and every pre-existing one).

- [ ] **Step 5: Commit**

```bash
npx prettier --write apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
git add apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
git commit -m "feat(analytics): Visualizações account views KPI first on the analytics page"
```

---

### Task 5: Full verification gate + browser check

**Files:** none created; verification only.

- [ ] **Step 1: Run the full local CI gate**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
git status --porcelain
```

Expected: every command clean/passing; `git status` shows no unexpected dirt (`node_modules` and `deno.lock` handling per Global Constraints). If `format:check` fails, run `npm run format` and amend the last commit.

- [ ] **Step 2: Browser verification**

Start the CRM dev server via the preview tools (never Bash) and open an analytics page for a client with a connected Instagram account. The new `/views` route is NOT deployed yet, so the correct observed behavior is the graceful degradation path: the Visualizações card renders FIRST, shows `…` while loading, then `—` with `Indisponível no momento`, and the other 7 KPIs are unaffected. Verify the 8-column grid does not break the layout (desktop ≥1101px and a narrow viewport). Screenshot as proof.

- [ ] **Step 3: Wrap up**

Use the superpowers:finishing-a-development-branch skill to decide integration (push + PR against `main`). PR description must note the deploy order from the spec: deploy `instagram-analytics` (`npx supabase functions deploy instagram-analytics --use-api`) before or right after merge; until then the card shows the unavailable state. Per project memory, re-verify there are no migration-prefix collisions (none expected: this branch adds no migrations) and expect the external Codex review to fire on `gh pr create`.
