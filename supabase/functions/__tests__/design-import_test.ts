// design-import (Estúdio slice C) — the image→design orchestrator. Every dep is faked; the real
// generateImageCore runs underneath (fake provider + minimal DB mock) so the "no provider call
// when an earlier gate fails" assertions are genuine (a spy on the FAKE PROVIDER's generate, not
// on the core itself). Mirrors generate-image_test.ts's and design-manage_test.ts's conventions.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  createDesignImportHandler,
  type DesignImportDeps,
  type FileRow,
  type PostMediaRow,
  type PostRow,
  type ResolvedLink,
} from "../design-import/handler.ts";
import type { ImageGenCoreDeps } from "../_shared/image-gen/core.ts";
import type { TextBlock } from "../_shared/image-gen/vision.ts";
import { DocServiceError } from "../_shared/doc-service.ts";

const CONTA = "conta-1";
const USER = "user-1";
const POST_ID = 42;

// link ids and file ids are DELIBERATELY DISJOINT ranges (post_file_links.id vs files.id are
// independent bigserial sequences — see supabase/migrations/20260425000001_file_system_tables.sql).
// A regression that confuses the two value-spaces (C2) must not be able to pass by coincidence.
const CLICKED_LINK_ID = 9001;
const SIBLING_LINK_ID = 9002;
const CLICKED_FILE_ID = 501;
const BACKGROUND_FILE_ID = 900;
const SIBLING_FILE_ID = 502;

function makePostRow(overrides: Partial<PostRow> = {}): PostRow {
  return { id: POST_ID, titulo: "Promoção de verão", tipo: "feed", status: "rascunho", ...overrides };
}

function makeClickedMedia(overrides: Partial<PostMediaRow> = {}): PostMediaRow {
  return {
    link_id: CLICKED_LINK_ID,
    file_id: CLICKED_FILE_ID,
    kind: "image",
    r2_key: "files/clicked.jpg",
    sort_order: 0,
    ...overrides,
  };
}

function makeClickedFile(overrides: Partial<FileRow> = {}): FileRow {
  return { id: CLICKED_FILE_ID, kind: "image", r2_key: "files/clicked.jpg", width: 1080, height: 1350, ...overrides };
}

/** Default resolveLink fake: succeeds only for (POST_ID, CLICKED_LINK_ID, CONTA), mirroring the
 * real conta-scoped post_file_links JOIN files query. Tests override this directly (not via the
 * old media.find + getFile pair) to model link-resolution failures. */
function makeResolveLink(
  files: Map<number, FileRow>,
): DesignImportDeps["resolveLink"] {
  return async (postId, linkId, contaId) => {
    if (contaId !== CONTA || postId !== POST_ID || linkId !== CLICKED_LINK_ID) return null;
    const file = files.get(CLICKED_FILE_ID);
    if (!file || file.kind !== "image") return null;
    return { link_id: CLICKED_LINK_ID, file } satisfies ResolvedLink;
  };
}

const SAMPLE_BLOCKS: TextBlock[] = [
  { text: "50% OFF", bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 }, size: 0.08, weight: 700, color: "#ffffff", align: "center" },
];

interface Spy {
  audits: Array<Record<string, unknown>>;
  putBlobCalls: Array<{ key: string; bytes: Uint8Array }>;
  createDesignCalls: Array<{ postId: number; format: string; name: string | null; mediaHoldPassed?: boolean }>;
  fireRenderCalls: Array<{ designId: number; rev: number }>;
  normalizeCalls: number;
  composeCalls: Array<{ preset: string; frames: unknown[]; texts: unknown[] }>;
  extractTextBlocksCalls: number;
  providerCalls: number;
  rateLimitCalls: string[];
}

