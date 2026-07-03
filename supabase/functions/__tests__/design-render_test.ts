import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createDesignRenderHandler,
  type ClaimedDesign,
  type DesignRenderDeps,
  type DesignRow,
  type ManifestEntry,
} from "../design-render/handler.ts";
import type { DesignDoc } from "../_shared/design-doc.ts";

// ============================================================
// Fixtures
// ============================================================

const CONTA_ID = "11111111-1111-1111-1111-111111111111";

function makeDoc(pageCount: number): DesignDoc {
  return {
    version: 1,
    format: pageCount > 1 ? "carrossel" : "feed",
    aspect_ratio: "1:1",
    canvas: { width: 1080, height: 1080 },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `p${i + 1}`,
      background: { type: "solid", color: "#ffffff" },
      layers: [],
    })),
    fileIds: [],
  };
}

function makeRow(overrides: Partial<DesignRow> = {}): DesignRow {
  return {
    id: 1,
    conta_id: CONTA_ID,
    post_id: 42,
    rev: 3,
    doc: makeDoc(1),
    doc_hash: "hash-current",
    render_status: "pending",
    render_manifest: null,
    ...overrides,
  };
}

function makeClaimed(overrides: Partial<ClaimedDesign> = {}): ClaimedDesign {
  return {
    id: 1,
    conta_id: CONTA_ID,
    post_id: 42,
    doc: makeDoc(1),
    doc_hash: "hash-current",
    ...overrides,
  };
}

interface DepsSpy {
  finalizeCalls: Array<{ designId: number; hash: string; manifest: ManifestEntry[] }>;
  failCalls: Array<{ designId: number; error: string }>;
  writeManifestCalls: Array<{ designId: number; manifest: ManifestEntry[] }>;
  queueFileDeletionCalls: string[];
  putObjectCalls: Array<{ key: string; bytes: number; contentType: string }>;
  loggedErrors: unknown[];
  selfInvokeCalls: Array<{ designId: number; rev: number; pageIndex: number }>;
  waitUntilCalls: Array<Promise<unknown>>;
}

function makeDeps(
  overrides: Partial<DesignRenderDeps> = {},
): { deps: DesignRenderDeps; spy: DepsSpy } {
  const spy: DepsSpy = {
    finalizeCalls: [],
    failCalls: [],
    writeManifestCalls: [],
    queueFileDeletionCalls: [],
    putObjectCalls: [],
    loggedErrors: [],
    selfInvokeCalls: [],
    waitUntilCalls: [],
  };

  const deps: DesignRenderDeps = {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "http://localhost" }),
    cronSecret: "test-secret",
    timingSafeEqual: (a, b) => a === b,
    readDesignRow: async () => makeRow(),
    claimDesignRender: async () => makeClaimed(),
    finalizeDesignRender: async (designId, hash, manifest) => {
      spy.finalizeCalls.push({ designId, hash, manifest });
      return "rendered";
    },
    failDesignRender: async (designId, error) => {
      spy.failCalls.push({ designId, error });
    },
    writeManifest: async (designId, manifest) => {
      spy.writeManifestCalls.push({ designId, manifest });
    },
    queueFileDeletion: async (r2Key) => {
      spy.queueFileDeletionCalls.push(r2Key);
    },
    renderPage: async () => ({
      jpegBytes: new Uint8Array([0xff, 0xd8, 0xd9]),
      width: 1080,
      height: 1080,
    }),
    resolveFileBytes: async () => ({ bytes: new Uint8Array(), mimeType: "image/jpeg" }),
    resolveFontBytes: async () => new Uint8Array(),
    putObject: async (key, bytes, contentType) => {
      spy.putObjectCalls.push({ key, bytes: bytes.length, contentType });
    },
    logError: (_context, error) => {
      spy.loggedErrors.push(error);
    },
    selfInvoke: async (designId, rev, pageIndex) => {
      spy.selfInvokeCalls.push({ designId, rev, pageIndex });
    },
    waitUntil: (promise) => {
      spy.waitUntilCalls.push(promise);
    },
    ...overrides,
  };

  return { deps, spy };
}

function makeReq(body?: unknown, secret = "test-secret") {
  return new Request("http://localhost/design-render", {
    method: "POST",
    headers: { "x-cron-secret": secret, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ============================================================
// Auth / request validation
// ============================================================

Deno.test("rejects requests without a valid x-cron-secret", async () => {
  const { deps } = makeDeps();
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }, "wrong-secret"));
  assertEquals(res.status, 401);
});

Deno.test("handles OPTIONS preflight without checking the secret", async () => {
  const { deps } = makeDeps();
  const handler = createDesignRenderHandler(deps);
  const res = await handler(
    new Request("http://localhost/design-render", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
});

Deno.test("rejects a malformed body", async () => {
  const { deps } = makeDeps();
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ rev: 3 })); // missing design_id
  assertEquals(res.status, 400);
});

