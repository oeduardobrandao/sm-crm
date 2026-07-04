// post-design-manage — Estúdio v2 (OpenPencil). The editor's blob save/load path: .fig bytes
// live in R2, this function moves them and guards rev/tenancy/status. Contract (FROZEN):
// docs/estudio-v2-editor-contract.md — GET/PUT /blob with x-rev / x-expected-rev.
//
// User-facing (Bearer JWT, verified in application code — same pattern as file-upload-finalize,
// NOT the platform gateway's verify_jwt; see config.toml). All writes go through the v2 RPC
// family (20260704000001_post_designs_blob.sql) — clients cannot write post_designs directly
// (SELECT-only grants), so ownership/status/rev are enforced in one transaction regardless of
// caller. This function treats the blob as opaque bytes — deep validation and tipo-sync live in
// the render pipeline (design-render + estudio-render service), kicked fire-and-forget on
// every mint/save.

import { createJsonResponder } from "../_shared/http.ts";
import type { MaterializeLogoResult } from "../_shared/brand-logo.ts";
import { starterTemplateFor } from "./starter-templates.gen.ts";

// Mirrors the SQL copies inside get_or_create_post_design_blob / save_post_design_blob.
const EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente"];

// Contract: PUT bodies above this are refused with 413. Keep well under the edge runtime's
// own request-size ceiling so our limit is the one callers actually observe.
export const MAX_BLOB_BYTES = 10 * 1024 * 1024;

export interface PostRow {
  id: number;
  tipo: string;
  status: string;
}

export interface DesignMeta {
  id: number;
  rev: number;
  doc_r2_key: string | null;
}

