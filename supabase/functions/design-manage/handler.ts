// design-manage — Estúdio design-first core (slice A1). Designs are first-class rows keyed
// by design_id; creation is explicit (POST /designs), the blob save/load path keeps the
// FROZEN contract (docs/estudio-v2-editor-contract.md — GET/PUT /blob with x-rev /
// x-expected-rev) with design_id as the key, and attach/detach/duplicate/delete manage the
// 1:1 post attachment. Spec: docs/superpowers/specs/2026-07-04-estudio-design-first-model.md.
//
// User-facing (Bearer JWT, verified in application code — same pattern as
// file-upload-finalize, NOT the platform gateway's verify_jwt; see config.toml). All writes
// go through the design RPC family (20260705000001_designs_first_class.sql) — clients
// cannot write designs directly (SELECT-only grants), so ownership/status/rev are enforced
// in one transaction regardless of caller. This function treats the blob as opaque bytes —
// deep validation and tipo-sync live in the render pipeline (design-render +
// estudio-render service), kicked fire-and-forget on every create/save/attach.

import { createJsonResponder } from "../_shared/http.ts";
import type { MaterializeLogoResult } from "../_shared/brand-logo.ts";
import { type DesignFormat, starterTemplateFor } from "./starter-templates.gen.ts";

// Mirrors the SQL checks inside create_design / save_design_blob / attach_design
// (20260706000001: design work may continue while the post awaits client review).
const EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente", "enviado_cliente"];

const FORMATS: DesignFormat[] = ["feed", "carrossel", "reel_cover", "livre"];

// A design can attach to feed/carrossel/reels posts; stories (and anything else) can't
// hold a design. The post's tipo dictates the design format when creating pre-attached.
const TIPO_TO_FORMAT: Record<string, DesignFormat> = {
  feed: "feed",
  carrossel: "carrossel",
  reels: "reel_cover",
};

// Contract: PUT bodies above this are refused with 413. Keep well under the edge runtime's
// own request-size ceiling so our limit is the one callers actually observe.
export const MAX_BLOB_BYTES = 10 * 1024 * 1024;

export interface PostRow {
  id: number;
  tipo: string;
  status: string;
}

export interface DesignRow {
  id: number;
  rev: number;
  doc_r2_key: string;
  post_id: number | null;
  format: string;
}

export interface DesignManageDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  getUser: (token: string) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<{ conta_id: string } | null>;
  isFeatureEnabled: (contaId: string) => Promise<boolean>;
  getPost: (postId: number, contaId: string) => Promise<PostRow | null>;
  hasVideoMedia: (postId: number) => Promise<boolean>;
  getDesign: (designId: number, contaId: string) => Promise<DesignRow | null>;
  createDesign: (
    contaId: string,
    input: { clienteId: number | null; postId: number | null; format: string; name: string | null },
    r2Key: string,
    docHash: string,
    docBytes: number,
    createdBy: string,
  ) => Promise<number>;
  saveDesignBlob: (
    contaId: string,
    designId: number,
    expectedRev: number,
    docHash: string,
    r2Key: string,
    docBytes: number,
    editorVersion: string | null,
    updatedBy: string,
  ) => Promise<{ rev: number; prevR2Key: string | null }>;
  attachDesign: (
    contaId: string,
    designId: number,
    postId: number,
    updatedBy: string,
  ) => Promise<string>;
  detachDesign: (contaId: string, designId: number) => Promise<void>;
  duplicateDesign: (
    contaId: string,
    designId: number,
    newR2Key: string,
    createdBy: string,
  ) => Promise<number>;
  deleteDesign: (contaId: string, designId: number) => Promise<void>;
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
  randomUUID: () => string;
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

function fireRender(deps: DesignManageDeps, designId: number, rev: number) {
  // Fire-and-forget: a failed kick just leaves the row pending for the sweep cron.
  deps.waitUntil(
    deps.triggerRender(designId, rev).catch((e) => deps.logError("design-manage:trigger-render", e)),
  );
}

function blobKey(deps: DesignManageDeps, contaId: string, rev: number): string {
  // uuid-keyed on purpose: the key never depends on the row id (unknown before insert) and
  // a lost save race can never clobber the winner's bytes — the row's doc_r2_key always
  // names the bytes that won. The loser's orphan is cleaned best-effort.
  return `designs/${contaId}/${deps.randomUUID()}-r${rev}.fig`;
}

