import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPostDesignManageHandler,
  type DesignRow,
  type PostDesignManageDeps,
  type PostRow,
} from "../post-design-manage/handler.ts";
import { fakeFonts, VALID_FEED_1x1 } from "../_shared/design-doc-fixtures.ts";
import type { DesignDoc } from "../_shared/design-doc.ts";

const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const POST_ID = 42;

function makeDoc(overrides: Partial<DesignDoc> = {}): DesignDoc {
  return {
    version: 1,
    format: "feed",
    aspect_ratio: "1:1",
    canvas: { width: 1080, height: 1080 },
    pages: [{ id: "p1", background: { type: "solid", color: "#ffffff" }, layers: [] }],
    fileIds: [],
    ...overrides,
  };
}

function makeDesignRow(overrides: Partial<DesignRow> = {}): DesignRow {
  return {
    id: 1,
    doc: makeDoc(),
    rev: 1,
    render_status: "pending",
    is_stale: true,
    ...overrides,
  };
}

function makePostRow(overrides: Partial<PostRow> = {}): PostRow {
  return { id: POST_ID, tipo: "feed", status: "rascunho", ...overrides };
}

interface DepsSpy {
  getOrCreateCalls: Array<{ contaId: string; postId: number; starterDoc: DesignDoc }>;
  updateCalls: Array<{ contaId: string; postId: number; doc: DesignDoc; expectedRev: number }>;
  deleteCalls: Array<{ contaId: string; postId: number }>;
  triggerRenderCalls: Array<{ designId: number; rev: number }>;
  waitUntilCalls: Promise<unknown>[];
  auditCalls: Array<Record<string, unknown>>;
  loggedErrors: Array<{ context: string; error: unknown }>;
}

function makeDeps(
  overrides: Partial<PostDesignManageDeps> = {},
): { deps: PostDesignManageDeps; spy: DepsSpy } {
  const spy: DepsSpy = {
    getOrCreateCalls: [],
    updateCalls: [],
    deleteCalls: [],
    triggerRenderCalls: [],
    waitUntilCalls: [],
    auditCalls: [],
    loggedErrors: [],
  };

  const deps: PostDesignManageDeps = {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost" }),
    getUser: async (token) => (token === "valid-token" ? { id: USER_ID } : null),
    getProfile: async (userId) => (userId === USER_ID ? { conta_id: CONTA_ID } : null),
    isFeatureEnabled: async () => true,
    getPost: async (postId, contaId) =>
      postId === POST_ID && contaId === CONTA_ID ? makePostRow() : null,
    hasVideoMedia: async () => false,
    getCoverFileId: async () => null,
    getExistingDesign: async () => null,
    getOrCreateDesign: async (contaId, postId, starterDoc) => {
      spy.getOrCreateCalls.push({ contaId, postId, starterDoc });
      return { ...makeDesignRow({ doc: starterDoc, is_stale: true }), created: true };
    },
    updateDesign: async (contaId, postId, doc, expectedRev) => {
      spy.updateCalls.push({ contaId, postId, doc, expectedRev });
      return makeDesignRow({ doc, rev: expectedRev + 1, is_stale: true });
    },
    deleteDesign: async (contaId, postId) => {
      spy.deleteCalls.push({ contaId, postId });
    },
    checkFileIds: async (ids) => new Set(ids.filter((id) => id === 812 || id === 900)),
    fonts: fakeFonts,
    getRenderPages: async () => [],
    triggerRender: async (designId, rev) => {
      spy.triggerRenderCalls.push({ designId, rev });
    },
    waitUntil: (promise) => {
      spy.waitUntilCalls.push(promise);
    },
    insertAuditLog: async (entry) => {
      spy.auditCalls.push(entry);
    },
    logError: (context, error) => {
      spy.loggedErrors.push({ context, error });
    },
    ...overrides,
  };

  return { deps, spy };
}

