// T5.5 — preview_design + get_design_capabilities (design §9): discovery shapes, tenancy,
// the read-only brand block (logo only when materialized), quota snapshot, and the preview's
// guards + full render path (satori → resvg → mozjpeg with real font bytes).
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { McpStructuredError } from "../mcp/design.ts";
import {
  getDesignCapabilities,
  PREVIEW_DEFAULT_WIDTH,
  previewDesign,
} from "../mcp/capabilities.ts";
import type { Deps } from "../mcp/queries.ts";

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["posts:read"],
  key_id: "key-1",
  created_by: "user-1",
};

function makeDeps(
  db: ReturnType<typeof createSupabaseQueryMock>,
  extra: Partial<Deps> = {},
): Deps {
  return {
    db: db as never,
    ctx: CTX,
    isFeatureEnabled: async () => true,
    imageGen: {
      db: db as never,
      provider: { generate: () => Promise.reject(new Error("unused")) },
      monthlyLimit: async () => 50,
    },
    ...extra,
  } as Deps;
}

// ── get_design_capabilities ──────────────────────────────────────────────────

Deno.test("capabilities: formats/canvases/tipo mapping + fonts + limits from the single sources", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ai_image_generations", "select", { data: [], error: null }); // quota snapshot
  const out = await getDesignCapabilities(makeDeps(db), {});

  const feed = out.formats.find((f) => f.format === "feed")!;
  assertEquals(feed.tipo, "feed");
  assertEquals(feed.aspect_ratios.map((a) => a.aspect_ratio), ["1:1", "4:5"]);
  assertEquals(feed.aspect_ratios[1].canvas, { width: 1080, height: 1350 });
  const reel = out.formats.find((f) => f.format === "reel_cover")!;
  assertEquals(reel.aspect_ratios[0].canvas, { width: 1080, height: 1920 });

  assertEquals(out.post_tipo_mapping.stories, null);
  assertEquals(out.post_tipo_mapping.reels, "reel_cover");

  assertEquals(out.fonts.families.length, 26); // the real committed manifest
  assert(out.fonts.families.some((f) => f.key === "playfair-display"));
  assertEquals(out.fonts.fallback_key, "inter");

  assertEquals(out.limits.max_pages, 10);
  assertEquals(out.limits.max_doc_bytes, 256 * 1024);
  assertEquals(out.features, { feature_estudio: true, feature_ai_images: true });
  assertEquals(out.image_gen.enabled, true);
  assertEquals(out.image_gen.quota, { used: 0, limit: 50, resets_at: out.image_gen.quota!.resets_at });
  assert(!("brand" in out), "no brand block without client_id");
});

Deno.test("capabilities: image_gen.enabled is false without a provider even when the feature is on", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ai_image_generations", "select", { data: [], error: null });
  const deps = makeDeps(db);
  // deno-lint-ignore no-explicit-any
  (deps.imageGen as any).provider = undefined;
  const out = await getDesignCapabilities(deps, {});
  assertEquals(out.image_gen.enabled, false);
});

Deno.test("capabilities: foreign client_id rejects; own client resolves the brand block via the matcher", async () => {
  const db = createSupabaseQueryMock();
  db.queue("ai_image_generations", "select", { data: [], error: null });
  db.queue("clientes", "select", { data: null, error: null });
  let threw = false;
  try {
    await getDesignCapabilities(makeDeps(db), { client_id: 999 });
  } catch (e) {
    threw = e instanceof McpInputError;
  }
  assertEquals(threw, true);

  const db2 = createSupabaseQueryMock();
  db2.queue("ai_image_generations", "select", { data: [], error: null });
  db2.queue("clientes", "select", { data: { id: 42 }, error: null });
  db2.queue("hub_brand", "select", {
    data: {
      primary_color: "#eab308",
      secondary_color: null,
      logo_file_id: 2258,
      font_primary: "Playfair",
      font_secondary: "Comic Sans MS",
    },
    error: null,
  });
  const out = await getDesignCapabilities(makeDeps(db2), { client_id: 42 });
  assertEquals(out.brand.colors, ["#eab308"]);
  assertEquals(out.brand.logo_file_id, 2258); // reported because ALREADY materialized — no write
  assertEquals(out.brand.font_primary, {
    raw: "Playfair",
    resolved_key: "playfair-display",
    fallback_key: "playfair-display",
  });
  assertEquals(out.brand.font_secondary, {
    raw: "Comic Sans MS",
    resolved_key: null, // never guesses
    fallback_key: "inter",
  });
});

