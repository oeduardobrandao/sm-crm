// Estúdio MCP design tools (design §9, plan T5.2/T5.3): get_design / create_design /
// update_design handlers + the zod4 validation glue. MCP arg shapes stay zod3 in tools.ts;
// the design payload arrives as an untyped record and is validated HERE by the shared zod4
// pipeline (§2.4) — invalid docs throw McpStructuredError carrying the aggregated issues[]
// payload so one retry can fix everything.
//
// Writes go through the SAME service-role RPC family the editor uses (create_post_design /
// update_post_design — no bespoke write path): ownership, status, rev guard and tipo sync are
// enforced in one transaction regardless of caller. This module's own pre-checks exist only to
// turn raw RPC exceptions into agent-actionable messages.
import {
  FORMAT_TO_TIPO,
  toDesignValidationError,
  validateDesignDoc,
  type DesignDoc,
  type DesignWarning,
  type ValidationContext,
} from "../_shared/design-doc.ts";
import { manifestFontLookup } from "../_shared/fonts/lookup.ts";
import {
  getRenderPages,
  type RenderPageInfo,
} from "../_shared/design-render-status.ts";
import { measureLayer, type FontBytesResolver } from "../_shared/design-render-core.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { signGetUrl } from "../_shared/r2.ts";
import { EDITABLE_STATUSES, type Deps } from "./queries.ts";

export const DOC_VERSION = 1;

/** Structured (JSON-payload) tool error — errorResult emits the payload verbatim instead of a
 * plain message string, giving agents a machine-usable self-correction contract (§2.4). */
export class McpStructuredError extends Error {
  constructor(public payload: Record<string, unknown>) {
    super(typeof payload.error === "string" ? payload.error : "structured_error");
  }
}

interface PostRow {
  id: number;
  tipo: string;
  status: string;
}

async function getPostOrThrow(d: Deps, postId: number): Promise<PostRow> {
  const { data } = await d.db
    .from("workflow_posts")
    .select("id, tipo, status")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", postId)
    .maybeSingle();
  if (!data) throw new McpInputError("Post não encontrado neste workspace.");
  return data as PostRow;
}

async function hasVideoMedia(d: Deps, postId: number): Promise<boolean> {
  const { data } = await d.db
    .from("post_file_links")
    .select("file_id, files!inner(kind)")
    .eq("post_id", postId)
    .eq("conta_id", d.ctx.conta_id)
    .eq("files.kind", "video")
    .limit(1);
  return (data ?? []).length > 0;
}

function buildValidationContext(d: Deps, post: PostRow, postHasVideo: boolean): ValidationContext {
  return {
    postTipo: post.tipo,
    postHasVideoMedia: postHasVideo,
    fonts: manifestFontLookup,
    checkFileIds: async (ids: number[]) => {
      if (ids.length === 0) return new Set<number>();
      const { data } = await d.db
        .from("files")
        .select("id")
        .eq("conta_id", d.ctx.conta_id)
        .eq("kind", "image")
        .in("id", ids);
      return new Set((data ?? []).map((f: { id: number }) => f.id));
    },
  };
}

/** §2.4 through the shared pipeline; invalid → McpStructuredError with the aggregated issues
 * payload (≤20 + truncated flag — toDesignValidationError owns the cap). */
async function validateOrThrow(
  d: Deps,
  post: PostRow,
  input: unknown,
): Promise<{ doc: DesignDoc; warnings: DesignWarning[] }> {
  const ctx = buildValidationContext(d, post, await hasVideoMedia(d, post.id));
  const validated = await validateDesignDoc(input, ctx);
  if (!validated.ok) {
    throw new McpStructuredError(toDesignValidationError(validated) as Record<string, unknown>);
  }
  return { doc: validated.doc, warnings: validated.warnings };
}

// ---- measure pass (§2.5) -------------------------------------------------------------------
// Per-layer bboxes so agents can position relative to real geometry ("below the headline").
// Text heights are emergent (auto-grow): measured through satori + resvg getBBox — SVG parse
// only, no rasterization. Non-text layers already carry explicit w/h in the normalized doc.

