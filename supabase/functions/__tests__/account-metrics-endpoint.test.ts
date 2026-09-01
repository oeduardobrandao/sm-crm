import { assertEquals } from "./assert.ts";
import {
  handleAccountMetrics,
  type AccountMetricsDeps,
} from "../instagram-analytics/account-metrics.ts";

// --- Fakes ------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// Generic mock query-builder chain: supports the eq/gte/lte + order/maybeSingle
// shapes the handler actually issues against instagram_account_metrics_monthly,
// instagram_account_metrics_daily and instagram_follower_history. Mirrors the
// mocking style already used for handleGetMrr in platform-admin-mrr_test.ts.
function chain(rows: Row[]) {
  let filtered = rows;
  const builder = {
    eq(field: string, val: unknown) {
      filtered = filtered.filter((r) => r[field] === val);
      return builder;
    },
    gte(field: string, val: string) {
      filtered = filtered.filter((r) => r[field] >= val);
      return builder;
    },
    lte(field: string, val: string) {
      filtered = filtered.filter((r) => r[field] <= val);
      return builder;
    },
    order(field: string) {
      const sorted = [...filtered].sort((a, b) => (a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0));
      return Promise.resolve({ data: sorted, error: null });
    },
    maybeSingle() {
      return Promise.resolve({ data: filtered[0] ?? null, error: null });
    },
  };
  return builder;
}

function makeDb(data: { monthly?: Row[]; daily?: Row[]; follower?: Row[] }) {
  return {
    from(table: string) {
      if (table === "instagram_account_metrics_monthly") return { select: () => chain(data.monthly ?? []) };
      if (table === "instagram_account_metrics_daily") return { select: () => chain(data.daily ?? []) };
      if (table === "instagram_follower_history") return { select: () => chain(data.follower ?? []) };
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function unreachableDb() {
  return {
    from(table: string) {
      throw new Error(`db should not be queried (table: ${table})`);
    },
  };
}

function unreachableFetch(): typeof fetch {
  return (() => {
    throw new Error("fetch should not be called");
  }) as unknown as typeof fetch;
}

const NOW_MS = Date.parse("2026-08-31T18:00:00Z");

function baseDeps(overrides: Partial<AccountMetricsDeps> = {}): AccountMetricsDeps {
  return {
    db: unreachableDb(),
    fetch: unreachableFetch(),
    account: { id: "acc-1" },
    accessToken: "tok",
    nowMs: NOW_MS,
    ...overrides,
  };
}

// Fake Graph fetch: branches per metric + `since`, so a test can give the
// current window and the previous window different canned values.
function fakeGraphFetch(byWindow: Record<string, Record<string, number>>): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const metric = url.searchParams.get("metric")!;
    const since = url.searchParams.get("since")!;
    const values = byWindow[since] ?? {};

    if (metric === "follows_and_unfollows") {
      const follows = values.follows ?? 0;
      const unfollows = values.unfollows ?? 0;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{
              name: "follows_and_unfollows",
              total_value: {
                breakdowns: [{
                  results: [
                    { dimension_values: ["FOLLOWER"], value: follows },
                    { dimension_values: ["NON_FOLLOWER"], value: unfollows },
                  ],
                }],
              },
            }],
          }),
          { status: 200 },
        ),
      );
    }

    if (values[metric] === undefined) {
      return Promise.resolve(new Response(JSON.stringify({ error: { message: "no data" } }), { status: 200 }));
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ data: [{ name: metric, total_value: { value: values[metric] } }] }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
}

// --- Tests -------------------------------------------------------------------

