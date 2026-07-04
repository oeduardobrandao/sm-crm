// design-manage (Estúdio design-first, slice A1) — designs are first-class rows keyed by
// design_id. POST /designs creates explicitly (mint-on-GET is gone), GET/PUT /blob keep the
// frozen contract (docs/estudio-v2-editor-contract.md) with design_id as the key, and
// attach/detach/duplicate/DELETE manage the 1:1 post attachment. POST /brand-logo unchanged.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createDesignManageHandler,
  type DesignManageDeps,
  type DesignRow,
  type PostRow,
} from "../design-manage/handler.ts";
import { starterTemplateFor } from "../design-manage/starter-templates.gen.ts";

const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const DESIGN_ID = 9;
const POST_ID = 42;
const CLIENTE_ID = 7;
const UUID = "deadbeef-0000-4000-8000-000000000001";
const BLOB_URL = `https://x.test/design-manage/blob?design_id=${DESIGN_ID}`;

const STORED_BYTES = new Uint8Array([0x66, 0x69, 0x67, 1, 2, 3]);
const STORED_KEY = `designs/${CONTA_ID}/aaaa-r3.fig`;

function makePostRow(overrides: Partial<PostRow> = {}): PostRow {
  return { id: POST_ID, tipo: "feed", status: "rascunho", ...overrides };
}

function makeDesignRow(overrides: Partial<DesignRow> = {}): DesignRow {
  return { id: DESIGN_ID, rev: 3, doc_r2_key: STORED_KEY, post_id: POST_ID, format: "feed", ...overrides };
}

interface DepsSpy {
  triggerCalls: Array<{ designId: number; rev: number }>;
  putBlobCalls: Array<{ key: string; bytes: Uint8Array }>;
  deleteBlobCalls: string[];
  createCalls: Array<{
    input: { clienteId: number | null; postId: number | null; format: string; name: string | null };
    r2Key: string;
    docHash: string;
    docBytes: number;
  }>;
  saveCalls: Array<{ expectedRev: number; docHash: string; r2Key: string; editorVersion: string | null }>;
  attachCalls: Array<{ designId: number; postId: number }>;
  detachCalls: number[];
  duplicateCalls: Array<{ designId: number; newR2Key: string }>;
  deleteCalls: Array<{ contaId: string; designId: number }>;
  auditCalls: Array<Record<string, unknown>>;
  loggedErrors: Array<{ context: string; error: unknown }>;
}

function makeDeps(overrides: Partial<DesignManageDeps> = {}): { deps: DesignManageDeps; spy: DepsSpy } {
  const spy: DepsSpy = {
    triggerCalls: [],
    putBlobCalls: [],
    deleteBlobCalls: [],
    createCalls: [],
    saveCalls: [],
    attachCalls: [],
    detachCalls: [],
    duplicateCalls: [],
    deleteCalls: [],
    auditCalls: [],
    loggedErrors: [],
  };

  const deps: DesignManageDeps = {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost" }),
    getUser: async (token) => (token === "valid-token" ? { id: USER_ID } : null),
    getProfile: async (userId) => (userId === USER_ID ? { conta_id: CONTA_ID } : null),
    isFeatureEnabled: async () => true,
    getPost: async (postId, contaId) =>
      postId === POST_ID && contaId === CONTA_ID ? makePostRow() : null,
    hasVideoMedia: async () => false,
    getDesign: async (designId, contaId) =>
      designId === DESIGN_ID && contaId === CONTA_ID ? makeDesignRow() : null,
    createDesign: async (_contaId, input, r2Key, docHash, docBytes) => {
      spy.createCalls.push({ input, r2Key, docHash, docBytes });
      return 55;
    },
    saveDesignBlob: async (_contaId, _designId, expectedRev, docHash, r2Key, _docBytes, editorVersion) => {
      spy.saveCalls.push({ expectedRev, docHash, r2Key, editorVersion });
      return { rev: expectedRev + 1, prevR2Key: STORED_KEY };
    },
    attachDesign: async (_contaId, designId, postId) => {
      spy.attachCalls.push({ designId, postId });
      return "feed";
    },
    detachDesign: async (_contaId, designId) => {
      spy.detachCalls.push(designId);
    },
    duplicateDesign: async (_contaId, designId, newR2Key) => {
      spy.duplicateCalls.push({ designId, newR2Key });
      return 56;
    },
    deleteDesign: async (contaId, designId) => {
      spy.deleteCalls.push({ contaId, designId });
    },
    fetchBlob: async (key) => (key === STORED_KEY ? STORED_BYTES : null),
    putBlob: async (key, bytes) => {
      spy.putBlobCalls.push({ key, bytes });
    },
    deleteBlob: async (key) => {
      spy.deleteBlobCalls.push(key);
    },
    clienteExists: async (clienteId, contaId) => clienteId === CLIENTE_ID && contaId === CONTA_ID,
    materializeBrandLogo: async () => ({ logo_file_id: 77, created: true }),
    insertAuditLog: async (entry) => {
      spy.auditCalls.push(entry as unknown as Record<string, unknown>);
    },
    logError: (context, error) => {
      spy.loggedErrors.push({ context, error });
    },
    triggerRender: async (designId, rev) => {
      spy.triggerCalls.push({ designId, rev });
    },
    waitUntil: (p) => {
      void p;
    },
    randomUUID: () => UUID,
    ...overrides,
  };
  return { deps, spy };
}