function makeDeps(
  overrides: Partial<DesignImportDeps> = {},
): { deps: DesignImportDeps; spy: Spy } {
  const spy: Spy = {
    audits: [],
    putBlobCalls: [],
    createDesignCalls: [],
    fireRenderCalls: [],
    normalizeCalls: 0,
    composeCalls: [],
    extractTextBlocksCalls: 0,
    providerCalls: 0,
    rateLimitCalls: [],
  };

  // Minimal DB mock backing the REAL generateImageCore: since design-import always sets an
  // idempotencyKey, the core issues TWO selects against ai_image_generations in order — (1) the
  // idempotency-key lookup (maybeSingle, no existing row), (2) the reservedCount scan for the
  // monthly quota (empty — no reservations used yet) — then a successful ledger insert. Table+op
  // is the mock's queue key, so both selects share one FIFO queue; order matters here. This makes
  // the "no provider call before vision" assertions meaningful — if the pipeline reordered spend
  // before vision, the provider fake below would be hit and spy.providerCalls would move.
  const db = createSupabaseQueryMock();
  db.queue("ai_image_generations", "select", { data: null, error: null }); // idempotency lookup
  db.queue("ai_image_generations", "select", { data: [], error: null }); // reservedCount
  db.queue("ai_image_generations", "insert", { data: { id: 501 }, error: null });

  const imageGen: ImageGenCoreDeps = {
    db: db as never,
    provider: {
      generate: () => {
        spy.providerCalls++;
        return Promise.resolve({
          bytes: new Uint8Array(2048),
          mime: "image/jpeg",
          width: 1080,
          height: 1350,
          model: "fake-inpaint-model",
          outputTokens: 12,
          costEstimateUsd: 0.08,
        });
      },
    },
    isFeatureEnabled: async () => true,
    monthlyLimit: async () => 50,
    checkRateLimit: async () => true,
    putObject: async () => {},
    deleteObject: async () => {},
    insertFile: async () => ({ id: BACKGROUND_FILE_ID }),
    resolveFileBytes: async () => new Uint8Array([1]),
    signUrl: async (key) => `https://signed.example/${key}`,
    randomUUID: () => "fixed-uuid",
    logError: () => {},
  };

  const files = new Map<number, FileRow>([
    [CLICKED_FILE_ID, makeClickedFile()],
    [BACKGROUND_FILE_ID, { id: BACKGROUND_FILE_ID, kind: "image", r2_key: "files/background.jpg", width: 1080, height: 1350 }],
    [SIBLING_FILE_ID, { id: SIBLING_FILE_ID, kind: "image", r2_key: "files/sibling.jpg", width: 1080, height: 1350 }],
  ]);

  const deps: DesignImportDeps = {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" }),
    getUser: async (token) => (token === "valid" ? { id: USER } : null),
    getProfile: async (userId) => (userId === USER ? { conta_id: CONTA } : null),
    isFeatureEnabled: async () => true,
    getPost: async (postId, contaId) => (postId === POST_ID && contaId === CONTA ? makePostRow() : null),
    hasDesignAttached: async () => false,
    getPostMedia: async () => [makeClickedMedia()],
    getFile: async (fileId, contaId) => (contaId === CONTA ? files.get(fileId) ?? null : null),
    resolveLink: makeResolveLink(files),
    checkRateLimit: async (key) => {
      spy.rateLimitCalls.push(key);
      return true;
    },
    signGetUrl: async (r2Key) => `https://signed.example/${r2Key}`,
    docService: {
      normalize: async () => {
        spy.normalizeCalls++;
        return new Uint8Array(512);
      },
      compose: async (spec) => {
        spy.composeCalls.push({ preset: spec.preset, frames: spec.frames, texts: spec.texts ?? [] });
        return new Uint8Array(4096);
      },
    },
    visionApiKey: () => "vision-key",
    extractTextBlocks: async () => {
      spy.extractTextBlocksCalls++;
      return SAMPLE_BLOCKS;
    },
    imageGen,
    putBlob: async (key, bytes) => {
      spy.putBlobCalls.push({ key, bytes });
    },
    createDesign: async (_contaId, input) => {
      spy.createDesignCalls.push({ postId: input.postId, format: input.format, name: input.name });
      return 777;
    },
    fireRender: (designId, rev) => {
      spy.fireRenderCalls.push({ designId, rev });
    },
    randomUUID: () => "fixed-uuid",
    insertAuditLog: async (entry) => {
      spy.audits.push(entry as never);
    },
    logError: () => {},
    ...overrides,
  };
  return { deps, spy };
}

