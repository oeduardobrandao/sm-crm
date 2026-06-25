import { assert, assertEquals } from "./assert.ts";
import { getPost, listPosts } from "../mcp/queries.ts";
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
  // The happy path still attaches metrics.
  assertEquals(out.length, 1);
  assertEquals(out[0].metrics, { reach: 100, saved: 20, shares: 5, comments: 3, likes: 50 });
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
  assertEquals(out.metrics, { reach: 7, saved: 1, shares: 0, comments: 0, likes: 2 });
});
