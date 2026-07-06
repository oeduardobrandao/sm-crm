// Estúdio MCP read tools, v2: preview_design (render-service backed, page selection,
// structured page errors) + get_design_capabilities (formats, ops catalog, brand block).
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { McpKeyContext } from "../_shared/mcp-token.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import type { Deps } from "../mcp/queries.ts";
import { McpStructuredError } from "../mcp/design.ts";
import { getDesignCapabilities, previewDesign } from "../mcp/capabilities.ts";

const CTX: McpKeyContext = {
  conta_id: "workspace-A",
  scopes: ["posts:read", "designs:write"],
  key_id: "key-1",
  created_by: "user-1",
};

const ROW = {
  id: 7,
  cliente_id: null,
  post_id: null,
  name: "Design",
  format: "feed",
  rev: 3,
  doc_r2_key: "designs/workspace-A/x-r3.fig",
  render_status: "rendered",
  is_stale: false,
  render_manifest: null,
};

const JPEG_B64 = btoa("\x01\x02\x03");

function makeDeps(
  db: ReturnType<typeof createSupabaseQueryMock>,
  extra: Partial<Deps> = {},
): Deps & { renderTipos: string[] } {
  const renderTipos: string[] = [];
  return {
    db: db as never,
    ctx: CTX,
    isFeatureEnabled: async (f: string) => f === "feature_estudio",
    fetchBlob: async () => new Uint8Array([1, 2, 3]),
    callRenderService: async (_bytes: Uint8Array, tipo: string) => {
      renderTipos.push(tipo);
      return {
        pages: [
          { frame_id: "1:4", width: 1080, height: 1350, jpeg_b64: JPEG_B64 },
          { frame_id: "1:5", width: 1080, height: 1350, jpeg_b64: JPEG_B64 },
        ],
      };
    },
    ...extra,
    renderTipos,
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

// ── preview_design ────────────────────────────────────────────────────────────

Deno.test("preview_design: unconfigured render service reports actionably", async () => {
  const db = createSupabaseQueryMock();
  const err = await expectErr(() =>
    previewDesign(makeDeps(db, { callRenderService: undefined }), { design_id: 7 })
  );
  assert(err instanceof McpInputError);
});

Deno.test("preview_design: default page is the first; bytes decoded from the service", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  const deps = makeDeps(db);
  const out = await previewDesign(deps, { design_id: 7 });
  assertEquals(out.page_id, "1:4");
  assertEquals([...out.jpegBytes], [1, 2, 3]);
  assertEquals(out.width, 1080);
  assertEquals(deps.renderTipos, ["feed"]); // standalone: tipo from format
});

Deno.test("preview_design: attached design renders with the POST's tipo", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: { ...ROW, post_id: 42 }, error: null });
  db.queue("workflow_posts", "select", { data: { tipo: "carrossel" }, error: null });
  const deps = makeDeps(db);
  await previewDesign(deps, { design_id: 7, page_id: "1:5" });
  assertEquals(deps.renderTipos, ["carrossel"]);
});

Deno.test("preview_design: unknown page_id → structured error listing pages", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  const err = await expectErr(() => previewDesign(makeDeps(db), { design_id: 7, page_id: "nope" }));
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "page_not_found");
  assertEquals((err as McpStructuredError).payload.page_ids, ["1:4", "1:5"]);
});

Deno.test("preview_design: no publishable frames → structured error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("designs", "select", { data: ROW, error: null });
  const deps = makeDeps(db, {
    callRenderService: async () => ({ pages: [] }),
  });
  const err = await expectErr(() => previewDesign(deps, { design_id: 7 }));
  assert(err instanceof McpStructuredError);
  assertEquals((err as McpStructuredError).payload.error, "no_publishable_frames");
});

// ── get_design_capabilities ───────────────────────────────────────────────────

Deno.test("capabilities: formats, ops catalog and feature flags", async () => {
  const db = createSupabaseQueryMock();
  const out = await getDesignCapabilities(makeDeps(db), {});
  assertEquals(out.formats.length, 4);
  const livre = out.formats.find((f: { format: string }) => f.format === "livre");
  assertEquals(livre!.starter_canvas, null);
  assert(out.ops.some((o: { op: string }) => o.op === "set_text"));
  assert(out.ops.some((o: { op: string }) => o.op === "add_frame"));
  assertEquals(out.features, { feature_estudio: true, feature_ai_images: false });
  assertEquals(out.image_gen, { enabled: false, quota: null });
  assert(!("brand" in out));
});

Deno.test("capabilities: unknown client rejects; brand block returns raw fonts", async () => {
  const db1 = createSupabaseQueryMock();
  db1.queue("clientes", "select", { data: null, error: null });
  const err = await expectErr(() => getDesignCapabilities(makeDeps(db1), { client_id: 5 }));
  assert(err instanceof McpInputError);

  const db2 = createSupabaseQueryMock();
  db2.queue("clientes", "select", { data: { id: 5 }, error: null });
  db2.queue("hub_brand", "select", {
    data: {
      primary_color: "#112233",
      secondary_color: null,
      logo_file_id: 88,
      font_primary: " Montserrat ",
      font_secondary: null,
    },
    error: null,
  });
  const out = await getDesignCapabilities(makeDeps(db2), { client_id: 5 });
  assertEquals(out.brand, {
    colors: ["#112233"],
    logo_file_id: 88,
    font_primary: "Montserrat",
    font_secondary: null,
  });
});
