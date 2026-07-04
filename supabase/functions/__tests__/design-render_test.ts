// design-render orchestrator (design-first) — claim → blob → render service → R2 →
// finalize → tipo-sync (attached + editable posts only). Trigger contract identical
// (x-cron-secret, {design_id, rev}, 204 nothing-to-do, 409 claim lost) so design-manage /
// sweep cron / publish gate need no changes. Unattached designs render too (gallery
// thumbnails); media application lives in the finalize RPC, not here.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createDesignRenderHandler,
  type ClaimedDesign,
  type DesignRenderDeps,
  type RenderServiceResult,
} from "../design-render/handler.ts";

const DESIGN_ID = 9;
const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const POST_ID = 42;
const SECRET = "cron-secret";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 7, 7]);
const JPEG_B64 = btoa(String.fromCharCode(...JPEG));

function serviceOk(overrides: Partial<RenderServiceResult> = {}): RenderServiceResult {
  return {
    validation: { ok: true, errors: [] },
    derived: { format: "feed", tipo: "feed" },
    pages: [{ frame_id: "f1", width: 1080, height: 1350, bytes: JPEG.length, jpeg_b64: JPEG_B64 }],
    ...overrides,
  };
}

interface Spy {
  putCalls: Array<{ key: string; bytes: Uint8Array }>;
  finalizeCalls: Array<{ designId: number; hash: string; manifest: unknown[] }>;
  failCalls: Array<{ designId: number; error: string }>;
  deletions: string[];
  tipoSyncs: Array<{ postId: number; tipo: string }>;
  serviceCalls: Array<{ tipo: string; bytes: number }>;
}

function makeClaimed(overrides: Partial<ClaimedDesign> = {}): ClaimedDesign {
  return {
    id: DESIGN_ID,
    conta_id: CONTA_ID,
    post_id: POST_ID,
    doc_r2_key: `designs/${CONTA_ID}/deadbeef-r3.fig`,
    doc_hash: "hash-3",
    format: "feed",
    post_tipo: "feed",
    post_status: "rascunho",
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DesignRenderDeps> = {}): { deps: DesignRenderDeps; spy: Spy } {
  const spy: Spy = { putCalls: [], finalizeCalls: [], failCalls: [], deletions: [], tipoSyncs: [], serviceCalls: [] };
  const deps: DesignRenderDeps = {
    buildCorsHeaders: () => ({}),
    cronSecret: SECRET,
    timingSafeEqual: (a, b) => a === b,
    readDesignRow: async () => ({ id: DESIGN_ID, rev: 3, render_status: "pending" }),
    claimDesignRender: async () => makeClaimed(),
    fetchBlob: async () => new Uint8Array([1, 2, 3]),
    callRenderService: async (bytes, tipo) => {
      spy.serviceCalls.push({ tipo, bytes: bytes.length });
      return serviceOk();
    },
    putObject: async (key, bytes) => {
      spy.putCalls.push({ key, bytes });
    },
    finalizeDesignRender: async (designId, hash, manifest) => {
      spy.finalizeCalls.push({ designId, hash, manifest });
      return "rendered";
    },
    failDesignRender: async (designId, error) => {
      spy.failCalls.push({ designId, error });
    },
    queueFileDeletion: async (key) => {
      spy.deletions.push(key);
    },
    syncPostTipo: async (postId, _contaId, tipo) => {
      spy.tipoSyncs.push({ postId, tipo });
    },
    logError: () => {},
    ...overrides,
  };
  return { deps, spy };
}

function trigger(body: unknown, secret = SECRET): Request {
  return new Request("https://x.test/design-render", {
    method: "POST",
    headers: { "x-cron-secret": secret, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.test("bad cron secret → 401", async () => {
  const { deps } = makeDeps();
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }, "nope"));
  assertEquals(res.status, 401);
});

Deno.test("superseded rev → 204, no claim", async () => {
  const { deps, spy } = makeDeps({ readDesignRow: async () => ({ id: DESIGN_ID, rev: 5, render_status: "pending" }) });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 204);
  assertEquals(spy.serviceCalls.length, 0);
});

Deno.test("claim lost → 409", async () => {
  const { deps } = makeDeps({ claimDesignRender: async () => null });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 409);
});

Deno.test("happy path: v1 key scheme, finalize with claimed hash, no tipo-sync when equal", async () => {
  const { deps, spy } = makeDeps();
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 200);
  assertEquals(spy.serviceCalls, [{ tipo: "feed", bytes: 3 }]);
  assertEquals(spy.putCalls.length, 1);
  assertEquals(spy.putCalls[0].key, `contas/${CONTA_ID}/designs/${DESIGN_ID}/3/f1.jpg`);
  assertEquals(spy.putCalls[0].bytes, JPEG);
  assertEquals(spy.finalizeCalls.length, 1);
  assertEquals(spy.finalizeCalls[0].hash, "hash-3");
  assertEquals((spy.finalizeCalls[0].manifest[0] as { page_id: string }).page_id, "f1");
  assertEquals(spy.tipoSyncs.length, 0); // derived feed === post feed
  assertEquals(spy.failCalls.length, 0);
});

