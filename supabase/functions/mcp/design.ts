// Estúdio MCP design tools, v2 (design-first model — spec
// docs/superpowers/specs/2026-07-04-estudio-design-first-model.md §MCP):
// designs are first-class rows whose document is a .fig blob in R2; reads project
// the scene graph through the doc service (/api/describe) and writes go through
// /api/mutate + the SAME RPC family design-manage uses (create_design /
// save_design_blob / attach_design) — ownership, rev CAS, read-only and
// eligibility rules are enforced in one place regardless of caller.
//
// Projection node ids are `source.id` guids — STABLE across saves. Ops reference
// them; get_design_capabilities documents the vocabulary.
import { DocServiceError } from "../_shared/doc-service.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { signGetUrl } from "../_shared/r2.ts";
import { DESIGN_ELIGIBLE_STATUSES, type Deps } from "./queries.ts";

export { DocServiceError };

/** Structured (JSON-payload) tool error — errorResult emits the payload verbatim instead of a
 * plain message string, giving agents a machine-usable self-correction contract. */
export class McpStructuredError extends Error {
  constructor(public payload: Record<string, unknown>) {
    super(typeof payload.error === "string" ? payload.error : "structured_error");
  }
}

export const FORMATS = ["feed", "carrossel", "reel_cover", "livre"] as const;
export type DesignFormat = (typeof FORMATS)[number];

const TIPO_TO_FORMAT: Record<string, DesignFormat> = {
  feed: "feed",
  carrossel: "carrossel",
  reels: "reel_cover",
};

/** Render-service tipo for a design; attached designs use the post's tipo instead. */
export const FORMAT_TO_RENDER_TIPO: Record<DesignFormat, string> = {
  feed: "feed",
  carrossel: "carrossel",
  reel_cover: "reels",
  livre: "carrossel",
};

export interface DesignRow {
  id: number;
  cliente_id: number | null;
  post_id: number | null;
  name: string;
  format: DesignFormat;
  rev: number;
  doc_r2_key: string;
  render_status: string;
  is_stale: boolean;
  render_manifest: Array<{ page_id: string; r2_key: string; width: number; height: number }> | null;
}

const DESIGN_COLUMNS =
  "id, cliente_id, post_id, name, format, rev, doc_r2_key, render_status, is_stale, render_manifest";

interface PostRow {
  id: number;
  tipo: string;
  status: string;
}

// ---- plumbing --------------------------------------------------------------------------------

async function requireFeature(d: Deps): Promise<void> {
  if (!d.isFeatureEnabled) return; // wired in index.ts; absent only in tests that opt out
  if (!(await d.isFeatureEnabled("feature_estudio"))) {
    throw new McpInputError(
      "O Estúdio não está disponível no plano deste workspace (feature_estudio).",
    );
  }
}

function requireDocService(d: Deps): void {
  if (!d.fetchBlob || !d.putBlob || !d.docDescribe || !d.docMutate) {
    throw new McpInputError(
      "O serviço de documentos do Estúdio não está configurado neste ambiente.",
    );
  }
}

