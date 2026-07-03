// design-render — docs/estudio-design.md §5.2. Internal-only (x-cron-secret, --no-verify-jwt).
// Callers: MCP design tools, post-design-manage (editor saves), the pre-schedule hook, and the
// sweep cron — never the CRM directly.
//
// PR 1.4 scope (per docs/estudio-plan.md T1.5 — "design-render fn (single page)"): renders
// exactly the page in the request (`page_index ?? 0`), appends to `render_manifest`, and
// finalizes immediately IF that was the doc's last page. Self-invocation for the next page of a
// multi-page doc (`EdgeRuntime.waitUntil`) is PR 1.5's job — a multi-page doc rendered here stops
// after page 0 with `{status: 'partial'}` and stays `render_status = 'rendering'` until PR 1.5's
// chaining or sweep cron continues it. The re-read/abort logic for a chunked call (`page_index >
// 0`) is implemented and tested now even though nothing sends such a request yet, because it's
// page-index-agnostic and PR 1.5 must not need to touch this file to wire the chain in.

import { createJsonResponder } from "../_shared/http.ts";
import type { DesignDoc } from "../_shared/design-doc.ts";

export interface ManifestEntry {
  page_id: string;
  r2_key: string;
  bytes: number;
  width: number;
  height: number;
}

export interface DesignRow {
  id: number;
  conta_id: string;
  post_id: number;
  rev: number;
  doc: DesignDoc;
  doc_hash: string;
  render_status: string;
  render_manifest: ManifestEntry[] | null;
}

export interface ClaimedDesign {
  id: number;
  conta_id: string;
  post_id: number;
  doc: DesignDoc;
  doc_hash: string;
}

export type FileBytesResolver = (
  fileId: number,
) => Promise<{ bytes: Uint8Array; mimeType: string }>;

export type FontBytesResolver = (r2Key: string) => Promise<Uint8Array>;

// Tenancy-scoped variant the deps object provides — `conta_id` is only known once the design
// row has been read, so the handler closes over it per-request before handing design-render-core
// a plain `FileBytesResolver` (which has no concept of tenancy at all, by design).
export type TenantFileBytesResolver = (
  fileId: number,
  contaId: string,
) => Promise<{ bytes: Uint8Array; mimeType: string }>;

export interface RenderedPage {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

export interface DesignRenderDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  readDesignRow: (designId: number) => Promise<DesignRow | null>;
  claimDesignRender: (designId: number) => Promise<ClaimedDesign | null>;
  finalizeDesignRender: (
    designId: number,
    claimedHash: string,
    manifest: ManifestEntry[],
  ) => Promise<"rendered" | "stale">;
  failDesignRender: (designId: number, error: string) => Promise<void>;
  writeManifest: (designId: number, manifest: ManifestEntry[]) => Promise<void>;
  queueFileDeletion: (r2Key: string) => Promise<void>;
  renderPage: (
    doc: DesignDoc,
    pageIndex: number,
    deps: { resolveFileBytes: FileBytesResolver; resolveFontBytes: FontBytesResolver },
  ) => Promise<RenderedPage>;
  resolveFileBytes: TenantFileBytesResolver;
  resolveFontBytes: FontBytesResolver;
  putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  logError: (context: string, error: unknown) => void;
}

const NO_CONTENT = (cors: Record<string, string>) =>
  new Response(null, { status: 204, headers: cors });

