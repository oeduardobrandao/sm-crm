import { assertEquals } from "./assert.ts";
import { getPost } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";

type Resp = { data: unknown; error: unknown };

// Recording fake Supabase client: chainable methods record their args; `await` /
// maybeSingle pull the next canned response from that table's queue.
// (Mirrors makeFakeDb in mcp-metrics_test.ts.)
function makeFakeDb(responses: Record<string, Resp[]>) {
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];

  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: [], error: null };
    for (const m of ["select", "eq", "in", "gte", "order", "limit"]) {
      rec[m] = (..._args: unknown[]) => rec;
    }
    rec.single = () => Promise.resolve(next());
    rec.maybeSingle = () => Promise.resolve(next());
    rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(next()));
    return rec;
  }

  const db = { from: (t: string) => recorder(t) };
  return { db };
}

const CTX: McpKeyContext = {
  conta_id: "workspace-A", scopes: ["posts:read"], key_id: "k1", created_by: "user-1",
};

const postRow = (over: Record<string, unknown> = {}) => ({
  id: 10, workflow_id: 20, titulo: "Post", tipo: "feed", status: "publicado",
  ig_caption: "cap", conteudo_plain: "Linha 1\nLinha 2", created_via: "user",
  instagram_media_id: null, instagram_permalink: null,
  scheduled_at: null, published_at: null, created_at: "2026-05-01T00:00:00Z",
  ...over,
});

Deno.test("get_post media exposes file_id, link_id, sort_order", async () => {
  // Sequence of DB calls in getPost (per-table queues, order across tables N/A):
  // 1. workflow_posts -> maybeSingle (post)
  // 2. loadPostProps: post_property_values -> then (empty)
  // 3. loadMetrics: no media_id/permalink -> instagram_posts NOT queried
  // 4. post_file_links -> then (one media row)
  // 5. workflows -> maybeSingle (no client_id -> ig_score section skipped since clientId falsy)
  const { db } = makeFakeDb({
    workflow_posts: [{ data: postRow(), error: null }],
    post_property_values: [{ data: [], error: null }],
    post_file_links: [{
      data: [{
        id: 55,
        is_cover: true,
        sort_order: 0,
        files: {
          id: 88,
          kind: "image",
          mime_type: "image/jpeg",
          width: 1080,
          height: 1350,
          duration_seconds: null,
          r2_key: "k",
          thumbnail_r2_key: null,
        },
      }],
      error: null,
    }],
    workflows: [{ data: { cliente_id: null }, error: null }],
  });
  const deps = { db, ctx: CTX, signUrl: (k: string) => Promise.resolve(`signed:${k}`) } as unknown as Deps;

  const post = await getPost(deps, { post_id: 10 });

  assertEquals(post.media[0].file_id, 88);
  assertEquals(post.media[0].link_id, 55);
  assertEquals(post.media[0].sort_order, 0);
  assertEquals(post.media[0].is_cover, true); // unchanged
});