function authedRequest(method: string, url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    method,
    headers: { Authorization: "Bearer valid-token", ...(init.headers ?? {}) },
    body: init.body,
  });
}

function createDesignsRequest(body: unknown): Request {
  return authedRequest("POST", "https://x.test/design-manage/designs", {
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- auth / gate ----------

Deno.test("GET /blob without token → 401", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(new Request(BLOB_URL, { method: "GET" }));
  assertEquals(res.status, 401);
});

Deno.test("GET /blob with bad token → 401", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    new Request(BLOB_URL, { method: "GET", headers: { Authorization: "Bearer nope" } }),
  );
  assertEquals(res.status, 401);
});

Deno.test("feature gate off → 403", async () => {
  const { deps } = makeDeps({ isFeatureEnabled: async () => false });
  const handler = createDesignManageHandler(deps);
  const res = await handler(authedRequest("GET", BLOB_URL));
  assertEquals(res.status, 403);
});

Deno.test("unknown design → 404", async () => {
  const { deps } = makeDeps({ getDesign: async () => null });
  const handler = createDesignManageHandler(deps);
  const res = await handler(authedRequest("GET", BLOB_URL));
  assertEquals(res.status, 404);
});

Deno.test("non-blob GET path → 404", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("GET", `https://x.test/design-manage?design_id=${DESIGN_ID}`),
  );
  assertEquals(res.status, 404);
});

// ---------- POST /designs ----------

Deno.test("POST /designs with post_id: starter from post tipo, uuid r1 key, trigger, audit, 201", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ post_id: POST_ID }));
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.design_id, 55);
  const template = starterTemplateFor("feed");
  assertEquals(spy.putBlobCalls.length, 1);
  assertEquals(spy.putBlobCalls[0].key, `designs/${CONTA_ID}/${UUID}-r1.fig`);
  assertEquals(spy.createCalls.length, 1);
  assertEquals(spy.createCalls[0].input.postId, POST_ID);
  assertEquals(spy.createCalls[0].input.format, "feed");
  assertEquals(spy.createCalls[0].docHash, await sha256Hex(template));
  assertEquals(spy.auditCalls.length, 1);
  assertEquals(spy.triggerCalls, [{ designId: 55, rev: 1 }]);
});

Deno.test("POST /designs standalone: format from body, no post checks", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ format: "livre", name: "Meu canvas" }));
  assertEquals(res.status, 201);
  assertEquals(spy.createCalls[0].input.postId, null);
  assertEquals(spy.createCalls[0].input.format, "livre");
  assertEquals(spy.createCalls[0].input.name, "Meu canvas");
});

Deno.test("POST /designs standalone with bad format → 400", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ format: "stories" }));
  assertEquals(res.status, 400);
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("POST /designs with post_id derives format from post tipo (reels → reel_cover)", async () => {
  const { deps, spy } = makeDeps({ getPost: async () => makePostRow({ tipo: "reels" }) });
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ post_id: POST_ID, format: "feed" }));
  assertEquals(res.status, 201);
  assertEquals(spy.createCalls[0].input.format, "reel_cover");
});

Deno.test("POST /designs with post_id on non-editable post → 403 post_not_editable", async () => {
  const { deps, spy } = makeDeps({ getPost: async () => makePostRow({ status: "aprovado_cliente" }) });
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ post_id: POST_ID }));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "post_not_editable");
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("POST /designs on stories post → 422 post_tipo_unsupported", async () => {
  const { deps, spy } = makeDeps({ getPost: async () => makePostRow({ tipo: "stories" }) });
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ post_id: POST_ID }));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error, "post_tipo_unsupported");
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("POST /designs on feed post with video media → 422 post_has_video", async () => {
  const { deps, spy } = makeDeps({ hasVideoMedia: async () => true });
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ post_id: POST_ID }));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error, "post_has_video");
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("POST /designs with unknown post → 404", async () => {
  const { deps } = makeDeps({ getPost: async () => null });
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ post_id: POST_ID }));
  assertEquals(res.status, 404);
});