Deno.test("returns 404 when the design row doesn't exist", async () => {
  const { deps } = makeDeps({ readDesignRow: async () => null });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 999, rev: 1 }));
  assertEquals(res.status, 404);
});

// ============================================================
// Orchestration start (page_index absent)
// ============================================================

Deno.test("stale-rev at orchestration start returns 204 without claiming", async () => {
  let claimed = false;
  const { deps } = makeDeps({
    readDesignRow: async () => makeRow({ rev: 5 }),
    claimDesignRender: async () => {
      claimed = true;
      return makeClaimed();
    },
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 })); // requested rev 3, row is at 5
  assertEquals(res.status, 204);
  assertEquals(claimed, false);
});

Deno.test("claim conflict (already rendering) returns 409", async () => {
  const { deps } = makeDeps({ claimDesignRender: async () => null });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(res.status, 409);
});

Deno.test("single-page doc renders, uploads, and finalizes in one call", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () => makeClaimed({ doc: makeDoc(1) }),
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "rendered");
  assertEquals(spy.putObjectCalls.length, 1);
  assertEquals(spy.putObjectCalls[0].key, `contas/${CONTA_ID}/designs/1/3/p1.jpg`);
  assertEquals(spy.finalizeCalls.length, 1);
  assertEquals(spy.finalizeCalls[0].manifest.length, 1);
  assertEquals(spy.finalizeCalls[0].manifest[0].page_id, "p1");
});

Deno.test("multi-page doc renders page 0 only, writes the manifest, and does not finalize yet", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () => makeClaimed({ doc: makeDoc(3) }),
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "partial");
  assertEquals(body.page_index, 0);
  assertEquals(body.pages_total, 3);
  assertEquals(spy.finalizeCalls.length, 0);
  assertEquals(spy.writeManifestCalls[0].manifest.length, 1);
});

// ============================================================
// Chaining (PR 1.5) — a non-last page self-invokes page_index+1, wrapped in waitUntil so the
// chain survives past this call's response.
// ============================================================

Deno.test("a non-last page self-invokes the next page_index via waitUntil", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () => makeClaimed({ doc: makeDoc(3) }),
  });
  const handler = createDesignRenderHandler(deps);
  await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(spy.waitUntilCalls.length, 1);
  await spy.waitUntilCalls[0]; // the handler's own .catch means this never rejects
  assertEquals(spy.selfInvokeCalls, [{ designId: 1, rev: 3, pageIndex: 1 }]);
});

Deno.test("a chunked continuation on a non-last page also chains to the next page_index", async () => {
  const priorManifest: ManifestEntry[] = [
    { page_id: "p1", r2_key: "contas/x/designs/1/3/p1.jpg", bytes: 100, width: 1080, height: 1080 },
  ];
  const { deps, spy } = makeDeps({
    readDesignRow: async () =>
      makeRow({
        rev: 3,
        render_status: "rendering",
        render_manifest: priorManifest,
        doc: makeDoc(3),
      }),
  });
  const handler = createDesignRenderHandler(deps);
  await handler(makeReq({ design_id: 1, rev: 3, page_index: 1 }));
  await spy.waitUntilCalls[0];
  assertEquals(spy.selfInvokeCalls, [{ designId: 1, rev: 3, pageIndex: 2 }]);
});

Deno.test("the last page never self-invokes", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () => makeClaimed({ doc: makeDoc(1) }),
  });
  const handler = createDesignRenderHandler(deps);
  await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(spy.waitUntilCalls.length, 0);
  assertEquals(spy.selfInvokeCalls.length, 0);
});