Deno.test("derived tipo differs → tipo-sync after finalize", async () => {
  const { deps, spy } = makeDeps({
    callRenderService: async () =>
      serviceOk({
        derived: { format: "carrossel", tipo: "carrossel" },
        pages: [
          { frame_id: "f1", width: 1080, height: 1350, bytes: JPEG.length, jpeg_b64: JPEG_B64 },
          { frame_id: "f2", width: 1080, height: 1350, bytes: JPEG.length, jpeg_b64: JPEG_B64 },
        ],
      }),
  });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 200);
  assertEquals(spy.tipoSyncs, [{ postId: POST_ID, tipo: "carrossel" }]);
});

Deno.test("unattached design renders with format-derived tipo, no tipo-sync", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () =>
      makeClaimed({ post_id: null, post_tipo: null, post_status: null, format: "livre" }),
    callRenderService: async (bytes, tipo) => {
      spy.serviceCalls.push({ tipo, bytes: bytes.length });
      return serviceOk({ derived: { format: "feed", tipo: "feed" } });
    },
  });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 200);
  assertEquals(spy.serviceCalls, [{ tipo: "carrossel", bytes: 3 }]); // livre → carrossel mode
  assertEquals(spy.finalizeCalls.length, 1); // manifest stored by the RPC (no media here)
  assertEquals(spy.tipoSyncs.length, 0); // no post to sync
  assertEquals(spy.failCalls.length, 0);
});

Deno.test("attached to a locked post → renders, but never tipo-syncs", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () => makeClaimed({ post_status: "aprovado_cliente" }),
    callRenderService: async (bytes, tipo) => {
      spy.serviceCalls.push({ tipo, bytes: bytes.length });
      return serviceOk({ derived: { format: "carrossel", tipo: "carrossel" } });
    },
  });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 200);
  assertEquals(spy.finalizeCalls.length, 1); // RPC stores the manifest, skips media itself
  assertEquals(spy.tipoSyncs.length, 0); // locked post is never touched
});

Deno.test("unattached design with invalid frames → fail with tenant message", async () => {
  const { deps, spy } = makeDeps({
    claimDesignRender: async () =>
      makeClaimed({ post_id: null, post_tipo: null, post_status: null, format: "livre" }),
    callRenderService: async () =>
      serviceOk({
        validation: { ok: false, errors: [{ code: "no_frames", message: "O design não tem frames." }] },
        pages: [],
      }),
  });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 422);
  assertEquals(spy.failCalls, [{ designId: DESIGN_ID, error: "O design não tem frames." }]);
});

Deno.test("validation failure → fail with tenant message, nothing uploaded", async () => {
  const { deps, spy } = makeDeps({
    callRenderService: async () =>
      serviceOk({
        validation: { ok: false, errors: [{ code: "mixed_aspects", message: "Todos os frames…" }] },
        pages: [],
      }),
  });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 422);
  assertEquals(spy.putCalls.length, 0);
  assertEquals(spy.failCalls, [{ designId: DESIGN_ID, error: "Todos os frames…" }]);
});

Deno.test("mid-upload failure → fail generic + already-uploaded objects queued for deletion", async () => {
  let call = 0;
  const { deps, spy } = makeDeps({
    callRenderService: async () =>
      serviceOk({
        pages: [
          { frame_id: "f1", width: 1080, height: 1350, bytes: JPEG.length, jpeg_b64: JPEG_B64 },
          { frame_id: "f2", width: 1080, height: 1350, bytes: JPEG.length, jpeg_b64: JPEG_B64 },
        ],
      }),
    putObject: async (key, bytes) => {
      call += 1;
      if (call === 2) throw new Error("r2 down");
      spy.putCalls.push({ key, bytes });
    },
  });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 500);
  assertEquals(spy.deletions, [`contas/${CONTA_ID}/designs/${DESIGN_ID}/3/f1.jpg`]);
  assertEquals(spy.failCalls[0].error, "Falha ao renderizar o design.");
});

Deno.test("stale finalize → rendered pages queued for deletion, 204", async () => {
  const { deps, spy } = makeDeps({ finalizeDesignRender: async () => "stale" });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 204);
  assertEquals(spy.deletions, [`contas/${CONTA_ID}/designs/${DESIGN_ID}/3/f1.jpg`]);
  assertEquals(spy.failCalls.length, 0);
});

Deno.test("missing blob → fail, no service call", async () => {
  const { deps, spy } = makeDeps({ fetchBlob: async () => null });
  const res = await createDesignRenderHandler(deps)(trigger({ design_id: DESIGN_ID, rev: 3 }));
  assertEquals(res.status, 500);
  assertEquals(spy.serviceCalls.length, 0);
  assertEquals(spy.failCalls[0].error, "Documento do design não encontrado.");
});
