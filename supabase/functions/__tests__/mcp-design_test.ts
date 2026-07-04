// Estúdio MCP design tools (design §9, plan T5.2/T5.3): tenancy, feature gate, status guards,
// the §2.4 aggregated-issues contract, existing-design/rev-conflict structured errors, the
// correcao auto-move, RPC arg shapes (updated_via='agent', NULL expected_rev = LWW) and the
// fire-and-forget render trigger.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { McpKeyContext } from "../../functions/_shared/mcp-token.ts";
import { McpInputError } from "../../functions/_shared/mcp-token.ts";
import { VALID_FEED_1x1 } from "../_shared/design-doc-fixtures.ts";
import type { Deps } from "../mcp/queries.ts";
import { createDesign, getDesign, McpStructuredError, updateDesign } from "../mcp/design.ts";

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["posts:read", "designs:write"],
  key_id: "key-1",
  created_by: "user-1",
};

const POST = { id: 42, tipo: "feed", status: "rascunho" };

function makeDeps(
  db: ReturnType<typeof createSupabaseQueryMock>,
  extra: Partial<Deps> = {},
): Deps & { triggered: Array<{ designId: number; rev: number }> } {
  const triggered: Array<{ designId: number; rev: number }> = [];
  return {
    db: db as never,
    ctx: CTX,
    isFeatureEnabled: async () => true,
    triggerRender: (designId, rev) => {
      triggered.push({ designId, rev });
      return Promise.resolve();
    },
    signUrl: async (key: string) => `https://signed.example/${key}`,
    ...extra,
    triggered,
  } as never;
}

/** Queues the reads every write makes before hitting the RPC: post lookup, (create only:
 * existing-design pre-check), video-media check, file tenancy check. */
function queueWriteReads(
  db: ReturnType<typeof createSupabaseQueryMock>,
  opts: { post?: Record<string, unknown>; existingDesign?: Record<string, unknown> | null } = {},
) {
  db.queue("workflow_posts", "select", { data: opts.post ?? POST, error: null });
  if (opts.existingDesign !== undefined) {
    db.queue("post_designs", "select", { data: opts.existingDesign, error: null });
  }
  db.queue("post_file_links", "select", { data: [], error: null }); // no video media
  // VALID_FEED_1x1 has no file_ids -> checkFileIds([]) short-circuits without a query.
}

const CREATED_ROW = {
  id: 7,
  doc: { ...VALID_FEED_1x1, canvas: { width: 1080, height: 1080 }, fileIds: [] },
  rev: 1,
  render_status: "pending",
  is_stale: true,
};

// ── getDesign ─────────────────────────────────────────────────────────────────

Deno.test("get_design: foreign/nonexistent post rejects with a tenancy message", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: null, error: null });
  let err: unknown;
  try {
    await getDesign(makeDeps(db), { post_id: 999 });
  } catch (e) {
    err = e;
  }
  assert(err instanceof McpInputError, "expected McpInputError");
});

Deno.test("get_design: post without a design returns design:null + hint (NOT an error)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: POST, error: null });
  db.queue("post_designs", "select", { data: null, error: null });
  const out = await getDesign(makeDeps(db), { post_id: 42 });
  assertEquals(out.design, null);
  assert(String((out as { hint?: string }).hint).includes("create_design"));
  assertEquals(out.post, { tipo: "feed", status: "rascunho" });
});

Deno.test("get_design: returns doc, rev and signed render pages", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: POST, error: null });
  db.queue("post_designs", "select", {
    data: { ...CREATED_ROW, rev: 3, render_status: "rendered" },
    error: null,
  });
  // renderInfo's design-links read (one page rendered):
  db.queue("post_file_links", "select", {
    data: [{ file_id: 500, sort_order: 0, files: { r2_key: "k1", width: 1080, height: 1080 } }],
    error: null,
  });
  const out = await getDesign(makeDeps(db), { post_id: 42 });
  assertEquals(out.rev, 3);
  assertEquals(out.render?.status, "rendered");
  assertEquals(out.render?.pages?.[0]?.file_id, 500);
  assert(String(out.render?.pages?.[0]?.preview_url).startsWith("https://signed.example/"));
});

