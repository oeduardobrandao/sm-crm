// design-render — Estúdio orchestrator (design-first, slice A1). Internal-only
// (x-cron-secret, --no-verify-jwt). Callers unchanged: design-manage (creates/saves/attach),
// the pre-schedule publish-gate re-check, hub-approve, and the sweep cron — same trigger
// contract ({design_id, rev}).
//
// Delegates the compute to the estudio-render Vercel service (IO-bound here); the database
// story lives in the design_id-keyed RPC family (20260705000001): claim_design_render (same
// locking/reap semantics, now LEFT JOINed to the optionally-attached post),
// finalize_design_render (media application only when attached AND the post is editable) and
// fail_design_render. Same rendered-page R2 key scheme, same stale/cleanup behavior.
// Unattached designs render too — thumbnails for the gallery; no post is touched.

import { createJsonResponder } from "../_shared/http.ts";

// Mirrors the SQL editability list (save_design_blob / finalize_design_render).
const EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente", "enviado_cliente"];

// Render-service tipo for a design with no attached post, from its format.
const FORMAT_TO_TIPO: Record<string, string> = {
  feed: "feed",
  carrossel: "carrossel",
  reel_cover: "reels",
  livre: "carrossel",
};

export interface ManifestEntry {
  page_id: string;
  r2_key: string;
  bytes: number;
  width: number;
  height: number;
}

export interface DesignRowMeta {
  id: number;
  rev: number;
  render_status: string;
}

export interface ClaimedDesign {
  id: number;
  conta_id: string;
  post_id: number | null;
  doc_r2_key: string | null;
  doc_hash: string;
  format: string;
  post_tipo: string | null;
  post_status: string | null;
}

export interface RenderServiceResult {
  validation: { ok: boolean; errors: Array<{ code: string; message?: string }> };
  derived: { format: string | null; tipo: string | null };
  pages: Array<{ frame_id: string; width: number; height: number; bytes: number; jpeg_b64: string }>;
}

export interface DesignRenderDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  readDesignRow: (designId: number) => Promise<DesignRowMeta | null>;
  claimDesignRender: (designId: number) => Promise<ClaimedDesign | null>;
  fetchBlob: (r2Key: string) => Promise<Uint8Array | null>;
  callRenderService: (bytes: Uint8Array, tipo: string) => Promise<RenderServiceResult>;
  putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  finalizeDesignRender: (
    designId: number,
    claimedHash: string,
    manifest: ManifestEntry[],
  ) => Promise<"rendered" | "stale">;
  failDesignRender: (designId: number, error: string) => Promise<void>;
  queueFileDeletion: (r2Key: string) => Promise<void>;
  syncPostTipo: (postId: number, contaId: string, tipo: string) => Promise<void>;
  logError: (context: string, error: unknown) => void;
}

const NO_CONTENT = (cors: Record<string, string>) =>
  new Response(null, { status: 204, headers: cors });

// v1 scheme, unchanged — finalize_design_render's manifest consumers and the R2 cleanup
// tooling both assume it.
function r2KeyFor(contaId: string, designId: number, rev: number, frameId: string): string {
  return `contas/${contaId}/designs/${designId}/${rev}/${frameId}.jpg`;
}

// Tenant-visible failure text (render_error). Validation codes come from the render service
// with PT-BR messages of our own making; anything else gets the generic string (v1 rule:
// never a raw provider/internal error).
function tenantErrorFor(result: RenderServiceResult): string {
  return result.validation.errors[0]?.message ?? "Falha ao renderizar o design.";
}

function decodeB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function createDesignRenderHandler(deps: DesignRenderDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const { design_id, rev } = (body ?? {}) as Record<string, unknown>;
    if (typeof design_id !== "number" || typeof rev !== "number") {
      return json({ error: "invalid_request" }, 400);
    }

    const row = await deps.readDesignRow(design_id);
    if (!row) return json({ error: "design_not_found" }, 404);
    if (row.rev !== rev) return NO_CONTENT(cors); // superseded trigger — nothing to do

    const claimed = await deps.claimDesignRender(design_id);
    if (!claimed) return json({ error: "render_in_progress" }, 409);

    // Attached designs render for the post's tipo; unattached ones derive it from format
    // (livre has no fixed aspect → carrossel is the service's multi-frame-tolerant mode).
    const renderTipo = claimed.post_tipo ?? FORMAT_TO_TIPO[claimed.format] ?? "carrossel";

    // Track what really landed in R2 so every failure path can queue cleanup before
    // fail_design_render NULLs the manifest (v1 invariant, kept).
    const uploaded: ManifestEntry[] = [];
    const failAndCleanup = async (message: string) => {
      for (const e of uploaded) await deps.queueFileDeletion(e.r2_key);
      await deps.failDesignRender(design_id, message);
    };

    try {
      const bytes = claimed.doc_r2_key ? await deps.fetchBlob(claimed.doc_r2_key) : null;
      if (!bytes) {
        deps.logError("design-render:blob-missing", { design_id, key: claimed.doc_r2_key });
        await failAndCleanup("Documento do design não encontrado.");
        return json({ error: "render_failed" }, 500);
      }

      const result = await deps.callRenderService(bytes, renderTipo);

      if (!result.validation.ok) {
        await failAndCleanup(tenantErrorFor(result));
        return json({ error: "design_invalid", codes: result.validation.errors.map((e) => e.code) }, 422);
      }

      const manifest: ManifestEntry[] = [];
      for (const page of result.pages) {
        const key = r2KeyFor(claimed.conta_id, design_id, rev, page.frame_id);
        const jpeg = decodeB64(page.jpeg_b64);
        await deps.putObject(key, jpeg, "image/jpeg");
        const entry: ManifestEntry = {
          page_id: page.frame_id,
          r2_key: key,
          bytes: jpeg.length,
          width: page.width,
          height: page.height,
        };
        manifest.push(entry);
        uploaded.push(entry);
      }

      const outcome = await deps.finalizeDesignRender(design_id, claimed.doc_hash, manifest);
      if (outcome === "stale") {
        for (const e of manifest) await deps.queueFileDeletion(e.r2_key);
        return NO_CONTENT(cors);
      }

      if (
        claimed.post_id !== null &&
        claimed.post_status !== null &&
        EDITABLE_STATUSES.includes(claimed.post_status) &&
        result.derived.tipo &&
        result.derived.tipo !== claimed.post_tipo
      ) {
        // Post-finalize on purpose: media is live either way; tipo follows the frames.
        // Unattached or locked posts are never touched (mirrors finalize's media branch).
        await deps
          .syncPostTipo(claimed.post_id, claimed.conta_id, result.derived.tipo)
          .catch((e) => deps.logError("design-render:tipo-sync", e));
      }

      return json({ status: "rendered", pages_total: manifest.length });
    } catch (e) {
      deps.logError("design-render", e);
      await failAndCleanup("Falha ao renderizar o design.");
      return json({ error: "render_failed" }, 500);
    }
  };
}