function mapDesignRpcError(message: string): { status: number; body: Record<string, unknown> } {
  if (message === "post_not_found") return { status: 404, body: { error: "post_not_found" } };
  if (message === "design_not_found") return { status: 404, body: { error: "design_not_found" } };
  if (message === "cliente_not_found") return { status: 404, body: { error: "cliente_not_found" } };
  if (message.startsWith("post_not_editable:")) {
    return {
      status: 403,
      body: { error: "post_not_editable", status: message.slice("post_not_editable:".length) },
    };
  }
  if (message === "read_only") return { status: 403, body: { error: "read_only" } };
  if (message === "rev_conflict") return { status: 409, body: { error: "rev_conflict" } };
  if (message === "design_already_attached") {
    return { status: 409, body: { error: "design_already_attached" } };
  }
  if (message === "post_already_designed") {
    return { status: 409, body: { error: "post_already_designed" } };
  }
  // Never surface a raw/unrecognized RPC exception message to the client (security rule).
  return { status: 500, body: { error: "internal_error" } };
}

export function createDesignManageHandler(deps: DesignManageDeps) {
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
    const rest = parts.slice(parts.indexOf("design-manage") + 1);
    const sub = rest[0] ?? null;

    const audit = (action: string, designId: number, metadata: Record<string, unknown>) =>
      deps.insertAuditLog({
        conta_id: contaId,
        actor_user_id: user.id,
        action,
        resource_type: "design",
        resource_id: String(designId),
        metadata,
      });

    // ---------- POST /brand-logo (client-scoped, unrelated to the design model) ----------
    if (req.method === "POST" && sub === "brand-logo") {
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
        deps.logError("design-manage:brand-logo", e);
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

    // ---------- POST /designs — explicit creation (mint-on-GET is gone) ----------
    if (req.method === "POST" && sub === "designs" && rest.length === 1) {
      let body: { format?: unknown; cliente_id?: unknown; post_id?: unknown; name?: unknown };
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      const postId = typeof body.post_id === "number" ? body.post_id : null;
      const clienteId = typeof body.cliente_id === "number" ? body.cliente_id : null;
      const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

      let format: DesignFormat;
      if (postId !== null) {
        const post = await deps.getPost(postId, contaId);
        if (!post) return json({ error: "post_not_found" }, 404);
        const derived = TIPO_TO_FORMAT[post.tipo];
        if (!derived) return json({ error: "post_tipo_unsupported" }, 422);
        if (!EDITABLE_STATUSES.includes(post.status)) {
          return json({ error: "post_not_editable", status: post.status }, 403);
        }
        if (post.tipo !== "reels" && (await deps.hasVideoMedia(postId))) {
          return json({ error: "post_has_video" }, 422);
        }
        format = derived;
      } else {
        if (!FORMATS.includes(body.format as DesignFormat)) {
          return json({ error: "invalid_format" }, 400);
        }
        format = body.format as DesignFormat;
      }

      if (clienteId !== null && !(await deps.clienteExists(clienteId, contaId))) {
        return json({ error: "cliente_not_found" }, 404);
      }

      const template = starterTemplateFor(format);
      const key = blobKey(deps, contaId, 1);
      try {
        await deps.putBlob(key, template);
        const designId = await deps.createDesign(
          contaId,
          { clienteId, postId, format, name },
          key,
          await sha256Hex(template),
          template.length,
          user.id,
        );
        await audit("create", designId, { post_id: postId, format, doc_bytes: template.length });
        fireRender(deps, designId, 1);
        return json({ design_id: designId }, 201);
      } catch (e) {
        const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
        if (mapped.status === 500) deps.logError("design-manage:create", e);
        return json(mapped.body, mapped.status);
      }
    }

    // ---------- POST /designs/:id/{attach|detach|duplicate} ----------
    if (req.method === "POST" && sub === "designs" && rest.length === 3) {
      const designId = parseInt(rest[1], 10);
      if (isNaN(designId)) return json({ error: "invalid_design_id" }, 400);
      const action = rest[2];

      if (action === "attach") {
        let body: { post_id?: unknown };
        try {
          body = await req.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        const postId = typeof body.post_id === "number" ? body.post_id : NaN;
        if (isNaN(postId)) return json({ error: "invalid_post_id" }, 400);

        const post = await deps.getPost(postId, contaId);
        if (!post) return json({ error: "post_not_found" }, 404);
        if (!TIPO_TO_FORMAT[post.tipo]) return json({ error: "post_tipo_unsupported" }, 422);
        if (post.tipo !== "reels" && (await deps.hasVideoMedia(postId))) {
          return json({ error: "post_has_video" }, 422);
        }

        try {
          const postTipo = await deps.attachDesign(contaId, designId, postId, user.id);
          await audit("attach", designId, { post_id: postId, post_tipo: postTipo });
          // Media applies on finalize of the next render — kick it now.
          const design = await deps.getDesign(designId, contaId);
          if (design) fireRender(deps, designId, design.rev);
          return json({ post_tipo: postTipo });
        } catch (e) {
          const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
          if (mapped.status === 500) deps.logError("design-manage:attach", e);
          return json(mapped.body, mapped.status);
        }
      }

      if (action === "detach") {
        try {
          await deps.detachDesign(contaId, designId);
        } catch (e) {
          const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
          if (mapped.status === 500) deps.logError("design-manage:detach", e);
          return json(mapped.body, mapped.status);
        }
        await audit("detach", designId, {});
        return new Response(null, { status: 204, headers: cors });
      }

      if (action === "duplicate") {
        const design = await deps.getDesign(designId, contaId);
        if (!design) return json({ error: "design_not_found" }, 404);
        const bytes = await deps.fetchBlob(design.doc_r2_key);
        if (!bytes) {
          // R2/DB drift — an internal inconsistency, not a client error shape we can act on.
          deps.logError("design-manage:duplicate-blob-missing", { designId, key: design.doc_r2_key });
          return json({ error: "design_blob_missing" }, 404);
        }
        const newKey = blobKey(deps, contaId, 1);
        try {
          await deps.putBlob(newKey, bytes);
          const newId = await deps.duplicateDesign(contaId, designId, newKey, user.id);
          await audit("duplicate", newId, { source_design_id: designId });
          fireRender(deps, newId, 1);
          return json({ design_id: newId }, 201);
        } catch (e) {
          const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
          if (mapped.status === 500) deps.logError("design-manage:duplicate", e);
          return json(mapped.body, mapped.status);
        }
      }

      return json({ error: "not_found" }, 404);
    }

    // ---------- DELETE /designs/:id ----------
    if (req.method === "DELETE" && sub === "designs" && rest.length === 2) {
      const designId = parseInt(rest[1], 10);
      if (isNaN(designId)) return json({ error: "invalid_design_id" }, 400);

      try {
        // The RPC queues the doc blob + any stored manifest into file_deletions atomically.
        await deps.deleteDesign(contaId, designId);
      } catch (e) {
        const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
        if (mapped.status === 500) deps.logError("design-manage:delete", e);
        return json(mapped.body, mapped.status);
      }

      await audit("delete", designId, {});
      return new Response(null, { status: 204, headers: cors });
    }

    // ---------- GET/PUT /blob?design_id= (frozen contract, design_id-keyed) ----------
    const designId = parseInt(url.searchParams.get("design_id") ?? "", 10);

    if (req.method === "GET") {
      if (sub !== "blob") return json({ error: "not_found" }, 404);
      if (isNaN(designId)) return json({ error: "invalid_design_id" }, 400);

      const design = await deps.getDesign(designId, contaId);
      if (!design) return json({ error: "design_not_found" }, 404);

      const bytes = await deps.fetchBlob(design.doc_r2_key);
      if (!bytes) {
        deps.logError("design-manage:blob-missing", { designId, key: design.doc_r2_key });
        return json({ error: "design_blob_missing" }, 404);
      }
      return new Response(bytes.slice().buffer as ArrayBuffer, {
        status: 200,
        headers: {
          ...cors,
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
          "x-rev": String(design.rev),
        },
      });
    }

    if (req.method === "PUT") {
      if (sub !== "blob") return json({ error: "not_found" }, 404);
      if (isNaN(designId)) return json({ error: "invalid_design_id" }, 400);

      const expected = Number(req.headers.get("x-expected-rev"));
      if (!Number.isInteger(expected) || expected < 1) {
        return json({ error: "invalid_expected_rev" }, 422);
      }

      const design = await deps.getDesign(designId, contaId);
      if (!design) return json({ error: "design_not_found" }, 404);

      const body = new Uint8Array(await req.arrayBuffer());
      if (body.length === 0) return json({ error: "empty_body" }, 422);
      if (body.length > MAX_BLOB_BYTES) return json({ error: "blob_too_large" }, 413);

      const key = blobKey(deps, contaId, expected + 1);
      try {
        await deps.putBlob(key, body);
        const saved = await deps.saveDesignBlob(
          contaId,
          designId,
          expected,
          await sha256Hex(body),
          key,
          body.length,
          req.headers.get("x-editor-version"),
          user.id,
        );

        await audit("update", designId, { doc_bytes: body.length, rev: saved.rev });
        fireRender(deps, designId, saved.rev);

        // Best-effort: the previous rev's blob is now unreachable via the row.
        if (saved.prevR2Key && saved.prevR2Key !== key) {
          await deps.deleteBlob(saved.prevR2Key).catch((e) =>
            deps.logError("design-manage:prev-blob-cleanup", e)
          );
        }

        return new Response("ok", { status: 200, headers: { ...cors, "x-rev": String(saved.rev) } });
      } catch (e) {
        const mapped = mapDesignRpcError(e instanceof Error ? e.message : String(e));
        if (mapped.status === 500) deps.logError("design-manage:save", e);
        return json(mapped.body, mapped.status);
      }
    }

    return json({ error: "Method not allowed" }, 405);
  };
}