export interface LayoutEntry {
  page_id: string;
  layer_id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function buildLayout(
  doc: DesignDoc,
  resolveFontBytes: FontBytesResolver | undefined,
): Promise<LayoutEntry[]> {
  const out: LayoutEntry[] = [];
  for (const page of doc.pages) {
    for (const layer of page.layers) {
      if (layer.type === "text") {
        let h = layer.font_size * layer.line_height;
        if (resolveFontBytes) {
          try {
            h = (await measureLayer(layer, resolveFontBytes)).height;
          } catch (e) {
            // Measurement is best-effort agent ergonomics — a font-fetch hiccup must not fail
            // a write that already committed. Fall back to the single-line estimate.
            console.error("[mcp] measureLayer failed:", (e as Error)?.message);
          }
        }
        out.push({
          page_id: page.id,
          layer_id: layer.id,
          type: layer.type,
          x: layer.x,
          y: layer.y,
          w: layer.w,
          h,
        });
      } else {
        out.push({
          page_id: page.id,
          layer_id: layer.id,
          type: layer.type,
          x: layer.x,
          y: layer.y,
          w: layer.w,
          h: layer.h,
        });
      }
    }
  }
  return out;
}

// ---- render info (get_design) ---------------------------------------------------------------

async function renderInfo(
  d: Deps,
  postId: number,
  tipo: string,
  doc: DesignDoc,
  renderStatus: string,
): Promise<{ status: string; pages: RenderPageInfo[] }> {
  // Same default signer as queries.ts's sign() — d.signUrl is the test override.
  const signUrl = d.signUrl ?? ((key: string) => signGetUrl(key, 3600));
  const pages = await getRenderPages({
    fetchDesignLinks: async (pId, cId) => {
      const { data } = await d.db
        .from("post_file_links")
        .select("file_id, sort_order, files!inner(r2_key, width, height)")
        .eq("post_id", pId)
        .eq("conta_id", cId)
        .eq("origin", "design")
        .order("sort_order", { ascending: true });
      // deno-lint-ignore no-explicit-any
      return (data ?? []).map((l: any) => ({
        file_id: l.file_id,
        r2_key: l.files.r2_key,
        width: l.files.width,
        height: l.files.height,
        sort_order: l.sort_order,
      }));
    },
    fetchVideoThumbnail: async (pId, cId) => {
      const { data } = await d.db
        .from("post_file_links")
        .select("file_id, files!inner(kind, thumbnail_r2_key)")
        .eq("post_id", pId)
        .eq("conta_id", cId)
        .eq("files.kind", "video")
        .maybeSingle();
      if (!data) return null;
      // deno-lint-ignore no-explicit-any
      const files = (data as any).files;
      return {
        file_id: (data as { file_id: number }).file_id,
        thumbnail_r2_key: files.thumbnail_r2_key,
      };
    },
    signUrl,
  }, { postId, contaId: d.ctx.conta_id, tipo, doc });
  return { status: renderStatus, pages };
}

// ---- shared write plumbing -------------------------------------------------------------------

async function requireFeature(d: Deps): Promise<void> {
  if (!d.isFeatureEnabled) return; // wired in index.ts; absent only in tests that opt out
  if (!(await d.isFeatureEnabled("feature_estudio"))) {
    throw new McpInputError(
      "O Estúdio não está disponível no plano deste workspace (feature_estudio).",
    );
  }
}

function requireEditable(post: PostRow): void {
  if (!EDITABLE_STATUSES.includes(post.status)) {
    throw new McpInputError(
      `Post em estado '${post.status}' não pode receber design pelo agente.`,
    );
  }
}

/** correcao_cliente is live in the client portal — a design change is a content edit and must
 * pull the post back to revisao_interna (decision 16; same rule as updatePost). */
async function autoMoveCorrecao(d: Deps, post: PostRow): Promise<string> {
  if (post.status !== "correcao_cliente") return post.status;
  const { data } = await d.db
    .from("workflow_posts")
    .update({ status: "revisao_interna" })
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", post.id)
    .eq("status", "correcao_cliente")
    .select("status")
    .maybeSingle();
  return (data as { status: string } | null)?.status ?? post.status;
}

function fireRender(d: Deps, designId: number, rev: number): void {
  if (!d.triggerRender) return;
  // Fire-and-forget: the row's `pending` status IS the job and the sweep cron is the safety
  // net (§9) — a trigger failure must never fail the tool call.
  d.triggerRender(designId, rev).catch((e) =>
    console.error("[mcp] design render trigger failed:", (e as Error)?.message)
  );
}

export function docStats(doc: DesignDoc) {
  return {
    format: doc.format,
    page_count: doc.pages.length,
    layer_count: doc.pages.reduce((sum, p) => sum + p.layers.length, 0),
    doc_bytes: JSON.stringify(doc).length,
  };
}

interface DesignRow {
  id: number;
  doc: DesignDoc;
  rev: number;
  render_status: string;
  is_stale: boolean;
}

// ---- tools -----------------------------------------------------------------------------------

export async function getDesign(d: Deps, args: { post_id: number }) {
  const post = await getPostOrThrow(d, args.post_id);
  const { data } = await d.db
    .from("post_designs")
    .select("id, doc, rev, render_status, is_stale")
    .eq("conta_id", d.ctx.conta_id)
    .eq("post_id", args.post_id)
    .maybeSingle();
  if (!data) {
    return {
      design: null,
      hint:
        "Este post ainda não tem design. Use create_design para criar um (get_design_capabilities lista formatos, fontes e limites).",
      post: { tipo: post.tipo, status: post.status },
    };
  }
  const row = data as DesignRow;
  return {
    design: row.doc,
    rev: row.rev,
    render: await renderInfo(d, args.post_id, post.tipo, row.doc, row.render_status),
    post: { tipo: post.tipo, status: post.status },
  };
}

export async function createDesign(d: Deps, args: { post_id: number; design: unknown }) {
  await requireFeature(d);
  const post = await getPostOrThrow(d, args.post_id);
  requireEditable(post);

  // Friendly pre-check; the RPC's unique guard is the real boundary (race caught below).
  const { data: existing } = await d.db
    .from("post_designs")
    .select("id, rev")
    .eq("conta_id", d.ctx.conta_id)
    .eq("post_id", args.post_id)
    .maybeSingle();
  if (existing) {
    throw new McpStructuredError({
      error: "design_already_exists",
      message: "Este post já tem um design — use update_design (leia o atual com get_design).",
      rev: (existing as { rev: number }).rev,
    });
  }

  const { doc, warnings } = await validateOrThrow(d, post, args.design);

  const { data, error } = await d.db.rpc("create_post_design", {
    p_conta_id: d.ctx.conta_id,
    p_post_id: args.post_id,
    p_doc: doc,
    p_doc_version: DOC_VERSION,
    p_updated_via: "agent",
    p_updated_by: d.ctx.created_by,
  }).single();
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (message.includes("design_already_exists")) {
      throw new McpStructuredError({
        error: "design_already_exists",
        message: "Este post já tem um design — use update_design (leia o atual com get_design).",
      });
    }
    if (message.includes("post_has_video_media")) {
      throw new McpInputError(
        "Este post tem vídeo — designs de feed/carrossel não podem ser criados para ele.",
      );
    }
    console.error("[mcp] create_post_design failed:", message);
    throw new Error("create_post_design failed");
  }
  const row = data as unknown as DesignRow;