Deno.test("happy path: current + previous both live, source labels 'live'", async () => {
  const currentSinceSec = String(Date.parse("2026-08-25T00:00:00Z") / 1000);
  const prevSinceSec = String(Date.parse("2026-08-18T00:00:00Z") / 1000);

  const deps = baseDeps({
    db: makeDb({
      follower: [
        { instagram_account_id: "acc-1", date: "2026-08-25", follower_count: 1000 },
        { instagram_account_id: "acc-1", date: "2026-08-31", follower_count: 1050 },
        { instagram_account_id: "acc-1", date: "2026-08-18", follower_count: 950 },
        { instagram_account_id: "acc-1", date: "2026-08-24", follower_count: 990 },
      ],
    }),
    fetch: fakeGraphFetch({
      [currentSinceSec]: {
        reach: 5000, views: 8000, saves: 120, accounts_engaged: 900,
        profile_views: 300, website_clicks: 40, follows: 60, unfollows: 10,
      },
      [prevSinceSec]: {
        reach: 4000, views: 7000, saves: 100, accounts_engaged: 800,
        profile_views: 250, website_clicks: 30, follows: 50, unfollows: 8,
      },
    }),
  });

  const result = await handleAccountMetrics(deps, "2026-08-25", "2026-08-31");
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

  assertEquals(result.body.period, { start: "2026-08-25", end: "2026-08-31", effectiveEnd: "2026-08-31" });
  assertEquals(result.body.current.reach, 5000);
  assertEquals(result.body.current.views, 8000);
  assertEquals(result.body.current.follows_and_unfollows, { follows: 60, unfollows: 10, net: 50 });
  assertEquals(result.body.current.followers, { start: 1000, end: 1050, delta: 50 });
  assertEquals(result.body.source.reach, "live");
  assertEquals(result.body.source.views, "live");
  assertEquals(result.body.source.follows_and_unfollows, "live");

  if (!result.body.previous) throw new Error("expected previous to be non-null");
  assertEquals(result.body.previous.reach, 4000);
  assertEquals(result.body.previous.followers, { start: 950, end: 990, delta: 40 });
});

Deno.test("previous is null when its window is outside retention and has no snapshot data", async () => {
  // current: 2026-06-04..2026-06-10, fully inside the 90d retention window
  // relative to NOW_MS (2026-08-31). previous shifts to 2026-05-28..2026-06-03,
  // which falls (partially) before the retention boundary -> live skipped;
  // with no monthly/daily/follower rows for it either, it must resolve to null.
  const currentSinceSec = String(Date.parse("2026-06-04T00:00:00Z") / 1000);

  const deps = baseDeps({
    db: makeDb({}),
    fetch: fakeGraphFetch({
      [currentSinceSec]: {
        reach: 100, views: 200, saves: 10, accounts_engaged: 90,
        profile_views: 20, website_clicks: 5, follows: 8, unfollows: 1,
      },
    }),
  });

  const result = await handleAccountMetrics(deps, "2026-06-04", "2026-06-10");
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  assertEquals(result.body.current.reach, 100);
  assertEquals(result.body.previous, null);
});

Deno.test("end is inclusive: a historical 3-day range ending on the 31st sums all 3 days", async () => {
  // Fully outside the 90d retention window relative to NOW_MS -> live is
  // skipped entirely; the day-sum can only match if 2026-01-31 (the `end`
  // day) is included in the expected-days coverage check.
  const deps = baseDeps({
    db: makeDb({
      daily: [
        { instagram_account_id: "acc-1", snapshot_date: "2026-01-29", views_day: 5 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-01-30", views_day: 6 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-01-31", views_day: 7 },
      ],
    }),
  });

  const result = await handleAccountMetrics(deps, "2026-01-29", "2026-01-31");
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  assertEquals(result.body.current.views, 18);
  assertEquals(result.body.source.views, "snapshot");
});

Deno.test("historical range exactly one calendar month, outside retention, monthly row present -> 200 snapshot (never a range error)", async () => {
  const deps = baseDeps({
    db: makeDb({
      monthly: [{
        instagram_account_id: "acc-1",
        month: "2026-01-01",
        reach_month: 1000, views_month: 2000, saves_month: 50, accounts_engaged_month: 900,
        profile_views_month: 80, website_clicks_month: 12, follows_month: 40, unfollows_month: 10,
      }],
    }),
  });

  const result = await handleAccountMetrics(deps, "2026-01-01", "2026-01-31");
  if (!result.ok) throw new Error(`expected 200 snapshot, got range error: ${(result as { error: string }).error}`);
  assertEquals(result.body.current.reach, 1000);
  assertEquals(result.body.current.views, 2000);
  assertEquals(result.body.current.accounts_engaged, 900);
  assertEquals(result.body.current.follows_and_unfollows, { follows: 40, unfollows: 10, net: 30 });
  assertEquals(result.body.source.reach, "snapshot");
  assertEquals(result.body.source.accounts_engaged, "snapshot");
  assertEquals(result.body.source.views, "snapshot");
});

Deno.test("a reach outside retention with NO monthly row and non-calendar-month range never day-sums (unique metric)", async () => {
  const deps = baseDeps({
    db: makeDb({
      daily: [
        { instagram_account_id: "acc-1", snapshot_date: "2026-01-29", reach_day: 10 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-01-30", reach_day: 20 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-01-31", reach_day: 30 },
      ],
    }),
  });

  const result = await handleAccountMetrics(deps, "2026-01-29", "2026-01-31");
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  assertEquals(result.body.current.reach, null);
  assertEquals(result.body.source.reach, null);
});