Deno.test("POST /designs with alien cliente_id → 404 cliente_not_found", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ format: "feed", cliente_id: 999 }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "cliente_not_found");
});

Deno.test("POST /designs maps post_already_designed RPC error → 409", async () => {
  const { deps } = makeDeps({
    createDesign: async () => {
      throw new Error("post_already_designed");
    },
  });
  const handler = createDesignManageHandler(deps);
  const res = await handler(createDesignsRequest({ post_id: POST_ID }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "post_already_designed");
});

// ---------- GET /blob ----------

Deno.test("GET /blob returns stored bytes with x-rev", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(authedRequest("GET", BLOB_URL));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("x-rev"), "3");
  assertEquals(res.headers.get("content-type"), "application/octet-stream");
  const body = new Uint8Array(await res.arrayBuffer());
  assertEquals(body, STORED_BYTES);
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("GET /blob with missing R2 object → 404 + internal log", async () => {
  const { deps, spy } = makeDeps({ fetchBlob: async () => null });
  const handler = createDesignManageHandler(deps);
  const res = await handler(authedRequest("GET", BLOB_URL));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "design_blob_missing");
  assertEquals(spy.loggedErrors.length, 1);
});

Deno.test("GET /blob with bad design_id → 400", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(authedRequest("GET", "https://x.test/design-manage/blob?design_id=abc"));
  assertEquals(res.status, 400);
});

// ---------- PUT /blob ----------

Deno.test("PUT /blob happy path: uuid rev key, sha256, x-rev bump, prev blob cleanup", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const bytes = new Uint8Array([9, 9, 9, 9]);
  const res = await handler(
    authedRequest("PUT", BLOB_URL, {
      body: bytes,
      headers: { "x-expected-rev": "3", "x-editor-version": "0.13.2" },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("x-rev"), "4");
  assertEquals(spy.putBlobCalls.length, 1);
  assertEquals(spy.putBlobCalls[0].key, `designs/${CONTA_ID}/${UUID}-r4.fig`);
  assertEquals(spy.saveCalls.length, 1);
  assertEquals(spy.saveCalls[0].expectedRev, 3);
  assertEquals(spy.saveCalls[0].editorVersion, "0.13.2");
  assertEquals(spy.saveCalls[0].docHash, await sha256Hex(bytes));
  // previous rev's blob is best-effort deleted after a successful save
  assertEquals(spy.deleteBlobCalls, [STORED_KEY]);
  assertEquals(spy.auditCalls.length, 1); // update audit
  assertEquals(spy.triggerCalls, [{ designId: DESIGN_ID, rev: 4 }]); // save kicks a re-render
});

Deno.test("PUT /blob rev conflict → 409, no cleanup", async () => {
  const { deps, spy } = makeDeps({
    saveDesignBlob: async () => {
      throw new Error("rev_conflict");
    },
  });
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("PUT", BLOB_URL, { body: new Uint8Array([1]), headers: { "x-expected-rev": "2" } }),
  );
  assertEquals(res.status, 409);
  assertEquals(spy.deleteBlobCalls.length, 0);
  assertEquals(spy.triggerCalls.length, 0); // no render on a lost save
  const body = await res.json();
  assertEquals(body.error, "rev_conflict");
});

Deno.test("PUT /blob on design attached to a locked post → 403 read_only", async () => {
  const { deps, spy } = makeDeps({
    saveDesignBlob: async () => {
      throw new Error("read_only");
    },
  });
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("PUT", BLOB_URL, { body: new Uint8Array([1]), headers: { "x-expected-rev": "3" } }),
  );
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "read_only");
  assertEquals(spy.triggerCalls.length, 0);
});

Deno.test("PUT /blob body over 10MB → 413, blob never uploaded", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("PUT", BLOB_URL, {
      body: new Uint8Array(10 * 1024 * 1024 + 1),
      headers: { "x-expected-rev": "3" },
    }),
  );
  assertEquals(res.status, 413);
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("PUT /blob empty body or bad expected-rev → 422", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const empty = await handler(
    authedRequest("PUT", BLOB_URL, { body: new Uint8Array(0), headers: { "x-expected-rev": "3" } }),
  );
  assertEquals(empty.status, 422);
  const badRev = await handler(
    authedRequest("PUT", BLOB_URL, { body: new Uint8Array([1]), headers: { "x-expected-rev": "zero" } }),
  );
  assertEquals(badRev.status, 422);
});

// ---------- attach / detach ----------

Deno.test("POST /designs/:id/attach happy path fires the render trigger with the design rev", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("POST", `https://x.test/design-manage/designs/${DESIGN_ID}/attach`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_id: POST_ID }),
    }),
  );
  assertEquals(res.status, 200);
  assertEquals((await res.json()).post_tipo, "feed");
  assertEquals(spy.attachCalls, [{ designId: DESIGN_ID, postId: POST_ID }]);
  assertEquals(spy.triggerCalls, [{ designId: DESIGN_ID, rev: 3 }]);
  assertEquals(spy.auditCalls.length, 1);
});

