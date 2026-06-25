import { assert, assertEquals } from "./assert.ts";
import { getPost, getPerformanceBaseline, listPosts, loadClientRateDistributions } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";
import { McpInputError } from "../_shared/mcp-token.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

// Recording fake Supabase client: chainable methods record their args; `await` /
// maybeSingle pull the next canned response from that table's queue.
function makeFakeDb(responses: Record<string, Resp[]>) {
  const calls: Call[] = [];
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];

  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: [], error: null };
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.single = () => { calls.push({ table, method: "single", args: [] }); return Promise.resolve(next()); };
    rec.maybeSingle = () => { calls.push({ table, method: "maybeSingle", args: [] }); return Promise.resolve(next()); };
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }

  const db = { from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return recorder(t); } };
  return { db, calls };
}

const CTX: McpKeyContext = {
  conta_id: "workspace-A", scopes: ["posts:read"], key_id: "k1", created_by: "user-1",
};

function has(calls: Call[], table: string, method: string, args: unknown[]): boolean {
  return calls.some((c) => c.table === table && c.method === method &&
    JSON.stringify(c.args) === JSON.stringify(args));
}

const postRow = (over: Record<string, unknown> = {}) => ({
  id: 1, workflow_id: 10, titulo: "Post", tipo: "feed", status: "publicado",
  ig_caption: "cap", conteudo_plain: "Linha 1\nLinha 2", created_via: "user",
  instagram_media_id: "m1", instagram_permalink: null,
  scheduled_at: null, published_at: "2026-06-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z",
  ...over,
});

const metricRow = (over: Record<string, unknown> = {}) => ({
  instagram_post_id: "m1", permalink: null,
  reach: 100, saved: 20, shares: 5, comments: 3, likes: 50,
  impressions: 1000, unavailable_metrics: [], media_type: "IMAGE",
  instagram_accounts: { clientes: { conta_id: "workspace-A" } },
  ...over,
});

Deno.test("listPosts: metrics read is scoped through the account chain", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: [postRow()], error: null }],
    instagram_posts: [{ data: [metricRow()], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const out = await listPosts(deps, {});

  // The metric query joins to the account's client and filters on conta_id.
  assert(
    has(calls, "instagram_posts", "eq", ["instagram_accounts.clientes.conta_id", "workspace-A"]),
    "instagram_posts read scoped to the workspace via the account chain",
  );
  assert(
    has(calls, "instagram_posts", "in", ["instagram_post_id", ["m1"]]),
    "looked up by the post's own media id",
  );
  // The happy path still attaches metrics (now PostMetricRow).
  assertEquals(out.length, 1);
  const m = out[0].metrics;
  assertEquals(m?.reach, 100);
  assertEquals(m?.saved, 20);
  assertEquals(m?.shares, 5);
  assertEquals(m?.comments, 3);
  assertEquals(m?.likes, 50);
});

Deno.test("listPosts: no media id / permalink -> no instagram_posts read at all", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: [postRow({ instagram_media_id: null, instagram_permalink: null })], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const out = await listPosts(deps, {});

  assert(!calls.some((c) => c.table === "instagram_posts"), "skips the metric query when there is nothing to join");
  assertEquals(out[0].metrics, null);
});

Deno.test("getPost: metrics read is scoped through the account chain", async () => {
  const { db, calls } = makeFakeDb({
    workflow_posts: [{ data: postRow({ id: 2, instagram_media_id: "m2" }), error: null }],
    instagram_posts: [{ data: [metricRow({ instagram_post_id: "m2", reach: 7, saved: 1, shares: 0, comments: 0, likes: 2 })], error: null }],
  });
  const deps = { db, ctx: CTX, signUrl: (k: string) => Promise.resolve(`signed:${k}`) } as unknown as Deps;

  const out = await getPost(deps, { post_id: 2 });

  assert(
    has(calls, "instagram_posts", "eq", ["instagram_accounts.clientes.conta_id", "workspace-A"]),
    "instagram_posts read scoped to the workspace via the account chain",
  );
  assert(
    has(calls, "instagram_posts", "in", ["instagram_post_id", ["m2"]]),
    "looked up by the post's own media id",
  );
  const m = out.metrics;
  assertEquals(m?.reach, 7);
  assertEquals(m?.saved, 1);
  assertEquals(m?.shares, 0);
  assertEquals(m?.comments, 0);
  assertEquals(m?.likes, 2);
});

// ---- Task 5: rate-aware metric rows + views ----------------------------------

