// Estúdio MCP design tools, v2 (design-first model): tenancy, feature gate, standalone vs
// pre-attached creation, eligibility pre-checks, op-based update through the doc service
// (structured DocService errors, rev CAS, staged-blob cleanup), attach guards and the
// fire-and-forget render trigger.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { McpKeyContext } from "../../functions/_shared/mcp-token.ts";
import { McpInputError } from "../../functions/_shared/mcp-token.ts";
import { DocServiceError } from "../_shared/doc-service.ts";
import type { Deps } from "../mcp/queries.ts";
import {
  attachDesign,
  createDesign,
  getDesign,
  listDesigns,
  McpStructuredError,
  updateDesign,
} from "../mcp/design.ts";

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["posts:read", "designs:write"],
  key_id: "key-1",
  created_by: "user-1",
};

const POST = { id: 42, tipo: "feed", status: "rascunho" };

const ROW = {
  id: 7,
  cliente_id: null,
  post_id: null,
  name: "Design sem título",
  format: "feed",
  rev: 3,
  doc_r2_key: "designs/workspace-A/old-r3.fig",
  render_status: "rendered",
  is_stale: false,
  render_manifest: [{ page_id: "1:4", r2_key: "contas/a/7/3/1:4.jpg", width: 1080, height: 1350 }],
};

const PROJECTION = {
  pages: [{ id: "0:3", name: "Canvas", children: [{ id: "1:4", type: "FRAME", name: "1" }] }],
  images: [],
};

interface TestDeps extends Deps {
  triggered: Array<{ designId: number; rev: number }>;
  putCalls: Array<{ key: string; len: number }>;
  deleted: string[];
  mutateCalls: Array<unknown[]>;
}

function makeDeps(
  db: ReturnType<typeof createSupabaseQueryMock>,
  extra: Partial<Deps> = {},
): TestDeps {
  const triggered: Array<{ designId: number; rev: number }> = [];
  const putCalls: Array<{ key: string; len: number }> = [];
  const deleted: string[] = [];
  const mutateCalls: Array<unknown[]> = [];
  return {
    db: db as never,
    ctx: CTX,
    isFeatureEnabled: async () => true,
    triggerRender: (designId, rev) => {
      triggered.push({ designId, rev });
      return Promise.resolve();
    },
    signUrl: async (key: string) => `https://signed.example/${key}`,
    fetchBlob: async () => new Uint8Array([1, 2, 3]),
    putBlob: async (key, bytes) => {
      putCalls.push({ key, len: bytes.length });
    },
    deleteBlob: async (key) => {
      deleted.push(key);
    },
    docDescribe: async () => PROJECTION,
    docMutate: async (_bytes, ops) => {
      mutateCalls.push(ops);
      return { bytes: new Uint8Array([9, 9]), projection: PROJECTION, applied: ops.length };
    },
    starterTemplate: () => new Uint8Array([5, 5, 5, 5]),
    randomUUID: () => "uuid-1",
    ...extra,
    triggered,
    putCalls,
    deleted,
    mutateCalls,
  } as never;
}

async function expectErr(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected an error");
}

// ── getDesign / listDesigns ───────────────────────────────────────────────────

Deno.test("get_design: unknown/foreign id rejects with a tenancy message", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: null, error: null });
  const err = await expectErr(() => getDesign(makeDeps(db), { design_id: 999 }));
  assert(err instanceof McpInputError);
});

Deno.test("get_design: standalone — projection + signed fresh render pages", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  const out = await getDesign(makeDeps(db), { design_id: 7 });
  assertEquals(out.design_id, 7);
  assertEquals(out.rev, 3);
  assertEquals(out.projection, PROJECTION);
  assertEquals(out.post, null);
  assertEquals(out.render.pages, [{
    page_id: "1:4",
    width: 1080,
    height: 1350,
    url: "https://signed.example/contas/a/7/3/1:4.jpg",
  }]);
});

Deno.test("get_design: stale render exposes no page urls; attached post is reported", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: { ...ROW, is_stale: true, post_id: 42 }, error: null });
  db.queue("workflow_posts", "select", { data: POST, error: null });
  const out = await getDesign(makeDeps(db), { design_id: 7 });
  assertEquals(out.render.pages, []);
  assertEquals(out.post, { id: 42, tipo: "feed", status: "rascunho" });
});