function makeReq(
  method: string,
  opts: { token?: string; search?: string; body?: unknown } = {},
) {
  const token = opts.token ?? "valid-token";
  const url = `http://localhost/post-design-manage${opts.search ?? ""}`;
  return new Request(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

// ============================================================
// Auth / preflight
// ============================================================

Deno.test("handles OPTIONS preflight without checking auth", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(new Request("http://localhost/post-design-manage", { method: "OPTIONS" }));
  assertEquals(res.status, 200);
});

Deno.test("rejects requests with no Authorization header", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { token: "", search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 401);
});

Deno.test("rejects an invalid/expired token", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { token: "garbage", search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 401);
});

Deno.test("returns 403 when the user has no profile/conta_id", async () => {
  const { deps } = makeDeps({ getProfile: async () => null });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 403);
});

Deno.test("feature gate: feature_estudio disabled returns 403 before touching the post", async () => {
  let postLookedUp = false;
  const { deps } = makeDeps({
    isFeatureEnabled: async () => false,
    getPost: async () => {
      postLookedUp = true;
      return makePostRow();
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error, "feature_disabled");
  assertEquals(postLookedUp, false);
});

Deno.test("unknown method returns 405", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("PATCH", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 405);
});

// ============================================================
// GET — get-or-create + starter doc
// ============================================================

Deno.test("GET: foreign/nonexistent post_id is rejected as not found", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: "?post_id=999" }));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error, "post_not_found");
});

Deno.test("GET: rejects a missing/non-numeric post_id", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: "?post_id=abc" }));
  assertEquals(res.status, 400);
});