Deno.test("list_posts: row exposes views and four rates from PostMetricRow", async () => {
  const { db } = makeFakeDb({
    workflow_posts: [{ data: [postRow()], error: null }],
    instagram_posts: [{ data: [metricRow({ impressions: 500 })], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const out = await listPosts(deps, {});
  assertEquals(out.length, 1);
  const row = out[0];

  // views comes from impressions
  assertEquals(row.views, 500);

  // four rates should be numeric (impressions > 0)
  assert(typeof row.share_rate === "number", "share_rate is numeric");
  assert(typeof row.like_rate === "number", "like_rate is numeric");
  assert(typeof row.save_rate === "number", "save_rate is numeric");
  assert(typeof row.comment_rate === "number", "comment_rate is numeric");

  // ig_score is null (Task 7 fills it)
  assertEquals(row.ig_score, null);
});

Deno.test("list_posts: unavailable shares -> share_rate null, like_rate numeric", async () => {
  const { db } = makeFakeDb({
    workflow_posts: [{ data: [postRow()], error: null }],
    instagram_posts: [{
      data: [metricRow({
        impressions: 800,
        unavailable_metrics: ["shares"],
        shares: 0,
      })],
      error: null,
    }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const out = await listPosts(deps, {});
  const row = out[0];

  assertEquals(row.share_rate, null, "share_rate null when shares is unavailable");
  assert(typeof row.like_rate === "number", "like_rate still numeric");
  assert(row.like_rate! > 0, "like_rate > 0 (likes=50, impressions=800)");
});

Deno.test("list_posts: no metrics -> all rates null, views null", async () => {
  const { db } = makeFakeDb({
    workflow_posts: [{ data: [postRow({ instagram_media_id: null, instagram_permalink: null })], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const out = await listPosts(deps, {});
  const row = out[0];

  assertEquals(row.views, null);
  assertEquals(row.share_rate, null);
  assertEquals(row.like_rate, null);
  assertEquals(row.save_rate, null);
  assertEquals(row.comment_rate, null);
});

// ---- Task 5: loadClientRateDistributions ------------------------------------

function makeDistFakeDb(accountRows: unknown[], postRows: unknown[]) {
  return makeFakeDb({
    // verifyClient (conta-ownership guard) must pass — seed an owned client.
    clientes: [{ data: { id: 1, especialidade: null, cor: null }, error: null }],
    instagram_accounts: [{ data: accountRows, error: null }],
    instagram_posts: [{ data: postRows, error: null }],
  });
}

const igPost = (over: Record<string, unknown> = {}) => ({
  media_type: "IMAGE",
  reach: 200,
  impressions: 1000,
  saved: 30,
  shares: 10,
  likes: 80,
  comments: 5,
  unavailable_metrics: [],
  ...over,
});

Deno.test("distributions: buckets non-null rates per media_type and overall", async () => {
  const { db } = makeDistFakeDb(
    [{ id: 99 }],
    [
      igPost({ media_type: "IMAGE", impressions: 500, likes: 50, saved: 10, shares: 5, comments: 2 }),
      igPost({ media_type: "VIDEO", impressions: 1000, likes: 100, saved: 20, shares: 8, comments: 4 }),
      igPost({ media_type: "IMAGE", impressions: 400, likes: 40, saved: 8, shares: 3, comments: 1 }),
    ],
  );
  const deps = { db, ctx: CTX } as unknown as Deps;

  const dists = await loadClientRateDistributions(deps, 42);

  assertEquals(dists.sampleSize, 3);

  // overall should have rates for all 3 posts
  assert(dists.overall.like_rate.length === 3, "overall like_rate has 3 entries");
  assert(dists.overall.reach.length === 3, "overall reach has 3 entries");

  // byFormat should bucket correctly
  assert(dists.byFormat["IMAGE"] !== undefined, "IMAGE format bucket exists");
  assert(dists.byFormat["VIDEO"] !== undefined, "VIDEO format bucket exists");
  assertEquals(dists.byFormat["IMAGE"].like_rate.length, 2, "IMAGE has 2 like_rate entries");
  assertEquals(dists.byFormat["VIDEO"].like_rate.length, 1, "VIDEO has 1 like_rate entry");
});

Deno.test("distributions: no accounts -> empty result", async () => {
  const { db } = makeFakeDb({
    clientes: [{ data: { id: 1, especialidade: null, cor: null }, error: null }],
    instagram_accounts: [{ data: [], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const dists = await loadClientRateDistributions(deps, 99);

  assertEquals(dists.sampleSize, 0);
  assertEquals(dists.overall.like_rate, []);
  assertEquals(Object.keys(dists.byFormat).length, 0);
});

Deno.test("distributions: client not owned by workspace -> short-circuits, no leak", async () => {
  // verifyClient miss (data: null) must yield empty buckets WITHOUT touching
  // instagram_accounts / instagram_posts (no cross-tenant read).
  const { db, calls } = makeFakeDb({
    clientes: [{ data: null, error: null }],
    instagram_accounts: [{ data: [{ id: 1 }], error: null }],
    instagram_posts: [{ data: [igPost()], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const dists = await loadClientRateDistributions(deps, 12345);

  assertEquals(dists.sampleSize, 0);
  assertEquals(dists.overall, {
    share_rate: [], like_rate: [], save_rate: [], comment_rate: [], reach: [],
  });
  assertEquals(dists.byFormat, {});

  // Short-circuit: neither downstream table was queried.
  assert(
    !calls.some((c) => c.table === "instagram_accounts"),
    "instagram_accounts not read for a non-owned client",
  );
  assert(
    !calls.some((c) => c.table === "instagram_posts"),
    "instagram_posts not read for a non-owned client",
  );
});

Deno.test("distributions: unavailable reach -> excluded from reach bucket", async () => {
  const { db } = makeDistFakeDb(
    [{ id: 7 }],
    [
      igPost({ media_type: "IMAGE", impressions: 500, reach: 300, unavailable_metrics: [] }),
      igPost({ media_type: "IMAGE", impressions: 600, reach: 0, unavailable_metrics: ["reach"] }),
    ],
  );
  const deps = { db, ctx: CTX } as unknown as Deps;

  const dists = await loadClientRateDistributions(deps, 5);

  // Only the first post's reach should be in the bucket
  assertEquals(dists.overall.reach.length, 1, "reach bucket excludes unavailable rows");
  assertEquals(dists.overall.reach[0], 300);
});

// ---- Task 6: getPerformanceBaseline -> rate-based {n, quartiles} ---------------

// ---- Task 7: ig_score + tiers in get_post/list_posts; sort options ---------------

// Helper: 5 identical ig posts with known rates (impressions=1000, likes=100 => like_rate=0.1)
const igDistPost = (over: Record<string, unknown> = {}) => ({
  media_type: "IMAGE",
  reach: 500,
  impressions: 1000,
  saved: 50,
  shares: 20,
  likes: 100,
  comments: 10,
  unavailable_metrics: [],
  ...over,
});

Deno.test("getPost: ig_score + tiers computed when client has >=5 sample", async () => {
  // Sequence of DB calls in getPost:
  // 1. workflow_posts -> maybeSingle (post)
  // 2. loadPostProps: post_property_values -> then (empty)
  // 3. loadMetrics: instagram_posts -> then (metric, media_id="m10")
  // 4. post_file_links -> then (empty, no media)
  // 5. workflows -> maybeSingle (cliente_id: 99)
  // 6. loadClientRateDistributions:
  //    a. clientes -> maybeSingle (owned)
  //    b. instagram_accounts -> then (account)
  //    c. instagram_posts -> then (5 dist posts)
  const { db } = makeFakeDb({
    workflow_posts: [{ data: postRow({ id: 10, workflow_id: 20, instagram_media_id: "m10" }), error: null }],
    post_property_values: [{ data: [], error: null }],
    instagram_posts: [
      // loadMetrics: the post's own metric
      { data: [metricRow({ instagram_post_id: "m10", impressions: 1000, likes: 100, saved: 50, shares: 20, comments: 10, media_type: "IMAGE" })], error: null },
      // loadClientRateDistributions: 5 historical posts
      {
        data: [
          igDistPost(), igDistPost(), igDistPost(), igDistPost(), igDistPost(),
        ],
        error: null,
      },
    ],
    post_file_links: [{ data: [], error: null }],
    workflows: [{ data: { cliente_id: 99 }, error: null }],
    clientes: [{ data: { id: 99, especialidade: null, cor: null }, error: null }],
    instagram_accounts: [{ data: [{ id: 77 }], error: null }],
  });
  const deps = { db, ctx: CTX, signUrl: (k: string) => Promise.resolve(`signed:${k}`) } as unknown as Deps;

  const out = await getPost(deps, { post_id: 10 });

  assert(out !== null, "post should not be null");
  assert(typeof out.ig_score === "number", `ig_score should be numeric, got ${out.ig_score}`);
  assert(out.ig_score >= 0 && out.ig_score <= 100, `ig_score should be 0-100, got ${out.ig_score}`);
  assert(out.tiers !== null, "tiers should not be null when sample is sufficient");
  // Each tier should be a valid string or null
  for (const key of ["share_rate", "like_rate", "save_rate", "comment_rate"]) {
    const t = out.tiers[key];
    assert(
      t === null || ["top_quartile", "above_median", "below_median", "bottom_quartile"].includes(t),
      `tiers.${key} should be a valid tier string or null, got ${t}`,
    );
  }
});

Deno.test("getPost: ig_score null when no metric row (no media_id)", async () => {
  const { db } = makeFakeDb({
    workflow_posts: [{ data: postRow({ id: 11, workflow_id: 21, instagram_media_id: null, instagram_permalink: null }), error: null }],
    post_property_values: [{ data: [], error: null }],
    post_file_links: [{ data: [], error: null }],
    workflows: [{ data: { cliente_id: 99 }, error: null }],
    // Even with a valid client, no mrow means no scoring
    clientes: [{ data: { id: 99, especialidade: null, cor: null }, error: null }],
    instagram_accounts: [{ data: [{ id: 77 }], error: null }],
    instagram_posts: [
      { data: [], error: null }, // loadMetrics — no matching post
    ],
  });
  const deps = { db, ctx: CTX, signUrl: (k: string) => Promise.resolve(`signed:${k}`) } as unknown as Deps;

  const out = await getPost(deps, { post_id: 11 });

  assert(out !== null, "post should not be null");
  assertEquals(out.ig_score, null, "ig_score null when no metric row");
  assertEquals(out.tiers, null, "tiers null when no metric row");
});

Deno.test("list_posts: ig_score sort without client_id throws McpInputError", async () => {
  const { db } = makeFakeDb({});
  const deps = { db, ctx: CTX } as unknown as Deps;

  let threw = false;
  try {
    await listPosts(deps, { sort_by_metric: "ig_score" });
  } catch (e) {
    assert(e instanceof McpInputError, `Expected McpInputError, got ${e}`);
    assert((e as McpInputError).message.includes("ig_score"), `Error message should mention ig_score`);
    threw = true;
  }
  assert(threw, "listPosts should throw McpInputError when sort_by_metric=ig_score and no client_id");
});

Deno.test("list_posts: derived sort (like_rate) orders by rate, slices after sort", async () => {
  // Seed 3 posts for client 5:
  //   post A (id=1): like_rate=0.20 (likes=200, impressions=1000), published_at oldest
  //   post B (id=2): like_rate=0.05 (likes=50, impressions=1000),  published_at newest
  //   post C (id=3): like_rate=0.10 (likes=100, impressions=1000), published_at middle
  // With limit=2, published_at order would give [B,C] (newest first).
  // With like_rate sort, should give [A,C] after slice(0,2) — A is top-rate despite oldest.
  const makePost = (id: number, mediaId: string, pub: string) =>
    postRow({ id, workflow_id: 30, instagram_media_id: mediaId, published_at: pub });
  const makeMetric = (mediaId: string, likes: number) =>
    metricRow({ instagram_post_id: mediaId, likes, impressions: 1000, saved: 20, shares: 5, comments: 3, media_type: "IMAGE" });

  // DB call sequence for listPosts with derived sort + client_id=5:
  // 1. clientWorkflowIds: workflows -> then ([{id:30}])
  // 2. workflow_posts -> then (3 posts, .limit(500))
  // 3. post_property_values -> then (empty)
  // 4. post_file_links -> then (empty)
  // 5. instagram_posts -> then (3 metrics)
  // 6. loadClientRateDistributions:
  //    a. clientes -> maybeSingle (owned)
  //    b. instagram_accounts -> then ([{id:88}])
  //    c. instagram_posts -> then (5 dist posts for distributions)
  const { db } = makeFakeDb({
    workflows: [{ data: [{ id: 30 }], error: null }],
    workflow_posts: [{
      data: [
        makePost(1, "mA", "2026-01-01T00:00:00Z"),
        makePost(2, "mB", "2026-03-01T00:00:00Z"),
        makePost(3, "mC", "2026-02-01T00:00:00Z"),
      ],
      error: null,
    }],
    post_property_values: [{ data: [], error: null }],
    post_file_links: [{ data: [], error: null }],
    instagram_posts: [
      // loadMetrics: metrics for the 3 posts
      {
        data: [
          makeMetric("mA", 200), // like_rate=0.20 (top)
          makeMetric("mB", 50),  // like_rate=0.05 (bottom)
          makeMetric("mC", 100), // like_rate=0.10 (middle)
        ],
        error: null,
      },
      // loadClientRateDistributions: 5 posts for distributions
      { data: [igDistPost(), igDistPost(), igDistPost(), igDistPost(), igDistPost()], error: null },
    ],
    clientes: [{ data: { id: 5, especialidade: null, cor: null }, error: null }],
    instagram_accounts: [{ data: [{ id: 88 }], error: null }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const result = await listPosts(deps, { client_id: 5, sort_by_metric: "like_rate", limit: 2 });

  // Derived sort → returns { posts, truncated, cap }
  assert(typeof result === "object" && !Array.isArray(result), "derived sort should return an object, not an array");
  const { posts, truncated, cap } = result as { posts: any[]; truncated: boolean; cap: number };
  assertEquals(posts.length, 2, "should return limit=2 posts after slice");
  assertEquals(posts[0].id, 1, "top-by-like_rate (post A, id=1) should be first despite oldest published_at");
  assertEquals(posts[1].id, 3, "second-by-like_rate (post C, id=3) should be second");
  assertEquals(truncated, false, "truncated=false (3 rows < cap=500)");
  assertEquals(cap, 500, "cap should be 500");
});

Deno.test("baseline: like_rate gets quartiles when n>=5, share_rate null when n<5", async () => {
  // 5 CAROUSEL posts with shares unavailable -> like_rate bucket has 5 entries
  // (>= MIN_SAMPLE=5, so quartiles computed), share_rate bucket has 0 entries
  // (< MIN_SAMPLE, so quartiles null).
  // getPerformanceBaseline calls verifyClient, then loadClientRateDistributions
  // which calls verifyClient again -> need TWO clientes responses in the queue.
  const carouselPost = (likes: number) => igPost({
    media_type: "CAROUSEL_ALBUM",
    impressions: 1000,
    likes,
    saved: 20,
    comments: 5,
    shares: 0,
    unavailable_metrics: ["shares"],
  });

  const { db } = makeFakeDb({
    // verifyClient call from getPerformanceBaseline
    clientes: [
      { data: { id: 1, especialidade: null, cor: null }, error: null },
      // verifyClient call from loadClientRateDistributions (called internally)
      { data: { id: 1, especialidade: null, cor: null }, error: null },
    ],
    instagram_accounts: [{ data: [{ id: 55 }], error: null }],
    instagram_posts: [{
      data: [
        carouselPost(100),
        carouselPost(80),
        carouselPost(60),
        carouselPost(120),
        carouselPost(90),
      ],
      error: null,
    }],
  });
  const deps = { db, ctx: CTX } as unknown as Deps;

  const result = await getPerformanceBaseline(deps, { client_id: 1 });

  assert(result !== null, "result should not be null for an owned client");

  // sample_size matches the number of posts seeded
  assertEquals(result.sample_size, 5, "sample_size is 5");

  // weights should be present
  assert(result.weights !== undefined, "weights key present");
  assert(typeof result.weights_note === "string", "weights_note is a string");

  // like_rate: 5 posts with impressions=1000 -> 5 rate values -> quartiles computed
  const lr = result.overall.like_rate;
  assert(lr.n >= 5, `overall.like_rate.n should be >=5, got ${lr.n}`);
  assert(lr.quartiles !== null, "overall.like_rate.quartiles should not be null when n>=MIN_SAMPLE");
  assert(typeof lr.quartiles.p25 === "number", "p25 is a number");
  assert(typeof lr.quartiles.p50 === "number", "p50 is a number");
  assert(typeof lr.quartiles.p75 === "number", "p75 is a number");

  // share_rate: shares unavailable on all posts -> 0 entries -> quartiles null
  const sr = result.overall.share_rate;
  assert(sr.n < 5, `overall.share_rate.n should be <5, got ${sr.n}`);
  assertEquals(sr.quartiles, null, "overall.share_rate.quartiles is null when n<MIN_SAMPLE");

  // by_format should have CAROUSEL_ALBUM bucket
  assert(result.by_format["CAROUSEL_ALBUM"] !== undefined, "CAROUSEL_ALBUM format bucket present");
});