// ── createDesign ──────────────────────────────────────────────────────────────

Deno.test("create_design: feature_estudio disabled rejects before any post read", async () => {
  const db = createSupabaseQueryMock();
  const deps = makeDeps(db, { isFeatureEnabled: async () => false });
  let message = "";
  try {
    await createDesign(deps, { post_id: 42, design: VALID_FEED_1x1 });
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("feature_estudio"), message);
  assertEquals(db.calls.length, 0, "no DB reads before the gate");
});

Deno.test("create_design: non-editable post status rejects", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: { ...POST, status: "enviado_cliente" }, error: null });
  let message = "";
  try {
    await createDesign(makeDeps(db), { post_id: 42, design: VALID_FEED_1x1 });
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("enviado_cliente"), message);
});

Deno.test("create_design: existing design → structured 'use update_design' error with rev", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: POST, error: null });
  db.queue("post_designs", "select", { data: { id: 7, rev: 4 }, error: null });
  let err: unknown;
  try {
    await createDesign(makeDeps(db), { post_id: 42, design: VALID_FEED_1x1 });
  } catch (e) {
    err = e;
  }
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "design_already_exists");
  assertEquals((err as McpStructuredError).payload.rev, 4);
});

Deno.test("create_design: invalid doc → §2.4 aggregated issues payload (design_invalid)", async () => {
  const db = createSupabaseQueryMock();
  queueWriteReads(db, { existingDesign: null });
  const bad = {
    ...VALID_FEED_1x1,
    pages: [{
      ...(VALID_FEED_1x1 as { pages: Array<Record<string, unknown>> }).pages[0],
      layers: [{
        id: "headline",
        type: "text",
        x: 90,
        y: 400,
        w: 900,
        text: "Bom dia",
        font_key: "helvetica-neue", // not in the catalog
        font_weight: 700,
        font_size: 64,
        color: "#12151a",
      }],
    }],
  };
  let err: unknown;
  try {
    await createDesign(makeDeps(db), { post_id: 42, design: bad });
  } catch (e) {
    err = e;
  }
  assert(err instanceof McpStructuredError, String(err));
  const payload = (err as McpStructuredError).payload as {
    error: string;
    issues: Array<{ code: string; path: string }>;
    truncated: boolean;
  };
  assertEquals(payload.error, "design_invalid");
  assert(payload.issues.some((i) => i.code === "unknown_font"), JSON.stringify(payload.issues));
  assertEquals(payload.truncated, false);
});

Deno.test("create_design: happy path — RPC gets updated_via 'agent', render fires, layout returned", async () => {
  const db = createSupabaseQueryMock();
  queueWriteReads(db, { existingDesign: null });
  db.queueRpc("create_post_design", { data: CREATED_ROW, error: null });
  const deps = makeDeps(db);
  const out = await createDesign(deps, { post_id: 42, design: VALID_FEED_1x1 });

  const rpcCall = db.calls.find((c) => c.table === "rpc:create_post_design");
  assert(rpcCall, "create_post_design RPC called");
  const params = rpcCall!.payload as Record<string, unknown>;
  assertEquals(params.p_updated_via, "agent");
  assertEquals(params.p_updated_by, "user-1");
  assertEquals(params.p_conta_id, "workspace-A");

  assertEquals(out.rev, 1);
  assertEquals(out.render, { status: "queued", rev: 1 });
  assertEquals(deps.triggered, [{ designId: 7, rev: 1 }]);
  // layout: no resolveFontBytes injected -> single-line estimate for the text layer.
  const headline = out.layout.find((l) => l.layer_id === "headline");
  assert(headline, "headline in layout");
  assertEquals(headline!.w, 900);
  assert(headline!.h > 0);
  // rascunho post: NO status auto-move write happened.
  assert(!db.calls.some((c) => c.table === "workflow_posts" && c.operation === "update"));
});

