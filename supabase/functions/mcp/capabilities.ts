// Estúdio MCP read tools (design §9, plan T5.5): preview_design + get_design_capabilities.
//
// preview_design renders ONE reduced page synchronously through the SHARED render core (§5.2:
// satori → resvg → mozjpeg) and returns raw JPEG bytes for an MCP image content block —
// Claude is multimodal; seeing the render collapses blind iterations. One page per call, width
// default 512 (layout always runs at native canvas size; the width only scales the raster).
//
// get_design_capabilities is the agent's discovery surface: formats/canvases, tipo mapping,
// the font catalog, hard limits, feature/quota state, and the per-client brand block. It is a
// PURE READ — logo_file_id is reported only when already materialized (never triggers the
// import; that's the /brand-logo route or generate_image use_brand_logo), and it is NOT an
// extension of get_brand_profile (that shape is a published contract used by the DK skills).
import rawManifest from "../_shared/fonts/manifest.json" with { type: "json" };
import type { FontManifest } from "../_shared/fonts/types.ts";
import { matchBrandFont } from "../_shared/fonts/match.ts";
import {
  ALLOWED_ASPECT_RATIOS_BY_FORMAT,
  CANVAS_DIMENSIONS,
  FORMAT_TO_TIPO,
  MAX_DESIGN_DOC_BYTES,
  type DesignDoc,
  type DesignFormat,
} from "../_shared/design-doc.ts";
import { renderPage } from "../_shared/design-render-core.ts";
import { quotaSnapshot } from "../_shared/image-gen/core.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { McpStructuredError } from "./design.ts";
import type { Deps } from "./queries.ts";

const FONT_MANIFEST = rawManifest as unknown as FontManifest;

export const PREVIEW_DEFAULT_WIDTH = 512;
export const PREVIEW_MIN_WIDTH = 128;
export const PREVIEW_MAX_WIDTH = 1080;

// ---- preview_design --------------------------------------------------------------------------

export interface PreviewResult {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
  page_id: string;
}

export async function previewDesign(
  d: Deps,
  args: { post_id: number; page_id?: string; width?: number },
): Promise<PreviewResult> {
  const { data: post } = await d.db
    .from("workflow_posts")
    .select("id, tipo, status")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", args.post_id)
    .maybeSingle();
  if (!post) throw new McpInputError("Post não encontrado neste workspace.");

  const { data: design } = await d.db
    .from("post_designs")
    .select("doc")
    .eq("conta_id", d.ctx.conta_id)
    .eq("post_id", args.post_id)
    .maybeSingle();
  if (!design) {
    throw new McpInputError("Este post não tem design — crie um com create_design.");
  }
  const doc = (design as { doc: DesignDoc }).doc;

  let pageIndex = 0;
  if (args.page_id !== undefined) {
    pageIndex = doc.pages.findIndex((p) => p.id === args.page_id);
    if (pageIndex === -1) {
      throw new McpStructuredError({
        error: "page_not_found",
        message: `Página '${args.page_id}' não existe neste design.`,
        page_ids: doc.pages.map((p) => p.id),
      });
    }
  }

  const width = Math.min(
    PREVIEW_MAX_WIDTH,
    Math.max(PREVIEW_MIN_WIDTH, Math.trunc(args.width ?? PREVIEW_DEFAULT_WIDTH)),
  );

  if (!d.resolveFontBytes) throw new Error("resolveFontBytes dep missing");
  const resolveFontBytes = d.resolveFontBytes;
  const result = await renderPage(doc, pageIndex, {
    resolveFileBytes: async (fileId: number) => {
      // Tenant re-check per file even though the doc was validated at write time — the doc is
      // stored data, and files can change hands/kind only within the workspace anyway.
      const { data } = await d.db
        .from("files")
        .select("r2_key, mime_type")
        .eq("conta_id", d.ctx.conta_id)
        .eq("id", fileId)
        .maybeSingle();
      const row = data as { r2_key: string; mime_type: string } | null;
      if (!row) throw new Error(`file ${fileId} not found in workspace`);
      const bytes = await resolveFontBytes(row.r2_key); // generic R2 byte reader
      return { bytes, mimeType: row.mime_type };
    },
    resolveFontBytes,
  }, { width });

  return {
    jpegBytes: result.jpegBytes,
    width: result.width,
    height: result.height,
    page_id: doc.pages[pageIndex].id,
  };
}