export async function getDesignRowOrThrow(d: Deps, designId: number): Promise<DesignRow> {
  const { data } = await d.db
    .from("designs")
    .select(DESIGN_COLUMNS)
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", designId)
    .maybeSingle();
  if (!data) {
    throw new McpInputError("Design não encontrado neste workspace (use list_designs).");
  }
  return data as DesignRow;
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

function requireEditable(post: PostRow): void {
  if (!DESIGN_ELIGIBLE_STATUSES.includes(post.status)) {
    throw new McpInputError(
      `Post em estado '${post.status}' não pode receber design pelo agente.`,
    );
  }
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

/** Post-eligibility pre-checks shared by create-with-post and attach: friendly messages here,
 * the RPCs remain the real boundary. Returns the design format derived from the post's tipo. */
async function checkPostEligibility(d: Deps, post: PostRow): Promise<DesignFormat> {
  requireEditable(post);
  const format = TIPO_TO_FORMAT[post.tipo];
  if (!format) {
    throw new McpInputError(
      `Posts do tipo '${post.tipo}' não são suportados pelo Estúdio (suportados: feed, carrossel, reels).`,
    );
  }
  if (format !== "reel_cover" && (await hasVideoMedia(d, post.id))) {
    throw new McpInputError(
      "Este post tem vídeo — designs de feed/carrossel não podem ser vinculados a ele.",
    );
  }
  return format;
}

function blobKey(d: Deps, rev: number): string {
  const uuid = d.randomUUID ? d.randomUUID() : crypto.randomUUID();
  return `designs/${d.ctx.conta_id}/${uuid}-r${rev}.fig`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadProjection(d: Deps, row: DesignRow): Promise<Record<string, unknown>> {
  const bytes = await d.fetchBlob!(row.doc_r2_key);
  if (!bytes) throw new Error(`design blob missing: ${row.doc_r2_key}`);
  return await d.docDescribe!(bytes);
}

function fireRender(d: Deps, designId: number, rev: number): void {
  if (!d.triggerRender) return;
  // Fire-and-forget: the row's `pending` status IS the job and the sweep cron is the safety
  // net — a trigger failure must never fail the tool call.
  d.triggerRender(designId, rev).catch((e) =>
    console.error("[mcp] design render trigger failed:", (e as Error)?.message)
  );
}

/** Signed URLs of the last finished render (when fresh) — agents that can fetch URLs get the
 * cheap path; preview_design returns inline bytes for the ones that can't. Attached designs'
 * pages live as the POST's media links (finalize applies them there and leaves no manifest);
 * unattached ones read the stored render manifest. */
async function renderSummary(d: Deps, row: DesignRow) {
  const fresh = row.render_status === "rendered" && !row.is_stale;
  const signUrl = d.signUrl ?? ((key: string) => signGetUrl(key, 3600));
  let pages: Array<{ page_id: string; width: number; height: number; url: string }> = [];
  if (fresh && row.post_id != null) {
    const { data } = await d.db
      .from("post_file_links")
      .select("file_id, sort_order, files!inner(r2_key, width, height)")
      .eq("post_id", row.post_id)
      .eq("conta_id", d.ctx.conta_id)
      .eq("origin", "design")
      .order("sort_order", { ascending: true });
    // deno-lint-ignore no-explicit-any
    pages = await Promise.all((data ?? []).map(async (l: any) => ({
      page_id: String(l.file_id),
      width: l.files.width,
      height: l.files.height,
      url: await signUrl(l.files.r2_key),
    })));
  } else if (fresh && Array.isArray(row.render_manifest)) {
    pages = await Promise.all(
      row.render_manifest.map(async (m) => ({
        page_id: m.page_id,
        width: m.width,
        height: m.height,
        url: await signUrl(m.r2_key),
      })),
    );
  }
  return { status: row.render_status, is_stale: row.is_stale, pages };
}

async function attachedPost(d: Deps, row: DesignRow): Promise<PostRow | null> {
  if (row.post_id == null) return null;
  const { data } = await d.db
    .from("workflow_posts")
    .select("id, tipo, status")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", row.post_id)
    .maybeSingle();
  return (data as PostRow | null) ?? null;
}

function mapDocServiceError(e: unknown): never {
  if (e instanceof DocServiceError) {
    throw new McpStructuredError({
      error: e.code,
      message: e.detail ??
        "Operação inválida — confira os ids de nós na projeção (get_design) e os args da op.",
    });
  }
  throw e;
}

// ---- tools -----------------------------------------------------------------------------------

export async function getDesign(d: Deps, args: { design_id: number }) {
  requireDocService(d);
  const row = await getDesignRowOrThrow(d, args.design_id);
  const post = await attachedPost(d, row);
  return {
    design_id: row.id,
    name: row.name,
    format: row.format,
    rev: row.rev,
    cliente_id: row.cliente_id,
    projection: await loadProjection(d, row),
    render: await renderSummary(d, row),
    post: post ? { id: post.id, tipo: post.tipo, status: post.status } : null,
  };
}

export async function listDesigns(
  d: Deps,
  args: { cliente_id?: number; post_id?: number; limit?: number },
) {
  let q = d.db
    .from("designs")
    .select("id, name, format, rev, cliente_id, post_id, render_status, is_stale, updated_at")
    .eq("conta_id", d.ctx.conta_id)
    .order("updated_at", { ascending: false })
    .limit(Math.min(Math.max(args.limit ?? 20, 1), 100));
  if (args.cliente_id != null) q = q.eq("cliente_id", args.cliente_id);
  if (args.post_id != null) q = q.eq("post_id", args.post_id);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return { designs: data ?? [] };
}

export async function createDesign(
  d: Deps,
  args: { format?: string; post_id?: number; cliente_id?: number; name?: string },
) {
  await requireFeature(d);
  requireDocService(d);
  if (!d.starterTemplate) throw new McpInputError("Templates do Estúdio indisponíveis.");

  let format: DesignFormat;
  let postId: number | null = null;
  if (args.post_id != null) {
    const post = await getPostOrThrow(d, args.post_id);
    const { data: existing } = await d.db
      .from("designs")
      .select("id, rev")
      .eq("conta_id", d.ctx.conta_id)
      .eq("post_id", args.post_id)
      .maybeSingle();
    if (existing) {
      throw new McpStructuredError({
        error: "post_already_designed",
        design_id: (existing as { id: number }).id,
        message:
          `Este post já tem o design ${(existing as { id: number }).id} — edite-o com update_design.`,
      });
    }
    format = await checkPostEligibility(d, post);
    postId = post.id;
  } else {
    if (!args.format || !(FORMATS as readonly string[]).includes(args.format)) {
      throw new McpInputError(
        `Informe format (${FORMATS.join(", ")}) ou post_id para derivar do post.`,
      );
    }
    format = args.format as DesignFormat;
  }

  if (args.cliente_id != null) {
    const { data } = await d.db
      .from("clientes")
      .select("id")
      .eq("conta_id", d.ctx.conta_id)
      .eq("id", args.cliente_id)
      .maybeSingle();
    if (!data) throw new McpInputError("Cliente não encontrado neste workspace.");
  }

  const template = d.starterTemplate(format);
  const key = blobKey(d, 1);
  await d.putBlob!(key, template);

  const { data, error } = await d.db.rpc("create_design", {
    p_conta_id: d.ctx.conta_id,
    p_cliente_id: args.cliente_id ?? null,
    p_post_id: postId,
    p_format: format,
    p_name: args.name ?? null,
    p_r2_key: key,
    p_doc_hash: await sha256Hex(template),
    p_doc_bytes: template.length,
    p_created_by: d.ctx.created_by,
  });
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    if (message.includes("post_already_designed")) {
      throw new McpStructuredError({
        error: "post_already_designed",
        message: "Este post já tem um design — edite-o com update_design.",
      });
    }
    console.error("[mcp] create_design failed:", message);
    throw new Error("create_design failed");
  }
  const designId = data as number;
  fireRender(d, designId, 1);

  return {
    design_id: designId,
    format,
    rev: 1,
    post_id: postId,
    projection: await d.docDescribe!(template),
    render: { status: "queued", rev: 1 },
    hint: "Edite com update_design (ops referem ids de nós da projeção).",
  };
}

export async function updateDesign(
  d: Deps,
  args: { design_id: number; ops: unknown[]; expected_rev?: number },
) {
  await requireFeature(d);
  requireDocService(d);
  if (!Array.isArray(args.ops) || args.ops.length === 0) {
    throw new McpInputError(
      "ops deve ser uma lista não-vazia de operações (get_design_capabilities documenta o vocabulário).",
    );
  }
  const row = await getDesignRowOrThrow(d, args.design_id);

  const bytes = await d.fetchBlob!(row.doc_r2_key);
  if (!bytes) throw new Error(`design blob missing: ${row.doc_r2_key}`);

  let mutated;
  try {
    mutated = await d.docMutate!(bytes, args.ops);
  } catch (e) {
    mapDocServiceError(e);
  }

  // NULL expected_rev = documented last-writer-wins: guard against the rev we just read.
  const expected = args.expected_rev ?? row.rev;
  const key = blobKey(d, expected + 1);
  await d.putBlob!(key, mutated.bytes);

  const { data, error } = await d.db.rpc("save_design_blob", {
    p_conta_id: d.ctx.conta_id,
    p_design_id: row.id,
    p_expected_rev: expected,
    p_doc_hash: await sha256Hex(mutated.bytes),
    p_r2_key: key,
    p_doc_bytes: mutated.bytes.length,
    p_editor_version: null,
    p_updated_by: d.ctx.created_by,
  }).single();
  if (error) {
    // The staged blob is unreachable on failure; best-effort cleanup.
    d.deleteBlob?.(key).catch(() => {});
    const message = (error as { message?: string }).message ?? "";
    if (message.includes("rev_conflict")) {
      throw new McpStructuredError({
        error: "rev_conflict",
        message:
          "O design foi alterado por outra fonte. Releia com get_design e reaplique as ops.",
      });
    }
    if (message.includes("read_only") || message.includes("post_not_editable")) {
      throw new McpStructuredError({
        error: "read_only",
        message:
          "O post vinculado não está mais editável (aprovado/agendado). Duplique o design para continuar editando.",
      });
    }
    console.error("[mcp] save_design_blob failed:", message);
    throw new Error("save_design_blob failed");
  }
  const saved = data as { o_rev: number; o_prev_r2_key: string | null };
  if (saved.o_prev_r2_key) d.deleteBlob?.(saved.o_prev_r2_key).catch(() => {});
  fireRender(d, row.id, saved.o_rev);

  return {
    design_id: row.id,
    rev: saved.o_rev,
    applied: mutated.applied,
    projection: mutated.projection,
    render: { status: "queued", rev: saved.o_rev },
  };
}

export async function attachDesign(d: Deps, args: { design_id: number; post_id: number }) {
  await requireFeature(d);
  const row = await getDesignRowOrThrow(d, args.design_id);
  if (row.post_id != null) {
    throw new McpStructuredError({
      error: "design_already_attached",
      post_id: row.post_id,
      message:
        `Este design já está vinculado ao post ${row.post_id}. Duplique-o para usar em outro post.`,
    });
  }
  const post = await getPostOrThrow(d, args.post_id);
  await checkPostEligibility(d, post);
  const { data: existing } = await d.db
    .from("designs")
    .select("id")
    .eq("conta_id", d.ctx.conta_id)
    .eq("post_id", args.post_id)
    .maybeSingle();
  if (existing) {
    throw new McpStructuredError({
      error: "post_already_designed",
      design_id: (existing as { id: number }).id,
      message: `O post ${args.post_id} já tem o design ${(existing as { id: number }).id}.`,
    });
  }

  const { data, error } = await d.db.rpc("attach_design", {
    p_conta_id: d.ctx.conta_id,
    p_design_id: args.design_id,
    p_post_id: args.post_id,
    p_updated_by: d.ctx.created_by,
  });
  if (error) {
    const message = (error as { message?: string }).message ?? "";
    for (const code of ["design_already_attached", "post_already_designed", "post_not_editable"]) {
      if (message.includes(code)) throw new McpStructuredError({ error: code, message });
    }
    console.error("[mcp] attach_design failed:", message);
    throw new Error("attach_design failed");
  }
  fireRender(d, args.design_id, row.rev);

  return {
    design_id: args.design_id,
    post_id: args.post_id,
    post_tipo: data as string,
    hint: "A renderização foi disparada — as páginas viram a mídia do post ao concluir.",
  };
}