Deno.test("a self-invoke failure is caught and logged, not thrown into the response path", async () => {
  const selfInvokeError = new Error("network unreachable");
  const { deps, spy } = makeDeps({
    claimDesignRender: async () => makeClaimed({ doc: makeDoc(3) }),
    selfInvoke: async () => {
      throw selfInvokeError;
    },
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(res.status, 200); // the response already went out; chaining is fire-and-forget
  await spy.waitUntilCalls[0];
  assertEquals(spy.loggedErrors, [selfInvokeError]);
});

Deno.test("finalize returning 'stale' queues every manifest key for deletion and returns 204", async () => {
  const { deps, spy } = makeDeps({
    finalizeDesignRender: async () => "stale",
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(res.status, 204);
  assertEquals(spy.queueFileDeletionCalls, [`contas/${CONTA_ID}/designs/1/3/p1.jpg`]);
});

// ============================================================
// Chunked continuation (page_index present) — no live caller sends this yet (PR 1.5 adds
// self-invocation), but the abort/continue logic is page-index-agnostic and tested now.
// ============================================================

Deno.test("chunked call with a moved rev aborts and queues already-uploaded pages for deletion", async () => {
  const priorManifest: ManifestEntry[] = [
    { page_id: "p1", r2_key: `contas/${CONTA_ID}/designs/1/3/p1.jpg`, bytes: 100, width: 1080, height: 1080 },
  ];
  const { deps, spy } = makeDeps({
    readDesignRow: async () =>
      makeRow({ rev: 4, render_status: "rendering", render_manifest: priorManifest }),
  });
  const handler = createDesignRenderHandler(deps);
  // Client still thinks rev is 3 (stale) and is continuing at page_index 1.
  const res = await handler(makeReq({ design_id: 1, rev: 3, page_index: 1 }));
  assertEquals(res.status, 204);
  assertEquals(spy.queueFileDeletionCalls, [priorManifest[0].r2_key]);
});

Deno.test("chunked call whose status is no longer 'rendering' aborts the same way", async () => {
  const priorManifest: ManifestEntry[] = [
    { page_id: "p1", r2_key: "some/key/p1.jpg", bytes: 100, width: 1080, height: 1080 },
  ];
  const { deps, spy } = makeDeps({
    readDesignRow: async () =>
      makeRow({ rev: 3, render_status: "failed", render_manifest: priorManifest }),
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3, page_index: 1 }));
  assertEquals(res.status, 204);
  assertEquals(spy.queueFileDeletionCalls, ["some/key/p1.jpg"]);
});

Deno.test("manifest accumulation: a valid chunked continuation merges prior entries with the new one", async () => {
  const priorManifest: ManifestEntry[] = [
    { page_id: "p1", r2_key: "contas/x/designs/1/3/p1.jpg", bytes: 100, width: 1080, height: 1080 },
  ];
  const { deps, spy } = makeDeps({
    readDesignRow: async () =>
      makeRow({
        rev: 3,
        render_status: "rendering",
        render_manifest: priorManifest,
        doc: makeDoc(2),
      }),
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3, page_index: 1 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "rendered"); // page_index 1 is the last page of a 2-page doc
  assertEquals(spy.finalizeCalls[0].manifest.length, 2);
  assertEquals(spy.finalizeCalls[0].manifest[0].page_id, "p1");
  assertEquals(spy.finalizeCalls[0].manifest[1].page_id, "p2");
});

// ============================================================
// Error sanitization — raw render/DB errors must never reach the client or the stored
// render_error (security rule: never log/return raw error details).
// ============================================================

Deno.test("a render failure is sanitized before it reaches the client or fail_design_render", async () => {
  const rawError = new Error("satori: yoga panicked at offset 0x4f2 reading /etc/secrets");
  const { deps, spy } = makeDeps({
    renderPage: async () => {
      throw rawError;
    },
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, "render_failed");
  assertEquals(JSON.stringify(body).includes("yoga panicked"), false);
  assertEquals(spy.failCalls.length, 1);
  assertEquals(spy.failCalls[0].error.includes("yoga panicked"), false);
  assertEquals(spy.loggedErrors[0], rawError); // the raw error still reaches internal logs
});

Deno.test("an out-of-range page_index fails cleanly instead of throwing", async () => {
  const { deps, spy } = makeDeps({
    readDesignRow: async () => makeRow({ render_status: "rendering", doc: makeDoc(1) }),
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3, page_index: 5 }));
  assertEquals(res.status, 500);
  assertEquals(spy.failCalls.length, 1);
});

// ============================================================
// fail_design_render's SQL unconditionally NULLs out render_manifest — any R2 object already
// uploaded under this claim must be queued into file_deletions BEFORE calling failDesignRender,
// or it becomes permanently untracked (a real storage leak, not just a stuck row).
// ============================================================

Deno.test("finalize throwing a real error (not 'stale') queues this page's just-uploaded R2 object before failing", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () => makeClaimed({ doc: makeDoc(1) }),
    finalizeDesignRender: async () => {
      throw new Error("reel_video_missing");
    },
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3 }));
  assertEquals(res.status, 500);
  assertEquals(spy.queueFileDeletionCalls, [`contas/${CONTA_ID}/designs/1/3/p1.jpg`]);
  assertEquals(spy.failCalls.length, 1);
});

Deno.test("a page_index-out-of-range failure on a chunked continuation queues the prior chunks' manifest too", async () => {
  const priorManifest: ManifestEntry[] = [
    { page_id: "p1", r2_key: "contas/x/designs/1/3/p1.jpg", bytes: 100, width: 1080, height: 1080 },
  ];
  const { deps, spy } = makeDeps({
    readDesignRow: async () =>
      makeRow({
        rev: 3,
        render_status: "rendering",
        render_manifest: priorManifest,
        doc: makeDoc(1), // page_index 5 is out of range for a 1-page doc
      }),
  });
  const handler = createDesignRenderHandler(deps);
  const res = await handler(makeReq({ design_id: 1, rev: 3, page_index: 5 }));
  assertEquals(res.status, 500);
  assertEquals(spy.queueFileDeletionCalls, [priorManifest[0].r2_key]);
});