// ---- get_design_capabilities -----------------------------------------------------------------

/** §7 defaults when a brand font is unmatched: template fonts, else playfair-display / inter. */
const UNMATCHED_FALLBACK: Record<"primary" | "secondary", string> = {
  primary: "playfair-display",
  secondary: "inter",
};

function brandFontEntry(raw: string | null | undefined, slot: "primary" | "secondary") {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return {
    raw: trimmed,
    resolved_key: matchBrandFont(trimmed, FONT_MANIFEST.families),
    fallback_key: UNMATCHED_FALLBACK[slot],
  };
}

export async function getDesignCapabilities(d: Deps, args: { client_id?: number }) {
  const formats = (Object.keys(ALLOWED_ASPECT_RATIOS_BY_FORMAT) as DesignFormat[]).map(
    (format) => ({
      format,
      tipo: FORMAT_TO_TIPO[format],
      aspect_ratios: ALLOWED_ASPECT_RATIOS_BY_FORMAT[format].map((ar) => ({
        aspect_ratio: ar,
        canvas: CANVAS_DIMENSIONS[ar],
      })),
    }),
  );

  const [estudioOn, aiImagesOn] = await Promise.all([
    d.isFeatureEnabled ? d.isFeatureEnabled("feature_estudio") : Promise.resolve(false),
    d.isFeatureEnabled ? d.isFeatureEnabled("feature_ai_images") : Promise.resolve(false),
  ]);

  const imageGenDeps = d.imageGen as
    | { db: unknown; monthlyLimit: (contaId: string) => Promise<number | null>; provider?: unknown }
    | undefined;
  const imageGen = {
    enabled: aiImagesOn && !!imageGenDeps?.provider,
    quota: imageGenDeps
      ? await quotaSnapshot(imageGenDeps as never, d.ctx.conta_id)
      : null,
  };

  // deno-lint-ignore no-explicit-any
  let brand: any = null;
  if (args.client_id !== undefined) {
    const { data: cliente } = await d.db
      .from("clientes")
      .select("id")
      .eq("conta_id", d.ctx.conta_id)
      .eq("id", args.client_id)
      .maybeSingle();
    if (!cliente) throw new McpInputError("Cliente não encontrado neste workspace.");
    const { data } = await d.db
      .from("hub_brand")
      .select("primary_color, secondary_color, logo_file_id, font_primary, font_secondary")
      .eq("cliente_id", args.client_id)
      .maybeSingle();
    const row = data as {
      primary_color: string | null;
      secondary_color: string | null;
      logo_file_id: number | null;
      font_primary: string | null;
      font_secondary: string | null;
    } | null;
    brand = row
      ? {
        colors: [row.primary_color, row.secondary_color].filter(Boolean),
        // Reported ONLY when already materialized — a read tool never triggers the import.
        logo_file_id: row.logo_file_id ?? null,
        font_primary: brandFontEntry(row.font_primary, "primary"),
        font_secondary: brandFontEntry(row.font_secondary, "secondary"),
      }
      : { colors: [], logo_file_id: null, font_primary: null, font_secondary: null };
  }

  return {
    formats,
    post_tipo_mapping: { feed: "feed", carrossel: "carrossel", reels: "reel_cover", stories: null },
    fonts: {
      groups: FONT_MANIFEST.groups,
      fallback_key: FONT_MANIFEST.fallbackKey,
      families: FONT_MANIFEST.families.map((f) => ({
        key: f.key,
        name: f.name,
        group: f.group,
        variants: f.variants.map((v) => ({ weight: v.weight, style: v.style })),
      })),
    },
    limits: {
      max_pages: 10,
      max_layers_per_page: 40,
      max_text_chars_per_layer: 2000,
      max_doc_bytes: MAX_DESIGN_DOC_BYTES,
      gradient_stops: { min: 2, max: 8 },
      carousel_max_published_items: 10,
    },
    features: { feature_estudio: estudioOn, feature_ai_images: aiImagesOn },
    image_gen: imageGen,
    ...(brand !== null ? { brand } : {}),
  };
}
