import { assert, assertEquals } from "./assert.ts";
import { getPost } from "../mcp/queries.ts";
import type { Deps } from "../mcp/queries.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { createMediaUpload, setPostMedia } from "../mcp/media.ts";

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

// ── create_media_upload ─────────────────────────────────────────────────────────

const CTX_WRITE: McpKeyContext = {
  conta_id: "ws-A", scopes: ["posts:write"], key_id: "k", created_by: "u",
};

/** fakeDeps for create_media_upload: fake db answers workspaces.select(storage_used_bytes)
 * .eq.single with `used`; storageQuota/signPutUrl are stubbed directly (not real R2/RPC). */
function fakeDeps(opts: {
  used: number;
  quota: number | null;
  uuid?: string;
  onSign?: (key: string) => void;
}): Deps {
  const { db } = makeFakeDb({
    workspaces: [{ data: { storage_used_bytes: opts.used }, error: null }],
  });
  return {
    db,
    ctx: CTX_WRITE,
    storageQuota: (_contaId: string) => Promise.resolve(opts.quota),
    signPutUrl: (key: string, _mime: string) => {
      opts.onSign?.(key);
      return Promise.resolve(`https://r2.example/${key}?signed=1`);
    },
    randomUUID: () => opts.uuid ?? "uuu",
  } as unknown as Deps;
}

Deno.test("create_media_upload signs a PUT url per file with a tenant-scoped r2_key", async () => {
  const deps = fakeDeps({ used: 0, quota: 1_000_000, uuid: "uuu" });
  const out = await createMediaUpload(deps, { files: [
    { filename: "a.jpg", mime_type: "image/jpeg", size_bytes: 100 }] });
  assertEquals(out.uploads.length, 1);
  assertEquals(out.uploads[0].r2_key, "contas/ws-A/files/uuu.jpg");
  assert(out.uploads[0].upload_url.includes("uuu.jpg")); // stub returns a url embedding the key
  assertEquals(out.uploads[0].size_bytes, 100);
});

Deno.test("create_media_upload rejects when used + Σsize exceeds quota, WITHOUT signing", async () => {
  const signed: string[] = [];
  const deps = fakeDeps({ used: 900, quota: 1000, onSign: (k) => signed.push(k) });
  let threw = false;
  try { await createMediaUpload(deps, { files: [{ filename:"a.jpg", mime_type:"image/jpeg", size_bytes: 200 }] }); }
  catch (e) { threw = e instanceof McpInputError; }
  assert(threw); assertEquals(signed.length, 0, "must not sign when over quota");
});

Deno.test("create_media_upload treats null quota as unlimited", async () => {
  const deps = fakeDeps({ used: 10 ** 12, quota: null, uuid: "u2" });
  const out = await createMediaUpload(deps, { files: [{ filename:"a.png", mime_type:"image/png", size_bytes: 5 }] });
  assertEquals(out.uploads[0].r2_key, "contas/ws-A/files/u2.png");
});

// ── set_post_media ──────────────────────────────────────────────────────────────

type Call2 = { table: string; args: unknown[] };

/** fakeDeps for set_post_media: `db.from` supports the getPost read chain (reused from the
 * "get_post media" test above); `db.rpc(fn, params)` records `{table:'rpc:'+fn, args:[params]}`
 * and resolves the queued `rpc:<fn>` response (same shape as mcp-writes_test.ts's call recorder).
 * `headObject` is stubbed directly from `opts.head` (single canned response for every key). */
