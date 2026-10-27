import { assert, assertEquals } from "./assert.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createBlogSearchConsoleHandler } from "../blog-search-console-cron/handler.ts";
import { backfillChunks, backfillHorizon } from "../blog-search-console-cron/logic.ts";

const SECRET = "cron-secret";
const NOW = new Date("2026-10-27T12:00:00Z");
const SITE = "sc-domain:mesaas.com.br";
const SEARCH_URL = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE)}/searchAnalytics/query`;
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";
const GOOGLE_ERROR_TEXT = "SECRET-GOOGLE-ERROR-TEXT";

// Pacific yesterday of NOW is 2026-10-26, so the refresh window is 10-17..10-26 and, with no
// cursor, the backfill starts at the 30 days ending 2026-10-16.
const REFRESH = { from: "2026-10-17", to: "2026-10-26" };
const CHUNKS = backfillChunks("2026-10-17", backfillHorizon(NOW));

interface FakeDbOpts {
  cursor?: string | null;
  liveRows?: Array<{ slug: string; date: string | null }>;
  checkedRows?: Array<{ slug: string; checked_at: string }>;
}

function fakeDb(opts: FakeDbOpts = {}) {
  const rpc: Array<{ fn: string; args: { p_from: string; p_to: string; p_rows: unknown[] } }> = [];
  const inserts: Array<{ table: string; row: unknown }> = [];
  const updates: Array<{ table: string; values: Record<string, unknown>; col: string; val: unknown }> = [];
  const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const liveRows = opts.liveRows ?? [{ slug: "post-a", date: null }, { slug: "post-b", date: null }];

  const db = {
    rpc(fn: string, args: never) {
      rpc.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    },
    from(table: string) {
      return {
        insert(row: unknown) {
          inserts.push({ table, row });
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 7 }, error: null }) }) };
        },
        update(values: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              updates.push({ table, values, col, val });
              return Promise.resolve({ error: null });
            },
          };
        },
        upsert(row: Record<string, unknown>) {
          upserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        select() {
          const result = () => {
            if (table === "blog_posts") return { data: liveRows, error: null };
            if (table === "blog_index_status") return { data: opts.checkedRows ?? [], error: null };
            return { data: null, error: null };
          };
          const q = {
            in: () => q,
            eq: () => q,
            maybeSingle: () => Promise.resolve({ data: { backfill_before: opts.cursor ?? null }, error: null }),
            then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
              Promise.resolve(result()).then(resolve, reject),
          };
          return q;
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, rpc, inserts, updates, upserts };
}

interface GoogleRequest {
  url: string;
  auth: string | null;
  body: Record<string, unknown>;
}

type Responder = (req: GoogleRequest) => Response | undefined;

function fakeFetch(responders: Responder[] = []) {
  const requests: GoogleRequest[] = [];
  const impl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req: GoogleRequest = {
      url: String(input),
      auth: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body ?? "{}")),
    };
    requests.push(req);
    for (const r of responders) {
      const res = r(req);
      if (res) return Promise.resolve(res);
    }
    if (req.url === SEARCH_URL) return Promise.resolve(Response.json({}));
    if (req.url === INSPECT_URL) {
      return Promise.resolve(Response.json({ inspectionResult: { indexStatusResult: { verdict: "PASS" } } }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  }) as typeof fetch;
  return { fetch: impl, requests };
}

function build(
  db: SupabaseClient,
  f: ReturnType<typeof fakeFetch>,
  over: Partial<Parameters<typeof createBlogSearchConsoleHandler>[0]> = {},
) {
  const failures: string[] = [];
  const handler = createBlogSearchConsoleHandler({
    db,
    cronSecret: SECRET,
    getToken: () => Promise.resolve("tok"),
    fetch: f.fetch,
    now: () => NOW,
    siteUrl: SITE,
    reportFailure: (m) => {
      failures.push(m);
      return Promise.resolve();
    },
    ...over,
  });
  return { handler, failures };
}

const call = (handler: (r: Request) => Promise<Response>, secret: string | null = SECRET) =>
  handler(new Request("http://localhost/blog-search-console-cron", {
    method: "POST",
    headers: secret === null ? {} : { "x-cron-secret": secret },
  }));

const searchRows = (day = "2026-10-20") => [
  { keys: [day, "https://www.mesaas.com.br/blog/post-a"], clicks: 3, impressions: 30, position: 4 },
  { keys: [day, "https://mesaas.com.br/blog/post-a"], clicks: 1, impressions: 10, position: 8 },
];
const searchRespondFor = (startDate: string, res: () => Response): Responder => (req) =>
  req.url === SEARCH_URL && req.body.startDate === startDate ? res() : undefined;
const inspectionFor = (slug: string, res: () => Response): Responder => (req) =>
  req.url === INSPECT_URL && req.body.inspectionUrl === `https://www.mesaas.com.br/blog/${slug}` ? res() : undefined;