export interface PostDesignManageDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  getUser: (token: string) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<{ conta_id: string } | null>;
  isFeatureEnabled: (contaId: string) => Promise<boolean>;
  getPost: (postId: number, contaId: string) => Promise<PostRow | null>;
  hasVideoMedia: (postId: number) => Promise<boolean>;
  getDesignMeta: (postId: number, contaId: string) => Promise<DesignMeta | null>;
  getOrCreateDesignBlob: (
    contaId: string,
    postId: number,
    r2Key: string,
    docHash: string,
    docBytes: number,
    updatedBy: string,
  ) => Promise<DesignMeta & { created: boolean }>;
  saveDesignBlob: (
    contaId: string,
    postId: number,
    expectedRev: number,
    docHash: string,
    r2Key: string,
    docBytes: number,
    editorVersion: string | null,
    updatedBy: string,
  ) => Promise<{ rev: number; prevR2Key: string | null }>;
  deleteDesign: (contaId: string, postId: number) => Promise<void>;
  fetchBlob: (r2Key: string) => Promise<Uint8Array | null>;
  putBlob: (r2Key: string, bytes: Uint8Array) => Promise<void>;
  deleteBlob: (r2Key: string) => Promise<void>;
  clienteExists: (clienteId: number, contaId: string) => Promise<boolean>;
  materializeBrandLogo: (args: {
    contaId: string;
    clienteId: number;
    uploadedBy: string;
  }) => Promise<MaterializeLogoResult>;
  triggerRender: (designId: number, rev: number) => Promise<void>;
  waitUntil: (promise: Promise<unknown>) => void;
  insertAuditLog: (entry: {
    conta_id: string;
    actor_user_id: string;
    action: string;
    resource_type: string;
    resource_id: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  logError: (context: string, error: unknown) => void;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fireRender(deps: PostDesignManageDeps, designId: number, rev: number) {
  // Fire-and-forget (v1 idiom): a failed kick just leaves the row pending for the sweep cron.
  deps.waitUntil(
    deps.triggerRender(designId, rev).catch((e) =>
      deps.logError("post-design-manage:trigger-render", e)
    ),
  );
}

function blobKey(contaId: string, postId: number, rev: number): string {
  // Rev-scoped on purpose: a lost save race can never clobber the winner's bytes; the row's
  // doc_r2_key always names the bytes that won. The loser's orphan is cleaned best-effort.
  return `designs/${contaId}/${postId}-r${rev}.fig`;
}

function mapDesignRpcError(message: string): { status: number; body: Record<string, unknown> } {
  if (message === "post_not_found") return { status: 404, body: { error: "post_not_found" } };
  if (message.startsWith("post_not_editable:")) {
    return {
      status: 403,
      body: { error: "post_not_editable", status: message.slice("post_not_editable:".length) },
    };
  }
  if (message === "rev_conflict") return { status: 409, body: { error: "rev_conflict" } };
  if (message === "design_not_found") return { status: 404, body: { error: "design_not_found" } };
  // Never surface a raw/unrecognized RPC exception message to the client (security rule).
  return { status: 500, body: { error: "internal_error" } };
}

export function createPostDesignManageHandler(deps: PostDesignManageDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = {
      ...deps.buildCorsHeaders(req),
      // The /blob contract needs two extra request headers and the rev echo (frozen contract).
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type, x-expected-rev, x-editor-version",
      "Access-Control-Expose-Headers": "x-rev",
    };
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const user = await deps.getUser(authHeader.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);

    const profile = await deps.getProfile(user.id);
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const contaId = profile.conta_id;

    if (!(await deps.isFeatureEnabled(contaId))) {
      return json({ error: "feature_disabled", feature: "feature_estudio" }, 403);
    }

    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const sub = parts[parts.indexOf("post-design-manage") + 1] ?? null;

    if (req.method === "POST") {
      // POST /brand-logo is the ONLY POST this function serves — lazy logo materialization.
      if (sub !== "brand-logo") return json({ error: "not_found" }, 404);

      let body: { cliente_id?: unknown };
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      const clienteId = typeof body.cliente_id === "number" ? body.cliente_id : NaN;
      if (isNaN(clienteId)) return json({ error: "invalid_cliente_id" }, 400);

      if (!(await deps.clienteExists(clienteId, contaId))) {
        return json({ error: "cliente_not_found" }, 404);
      }

      let result: MaterializeLogoResult;
      try {
        result = await deps.materializeBrandLogo({ contaId, clienteId, uploadedBy: user.id });
      } catch (e) {
        // Only infra failures throw (R2 / unexpected DB) — expected outcomes come back as
        // `reason` codes. Never leak internals (security rule).
        deps.logError("post-design-manage:brand-logo", e);
        return json({ error: "internal_error" }, 500);
      }

      if (result.logo_file_id !== null) {
        if (result.created) {
          await deps.insertAuditLog({
            conta_id: contaId,
            actor_user_id: user.id,
            action: "brand_logo_materialize",
            resource_type: "hub_brand",
            resource_id: String(clienteId),
            metadata: { cliente_id: clienteId, logo_file_id: result.logo_file_id },
          });
        }
        return json({ logo_file_id: result.logo_file_id });
      }
      return json({ logo_file_id: null, reason: result.reason });
    }

    const postId = parseInt(url.searchParams.get("post_id") ?? "", 10);

    if (req.method === "GET") {
      if (sub !== "blob") return json({ error: "not_found" }, 404);
      if (isNaN(postId)) return json({ error: "invalid_post_id" }, 400);

      const post = await deps.getPost(postId, contaId);
      if (!post) return json({ error: "post_not_found" }, 404);

      const bytesResponse = (bytes: Uint8Array, rev: number) =>
        new Response(bytes.slice().buffer as ArrayBuffer, {
          status: 200,
          headers: {
            ...cors,
            "content-type": "application/octet-stream",
            "cache-control": "no-store",
            "x-rev": String(rev),
          },
        });

      const meta = await deps.getDesignMeta(postId, contaId);
      if (meta?.doc_r2_key) {
        const bytes = await deps.fetchBlob(meta.doc_r2_key);
        if (!bytes) {
          // R2/DB drift — an internal inconsistency, not a client error shape we can act on.
          deps.logError("post-design-manage:blob-missing", { postId, key: meta.doc_r2_key });
          return json({ error: "design_blob_missing" }, 404);
        }
        return bytesResponse(bytes, meta.rev);
      }

      // Mint: same rules v1 enforced for creation — editable post, supported tipo, and
      // feed/carrossel posts with video media can never hold a design.
      if (!EDITABLE_STATUSES.includes(post.status)) {
        return json({ error: "post_not_editable", status: post.status }, 403);
      }
      const template = starterTemplateFor(post.tipo);
      if (!template) return json({ error: "unsupported_post_tipo" }, 422);
      if (post.tipo !== "reels" && (await deps.hasVideoMedia(postId))) {
        return json({ error: "post_has_video_media" }, 422);
      }

      const key = blobKey(contaId, postId, 1);
      try {
        await deps.putBlob(key, template);
        const created = await deps.getOrCreateDesignBlob(
          contaId,
          postId,
          key,
          await sha256Hex(template),
          template.length,
          user.id,
        );
        if (created.created) {
          await deps.insertAuditLog({
            conta_id: contaId,
            actor_user_id: user.id,
            action: "create",
            resource_type: "post_design",
            resource_id: String(created.id),
            metadata: { post_id: postId, doc_bytes: template.length, rev: created.rev },
          });
          fireRender(deps, created.id, created.rev);
          return bytesResponse(template, created.rev);
        }
        // Lost the create race — serve the winner's bytes, never ours.
        const winnerBytes = created.doc_r2_key ? await deps.fetchBlob(created.doc_r2_key) : null;
        if (!winnerBytes) {
          deps.logError("post-design-manage:create-race-blob-missing", { postId });
          return json({ error: "internal_error" }, 500);
        }
        return bytesResponse(winnerBytes, created.rev);
      } catch (e) {
        const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
        if (mapped.status === 500) deps.logError("post-design-manage:get-or-create", e);
        return json(mapped.body, mapped.status);
      }
    }

    if (req.method === "PUT") {
      if (sub !== "blob") return json({ error: "not_found" }, 404);
      if (isNaN(postId)) return json({ error: "invalid_post_id" }, 400);

      const expected = Number(req.headers.get("x-expected-rev"));
      if (!Number.isInteger(expected) || expected < 1) {
        return json({ error: "invalid_expected_rev" }, 422);
      }

      const post = await deps.getPost(postId, contaId);
      if (!post) return json({ error: "post_not_found" }, 404);

      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length === 0) return json({ error: "empty_body" }, 422);
      if (body.length > MAX_BLOB_BYTES) return json({ error: "blob_too_large" }, 413);

      const key = blobKey(contaId, postId, expected + 1);
      try {
        await deps.putBlob(key, body);
        const saved = await deps.saveDesignBlob(
          contaId,
          postId,
          expected,
          await sha256Hex(body),
          key,
          body.length,
          req.headers.get("x-editor-version"),
          user.id,
        );

        await deps.insertAuditLog({
          conta_id: contaId,
          actor_user_id: user.id,
          action: "update",
          resource_type: "post_design",
          resource_id: String(postId),
          metadata: { post_id: postId, doc_bytes: body.length, rev: saved.rev },
        });

        const savedMeta = await deps.getDesignMeta(postId, contaId);
        if (savedMeta) fireRender(deps, savedMeta.id, saved.rev);

        // Best-effort: the previous rev's blob is now unreachable via the row.
        if (saved.prevR2Key && saved.prevR2Key !== key) {
          await deps.deleteBlob(saved.prevR2Key).catch((e) =>
            deps.logError("post-design-manage:prev-blob-cleanup", e)
          );
        }

        return new Response("ok", { status: 200, headers: { ...cors, "x-rev": String(saved.rev) } });
      } catch (e) {
        const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
        if (mapped.status === 500) deps.logError("post-design-manage:save", e);
        return json(mapped.body, mapped.status);
      }
    }

    if (req.method === "DELETE") {
      if (isNaN(postId)) return json({ error: "invalid_post_id" }, 400);

      const post = await deps.getPost(postId, contaId);
      if (!post) return json({ error: "post_not_found" }, 404);
      if (!EDITABLE_STATUSES.includes(post.status)) {
        return json({ error: "post_not_editable", status: post.status }, 403);
      }

      const meta = await deps.getDesignMeta(postId, contaId);

      try {
        await deps.deleteDesign(contaId, postId);
      } catch (e) {
        const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
        if (mapped.status === 500) deps.logError("post-design-manage:delete", e);
        return json(mapped.body, mapped.status);
      }

      if (meta?.doc_r2_key) {
        await deps.deleteBlob(meta.doc_r2_key).catch((e) =>
          deps.logError("post-design-manage:delete-blob", e)
        );
      }

      await deps.insertAuditLog({
        conta_id: contaId,
        actor_user_id: user.id,
        action: "delete",
        resource_type: "post_design",
        resource_id: String(postId),
        metadata: { post_id: postId },
      });

      return json({ ok: true });
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
