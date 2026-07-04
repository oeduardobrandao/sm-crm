// post-design-manage v2 (Estúdio/OpenPencil) — the /blob contract:
// docs/estudio-v2-editor-contract.md. GET/PUT move .fig bytes with x-rev /
// x-expected-rev; JSON doc routes are gone. POST /brand-logo is unchanged.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createPostDesignManageHandler,
  type DesignMeta,
  type PostDesignManageDeps,
  type PostRow,
} from "../post-design-manage/handler.ts";
import { starterTemplateFor } from "../post-design-manage/starter-templates.gen.ts";

const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const POST_ID = 42;
const CLIENTE_ID = 7;
const BLOB_URL = `https://x.test/post-design-manage/blob?post_id=${POST_ID}`;

const STORED_BYTES = new Uint8Array([0x66, 0x69, 0x67, 1, 2, 3]);
const STORED_KEY = `designs/${CONTA_ID}/${POST_ID}-r3.fig`;

function makePostRow(overrides: Partial<PostRow> = {}): PostRow {
  return { id: POST_ID, tipo: "feed", status: "rascunho", ...overrides };
}

interface DepsSpy {
  putBlobCalls: Array<{ key: string; bytes: Uint8Array }>;
  deleteBlobCalls: string[];
  getOrCreateCalls: Array<{ r2Key: string; docHash: string; docBytes: number }>;
  saveCalls: Array<{ expectedRev: number; docHash: string; r2Key: string; editorVersion: string | null }>;
  deleteCalls: Array<{ contaId: string; postId: number }>;
  auditCalls: Array<Record<string, unknown>>;
  loggedErrors: Array<{ context: string; error: unknown }>;
}

function makeDeps(overrides: Partial<PostDesignManageDeps> = {}): { deps: PostDesignManageDeps; spy: DepsSpy } {
  const spy: DepsSpy = {
    putBlobCalls: [],
    deleteBlobCalls: [],
    getOrCreateCalls: [],
    saveCalls: [],
    deleteCalls: [],
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
    getDesignMeta: async (): Promise<DesignMeta | null> => ({
      id: 9,
      rev: 3,
      doc_r2_key: STORED_KEY,
    }),
    getOrCreateDesignBlob: async (_contaId, _postId, r2Key, docHash, docBytes) => {
      spy.getOrCreateCalls.push({ r2Key, docHash, docBytes });
      return { id: 9, rev: 1, doc_r2_key: r2Key, created: true };
    },
    saveDesignBlob: async (_contaId, _postId, expectedRev, docHash, r2Key, _docBytes, editorVersion) => {
      spy.saveCalls.push({ expectedRev, docHash, r2Key, editorVersion });
      return { rev: expectedRev + 1, prevR2Key: STORED_KEY };
    },
    deleteDesign: async (contaId, postId) => {
      spy.deleteCalls.push({ contaId, postId });
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
    ...overrides,
  };
  return { deps, spy };
}

function blobRequest(method: "GET" | "PUT", init: RequestInit = {}, url = BLOB_URL): Request {
  return new Request(url, {
    method,
    headers: { Authorization: "Bearer valid-token", ...(init.headers ?? {}) },
    body: init.body,
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- auth / gate ----------

Deno.test("GET /blob without token → 401", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(new Request(BLOB_URL, { method: "GET" }));
  assertEquals(res.status, 401);
});

Deno.test("GET /blob with bad token → 401", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    new Request(BLOB_URL, { method: "GET", headers: { Authorization: "Bearer nope" } }),
  );
  assertEquals(res.status, 401);
});

Deno.test("feature gate off → 403", async () => {
  const { deps } = makeDeps({ isFeatureEnabled: async () => false });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(blobRequest("GET"));
  assertEquals(res.status, 403);
});

Deno.test("unknown post → 404", async () => {
  const { deps } = makeDeps({ getPost: async () => null });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(blobRequest("GET"));
  assertEquals(res.status, 404);
});

Deno.test("non-blob GET path → 404 (JSON doc route is gone)", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    blobRequest("GET", {}, `https://x.test/post-design-manage?post_id=${POST_ID}`),
  );
  assertEquals(res.status, 404);
});

// ---------- GET /blob ----------