Deno.test("401 on a wrong or missing x-cron-secret, with no work done", async () => {
  const d = fakeDb();
  const f = fakeFetch();
  const { handler } = build(d.db, f);
  assertEquals((await call(handler, "nope")).status, 401);
  assertEquals((await call(handler, null)).status, 401);
  assertEquals(f.requests.length, 0);
  assertEquals(d.inserts.length, 0);
  assertEquals(d.rpc.length, 0);
});

Deno.test("not configured: 200 skipped, no fetch and no run row", async () => {
  const d = fakeDb();
  const f = fakeFetch();
  const { handler } = build(d.db, f, { getToken: null });
  const res = await call(handler);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { skipped: "not_configured" });
  assertEquals(f.requests.length, 0);
  assertEquals(d.inserts.length, 0);
  assertEquals(d.updates.length, 0);
});

Deno.test("happy path: refresh, four backfill chunks, cursor, inspections and run closed ok", async () => {
  const d = fakeDb();
  const f = fakeFetch([
    searchRespondFor(REFRESH.from, () => Response.json({ rows: searchRows() })),
    inspectionFor("post-a", () =>
      Response.json({
        inspectionResult: {
          inspectionResultLink: "https://search.google.com/search-console/inspect?x=1",
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
            lastCrawlTime: "2026-10-25T08:00:00Z",
            googleCanonical: "https://www.mesaas.com.br/blog/post-a",
          },
        },
      })),
  ]);
  const { handler } = build(d.db, f);
  const res = await call(handler);
  assertEquals(res.status, 200);

  // The run row is opened first and closed ok at the end.
  assertEquals(d.inserts, [{ table: "blog_search_runs", row: {} }]);
  const close = d.updates.filter((u) => u.table === "blog_search_runs");
  assertEquals(close.length, 1);
  assertEquals(close[0].values.ok, true);
  assertEquals(close[0].col, "id");
  assertEquals(close[0].val, 7);
  assert(typeof close[0].values.finished_at === "string");

  // Refresh query: exact body, token and encoded site URL.
  const first = f.requests[0];
  assertEquals(first.url, SEARCH_URL);
  assertEquals(first.auth, "Bearer tok");
  assertEquals(first.body, {
    startDate: REFRESH.from,
    endDate: REFRESH.to,
    dimensions: ["date", "page"],
    dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: "/blog/" }] }],
    rowLimit: 25000,
    startRow: 0,
  });

  // One refresh replace then four backfill replaces; hosts folded into one row.
  assertEquals(d.rpc.length, 5);
  assertEquals(d.rpc[0].fn, "blog_search_replace");
  assertEquals(d.rpc[0].args, {
    p_from: REFRESH.from,
    p_to: REFRESH.to,
    p_rows: [{ slug: "post-a", day: "2026-10-20", clicks: 4, impressions: 40, position: 5 }],
  });
  assertEquals(CHUNKS.length, 4);
  assertEquals(
    d.rpc.slice(1).map((c) => ({ from: c.args.p_from, to: c.args.p_to })),
    CHUNKS,
  );

  // Cursor moved after each chunk and ends at the last chunk's start.
  const cursor = d.updates.filter((u) => u.table === "blog_search_state");
  assertEquals(cursor.map((u) => u.values.backfill_before), CHUNKS.map((c) => c.from));

  // Inspection: canonical URL + site, upserted rows, Google-hosted link kept.
  const inspect = f.requests.filter((r) => r.url === INSPECT_URL);
  const a = inspect.find((r) => r.body.inspectionUrl === "https://www.mesaas.com.br/blog/post-a");
  assertEquals(a?.body, { inspectionUrl: "https://www.mesaas.com.br/blog/post-a", siteUrl: SITE });
  assertEquals(d.upserts.length, inspect.length);
  const rowA = d.upserts.find((u) => u.row.slug === "post-a")!;
  assertEquals(rowA.table, "blog_index_status");
  assertEquals(rowA.row.verdict, "PASS");
  assertEquals(rowA.row.coverage_state, "Submitted and indexed");
  assertEquals(rowA.row.last_crawl_time, "2026-10-25T08:00:00Z");
  assertEquals(rowA.row.google_canonical, "https://www.mesaas.com.br/blog/post-a");
  assertEquals(rowA.row.inspection_link, "https://search.google.com/search-console/inspect?x=1");
  assertEquals(rowA.row.checked_at, NOW.toISOString());
  assert(d.upserts.some((u) => u.row.slug === "post-b"));
});

Deno.test("an existing cursor resumes from it; a finished backfill does no backfill queries", async () => {
  const resumed = fakeDb({ cursor: "2026-06-19" });
  const f1 = fakeFetch();
  const r1 = await call(build(resumed.db, f1).handler);
  assertEquals(r1.status, 200);
  assertEquals(resumed.rpc[1].args.p_to, "2026-06-18");

  const done = fakeDb({ cursor: backfillHorizon(NOW) });
  const f2 = fakeFetch();
  const r2 = await call(build(done.db, f2).handler);
  assertEquals(r2.status, 200);
  assertEquals(done.rpc.length, 1); // refresh only
  assertEquals(done.updates.filter((u) => u.table === "blog_search_state").length, 0);
});