Deno.test("GET: creates a blank starter doc derived from tipo when no design exists", async () => {
  const { deps, spy } = makeDeps({
    getPost: async () => makePostRow({ tipo: "feed" }),
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 200);
  assertEquals(spy.getOrCreateCalls.length, 1);
  const starter = spy.getOrCreateCalls[0].starterDoc;
  assertEquals(starter.format, "feed");
  assertEquals(starter.pages.length, 1);
  assertEquals(starter.pages[0].background, { type: "solid", color: "#ffffff" });
});

Deno.test("GET: losing the create race (RPC reports created=false) does not audit-log a create", async () => {
  // get_or_create_post_design's own atomicity means a lost race returns the WINNER's row —
  // this simulates that: this caller built a starter doc, but the RPC signals it didn't
  // actually insert (created: false). Auditing "create" here would misattribute someone
  // else's creation to this caller.
  const winnerRow = makeDesignRow({ id: 9, rev: 1, is_stale: true });
  const { deps, spy } = makeDeps({
    getOrCreateDesign: async (contaId, postId, starterDoc) => {
      spy.getOrCreateCalls.push({ contaId, postId, starterDoc });
      return { ...winnerRow, created: false };
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.rev, winnerRow.rev);
  assertEquals(spy.auditCalls.length, 0);
});

Deno.test("GET: a status race during get_or_create maps to the same structured error PUT/DELETE give", async () => {
  const { deps, spy } = makeDeps({
    getOrCreateDesign: async () => {
      throw new Error("post_not_editable:agendado");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body, { error: "post_not_editable", status: "agendado" });
  assertEquals(spy.auditCalls.length, 0);
});

Deno.test("GET: an unrecognized error from get_or_create never leaks the raw message", async () => {
  const { deps, spy } = makeDeps({
    getOrCreateDesign: async () => {
      throw new Error("permission denied for relation post_designs — leaked internal detail");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body, { error: "internal_error" });
  assertEquals(spy.loggedErrors.length, 1);
});

Deno.test("GET: starter doc uses the existing cover image as background when present", async () => {
  const { deps, spy } = makeDeps({
    getPost: async () => makePostRow({ tipo: "carrossel" }),
    getCoverFileId: async () => 900,
  });
  const handler = createPostDesignManageHandler(deps);
  await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  const starter = spy.getOrCreateCalls[0].starterDoc;
  const background = starter.pages[0].background as { type: string; file_id: number; fit: string };
  assertEquals(background.type, "image");
  assertEquals(background.file_id, 900);
  assertEquals(background.fit, "cover");
});

Deno.test("GET: reel_cover starter doc never looks up a cover image", async () => {
  let called = false;
  const { deps } = makeDeps({
    getPost: async () => makePostRow({ tipo: "reels" }),
    getCoverFileId: async () => {
      called = true;
      return 900;
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 200);
  assertEquals(called, false);
});

Deno.test("GET: unsupported post tipo (stories) is rejected before creating anything", async () => {
  const { deps, spy } = makeDeps({
    getPost: async () => makePostRow({ tipo: "stories" }),
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "unsupported_post_tipo");
  assertEquals(spy.getOrCreateCalls.length, 0);
});

Deno.test("GET: status guard blocks starter-doc creation on a non-editable post", async () => {
  const { deps, spy } = makeDeps({
    getPost: async () => makePostRow({ status: "agendado" }),
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "post_not_editable");
  assertEquals(body.status, "agendado");
  assertEquals(spy.getOrCreateCalls.length, 0);
});

Deno.test("GET: returns an existing design without re-creating or re-auditing", async () => {
  const existing = makeDesignRow({ id: 5, rev: 3, render_status: "rendered", is_stale: false });
  const { deps, spy } = makeDeps({
    getExistingDesign: async () => existing,
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.rev, 3);
  assertEquals(spy.getOrCreateCalls.length, 0);
  assertEquals(spy.auditCalls.length, 0);
});

Deno.test("GET: creating a design audits with redacted metadata (no doc contents)", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(spy.auditCalls.length, 1);
  const entry = spy.auditCalls[0];
  assertEquals(entry.action, "create");
  assertEquals(entry.conta_id, CONTA_ID);
  const metadata = entry.metadata as Record<string, unknown>;
  assertEquals(metadata.post_id, POST_ID);
  assertEquals(typeof metadata.doc_bytes, "number");
  assertEquals(JSON.stringify(entry).includes("#ffffff"), false); // no raw doc fields leaked
});

Deno.test("GET: triggers a render via waitUntil for a newly created (stale) design", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(spy.waitUntilCalls.length, 1);
  await spy.waitUntilCalls[0];
  assertEquals(spy.triggerRenderCalls.length, 1);
});

Deno.test("GET: does not trigger a render when the existing design is not stale", async () => {
  const { deps, spy } = makeDeps({
    getExistingDesign: async () => makeDesignRow({ is_stale: false }),
  });
  const handler = createPostDesignManageHandler(deps);
  await handler(makeReq("GET", { search: `?post_id=${POST_ID}` }));
  assertEquals(spy.waitUntilCalls.length, 0);
});

// ============================================================
// PUT — validated save via update_post_design
// ============================================================

Deno.test("PUT: foreign/nonexistent post_id is rejected as not found", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    makeReq("PUT", { body: { post_id: 999, doc: VALID_FEED_1x1, expected_rev: 1 } }),
  );
  assertEquals(res.status, 404);
});

Deno.test("PUT: rejects a body missing expected_rev", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1 } }));
  assertEquals(res.status, 400);
});

Deno.test("PUT: status guard rejects a save on a non-editable post", async () => {
  const { deps } = makeDeps({ getPost: async () => makePostRow({ status: "publicado" }) });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 1 } }),
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error, "post_not_editable");
  assertEquals(body.status, "publicado");
});

Deno.test("PUT: an invalid doc returns every aggregated issue together", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  // Two independent zod-level (Stage 0) violations, so both surface together — a Stage 1
  // business-rule issue (like invalid_aspect_ratio_for_format) never runs when Stage 0 fails,
  // since validateDesignDoc short-circuits after Stage 0.
  const badDoc = {
    version: 1,
    format: "feed",
    aspect_ratio: "1:1",
    pages: [
      {
        background: { type: "solid", color: "not-a-hex" },
        layers: [
          {
            type: "text", x: 0, y: 0, w: 100, text: "oi",
            font_key: "dm-sans", font_weight: 700, font_size: 40,
            color: "also-not-a-hex",
          },
        ],
      },
    ],
  };
  const res = await handler(
    makeReq("PUT", { body: { post_id: POST_ID, doc: badDoc, expected_rev: 1 } }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, "design_invalid");
  assertEquals(body.issues.length > 1, true);
});