function r2KeyFor(
  contaId: string,
  designId: number,
  rev: number,
  pageId: string,
): string {
  return `contas/${contaId}/designs/${designId}/${rev}/${pageId}.jpg`;
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
    const { design_id, rev, page_index } = (body ?? {}) as Record<string, unknown>;
    if (typeof design_id !== "number" || typeof rev !== "number") {
      return json({ error: "invalid_request" }, 400);
    }
    if (page_index !== undefined && typeof page_index !== "number") {
      return json({ error: "invalid_request" }, 400);
    }

    const row = await deps.readDesignRow(design_id);
    if (!row) return json({ error: "design_not_found" }, 404);

    let doc: DesignDoc;
    let contaId: string;
    let claimedHash: string;
    let existingManifest: ManifestEntry[];

    if (page_index === undefined) {
      // Orchestration start.
      if (row.rev !== rev) return NO_CONTENT(cors);

      const claimed = await deps.claimDesignRender(design_id);
      if (!claimed) return json({ error: "render_in_progress" }, 409);

      doc = claimed.doc;
      contaId = claimed.conta_id;
      claimedHash = claimed.doc_hash;
      existingManifest = []; // claim_design_render resets render_manifest to [] atomically.
    } else {
      // Chunked continuation (no live caller sends this yet — see file header).
      if (row.rev !== rev || row.render_status !== "rendering") {
        for (const entry of row.render_manifest ?? []) {
          await deps.queueFileDeletion(entry.r2_key);
        }
        return NO_CONTENT(cors);
      }
      doc = row.doc;
      contaId = row.conta_id;
      claimedHash = row.doc_hash;
      existingManifest = row.render_manifest ?? [];
    }

    const effectivePageIndex = page_index ?? 0;
    const page = doc.pages[effectivePageIndex];

    // fail_design_render's own SQL unconditionally NULLs out render_manifest on the way to
    // 'failed' (mirroring the doc-state trigger's reset-on-write behavior) — so any R2 object
    // already uploaded under this claim (prior chunks' entries in `existingManifest`, or this
    // call's own page once `putObject` below succeeds) would become permanently untracked unless
    // this handler queues it into file_deletions itself before ever calling failDesignRender.
    // `uploadedManifest` tracks the best-known set of "really is in R2" entries at every point a
    // failure could occur, so every failDesignRender call site below cleans up correctly.
    let uploadedManifest = existingManifest;
    const failAndCleanup = async (message: string) => {
      for (const e of uploadedManifest) await deps.queueFileDeletion(e.r2_key);
      await deps.failDesignRender(design_id, message);
    };

    if (!page) {
      deps.logError("design-render", new Error(`page_index ${effectivePageIndex} out of range`));
      await failAndCleanup("Página inválida.");
      return json({ error: "render_failed" }, 500);
    }

    try {
      const rendered = await deps.renderPage(doc, effectivePageIndex, {
        resolveFileBytes: (fileId) => deps.resolveFileBytes(fileId, contaId),
        resolveFontBytes: deps.resolveFontBytes,
      });
      const r2Key = r2KeyFor(contaId, design_id, rev, page.id);
      await deps.putObject(r2Key, rendered.jpegBytes, "image/jpeg");

      const entry: ManifestEntry = {
        page_id: page.id,
        r2_key: r2Key,
        bytes: rendered.jpegBytes.length,
        width: rendered.width,
        height: rendered.height,
      };
      const manifest = [...existingManifest, entry];
      uploadedManifest = manifest; // this page's object now really exists in R2 — track it.

      const isLastPage = effectivePageIndex === doc.pages.length - 1;
      if (!isLastPage) {
        // PR 1.5 adds the EdgeRuntime.waitUntil self-invoke for page_index+1 here.
        await deps.writeManifest(design_id, manifest);
        return json({
          status: "partial",
          page_index: effectivePageIndex,
          pages_total: doc.pages.length,
        });
      }

      // No writeManifest here on the last-page path: finalize_design_render's own transaction
      // sets render_manifest = NULL unconditionally on success, so persisting it first would
      // just be an extra round trip immediately overwritten.
      const result = await deps.finalizeDesignRender(design_id, claimedHash, manifest);
      if (result === "stale") {
        for (const e of manifest) await deps.queueFileDeletion(e.r2_key);
        return NO_CONTENT(cors);
      }
      return json({
        status: "rendered",
        page_index: effectivePageIndex,
        pages_total: doc.pages.length,
      });
    } catch (e) {
      deps.logError("design-render", e);
      await failAndCleanup("Falha ao renderizar o design.");
      return json({ error: "render_failed" }, 500);
    }
  };
}
