import { assert, assertEquals } from "./assert.ts";
import { getPost, listPosts, loadClientRateDistributions } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";

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