Deno.test("attach to an already-designed post → 409 post_already_designed", async () => {
  const { deps, spy } = makeDeps({
    attachDesign: async () => {
      throw new Error("post_already_designed");
    },
  });
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("POST", `https://x.test/design-manage/designs/${DESIGN_ID}/attach`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_id: POST_ID }),
    }),
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, "post_already_designed");
  assertEquals(spy.triggerCalls.length, 0);
});

Deno.test("attach to a post with video media → 422 before hitting the RPC", async () => {
  const { deps, spy } = makeDeps({ hasVideoMedia: async () => true });
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("POST", `https://x.test/design-manage/designs/${DESIGN_ID}/attach`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_id: POST_ID }),
    }),
  );
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error, "post_has_video");
  assertEquals(spy.attachCalls.length, 0);
});

Deno.test("attach to a stories post → 422 post_tipo_unsupported", async () => {
  const { deps, spy } = makeDeps({ getPost: async () => makePostRow({ tipo: "stories" }) });
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("POST", `https://x.test/design-manage/designs/${DESIGN_ID}/attach`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_id: POST_ID }),
    }),
  );
  assertEquals(res.status, 422);
  assertEquals(spy.attachCalls.length, 0);
});

Deno.test("POST /designs/:id/detach → 204", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("POST", `https://x.test/design-manage/designs/${DESIGN_ID}/detach`),
  );
  assertEquals(res.status, 204);
  assertEquals(spy.detachCalls, [DESIGN_ID]);
});

// ---------- duplicate ----------

Deno.test("POST /designs/:id/duplicate copies the blob to a fresh r1 key and returns the new id", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("POST", `https://x.test/design-manage/designs/${DESIGN_ID}/duplicate`),
  );
  assertEquals(res.status, 201);
  assertEquals((await res.json()).design_id, 56);
  assertEquals(spy.putBlobCalls.length, 1);
  assertEquals(spy.putBlobCalls[0].key, `designs/${CONTA_ID}/${UUID}-r1.fig`);
  assertEquals(spy.putBlobCalls[0].bytes, STORED_BYTES);
  assertEquals(spy.duplicateCalls, [{ designId: DESIGN_ID, newR2Key: `designs/${CONTA_ID}/${UUID}-r1.fig` }]);
  assertEquals(spy.triggerCalls, [{ designId: 56, rev: 1 }]);
});

Deno.test("duplicate with missing source blob → 404 + internal log", async () => {
  const { deps, spy } = makeDeps({ fetchBlob: async () => null });
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("POST", `https://x.test/design-manage/designs/${DESIGN_ID}/duplicate`),
  );
  assertEquals(res.status, 404);
  assertEquals(spy.duplicateCalls.length, 0);
  assertEquals(spy.loggedErrors.length, 1);
});

// ---------- DELETE ----------

Deno.test("DELETE /designs/:id → 204 (RPC queues blob + manifest keys itself)", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("DELETE", `https://x.test/design-manage/designs/${DESIGN_ID}`),
  );
  assertEquals(res.status, 204);
  assertEquals(spy.deleteCalls, [{ contaId: CONTA_ID, designId: DESIGN_ID }]);
  assertEquals(spy.auditCalls.length, 1);
});

Deno.test("DELETE unknown design → 404", async () => {
  const { deps } = makeDeps({
    deleteDesign: async () => {
      throw new Error("design_not_found");
    },
  });
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    authedRequest("DELETE", `https://x.test/design-manage/designs/${DESIGN_ID}`),
  );
  assertEquals(res.status, 404);
});

// ---------- CORS ----------

Deno.test("preflight allows the contract headers and exposes x-rev", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(new Request(BLOB_URL, { method: "OPTIONS" }));
  assertEquals(res.status, 200);
  const allow = res.headers.get("Access-Control-Allow-Headers") ?? "";
  assert(allow.includes("x-expected-rev"));
  assert(allow.includes("x-editor-version"));
  assertEquals(res.headers.get("Access-Control-Expose-Headers"), "x-rev");
});

// ---------- POST /brand-logo (unchanged behavior) ----------

Deno.test("POST /brand-logo still works", async () => {
  const { deps } = makeDeps();
  const handler = createDesignManageHandler(deps);
  const res = await handler(
    new Request("https://x.test/design-manage/brand-logo", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token", "content-type": "application/json" },
      body: JSON.stringify({ cliente_id: CLIENTE_ID }),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.logo_file_id, 77);
});