Deno.test("source labels: one metric fails live, falls back to snapshot day-sum while others stay live", async () => {
  const currentSinceSec = String(Date.parse("2026-08-25T00:00:00Z") / 1000);
  const deps = baseDeps({
    db: makeDb({
      daily: [
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-25", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-26", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-27", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-28", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-29", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-30", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-31", views_day: 100 },
      ],
    }),
    fetch: fakeGraphFetch({
      // `views` deliberately omitted -> Graph returns an error for it,
      // fetchAccountTotals normalizes that single metric to null.
      [currentSinceSec]: {
        reach: 5000, saves: 120, accounts_engaged: 900, profile_views: 300, website_clicks: 40,
        follows: 60, unfollows: 10,
      },
    }),
  });

  const result = await handleAccountMetrics(deps, "2026-08-25", "2026-08-31");
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  assertEquals(result.body.source.reach, "live");
  assertEquals(result.body.source.views, "snapshot");
  assertEquals(result.body.current.views, 700);
});

Deno.test("followers: fewer than 2 points within the window resolves to null", async () => {
  const deps = baseDeps({
    db: makeDb({ follower: [{ instagram_account_id: "acc-1", date: "2026-01-15", follower_count: 500 }] }),
  });
  const result = await handleAccountMetrics(deps, "2026-01-01", "2026-01-31");
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  assertEquals(result.body.current.followers, null);
});

Deno.test("comparison window derives from effectiveEnd, not the raw future end", async () => {
  // request end is 2026-09-05, 5 days past "today" (2026-08-31 per NOW_MS).
  // effectiveEnd clamps current to 2026-08-25..2026-08-31 (7 days). previous
  // MUST be sized off that same 7-day span (2026-08-18..2026-08-24), not off
  // the raw 12-day request span -- a stale lenDays would look for previous
  // daily rows over 2026-08-13..2026-08-24 (12 days) instead, and the day-sum
  // guard (rows.length !== expectedDays.length) would flip the result to null.
  const currentSinceSec = String(Date.parse("2026-08-25T00:00:00Z") / 1000);

  const deps = baseDeps({
    db: makeDb({
      daily: [
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-18", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-19", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-20", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-21", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-22", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-23", views_day: 100 },
        { instagram_account_id: "acc-1", snapshot_date: "2026-08-24", views_day: 100 },
      ],
      follower: [
        { instagram_account_id: "acc-1", date: "2026-08-25", follower_count: 1000 },
        { instagram_account_id: "acc-1", date: "2026-08-31", follower_count: 1050 },
        // beyond effectiveEnd -- must NOT be picked up as the window's "last" point
        { instagram_account_id: "acc-1", date: "2026-09-03", follower_count: 9999 },
      ],
    }),
    // Only the current window's since-key resolves; the previous window's
    // fetch returns "no data" for every simple metric, forcing it through
    // the daily snapshot chain where the length check actually bites.
    fetch: fakeGraphFetch({
      [currentSinceSec]: {
        reach: 5000, views: 8000, saves: 120, accounts_engaged: 900,
        profile_views: 300, website_clicks: 40, follows: 60, unfollows: 10,
      },
    }),
  });

  const result = await handleAccountMetrics(deps, "2026-08-25", "2026-09-05");
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);

  assertEquals(result.body.period, { start: "2026-08-25", end: "2026-09-05", effectiveEnd: "2026-08-31" });
  // followers window bounded by effectiveEnd, not the raw future end
  assertEquals(result.body.current.followers, { start: 1000, end: 1050, delta: 50 });

  if (!result.body.previous) throw new Error("expected previous to be non-null (7-day daily sum)");
  assertEquals(result.body.previous.views, 700);
});

Deno.test("invalid ranges return a 400 without touching db/fetch", async () => {
  const deps = baseDeps();

  const missing = await handleAccountMetrics(deps, "", "2026-08-31");
  assertEquals(missing.ok, false);

  const badFormat = await handleAccountMetrics(deps, "2026-08-01", "31-08-2026");
  assertEquals(badFormat.ok, false);

  const inverted = await handleAccountMetrics(deps, "2026-08-31", "2026-08-01");
  assertEquals(inverted.ok, false);

  const future = await handleAccountMetrics(deps, "2027-01-01", "2027-01-31");
  assertEquals(future.ok, false);

  const tooLarge = await handleAccountMetrics(deps, "2020-01-01", "2026-08-31");
  assertEquals(tooLarge.ok, false);
});