  const status = await autoMoveCorrecao(d, post);
  fireRender(d, row.id, row.rev);

  return {
    design: row.doc,
    rev: row.rev,
    warnings,
    // Layout from the locally-normalized doc (identical to what the RPC stored) — defaults
    // like line_height are guaranteed materialized there.
    layout: await buildLayout(doc, d.resolveFontBytes),
    render: { status: "queued", rev: row.rev },
    // tipo derived from the WRITTEN doc's format: the RPC's check_and_sync updates
    // workflow_posts.tipo when the design format maps differently (feed↔carrossel↔reels),
    // so the pre-write post row would be stale here.
    post: { tipo: FORMAT_TO_TIPO[doc.format], status },
  };
}

export async function updateDesign(
  d: Deps,
  args: { post_id: number; design: unknown; expected_rev?: number },
) {
  await requireFeature(d);
  const post = await getPostOrThrow(d, args.post_id);
  requireEditable(post);

  const { doc, warnings } = await validateOrThrow(d, post, args.design);

  const { data, error } = await d.db.rpc("update_post_design", {
    p_conta_id: d.ctx.conta_id,
    p_post_id: args.post_id,
    p_doc: doc,
    p_doc_version: DOC_VERSION,
    // NULL = unguarded (documented last-writer-wins when expected_rev is omitted).
    p_expected_rev: args.expected_rev ?? null,
    p_updated_via: "agent",
    p_updated_by: d.ctx.created_by,
  }).single();
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (message.startsWith("rev_conflict:") || message.includes("rev_conflict:")) {
      const current = Number(message.slice(message.indexOf("rev_conflict:") + "rev_conflict:".length));
      throw new McpStructuredError({
        error: "rev_conflict",
        current_rev: Number.isFinite(current) ? current : undefined,
        message:
          `O design foi alterado por outra fonte (rev atual: ${current}). Releia com get_design e reaplique sua mudança.`,
      });
    }
    if (message.includes("design_not_found")) {
      throw new McpInputError("Este post ainda não tem design — use create_design.");
    }
    if (message.includes("post_has_video_media")) {
      throw new McpInputError(
        "Este post tem vídeo — designs de feed/carrossel não podem ser atualizados para ele.",
      );
    }
    console.error("[mcp] update_post_design failed:", message);
    throw new Error("update_post_design failed");
  }
  const row = data as unknown as DesignRow;

  const status = await autoMoveCorrecao(d, post);
  fireRender(d, row.id, row.rev);

  return {
    design: row.doc,
    rev: row.rev,
    warnings,
    // Layout from the locally-normalized doc (identical to what the RPC stored) — defaults
    // like line_height are guaranteed materialized there.
    layout: await buildLayout(doc, d.resolveFontBytes),
    render: { status: "queued", rev: row.rev },
    // tipo derived from the WRITTEN doc's format: the RPC's check_and_sync updates
    // workflow_posts.tipo when the design format maps differently (feed↔carrossel↔reels),
    // so the pre-write post row would be stale here.
    post: { tipo: FORMAT_TO_TIPO[doc.format], status },
  };
}