Deno.test("PUT: rev_conflict from the RPC maps to 409 with the current rev", async () => {
  const { deps } = makeDeps({
    updateDesign: async () => {
      throw new Error("rev_conflict:7");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 3 } }),
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body, { error: "rev_conflict", current_rev: 7 });
});

Deno.test("PUT: design_not_found from the RPC maps to 404", async () => {
  const { deps } = makeDeps({
    updateDesign: async () => {
      throw new Error("design_not_found");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 1 } }),
  );
  assertEquals(res.status, 404);
});

Deno.test("PUT: an unrecognized RPC error never leaks the raw message to the client", async () => {
  const { deps, spy } = makeDeps({
    updateDesign: async () => {
      throw new Error("permission denied for relation post_designs — leaked internal detail");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 1 } }),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body, { error: "internal_error" });
  assertEquals(spy.loggedErrors.length, 1); // raw error still reaches internal logs
});

Deno.test("PUT: a successful save returns the normalized doc, rev, and warnings", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 1 } }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.rev, 2);
  assertEquals(Array.isArray(body.warnings), true);
  assertEquals(body.design.format, "feed");
});

Deno.test("PUT: audits the save with redacted metadata (no doc contents)", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  await handler(makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 1 } }));
  assertEquals(spy.auditCalls.length, 1);
  const entry = spy.auditCalls[0];
  assertEquals(entry.action, "update");
  const metadata = entry.metadata as Record<string, unknown>;
  assertEquals(metadata.page_count, 1);
  assertEquals(typeof metadata.layer_count, "number");
  assertEquals(JSON.stringify(entry).includes("Bom dia"), false); // caption/layer text never audited
});

Deno.test("PUT: a trigger-render failure is non-fatal — the save still succeeds", async () => {
  const { deps, spy } = makeDeps({
    triggerRender: async () => {
      throw new Error("design-render unreachable");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 1 } }),
  );
  assertEquals(res.status, 200);
  await spy.waitUntilCalls[0];
  assertEquals(spy.loggedErrors.some((l) => l.context === "post-design-manage:trigger-render"), true);
});

Deno.test("PUT: does not trigger a render when the RPC reports the design is not stale", async () => {
  const { deps, spy } = makeDeps({
    updateDesign: async (contaId, postId, doc, expectedRev) =>
      makeDesignRow({ doc, rev: expectedRev + 1, is_stale: false }),
  });
  const handler = createPostDesignManageHandler(deps);
  await handler(makeReq("PUT", { body: { post_id: POST_ID, doc: VALID_FEED_1x1, expected_rev: 1 } }));
  assertEquals(spy.waitUntilCalls.length, 0);
});

// ============================================================
// DELETE
// ============================================================

Deno.test("DELETE: foreign/nonexistent post_id is rejected as not found", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("DELETE", { search: "?post_id=999" }));
  assertEquals(res.status, 404);
});

Deno.test("DELETE: status guard applies to delete too", async () => {
  const { deps } = makeDeps({ getPost: async () => makePostRow({ status: "aprovado" }) });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("DELETE", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 409);
});

Deno.test("DELETE: a successful delete calls the RPC and audits minimal metadata", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(makeReq("DELETE", { search: `?post_id=${POST_ID}` }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
  assertEquals(spy.deleteCalls, [{ contaId: CONTA_ID, postId: POST_ID }]);
  assertEquals(spy.auditCalls[0].action, "delete");
  assertEquals(spy.auditCalls[0].metadata, { post_id: POST_ID });
});