// ── preview_design guards ────────────────────────────────────────────────────

Deno.test("preview: post without a design points at create_design", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: { id: 42, tipo: "feed", status: "rascunho" }, error: null });
  db.queue("post_designs", "select", { data: null, error: null });
  let message = "";
  try {
    await previewDesign(makeDeps(db), { post_id: 42 });
  } catch (e) {
    message = (e as Error).message;
  }
  assert(message.includes("create_design"), message);
});

Deno.test("preview: unknown page_id returns a structured error LISTING the real page ids", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: { id: 42, tipo: "feed", status: "rascunho" }, error: null });
  db.queue("post_designs", "select", {
    data: { doc: { pages: [{ id: "p1", layers: [] }, { id: "p2", layers: [] }] } },
    error: null,
  });
  let err: unknown;
  try {
    await previewDesign(makeDeps(db), { post_id: 42, page_id: "nope" });
  } catch (e) {
    err = e;
  }
  assert(err instanceof McpStructuredError, String(err));
  assertEquals((err as McpStructuredError).payload.error, "page_not_found");
  assertEquals((err as McpStructuredError).payload.page_ids, ["p1", "p2"]);
});

// ── preview_design full render (satori → resvg → mozjpeg, real font bytes) ──

Deno.test("preview: renders one page to JPEG at the default width", async () => {
  const doc = {
    version: 1,
    format: "feed",
    aspect_ratio: "1:1",
    canvas: { width: 1080, height: 1080 },
    fileIds: [],
    pages: [{
      id: "p1",
      background: { type: "solid", color: "#f4efe6" },
      layers: [{
        id: "headline",
        name: "Headline",
        type: "text",
        x: 90,
        y: 400,
        w: 900,
        rotation: 0,
        opacity: 1,
        locked: false,
        text: "Preview via MCP",
        font_key: "inter",
        font_weight: 400,
        font_size: 64,
        line_height: 1.2,
        letter_spacing: 0,
        color: "#12151a",
        align: "left",
      }],
    }],
  };
  const db = createSupabaseQueryMock();
  db.queue("workflow_posts", "select", { data: { id: 42, tipo: "feed", status: "rascunho" }, error: null });
  db.queue("post_designs", "select", { data: { doc }, error: null });
  const deps = makeDeps(db, {
    resolveFontBytes: (r2Key: string) => {
      // The manifest's r2 keys live under assets/fonts/v1/…; the same files are committed at
      // public/fonts/estudio/… (byte-identical — §7 single-format serving).
      const local = r2Key.replace("assets/fonts/v1/", "");
      return Deno.readFile(new URL(`../../../public/fonts/estudio/${local}`, import.meta.url));
    },
  });
  const out = await previewDesign(deps, { post_id: 42 });
  assertEquals(out.page_id, "p1");
  assertEquals(out.width, PREVIEW_DEFAULT_WIDTH);
  assertEquals(out.height, PREVIEW_DEFAULT_WIDTH); // 1:1 canvas
  assert(out.jpegBytes.length > 1000, `jpeg too small: ${out.jpegBytes.length}`);
  // JPEG magic bytes
  assertEquals(out.jpegBytes[0], 0xff);
  assertEquals(out.jpegBytes[1], 0xd8);
});