Deno.test("get_design: ATTACHED fresh design signs the post's design links (no manifest)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", {
    data: { ...ROW, post_id: 42, render_manifest: null },
    error: null,
  });
  db.queue("post_file_links", "select", {
    data: [{ file_id: 91, sort_order: 0, files: { r2_key: "contas/a/91.jpg", width: 1080, height: 1350 } }],
    error: null,
  });
  db.queue("workflow_posts", "select", { data: POST, error: null });
  const out = await getDesign(makeDeps(db), { design_id: 7 });
  assertEquals(out.render.pages, [{
    page_id: "91",
    width: 1080,
    height: 1350,
    url: "https://signed.example/contas/a/91.jpg",
  }]);
});

Deno.test("list_designs: returns workspace designs", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: [{ id: 7 }, { id: 8 }], error: null });
  const out = await listDesigns(makeDeps(db), {});
  assertEquals(out.designs.length, 2);
});

// ── createDesign ──────────────────────────────────────────────────────────────

Deno.test("create_design: feature off rejects", async () => {
  const db = createSupabaseQueryMock();
  const err = await expectErr(() =>
    createDesign(makeDeps(db, { isFeatureEnabled: async () => false }), { format: "feed" })
  );
  assert(err instanceof McpInputError);
});

Deno.test("create_design: standalone requires a valid format", async () => {
  const db = createSupabaseQueryMock();
  assert(await expectErr(() => createDesign(makeDeps(db), {})) instanceof McpInputError);
  assert(
    await expectErr(() => createDesign(makeDeps(db), { format: "story" })) instanceof
      McpInputError,
  );
});

Deno.test("create_design: standalone happy — starter blob, RPC args, trigger, projection", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("create_design", { data: 7, error: null });
  const deps = makeDeps(db);
  const out = await createDesign(deps, { format: "reel_cover", name: "Capa" });

  assertEquals(deps.putCalls, [{ key: "designs/workspace-A/uuid-1-r1.fig", len: 4 }]);
  const rpc = db.calls.find((c) => c.table === "rpc:create_design");
  assert(rpc, "create_design RPC called");
  const p = rpc!.payload as Record<string, unknown>;
  assertEquals(p.p_conta_id, "workspace-A");
  assertEquals(p.p_post_id, null);
  assertEquals(p.p_format, "reel_cover");
  assertEquals(p.p_name, "Capa");
  assertEquals(p.p_created_by, "user-1");
  assertEquals(out.design_id, 7);
  assertEquals(out.rev, 1);
  assertEquals(out.projection, PROJECTION);
  assertEquals(deps.triggered, [{ designId: 7, rev: 1 }]);
});

Deno.test("create_design: unknown cliente_id rejects", async () => {
  const db = createSupabaseQueryMock();
  db.queue("clientes", "select", { data: null, error: null });
  const err = await expectErr(() =>
    createDesign(makeDeps(db), { format: "feed", cliente_id: 5 })
  );
  assert(err instanceof McpInputError);
});

Deno.test("create_design with post: non-editable / unsupported tipo / video all reject", async () => {
  for (
    const [post, videoLinks] of [
      [{ ...POST, status: "aprovado" }, []],
      [{ ...POST, tipo: "stories" }, []],
      [POST, [{ file_id: 1 }]], // video media on a feed post
    ] as const
  ) {
    const db = createSupabaseQueryMock();
    db.queue("workflow_posts", "select", { data: post, error: null });
    db.queue("designs", "select", { data: null, error: null });
    db.queue("post_file_links", "select", { data: videoLinks, error: null });
    const err = await expectErr(() => createDesign(makeDeps(db), { post_id: 42 }));
    assert(err instanceof McpInputError, `expected input error for ${JSON.stringify(post)}`);
  }
});

Deno.test("create_design with post: existing design → structured post_already_designed with id", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: POST, error: null });
  db.queue("designs", "select", { data: { id: 31, rev: 2 }, error: null });
  const err = await expectErr(() => createDesign(makeDeps(db), { post_id: 42 }));
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "post_already_designed");
  assertEquals((err as McpStructuredError).payload.design_id, 31);
});

Deno.test("create_design with post: format derives from tipo; RPC carries post_id", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: { ...POST, tipo: "reels" }, error: null });
  db.queue("designs", "select", { data: null, error: null });
  db.queueRpc("create_design", { data: 9, error: null });
  const out = await createDesign(makeDeps(db), { post_id: 42 });
  const p = db.calls.find((c) => c.table === "rpc:create_design")!.payload as Record<
    string,
    unknown
  >;
  assertEquals(p.p_post_id, 42);
  assertEquals(p.p_format, "reel_cover");
  assertEquals(out.format, "reel_cover");
  assertEquals(out.post_id, 42);
});

// ── updateDesign ──────────────────────────────────────────────────────────────

Deno.test("update_design: empty ops rejects before any read", async () => {
  const db = createSupabaseQueryMock();
  const err = await expectErr(() =>
    updateDesign(makeDeps(db), { design_id: 7, ops: [] })
  );
  assert(err instanceof McpInputError);
  assertEquals(db.calls.length, 0);
});