Deno.test("create_design: correcao_cliente post auto-moves to revisao_interna (decision 16)", async () => {
  const db = createSupabaseQueryMock();
  queueWriteReads(db, { post: { ...POST, status: "correcao_cliente" }, existingDesign: null });
  db.queueRpc("create_post_design", { data: CREATED_ROW, error: null });
  db.queue("workflow_posts", "update", { data: { status: "revisao_interna" }, error: null });
  const out = await createDesign(makeDeps(db), { post_id: 42, design: VALID_FEED_1x1 });
  assertEquals(out.post.status, "revisao_interna");
  const move = db.calls.find((c) => c.table === "workflow_posts" && c.operation === "update");
  assert(move, "status auto-move update issued");
  assertEquals((move!.payload as { status: string }).status, "revisao_interna");
});

Deno.test("create_design: a rejected render trigger does NOT fail the tool", async () => {
  const db = createSupabaseQueryMock();
  queueWriteReads(db, { existingDesign: null });
  db.queueRpc("create_post_design", { data: CREATED_ROW, error: null });
  const deps = makeDeps(db, {
    triggerRender: () => Promise.reject(new Error("design-render 503")),
  });
  const out = await createDesign(deps, { post_id: 42, design: VALID_FEED_1x1 });
  assertEquals(out.rev, 1); // tool succeeded; the sweep cron is the safety net
});

// ── updateDesign ──────────────────────────────────────────────────────────────

Deno.test("update_design: omitted expected_rev sends NULL to the RPC (documented LWW)", async () => {
  const db = createSupabaseQueryMock();
  queueWriteReads(db);
  db.queueRpc("update_post_design", { data: { ...CREATED_ROW, rev: 5 }, error: null });
  const out = await updateDesign(makeDeps(db), { post_id: 42, design: VALID_FEED_1x1 });
  const rpcCall = db.calls.find((c) => c.table === "rpc:update_post_design");
  assertEquals((rpcCall!.payload as Record<string, unknown>).p_expected_rev, null);
  assertEquals(out.rev, 5);
});

Deno.test("update_design: rev conflict → structured error naming the current rev", async () => {
  const db = createSupabaseQueryMock();
  queueWriteReads(db);
  db.queueRpc("update_post_design", { data: null, error: { message: "rev_conflict:9" } });
  let err: unknown;
  try {
    await updateDesign(makeDeps(db), { post_id: 42, design: VALID_FEED_1x1, expected_rev: 8 });
  } catch (e) {
    err = e;
  }
  assert(err instanceof McpStructuredError, String(err));
  assertEquals((err as McpStructuredError).payload.error, "rev_conflict");
  assertEquals((err as McpStructuredError).payload.current_rev, 9);
  assert(String((err as McpStructuredError).payload.message).includes("get_design"));
});

Deno.test("update_design: design_not_found → points the agent at create_design", async () => {
  const db = createSupabaseQueryMock();
  queueWriteReads(db);
  db.queueRpc("update_post_design", { data: null, error: { message: "design_not_found" } });
  let message = "";
  try {
    await updateDesign(makeDeps(db), { post_id: 42, design: VALID_FEED_1x1 });
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("create_design"), message);
});

Deno.test("update_design: response tipo reflects a format-driven tipo sync (feed post → carrossel design)", async () => {
  const db = createSupabaseQueryMock();
  // Post is currently tipo 'feed'; the carrossel design makes the RPC sync tipo → 'carrossel'.
  queueWriteReads(db);
  const page1 = (VALID_FEED_1x1 as { pages: Array<Record<string, unknown>> }).pages[0];
  const carrossel = {
    ...VALID_FEED_1x1,
    format: "carrossel",
    pages: [
      page1,
      {
        ...page1,
        id: "p2",
        // Fresh layer ids — ids are unique DOC-wide (§2.4 rule 4).
        layers: (page1.layers as Array<Record<string, unknown>>).map((l) => ({
          ...l,
          id: `${l.id}-p2`,
        })),
      },
    ],
  };
  db.queueRpc("update_post_design", { data: { ...CREATED_ROW, rev: 2 }, error: null });
  const out = await updateDesign(makeDeps(db), { post_id: 42, design: carrossel });
  assertEquals(out.post.tipo, "carrossel"); // NOT the stale pre-write 'feed'
});
