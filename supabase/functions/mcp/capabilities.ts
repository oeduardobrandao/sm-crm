// Estúdio MCP read tools, v2 (design-first model): preview_design + get_design_capabilities.
//
// preview_design renders the design's publishable frames through the SAME Vercel render
// service the pipeline uses (version-pinned @open-pencil/core — what you see is what the
// post gets) and returns ONE page as raw JPEG bytes for an MCP image content block.
// Frames render at their preset export size (1080-wide) — one page per call, CPU-priced.
//
// get_design_capabilities is the agent's discovery surface: formats/starters, the
// update_design ops vocabulary, projection semantics, limits, feature/quota state and the
// per-client brand block. PURE READ — logo_file_id is reported only when already
// materialized (never triggers the import).
import { quotaSnapshot } from "../_shared/image-gen/core.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import {
  FORMAT_TO_RENDER_TIPO,
  getDesignRowOrThrow,
  McpStructuredError,
  type DesignFormat,
} from "./design.ts";
import type { Deps } from "./queries.ts";

// ---- preview_design --------------------------------------------------------------------------

export interface PreviewResult {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
  page_id: string;
}

export async function previewDesign(
  d: Deps,
  args: { design_id: number; page_id?: string },
): Promise<PreviewResult> {
  if (!d.fetchBlob || !d.callRenderService) {
    throw new McpInputError("O serviço de render do Estúdio não está configurado neste ambiente.");
  }
  const row = await getDesignRowOrThrow(d, args.design_id);

  let tipo = FORMAT_TO_RENDER_TIPO[row.format];
  if (row.post_id != null) {
    const { data } = await d.db
      .from("workflow_posts")
      .select("tipo")
      .eq("conta_id", d.ctx.conta_id)
      .eq("id", row.post_id)
      .maybeSingle();
    const postTipo = (data as { tipo: string } | null)?.tipo;
    if (postTipo && postTipo in { feed: 1, carrossel: 1, reels: 1 }) tipo = postTipo;
  }

  const bytes = await d.fetchBlob(row.doc_r2_key);
  if (!bytes) throw new Error(`design blob missing: ${row.doc_r2_key}`);
  const out = await d.callRenderService(bytes, tipo);

  if (!out.pages.length) {
    throw new McpStructuredError({
      error: "no_publishable_frames",
      message:
        "Nenhum frame publicável para renderizar — frames precisam de proporção 1:1, 4:5 ou 9:16 (get_design_capabilities documenta os formatos).",
    });
  }
  let page = out.pages[0];
  if (args.page_id !== undefined) {
    const found = out.pages.find((p) => p.frame_id === args.page_id);
    if (!found) {
      throw new McpStructuredError({
        error: "page_not_found",
        message: `Página '${args.page_id}' não existe neste design.`,
        page_ids: out.pages.map((p) => p.frame_id),
      });
    }
    page = found;
  }

  return {
    jpegBytes: Uint8Array.from(atob(page.jpeg_b64), (c) => c.charCodeAt(0)),
    width: page.width,
    height: page.height,
    page_id: page.frame_id,
  };
}

// ---- get_design_capabilities -----------------------------------------------------------------

const STARTER_CANVAS: Record<DesignFormat, { width: number; height: number } | null> = {
  feed: { width: 1080, height: 1350 },
  carrossel: { width: 1080, height: 1350 },
  reel_cover: { width: 1080, height: 1920 },
  livre: null,
};