Deno.test("update_design: happy — mutate, staged blob, rev CAS default, prev cleanup, trigger", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  db.queueRpc("save_design_blob", { data: { o_rev: 4, o_prev_r2_key: "old-key" }, error: null });
  const deps = makeDeps(db);
  const ops = [{ op: "set_text", node: "1:9", text: "novo" }];
  const out = await updateDesign(deps, { design_id: 7, ops });

  assertEquals(deps.mutateCalls, [ops]);
  assertEquals(deps.putCalls, [{ key: "designs/workspace-A/uuid-1-r4.fig", len: 2 }]);
  const p = db.calls.find((c) => c.table === "rpc:save_design_blob")!.payload as Record<
    string,
    unknown
  >;
  assertEquals(p.p_expected_rev, 3); // defaults to the rev just read
  assertEquals(p.p_updated_by, "user-1");
  assertEquals(out.rev, 4);
  assertEquals(out.applied, 1);
  assertEquals(deps.deleted, ["old-key"]); // superseded blob reaped
  assertEquals(deps.triggered, [{ designId: 7, rev: 4 }]);
});

Deno.test("update_design: explicit expected_rev is passed through", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  db.queueRpc("save_design_blob", { data: { o_rev: 3, o_prev_r2_key: null }, error: null });
  await updateDesign(makeDeps(db), {
    design_id: 7,
    ops: [{ op: "rename", node: "1:4", name: "x" }],
    expected_rev: 2,
  });
  const p = db.calls.find((c) => c.table === "rpc:save_design_blob")!.payload as Record<
    string,
    unknown
  >;
  assertEquals(p.p_expected_rev, 2);
});

Deno.test("update_design: rev conflict → structured error + staged blob cleanup", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  db.queueRpc("save_design_blob", { data: null, error: { message: "rev_conflict" } });
  const deps = makeDeps(db);
  const err = await expectErr(() =>
    updateDesign(deps, { design_id: 7, ops: [{ op: "remove_node", node: "1:9" }] })
  );
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "rev_conflict");
  assertEquals(deps.deleted, ["designs/workspace-A/uuid-1-r4.fig"]); // the staged blob
  assertEquals(deps.triggered, []);
});

Deno.test("update_design: locked attached post → structured read_only", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: { ...ROW, post_id: 42 }, error: null });
  db.queueRpc("save_design_blob", { data: null, error: { message: "read_only" } });
  const err = await expectErr(() =>
    updateDesign(makeDeps(db), { design_id: 7, ops: [{ op: "set_fill", node: "1:4", color: "#fff000" }] })
  );
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "read_only");
});

Deno.test("update_design: doc-service coded 422 surfaces as a structured error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  const deps = makeDeps(db, {
    docMutate: () => Promise.reject(new DocServiceError("node_not_found", "op 1: nó 9:9 não existe")),
  });
  const err = await expectErr(() =>
    updateDesign(deps, { design_id: 7, ops: [{ op: "set_text", node: "9:9", text: "x" }] })
  );
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "node_not_found");
});

// ── attachDesign ──────────────────────────────────────────────────────────────

Deno.test("attach_design: already-attached design → structured error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: { ...ROW, post_id: 41 }, error: null });
  const err = await expectErr(() =>
    attachDesign(makeDeps(db), { design_id: 7, post_id: 42 })
  );
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "design_already_attached");
});

Deno.test("attach_design: target post already designed → structured error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  db.queue("workflow_posts", "select", { data: POST, error: null });
  db.queue("post_file_links", "select", { data: [], error: null });
  db.queue("designs", "select", { data: { id: 31 }, error: null });
  const err = await expectErr(() =>
    attachDesign(makeDeps(db), { design_id: 7, post_id: 42 })
  );
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "post_already_designed");
});

Deno.test("attach_design: happy — RPC args, render fires, tipo returned", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  db.queue("workflow_posts", "select", { data: POST, error: null });
  db.queue("post_file_links", "select", { data: [], error: null });
  db.queue("designs", "select", { data: null, error: null });
  db.queueRpc("attach_design", { data: "feed", error: null });
  const deps = makeDeps(db);
  const out = await attachDesign(deps, { design_id: 7, post_id: 42 });
  const p = db.calls.find((c) => c.table === "rpc:attach_design")!.payload as Record<
    string,
    unknown
  >;
  assertEquals(p.p_design_id, 7);
  assertEquals(p.p_post_id, 42);
  assertEquals(out.post_tipo, "feed");
  assertEquals(deps.triggered, [{ designId: 7, rev: 3 }]);
});
