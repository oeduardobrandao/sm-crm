import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { getRenderPages, type RenderStatusDeps } from "../_shared/design-render-status.ts";
import type { DesignDoc } from "../_shared/design-doc.ts";

const CONTA_ID = "11111111-1111-1111-1111-111111111111";
const POST_ID = 42;

function makeDoc(overrides: Partial<DesignDoc> = {}): DesignDoc {
  return {
    version: 1,
    format: "carrossel",
    aspect_ratio: "1:1",
    canvas: { width: 1080, height: 1080 },
    pages: [
      { id: "p1", background: { type: "solid", color: "#fff" }, layers: [] },
      { id: "p2", background: { type: "solid", color: "#fff" }, layers: [] },
    ],
    fileIds: [],
    ...overrides,
  };
}

function makeDeps(overrides: Partial<RenderStatusDeps> = {}): RenderStatusDeps {
  return {
    fetchDesignLinks: async () => [],
    fetchVideoThumbnail: async () => null,
    signUrl: async (r2Key) => `https://signed.example/${r2Key}`,
    ...overrides,
  };
}

Deno.test("feed/carrossel: zips design links to doc pages by sort_order", async () => {
  const deps = makeDeps({
    fetchDesignLinks: async () => [
      { file_id: 20, r2_key: "k2", width: 1080, height: 1080, sort_order: 1 },
      { file_id: 10, r2_key: "k1", width: 1080, height: 1080, sort_order: 0 },
    ],
  });
  const result = await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "carrossel", doc: makeDoc() });
  assertEquals(result, [
    { page_id: "p1", file_id: 10, preview_url: "https://signed.example/k1", w: 1080, h: 1080 },
    { page_id: "p2", file_id: 20, preview_url: "https://signed.example/k2", w: 1080, h: 1080 },
  ]);
});

Deno.test("feed/carrossel: stops at the current doc's page count when more links exist than pages (stale)", async () => {
  const deps = makeDeps({
    fetchDesignLinks: async () => [
      { file_id: 10, r2_key: "k1", width: 1080, height: 1080, sort_order: 0 },
      { file_id: 20, r2_key: "k2", width: 1080, height: 1080, sort_order: 1 },
      { file_id: 30, r2_key: "k3", width: 1080, height: 1080, sort_order: 2 },
    ],
  });
  const result = await getRenderPages(deps, {
    postId: POST_ID,
    contaId: CONTA_ID,
    tipo: "carrossel",
    doc: makeDoc(), // only 2 pages
  });
  assertEquals(result.length, 2);
});

Deno.test("feed/carrossel: fewer links than pages returns only what's actually rendered", async () => {
  const deps = makeDeps({
    fetchDesignLinks: async () => [
      { file_id: 10, r2_key: "k1", width: 1080, height: 1080, sort_order: 0 },
    ],
  });
  const result = await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "carrossel", doc: makeDoc() });
  assertEquals(result.length, 1);
  assertEquals(result[0].page_id, "p1");
});

Deno.test("feed/carrossel: no rendered links returns an empty array", async () => {
  const deps = makeDeps();
  const result = await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "feed", doc: makeDoc() });
  assertEquals(result, []);
});

Deno.test("feed/carrossel: never calls fetchVideoThumbnail", async () => {
  let called = false;
  const deps = makeDeps({ fetchVideoThumbnail: async () => { called = true; return null; } });
  await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "feed", doc: makeDoc() });
  assertEquals(called, false);
});

// ============================================================
// reels — sourced from the linked video's thumbnail_r2_key, never a post_file_links row
// ============================================================

Deno.test("reels: uses the video's thumbnail as the single rendered page", async () => {
  const deps = makeDeps({
    fetchVideoThumbnail: async () => ({ file_id: 99, thumbnail_r2_key: "thumb.jpg" }),
  });
  const doc = makeDoc({ format: "reel_cover", pages: [{ id: "p1", background: { type: "solid", color: "#fff" }, layers: [] }] });
  const result = await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "reels", doc });
  assertEquals(result, [
    { page_id: "p1", file_id: 99, preview_url: "https://signed.example/thumb.jpg", w: 1080, h: 1080 },
  ]);
});

Deno.test("reels: no thumbnail yet (never rendered) returns an empty array", async () => {
  const deps = makeDeps({ fetchVideoThumbnail: async () => null });
  const doc = makeDoc({ format: "reel_cover", pages: [{ id: "p1", background: { type: "solid", color: "#fff" }, layers: [] }] });
  const result = await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "reels", doc });
  assertEquals(result, []);
});

Deno.test("reels: a video row with a null thumbnail_r2_key returns an empty array", async () => {
  const deps = makeDeps({ fetchVideoThumbnail: async () => ({ file_id: 99, thumbnail_r2_key: null }) });
  const doc = makeDoc({ format: "reel_cover", pages: [{ id: "p1", background: { type: "solid", color: "#fff" }, layers: [] }] });
  const result = await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "reels", doc });
  assertEquals(result, []);
});

Deno.test("reels: never calls fetchDesignLinks", async () => {
  let called = false;
  const deps = makeDeps({
    fetchDesignLinks: async () => { called = true; return []; },
    fetchVideoThumbnail: async () => ({ file_id: 99, thumbnail_r2_key: "thumb.jpg" }),
  });
  const doc = makeDoc({ format: "reel_cover", pages: [{ id: "p1", background: { type: "solid", color: "#fff" }, layers: [] }] });
  await getRenderPages(deps, { postId: POST_ID, contaId: CONTA_ID, tipo: "reels", doc });
  assertEquals(called, false);
});