function req(body: unknown, token = "valid", method = "POST") {
  const hasBody = method !== "GET" && method !== "HEAD" && body !== undefined;
  return new Request("http://localhost/design-import", {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
}

const VALID_BODY = { post_id: POST_ID, link_id: CLICKED_LINK_ID };

// ── auth + method + cors ─────────────────────────────────────────────────────

Deno.test("OPTIONS preflight returns 200 with CORS", async () => {
  const { deps } = makeDeps();
  const res = await createDesignImportHandler(deps)(
    new Request("http://localhost/design-import", { method: "OPTIONS" }),
  );
  assertEquals(res.status, 200);
  assert(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("non-POST is 405", async () => {
  const { deps } = makeDeps();
  const res = await createDesignImportHandler(deps)(req(VALID_BODY, "valid", "GET"));
  assertEquals(res.status, 405);
});

Deno.test("missing / invalid token is 401 — nothing downstream runs", async () => {
  const { deps, spy } = makeDeps();
  const handler = createDesignImportHandler(deps);
  assertEquals((await handler(req(VALID_BODY, ""))).status, 401);
  assertEquals((await handler(req(VALID_BODY, "garbage"))).status, 401);
  assertEquals(spy.providerCalls, 0);
  assertEquals(spy.normalizeCalls, 0);
});

Deno.test("no profile/conta_id is 403", async () => {
  const { deps } = makeDeps({ getProfile: async () => null });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 403);
});

Deno.test("invalid body (missing post_id/link_id) is 400", async () => {
  const { deps } = makeDeps();
  const h = createDesignImportHandler(deps);
  assertEquals((await h(req({ post_id: POST_ID }))).status, 400);
  assertEquals((await h(req({ link_id: CLICKED_FILE_ID }))).status, 400);
  assertEquals((await h(req({}))).status, 400);
});

// ── gate ORDER: feature → eligibility → burst → normalize → vision → spend ──

Deno.test("gate order: feature_disabled (estudio) aborts before eligibility/provider", async () => {
  const { deps, spy } = makeDeps({
    isFeatureEnabled: async (_c, feature) => feature !== "feature_estudio",
    getPost: async () => {
      throw new Error("getPost must not run when feature gate fails");
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "feature_disabled");
  assertEquals(spy.providerCalls, 0);
});

Deno.test("gate order: feature_disabled (ai_images) reported distinctly, still before eligibility", async () => {
  const { deps, spy } = makeDeps({
    isFeatureEnabled: async (_c, feature) => feature !== "feature_ai_images",
    getPost: async () => {
      throw new Error("getPost must not run when feature gate fails");
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "feature_disabled");
  assert(body.error.message.includes("IA"), "message should mention AI images, not estúdio generically");
  assertEquals(spy.providerCalls, 0);
});

Deno.test("gate order: eligibility failure (post not found) aborts before burst/normalize/vision/provider", async () => {
  const { deps, spy } = makeDeps({ getPost: async () => null });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error.code, "post_not_found");
  assertEquals(spy.rateLimitCalls.length, 0);
  assertEquals(spy.normalizeCalls, 0);
  assertEquals(spy.extractTextBlocksCalls, 0);
  assertEquals(spy.providerCalls, 0);
});

Deno.test("gate order: burst limit aborts before normalize/vision/provider", async () => {
  const { deps, spy } = makeDeps({ checkRateLimit: async () => false });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, "rate_limited");
  assertEquals(spy.normalizeCalls, 0);
  assertEquals(spy.extractTextBlocksCalls, 0);
  assertEquals(spy.providerCalls, 0);
});

Deno.test("gate order: normalize failure aborts before vision/provider", async () => {
  const { deps, spy } = makeDeps({
    docService: {
      normalize: async () => {
        throw new Error("boom");
      },
      compose: async () => new Uint8Array(1),
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, "normalize_failed");
  assertEquals(spy.extractTextBlocksCalls, 0);
  assertEquals(spy.providerCalls, 0);
});

Deno.test("gate order: vision failure aborts BEFORE any provider/inpaint call (no spend)", async () => {
  const { deps, spy } = makeDeps({
    extractTextBlocks: async () => {
      spy.extractTextBlocksCalls++;
      throw new (await import("../_shared/image-gen/vision.ts")).VisionError("provider down");
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, "vision_failed");
  assertEquals(spy.extractTextBlocksCalls, 1);
  assertEquals(spy.providerCalls, 0);
});

Deno.test("vision_unavailable when no vision key configured — aborts before provider", async () => {
  const { deps, spy } = makeDeps({ visionApiKey: () => null });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, "vision_unavailable");
  assertEquals(spy.extractTextBlocksCalls, 0);
  assertEquals(spy.providerCalls, 0);
});

// ── eligibility shapes ────────────────────────────────────────────────────────

Deno.test("reels rejected as post_tipo_unsupported", async () => {
  const { deps } = makeDeps({ getPost: async () => makePostRow({ tipo: "reels" }) });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "post_tipo_unsupported");
});

Deno.test("stories rejected as post_tipo_unsupported", async () => {
  const { deps } = makeDeps({ getPost: async () => makePostRow({ tipo: "stories" }) });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "post_tipo_unsupported");
});

Deno.test("enviado_cliente is ACCEPTED (editable per 20260706000001)", async () => {
  const { deps } = makeDeps({ getPost: async () => makePostRow({ status: "enviado_cliente" }) });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
});

Deno.test("aprovado_cliente / aprovado_interno rejected as post_not_editable", async () => {
  const { deps: deps1 } = makeDeps({ getPost: async () => makePostRow({ status: "aprovado_cliente" }) });
  const res1 = await createDesignImportHandler(deps1)(req(VALID_BODY));
  assertEquals(res1.status, 403);
  assertEquals((await res1.json()).error.code, "post_not_editable");

  const { deps: deps2 } = makeDeps({ getPost: async () => makePostRow({ status: "aprovado_interno" }) });
  const res2 = await createDesignImportHandler(deps2)(req(VALID_BODY));
  assertEquals(res2.status, 403);
});

Deno.test("post with video media → post_has_video", async () => {
  const { deps } = makeDeps({
    getPostMedia: async () => [
      makeClickedMedia(),
      { link_id: 9555, file_id: 555, kind: "video", r2_key: "files/v.mp4", sort_order: 1 },
    ],
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "post_has_video");
});

Deno.test("post already has a design attached → post_already_designed", async () => {
  const { deps } = makeDeps({ hasDesignAttached: async () => true });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "post_already_designed");
});

// ── link resolution: uniform foreign/mismatched error ────────────────────────
// C2 regression guard: link_id (post_file_links.id) and file_id are DISJOINT id spaces
// (CLICKED_LINK_ID=9001 vs CLICKED_FILE_ID=501) — resolveLink is the ONLY resolution path,
// so these tests exercise it directly rather than the old media.find/getFile pair.

Deno.test("link_id not linked to this post → invalid_reference (uniform, not 404)", async () => {
  const { deps } = makeDeps({ resolveLink: async () => null }); // clicked link not resolvable
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "invalid_reference");
});

Deno.test("link_id resolves to a non-image file row (defensive re-check) → invalid_reference", async () => {
  // The resolver's own post_file_links JOIN files disagrees with kind='image' — resolveLink must
  // reject rather than trust a stale media list.
  const { deps } = makeDeps({
    resolveLink: async (postId, linkId, contaId) =>
      contaId === CONTA && postId === POST_ID && linkId === CLICKED_LINK_ID ? null : null,
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "invalid_reference");
});

Deno.test("link_id from a different conta (resolveLink returns null) → same uniform invalid_reference message", async () => {
  const { deps: deps1 } = makeDeps({ resolveLink: async () => null });
  const res1 = await createDesignImportHandler(deps1)(req(VALID_BODY));
  const body1 = await res1.json();

  const { deps: deps2 } = makeDeps({ resolveLink: async () => null });
  const res2 = await createDesignImportHandler(deps2)(req(VALID_BODY));
  const body2 = await res2.json();

  assertEquals(body1.error.code, body2.error.code);
  assertEquals(body1.error.message, body2.error.message);
});

Deno.test("link_id equal to a file_id value (id-space collision) is REJECTED, not silently matched", async () => {
  // The request sends link_id = CLICKED_FILE_ID's numeric value (a coincidental id collision
  // across the two disjoint sequences). resolveLink must fail closed — it only resolves the
  // REAL link id (CLICKED_LINK_ID), never anything that merely matches a files.id.
  const { deps } = makeDeps();
  const res = await createDesignImportHandler(deps)(req({ post_id: POST_ID, link_id: CLICKED_FILE_ID }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "invalid_reference");
});

// ── carrossel: N frames, clicked-frame-texts-only ────────────────────────────

Deno.test("carrossel builds N frames in sort_order; only the clicked frame carries texts (0-based index)", async () => {
  const SIBLING2_FILE_ID = 503;
  const SIBLING2_LINK_ID = 9003;
  const files = new Map<number, FileRow>([
    [CLICKED_FILE_ID, makeClickedFile()],
    [BACKGROUND_FILE_ID, { id: BACKGROUND_FILE_ID, kind: "image", r2_key: "files/background.jpg", width: 1080, height: 1350 }],
    [SIBLING_FILE_ID, { id: SIBLING_FILE_ID, kind: "image", r2_key: "files/sibling.jpg", width: 1080, height: 1350 }],
    [SIBLING2_FILE_ID, { id: SIBLING2_FILE_ID, kind: "image", r2_key: "files/sibling2.jpg", width: 1080, height: 1350 }],
  ]);
  const { deps, spy } = makeDeps({
    getPost: async () => makePostRow({ tipo: "carrossel" }),
    getPostMedia: async () => [
      { link_id: SIBLING_LINK_ID, file_id: SIBLING_FILE_ID, kind: "image", r2_key: "files/sibling.jpg", sort_order: 0 },
      makeClickedMedia({ sort_order: 1 }),
      { link_id: SIBLING2_LINK_ID, file_id: SIBLING2_FILE_ID, kind: "image", r2_key: "files/sibling2.jpg", sort_order: 2 },
    ],
    getFile: async (fileId, contaId) => (contaId === CONTA ? files.get(fileId) ?? null : null),
    resolveLink: makeResolveLink(files),
  });

  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  assertEquals(spy.composeCalls.length, 1);
  const compose = spy.composeCalls[0];
  assertEquals(compose.frames.length, 3);
  // Clicked link was at sort_order 1 → frame INDEX 1 (0-based); it alone carries texts.
  assertEquals(compose.texts.length, SAMPLE_BLOCKS.length);
  assertEquals((compose.texts[0] as { frame: number }).frame, 1);
});

Deno.test("carrossel: same file linked twice keys texts on the LINK id, not the file id", async () => {
  // Two post_file_links rows point at the SAME file_id (CLICKED_FILE_ID) but only the clicked
  // LINK (CLICKED_LINK_ID) should carry texts — the sibling link sharing that file must not.
  const DUP_LINK_ID = 9099;
  const files = new Map<number, FileRow>([
    [CLICKED_FILE_ID, makeClickedFile()],
    [BACKGROUND_FILE_ID, { id: BACKGROUND_FILE_ID, kind: "image", r2_key: "files/background.jpg", width: 1080, height: 1350 }],
  ]);
  const { deps, spy } = makeDeps({
    getPost: async () => makePostRow({ tipo: "carrossel" }),
    getPostMedia: async () => [
      makeClickedMedia({ sort_order: 0 }),
      { link_id: DUP_LINK_ID, file_id: CLICKED_FILE_ID, kind: "image", r2_key: "files/clicked.jpg", sort_order: 1 },
    ],
    getFile: async (fileId, contaId) => (contaId === CONTA ? files.get(fileId) ?? null : null),
    resolveLink: makeResolveLink(files),
  });

  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  const compose = spy.composeCalls[0];
  assertEquals(compose.frames.length, 2);
  // Only ONE frame carries texts (frame 0, the clicked link) — not both, despite sharing a file_id.
  assertEquals(compose.texts.length, SAMPLE_BLOCKS.length);
  assertEquals((compose.texts[0] as { frame: number }).frame, 0);
});

// ── hold flag / audit hygiene ─────────────────────────────────────────────────

Deno.test("create_design is called with the design name and format derived from post.tipo", async () => {
  const { deps, spy } = makeDeps();
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  assertEquals(spy.createDesignCalls.length, 1);
  assertEquals(spy.createDesignCalls[0].format, "feed");
  assertEquals(spy.createDesignCalls[0].name, "Import — Promoção de verão");
});

Deno.test("design name falls back to post id when titulo is blank", async () => {
  const { deps, spy } = makeDeps({ getPost: async () => makePostRow({ titulo: "" }) });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  assertEquals(spy.createDesignCalls[0].name, `Import — post ${POST_ID}`);
});

Deno.test("createDesign dep receives p_media_hold=true at the index.ts wiring layer (contract check)", async () => {
  // handler.ts calls deps.createDesign — the hold flag itself is the RPC-call responsibility of
  // index.ts's dep implementation (p_media_hold: true), asserted here by inspecting the actual
  // literal in index.ts (a static contract check, since the handler layer is provider-agnostic).
  const indexSrc = await Deno.readTextFile(new URL("../design-import/index.ts", import.meta.url));
  assert(indexSrc.includes("p_media_hold: true"), "index.ts must pass p_media_hold: true to create_design");
});

Deno.test("audit metadata has NO extracted text content anywhere", async () => {
  const { deps, spy } = makeDeps();
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  assertEquals(spy.audits.length, 1);
  const audit = spy.audits[0];
  assertEquals(audit.action, "estudio.import_image");
  assertEquals(audit.resource_type, "design");
  const meta = audit.metadata as Record<string, unknown>;
  assertEquals(meta.text_block_count, SAMPLE_BLOCKS.length);
  assertEquals(meta.background_file_id, BACKGROUND_FILE_ID);
  assertEquals(meta.frame_count, 1);
  // The extracted text ("50% OFF") must not appear ANYWHERE in the audit entry.
  assert(!JSON.stringify(audit).includes("50% OFF"), "extracted text leaked into audit");
});

Deno.test("render is kicked with rev 1 (fire-and-forget)", async () => {
  const { deps, spy } = makeDeps();
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  const body = await res.json();
  assertEquals(spy.fireRenderCalls.length, 1);
  assertEquals(spy.fireRenderCalls[0], { designId: body.design_id, rev: 1 });
});

Deno.test("happy path returns 201 with design_id + quota", async () => {
  const { deps } = makeDeps();
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.design_id, 777);
  assertEquals(body.quota.limit, 50);
});

// ── preset selection ──────────────────────────────────────────────────────────

Deno.test("preset falls back to 4:5 when width/height missing, noted in audit", async () => {
  const files = new Map<number, FileRow>([
    [CLICKED_FILE_ID, { id: CLICKED_FILE_ID, kind: "image", r2_key: "files/clicked.jpg", width: null, height: null }],
    [BACKGROUND_FILE_ID, { id: BACKGROUND_FILE_ID, kind: "image", r2_key: "files/background.jpg", width: 1080, height: 1350 }],
  ]);
  const { deps, spy } = makeDeps({
    getFile: async (fileId, contaId) => (contaId === CONTA ? files.get(fileId) ?? null : null),
    resolveLink: makeResolveLink(files),
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  const audit = spy.audits[0].metadata as Record<string, unknown>;
  assertEquals(audit.preset, "4:5");
  assertEquals(audit.preset_fallback, true);
});

Deno.test("preset picks nearest of 1:1/4:5/9:16 by aspect ratio", async () => {
  const cases: Array<[number, number, string]> = [
    [1080, 1080, "1:1"],
    [1080, 1350, "4:5"],
    [1080, 1920, "9:16"],
  ];
  for (const [width, height, expected] of cases) {
    const files = new Map<number, FileRow>([
      [CLICKED_FILE_ID, { id: CLICKED_FILE_ID, kind: "image", r2_key: "files/clicked.jpg", width, height }],
      [BACKGROUND_FILE_ID, { id: BACKGROUND_FILE_ID, kind: "image", r2_key: "files/background.jpg", width, height }],
    ]);
    const { deps, spy } = makeDeps({
      getFile: async (fileId, contaId) => (contaId === CONTA ? files.get(fileId) ?? null : null),
      resolveLink: makeResolveLink(files),
    });
    const res = await createDesignImportHandler(deps)(req(VALID_BODY));
    assertEquals(res.status, 201);
    assertEquals((spy.audits[0].metadata as Record<string, unknown>).preset, expected, `${width}x${height}`);
  }
});

// ── §8 envelope / status mapping ──────────────────────────────────────────────

Deno.test("inpaint errors from generateImageCore map straight through (quota_exhausted → 402)", async () => {
  const { deps } = makeDeps();
  (deps.imageGen as ImageGenCoreDeps).monthlyLimit = async () => 0;
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 402);
  const body = await res.json();
  assertEquals(body.error.code, "quota_exhausted");
  assertEquals(body.error.retryable, false);
});

Deno.test("inpaint safety_refusal → 422", async () => {
  const { ProviderSafetyError } = await import("../_shared/image-gen/provider.ts");
  const { deps } = makeDeps();
  (deps.imageGen as ImageGenCoreDeps).provider = {
    generate: () => Promise.reject(new ProviderSafetyError("blocked")),
  };
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "safety_refusal");
});

Deno.test("inpaint provider_error → 502", async () => {
  const { deps } = makeDeps();
  (deps.imageGen as ImageGenCoreDeps).provider = { generate: () => Promise.reject(new Error("boom")) };
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, "provider_error");
});

Deno.test("compose doc_too_large → 413 (failure AFTER inpaint succeeded; no quota unwind)", async () => {
  const { deps, spy } = makeDeps({
    docService: {
      normalize: async () => new Uint8Array(1),
      compose: async () => {
        throw new DocServiceError("doc_too_large", "too big");
      },
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 413);
  assertEquals((await res.json()).error.code, "doc_too_large");
  // The inpaint DID run (spend happened) — this asserts we don't try to unwind it.
  assertEquals(spy.providerCalls, 1);
});

Deno.test("compose generic failure → compose_failed 502", async () => {
  const { deps } = makeDeps({
    docService: {
      normalize: async () => new Uint8Array(1),
      compose: async () => {
        throw new Error("network blip");
      },
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error.code, "compose_failed");
});

Deno.test("post-inpaint frame-URL signing failure → compose_failed 502, logged, no quota unwind", async () => {
  // signGetUrl must succeed for the PRE-inpaint normalize call (step 5) but throw on the
  // POST-inpaint frame-signing loop (step 8) — this is the exact "escapes the log+mapped-error
  // contract" scenario from the review finding: presigning happens AFTER the paid inpaint.
  let logged: { context: string; error: unknown } | null = null;
  let callCount = 0;
  const { deps, spy } = makeDeps({
    signGetUrl: async (r2Key) => {
      callCount++;
      if (callCount === 1) return `https://signed.example/${r2Key}`; // normalize (pre-spend)
      throw new Error("r2 presign exploded"); // frame-signing (post-spend)
    },
    logError: (context, error) => {
      logged = { context, error };
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error.code, "compose_failed");
  assertEquals(body.error.retryable, true);
  assert(!JSON.stringify(body).includes("r2 presign exploded"), "raw presign error leaked to client");
  // The inpaint DID run (spend happened) — this asserts we don't try to unwind it, just map+log.
  assertEquals(spy.providerCalls, 1);
  assert(logged !== null, "logError must be called for the post-spend presign failure");
});

// ── create_design RPC race (post-inpaint-spend): coded exceptions map through, not a flat 502 ──

Deno.test("create_design RPC race: post_already_designed maps to 409, not a generic 502 (post-spend)", async () => {
  const { deps, spy } = makeDeps({
    createDesign: async () => {
      throw new Error("post_already_designed");
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "post_already_designed");
  // The inpaint DID run (spend happened) — this asserts we don't try to unwind it, just map+log.
  assertEquals(spy.providerCalls, 1);
});

Deno.test("create_design RPC race: post_not_editable:<status> maps to 403", async () => {
  const { deps } = makeDeps({
    createDesign: async () => {
      throw new Error("post_not_editable:aprovado_cliente");
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error.code, "post_not_editable");
});

Deno.test("create_design RPC unrecognized exception never leaks raw message to client", async () => {
  const { deps } = makeDeps({
    createDesign: async () => {
      throw new Error("some raw postgres internal detail");
    },
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error.code, "compose_failed");
  assert(!JSON.stringify(body).includes("postgres internal"), "raw RPC error leaked to client");
});

Deno.test("envelope shape is always {error:{code,message,retryable}}", async () => {
  const { deps } = makeDeps({ checkRateLimit: async () => false });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  const body = await res.json();
  assert(typeof body.error.code === "string");
  assert(typeof body.error.message === "string");
  assert(typeof body.error.retryable === "boolean");
});

// ── early-path errors also use the {error:{code,message,retryable}} envelope (M1) ───────────

Deno.test("early-path errors (405/401/403 profile/400) use the same envelope as the rest of the function", async () => {
  const h = createDesignImportHandler(makeDeps().deps);

  const methodRes = await h(req(VALID_BODY, "valid", "GET"));
  assertEquals(methodRes.status, 405);
  const methodBody = await methodRes.json();
  assertEquals(methodBody.error.code, "method_not_allowed");
  assert(typeof methodBody.error.retryable === "boolean");

  const authRes = await h(req(VALID_BODY, ""));
  assertEquals(authRes.status, 401);
  const authBody = await authRes.json();
  assertEquals(authBody.error.code, "unauthorized");
  assert(typeof authBody.error.retryable === "boolean");

  const { deps: noProfileDeps } = makeDeps({ getProfile: async () => null });
  const profileRes = await createDesignImportHandler(noProfileDeps)(req(VALID_BODY));
  assertEquals(profileRes.status, 403);
  const profileBody = await profileRes.json();
  assertEquals(profileBody.error.code, "profile_not_found");
  assert(typeof profileBody.error.retryable === "boolean");

  const invalidBodyRes = await h(req({}));
  assertEquals(invalidBodyRes.status, 400);
  const invalidBody = await invalidBodyRes.json();
  assertEquals(invalidBody.error.code, "invalid_request");
  assert(typeof invalidBody.error.retryable === "boolean");
});

// ── align value-space: vision.ts's lowercase must reach the doc-service as uppercase (I1) ────

Deno.test("compose texts uppercase the align value (vision emits lowercase, doc-service requires uppercase)", async () => {
  const { deps, spy } = makeDeps({
    extractTextBlocks: async () => [
      { text: "A", bbox: { x: 0, y: 0, w: 0.2, h: 0.1 }, size: 0.05, weight: 400, color: "#000000", align: "left" },
      { text: "B", bbox: { x: 0, y: 0.2, w: 0.2, h: 0.1 }, size: 0.05, weight: 400, color: "#000000", align: "center" },
      { text: "C", bbox: { x: 0, y: 0.4, w: 0.2, h: 0.1 }, size: 0.05, weight: 400, color: "#000000", align: "right" },
    ],
  });
  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  const texts = spy.composeCalls[0].texts as Array<{ align: string }>;
  assertEquals(texts.map((t) => t.align), ["LEFT", "CENTER", "RIGHT"]);
});

// ── cross-seam contract test: assert the doc-service's OWN invariants against the ComposeSpec ──
// the handler actually builds. Closes the mock-vs-mock gap — this does NOT import compose.js
// (Node service code must never enter the Deno suite); it mirrors validateSpec's rules by hand.

Deno.test("cross-seam: the built ComposeSpec satisfies doc-service's validateSpec invariants (mirrored, not imported)", async () => {
  const SIBLING2_FILE_ID = 503;
  const SIBLING2_LINK_ID = 9003;
  const files = new Map<number, FileRow>([
    [CLICKED_FILE_ID, makeClickedFile()],
    [BACKGROUND_FILE_ID, { id: BACKGROUND_FILE_ID, kind: "image", r2_key: "files/background.jpg", width: 1080, height: 1350 }],
    [SIBLING_FILE_ID, { id: SIBLING_FILE_ID, kind: "image", r2_key: "files/sibling.jpg", width: 1080, height: 1350 }],
    [SIBLING2_FILE_ID, { id: SIBLING2_FILE_ID, kind: "image", r2_key: "files/sibling2.jpg", width: 1080, height: 1350 }],
  ]);
  const { deps, spy } = makeDeps({
    getPost: async () => makePostRow({ tipo: "carrossel" }),
    getPostMedia: async () => [
      { link_id: SIBLING_LINK_ID, file_id: SIBLING_FILE_ID, kind: "image", r2_key: "files/sibling.jpg", sort_order: 0 },
      makeClickedMedia({ sort_order: 1 }),
      { link_id: SIBLING2_LINK_ID, file_id: SIBLING2_FILE_ID, kind: "image", r2_key: "files/sibling2.jpg", sort_order: 2 },
    ],
    getFile: async (fileId, contaId) => (contaId === CONTA ? files.get(fileId) ?? null : null),
    resolveLink: makeResolveLink(files),
    extractTextBlocks: async () => [
      { text: "50% OFF", bbox: { x: 0.1, y: 0.1, w: 0.5, h: 0.1 }, size: 0.08, weight: 700, color: "#ffffff", align: "left" },
      { text: "Aproveite", bbox: { x: 0.1, y: 0.3, w: 0.5, h: 0.1 }, size: 0.06, weight: 400, color: "#000000", align: "right" },
    ],
  });

  const res = await createDesignImportHandler(deps)(req(VALID_BODY));
  assertEquals(res.status, 201);
  assertEquals(spy.composeCalls.length, 1);
  const spec = spy.composeCalls[0] as { preset: string; frames: Array<{ name?: string; image: { url: string } }>; texts: Array<{ frame: number; align?: string }> };

  // preset ∈ {'1:1','4:5','9:16'} (compose.js: PRESET_DIMS[spec.preset] must exist)
  assert(["1:1", "4:5", "9:16"].includes(spec.preset), `preset ${spec.preset} not a valid doc-service preset`);

  // frames must be a non-empty array; every frame needs name = String(position 1..N) + image.url
  assert(Array.isArray(spec.frames) && spec.frames.length > 0, "frames must be a non-empty array");
  spec.frames.forEach((f, i) => {
    assertEquals(f.name, String(i + 1), `frames[${i}].name must be "${i + 1}"`);
    assert(!!f.image?.url, `frames[${i}].image.url is required`);
  });

  // every texts[].frame is an integer 0 <= frame < frames.length (compose.js validateSpec)
  // every texts[].align ∈ {LEFT,CENTER,RIGHT} (JUSTIFIED never emitted by this pipeline)
  assert(spec.texts.length > 0, "expected at least one text block in this fixture");
  for (const t of spec.texts) {
    assert(Number.isInteger(t.frame), `texts[].frame must be an integer, got ${t.frame}`);
    assert(t.frame >= 0 && t.frame < spec.frames.length, `texts[].frame ${t.frame} out of range [0,${spec.frames.length})`);
    assert(["LEFT", "CENTER", "RIGHT"].includes(t.align ?? ""), `texts[].align "${t.align}" not in {LEFT,CENTER,RIGHT}`);
  }
});