/** update_design ops vocabulary — mirrors services/estudio-render/lib/doc.js (the executor). */
const OPS_CATALOG = [
  { op: "set_text", args: "node, text", desc: "Troca o texto de um nó TEXT." },
  {
    op: "set_text_style",
    args: "node, fontSize?, fontFamily?, fontWeight?, textAlignHorizontal?, color?",
    desc: "Estilo de um nó TEXT; color é hex (#rrggbb) e vira o fill do texto.",
  },
  { op: "set_fill", args: "node, color", desc: "Fill sólido (hex) de qualquer nó." },
  {
    op: "set_image_fill",
    args: "node, imageHash, scaleMode?",
    desc: "Fill de imagem usando um hash já presente em projection.images.",
  },
  { op: "set_bounds", args: "node, x?, y?, width?, height?", desc: "Move/redimensiona um nó." },
  { op: "rename", args: "node, name", desc: "Renomeia um nó (frames numerados ordenam o carrossel)." },
  { op: "remove_node", args: "node", desc: "Remove um nó e seus filhos." },
  {
    op: "add_text",
    args: "parent, text, x, y, width, height?, fontSize?, fontFamily?, fontWeight?, textAlignHorizontal?, color?, name?",
    desc: "Cria um TEXT dentro de um frame (parent = id do frame).",
  },
  {
    op: "add_frame",
    args: "page?, name?, x, y, width, height, color?",
    desc: "Cria um FRAME na página (sem page, usa a página com conteúdo). Frames 1080x1350 ou 1080x1920 são publicáveis.",
  },
];

export async function getDesignCapabilities(d: Deps, args: { client_id?: number }) {
  const formats = (Object.keys(STARTER_CANVAS) as DesignFormat[]).map((format) => ({
    format,
    render_tipo: FORMAT_TO_RENDER_TIPO[format],
    starter_canvas: STARTER_CANVAS[format],
  }));

  const [estudioOn, aiImagesOn] = await Promise.all([
    d.isFeatureEnabled ? d.isFeatureEnabled("feature_estudio") : Promise.resolve(false),
    d.isFeatureEnabled ? d.isFeatureEnabled("feature_ai_images") : Promise.resolve(false),
  ]);

  const imageGenDeps = d.imageGen as
    | { db: unknown; monthlyLimit: (contaId: string) => Promise<number | null>; provider?: unknown }
    | undefined;
  const imageGen = {
    enabled: aiImagesOn && !!imageGenDeps?.provider,
    quota: imageGenDeps ? await quotaSnapshot(imageGenDeps as never, d.ctx.conta_id) : null,
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
        font_primary: row.font_primary?.trim() || null,
        font_secondary: row.font_secondary?.trim() || null,
      }
      : { colors: [], logo_file_id: null, font_primary: null, font_secondary: null };
  }

  return {
    formats,
    post_tipo_mapping: { feed: "feed", carrossel: "carrossel", reels: "reel_cover", stories: null },
    ops: OPS_CATALOG,
    projection: {
      node_ids: "Estáveis entre revisões — use os ids retornados por get_design nas ops.",
      fills: "Cores em hex #rrggbb (ou #rrggbbaa).",
      publishable_frames:
        "Frames com proporção 1:1, 4:5 ou 9:16 (±0,5%) exportam a 1080px; ordem = prefixo numérico do nome, depois x. Demais frames são rascunho.",
    },
    fonts: {
      guaranteed: [{ family: "Inter", weights: [400, 700] }],
      note:
        "Renderizações garantem Inter (400/700) + emoji colorido; outras famílias podem cair em fallback no render. Prefira Inter até o catálogo expandir.",
    },
    limits: {
      max_doc_bytes: 10 * 1024 * 1024,
      carousel_max_published_items: 10,
    },
    attachment_rules: {
      one_post_per_design: true,
      post_must_be_editable: EDITABLE_STATUSES_DOC,
      feed_carrossel_reject_video_posts: true,
      locked_post_designs_are_read_only: "Duplique o design para continuar editando.",
    },
    features: { feature_estudio: estudioOn, feature_ai_images: aiImagesOn },
    image_gen: imageGen,
    ...(brand !== null ? { brand } : {}),
  };
}

const EDITABLE_STATUSES_DOC = ["rascunho", "revisao_interna", "correcao_cliente", "enviado_cliente"];