Deno.test("a failing backfill chunk keeps earlier chunks, leaves the cursor and the run ok", async () => {
  const d = fakeDb();
  const f = fakeFetch([searchRespondFor(CHUNKS[2].from, () => new Response(GOOGLE_ERROR_TEXT, { status: 500 }))]);
  const { handler, failures } = build(d.db, f);
  const res = await call(handler);
  assertEquals(res.status, 200);
  assertEquals(d.rpc.length, 3); // refresh + chunks 1 and 2
  const cursor = d.updates.filter((u) => u.table === "blog_search_state");
  assertEquals(cursor.map((u) => u.values.backfill_before), [CHUNKS[0].from, CHUNKS[1].from]);
  assertEquals(d.updates.find((u) => u.table === "blog_search_runs")?.values.ok, true);
  assertEquals(failures.length, 0);
  assert(d.upserts.length > 0); // inspection still ran
});

Deno.test("an inspection 429 for one slug does not stop the others", async () => {
  const d = fakeDb();
  const f = fakeFetch([inspectionFor("post-a", () => new Response(GOOGLE_ERROR_TEXT, { status: 429 }))]);
  const { handler } = build(d.db, f);
  const res = await call(handler);
  assertEquals(res.status, 200);
  assert(!d.upserts.some((u) => u.row.slug === "post-a"));
  assert(d.upserts.some((u) => u.row.slug === "post-b"));
  assertEquals(d.updates.find((u) => u.table === "blog_search_runs")?.values.ok, true);
});

Deno.test("an inspection link outside search.google.com is stored as null", async () => {
  const d = fakeDb({ liveRows: [{ slug: "post-a", date: null }, { slug: "post-b", date: null }] });
  const f = fakeFetch([
    inspectionFor("post-a", () =>
      Response.json({ inspectionResult: { inspectionResultLink: "https://evil.example/x", indexStatusResult: {} } })),
    inspectionFor("post-b", () =>
      Response.json({
        inspectionResult: { inspectionResultLink: "https://search.google.com.evil.example/x", indexStatusResult: {} },
      })),
  ]);
  await call(build(d.db, f).handler);
  assertEquals(d.upserts.find((u) => u.row.slug === "post-a")?.row.inspection_link, null);
  assertEquals(d.upserts.find((u) => u.row.slug === "post-b")?.row.inspection_link, null);
});

Deno.test("refresh failure: run ok=false, 500 with a generic body, nothing else attempted", async () => {
  const d = fakeDb();
  const f = fakeFetch([searchRespondFor(REFRESH.from, () => new Response(GOOGLE_ERROR_TEXT, { status: 403 }))]);
  const { handler, failures } = build(d.db, f);
  const res = await call(handler);
  assertEquals(res.status, 500);
  const text = await res.text();
  assertEquals(JSON.parse(text), { error: "Internal server error" });
  assert(!text.includes(GOOGLE_ERROR_TEXT));
  assertEquals(d.rpc.length, 0);
  assertEquals(f.requests.length, 1);
  const close = d.updates.find((u) => u.table === "blog_search_runs")!;
  assertEquals(close.values.ok, false);
  assertEquals(close.values.error, "search analytics query failed: 403");
  assertEquals(failures, ["search analytics query failed: 403"]);
});

Deno.test("token failure: run ok=false, 500, no Google call", async () => {
  const d = fakeDb();
  const f = fakeFetch();
  const { handler, failures } = build(d.db, f, {
    getToken: () => Promise.reject(new Error("google token exchange failed: 401")),
  });
  const res = await call(handler);
  assertEquals(res.status, 500);
  assertEquals(f.requests.length, 0);
  const close = d.updates.find((u) => u.table === "blog_search_runs")!;
  assertEquals(close.values.ok, false);
  assertEquals(close.values.error, "google token exchange failed: 401");
  assertEquals(failures.length, 1);
});

Deno.test("a full 25000-row page triggers a second request with startRow 25000", async () => {
  const d = fakeDb();
  const full = Array.from({ length: 25000 }, () => searchRows()[0]);
  const f = fakeFetch([
    (req) => req.url === SEARCH_URL && req.body.startDate === REFRESH.from && req.body.startRow === 0
      ? Response.json({ rows: full })
      : undefined,
    (req) => req.url === SEARCH_URL && req.body.startDate === REFRESH.from && req.body.startRow === 25000
      ? Response.json({ rows: searchRows("2026-10-21") })
      : undefined,
  ]);
  const res = await call(build(d.db, f).handler);
  assertEquals(res.status, 200);
  const refreshReqs = f.requests.filter((r) => r.url === SEARCH_URL && r.body.startDate === REFRESH.from);
  assertEquals(refreshReqs.map((r) => r.body.startRow), [0, 25000]);
  const rows = d.rpc[0].args.p_rows as Array<{ day: string; clicks: number }>;
  assertEquals(rows.map((r) => r.day), ["2026-10-20", "2026-10-21"]);
  assertEquals(rows[0].clicks, 25000 * 3);
});