function fakeSetDeps(opts: {
  head: { contentLength: number; contentType: string | null } | null;
  rpc?: { data: unknown; error: unknown };
}): { deps: Deps; calls: Call2[] } {
  const calls: Call2[] = [];
  const queues: Record<string, Resp[]> = {
    // getPost's read sequence (mirrors the "get_post media" test's fixture): a post with no
    // media links and no client, so loadMetrics/ig_score short-circuit and signUrl is unused.
    workflow_posts: [{ data: postRow({ id: 5 }), error: null }],
    post_property_values: [{ data: [], error: null }],
    post_file_links: [{ data: [], error: null }],
    workflows: [{ data: { cliente_id: null }, error: null }],
  };

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

  const db = {
    from: (t: string) => recorder(t),
    rpc: (fn: string, params: unknown) => {
      calls.push({ table: "rpc:" + fn, args: [params] });
      const key = "rpc:" + fn;
      const resp = (queues[key] ?? []).shift() ?? opts.rpc ?? { data: null, error: null };
      return Promise.resolve(resp);
    },
  };
  if (opts.rpc) queues["rpc:post_media_set_from_uploads"] = [opts.rpc];

  const deps = {
    db,
    ctx: { conta_id: "ws-A", scopes: ["posts:write"], key_id: "k", created_by: "u" } as McpKeyContext,
    headObject: (_key: string) => Promise.resolve(opts.head),
  } as unknown as Deps;
  return { deps, calls };
}

const ITEM = (k: string) => ({ r2_key: `contas/ws-A/files/${k}`, size_bytes: 10, mime_type: "image/jpeg" });

Deno.test("set_post_media rejects a foreign-tenant r2_key without calling the RPC", async () => {
  const { deps, calls } = fakeSetDeps({ head: { contentLength: 10, contentType: "image/jpeg" } });
  let threw = false;
  try { await setPostMedia(deps, { post_id: 5, items: [{ r2_key: "contas/OTHER/files/x.jpg", size_bytes: 10, mime_type: "image/jpeg" }] }); }
  catch (e) { threw = e instanceof McpInputError; }
  assert(threw); assert(!calls.some((c) => c.table === "rpc:post_media_set_from_uploads"));
});

Deno.test("set_post_media rejects a size mismatch (headObject) without calling the RPC", async () => {
  const { deps, calls } = fakeSetDeps({ head: { contentLength: 999, contentType: "image/jpeg" } });
  let threw = false;
  try { await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg")] }); }
  catch (e) { threw = e instanceof McpInputError; }
  assert(threw); assert(!calls.some((c) => c.table === "rpc:post_media_set_from_uploads"));
});

Deno.test("set_post_media calls the RPC with mapped params on valid uploads", async () => {
  const { deps, calls } = fakeSetDeps({
    head: { contentLength: 10, contentType: "image/jpeg" },
    rpc: { data: { post_id: 5, item_count: 2, tipo: "carrossel", status: "revisao_interna" }, error: null },
    // queue getPost's reads so the final return resolves (mirror mcp-metrics getPost setup)
  });
  await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg"), ITEM("b.jpg")] });
  const rpc = calls.find((c) => c.table === "rpc:post_media_set_from_uploads");
  assertEquals(rpc?.args[0], { p_conta_id: "ws-A", p_post_id: 5, p_uploaded_by: "u",
    p_items: [ITEM("a.jpg"), ITEM("b.jpg")] });
});

Deno.test("set_post_media maps coded RPC exceptions to PT McpInputError", async () => {
  for (const [code, needle] of [
    ["post_not_found", "não encontrado"], ["post_not_editable:aprovado_interno", "aprovado_interno"],
    ["tipo_not_image:reels", "reels"], ["design_attached", "design"], ["quota_exceeded", "Cota"],
  ] as Array<[string, string]>) {
    const { deps } = fakeSetDeps({ head: { contentLength: 10, contentType: "image/jpeg" },
      rpc: { data: null, error: { message: code } } });
    let msg = "", isInput = false;
    try { await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg")] }); }
    catch (e) { isInput = e instanceof McpInputError; msg = (e as Error).message; }
    assert(isInput, code); assert(msg.includes(needle), `${code} → ${msg}`);
  }
});

Deno.test("set_post_media never leaks a raw db error", async () => {
  const { deps } = fakeSetDeps({ head: { contentLength: 10, contentType: "image/jpeg" },
    rpc: { data: null, error: { message: "deadlock detected 0x…" } } });
  let msg = "";
  try { await setPostMedia(deps, { post_id: 5, items: [ITEM("a.jpg")] }); } catch (e) { msg = (e as Error).message; }
  assert(!msg.includes("deadlock"));
});