Deno.test("GET /blob mints the tipo starter when no design exists", async () => {
  const { deps, spy } = makeDeps({ getDesignMeta: async () => null });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(blobRequest("GET"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("x-rev"), "1");
  assertEquals(res.headers.get("content-type"), "application/octet-stream");
  const body = new Uint8Array(await res.arrayBuffer());
  const template = starterTemplateFor("feed")!;
  assertEquals(body, template);
  assertEquals(spy.putBlobCalls.length, 1);
  assertEquals(spy.putBlobCalls[0].key, `designs/${CONTA_ID}/${POST_ID}-r1.fig`);
  assertEquals(spy.getOrCreateCalls.length, 1);
  assertEquals(spy.getOrCreateCalls[0].docHash, await sha256Hex(template));
  assertEquals(spy.auditCalls.length, 1); // create audit
});

Deno.test("GET /blob mint refused on non-editable post", async () => {
  const { deps, spy } = makeDeps({
    getDesignMeta: async () => null,
    getPost: async () => makePostRow({ status: "aprovado" }),
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(blobRequest("GET"));
  assertEquals(res.status, 403);
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("GET /blob mint refused for feed post with video media", async () => {
  const { deps, spy } = makeDeps({
    getDesignMeta: async () => null,
    hasVideoMedia: async () => true,
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(blobRequest("GET"));
  assertEquals(res.status, 422);
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("GET /blob returns stored bytes for an existing design", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(blobRequest("GET"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("x-rev"), "3");
  const body = new Uint8Array(await res.arrayBuffer());
  assertEquals(body, STORED_BYTES);
  assertEquals(spy.putBlobCalls.length, 0);
  assertEquals(spy.getOrCreateCalls.length, 0);
});

Deno.test("GET /blob with missing R2 object → 404 + internal log", async () => {
  const { deps, spy } = makeDeps({ fetchBlob: async () => null });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(blobRequest("GET"));
  assertEquals(res.status, 404);
  assertEquals(spy.loggedErrors.length, 1);
});

// ---------- PUT /blob ----------

Deno.test("PUT /blob happy path: rev-scoped key, sha256, x-rev bump, prev blob cleanup", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const bytes = new Uint8Array([9, 9, 9, 9]);
  const res = await handler(
    blobRequest("PUT", {
      body: bytes,
      headers: { "x-expected-rev": "3", "x-editor-version": "0.13.2" },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("x-rev"), "4");
  assertEquals(spy.putBlobCalls.length, 1);
  assertEquals(spy.putBlobCalls[0].key, `designs/${CONTA_ID}/${POST_ID}-r4.fig`);
  assertEquals(spy.saveCalls.length, 1);
  assertEquals(spy.saveCalls[0].expectedRev, 3);
  assertEquals(spy.saveCalls[0].editorVersion, "0.13.2");
  assertEquals(spy.saveCalls[0].docHash, await sha256Hex(bytes));
  // previous rev's blob is best-effort deleted after a successful save
  assertEquals(spy.deleteBlobCalls, [STORED_KEY]);
  assertEquals(spy.auditCalls.length, 1); // update audit
});

Deno.test("PUT /blob rev conflict → 409, no cleanup", async () => {
  const { deps, spy } = makeDeps({
    saveDesignBlob: async () => {
      throw new Error("rev_conflict");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    blobRequest("PUT", { body: new Uint8Array([1]), headers: { "x-expected-rev": "2" } }),
  );
  assertEquals(res.status, 409);
  assertEquals(spy.deleteBlobCalls.length, 0);
  const body = await res.json();
  assertEquals(body.error, "rev_conflict");
});

Deno.test("PUT /blob on non-editable post → 403", async () => {
  const { deps } = makeDeps({
    saveDesignBlob: async () => {
      throw new Error("post_not_editable:aprovado");
    },
  });
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    blobRequest("PUT", { body: new Uint8Array([1]), headers: { "x-expected-rev": "2" } }),
  );
  assertEquals(res.status, 403);
});

Deno.test("PUT /blob body over 10MB → 413, blob never uploaded", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    blobRequest("PUT", {
      body: new Uint8Array(10 * 1024 * 1024 + 1),
      headers: { "x-expected-rev": "3" },
    }),
  );
  assertEquals(res.status, 413);
  assertEquals(spy.putBlobCalls.length, 0);
});

Deno.test("PUT /blob empty body or bad expected-rev → 422", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const empty = await handler(
    blobRequest("PUT", { body: new Uint8Array(0), headers: { "x-expected-rev": "3" } }),
  );
  assertEquals(empty.status, 422);
  const badRev = await handler(
    blobRequest("PUT", { body: new Uint8Array([1]), headers: { "x-expected-rev": "zero" } }),
  );
  assertEquals(badRev.status, 422);
});

// ---------- DELETE ----------

Deno.test("DELETE removes the row and the blob", async () => {
  const { deps, spy } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    new Request(`https://x.test/post-design-manage?post_id=${POST_ID}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer valid-token" },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(spy.deleteCalls, [{ contaId: CONTA_ID, postId: POST_ID }]);
  assertEquals(spy.deleteBlobCalls, [STORED_KEY]);
});

// ---------- CORS ----------

Deno.test("preflight allows the contract headers and exposes x-rev", async () => {
  const { deps } = makeDeps();
  const handler = createPostDesignManageHandler(deps);
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
  const handler = createPostDesignManageHandler(deps);
  const res = await handler(
    new Request("https://x.test/post-design-manage/brand-logo", {
      method: "POST",
      headers: { Authorization: "Bearer valid-token", "content-type": "application/json" },
      body: JSON.stringify({ cliente_id: CLIENTE_ID }),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.logo_file_id, 77);
});
