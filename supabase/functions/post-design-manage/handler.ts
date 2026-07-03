// post-design-manage — docs/estudio-design.md §5.4. The editor's save path (slice 1): the ONLY
// design write path for the CRM. User-facing (Bearer JWT, verified in application code — same
// pattern as file-upload-finalize, NOT the platform gateway's verify_jwt; see config.toml).
//
// Every write goes through the RPC family from 20260702000001_post_designs.sql
// (get_or_create_post_design / update_post_design / delete_post_design) — clients cannot write
// post_designs directly at all (SELECT-only grants), so ownership/status/rev/tipo-sync are
// enforced in one transaction regardless of caller. This handler's own status/feature
// pre-checks exist only to turn what would otherwise be a raw RPC exception into a clean
// structured response — the RPCs re-check everything themselves (defense in depth, not the
// actual access-control boundary).

import { createJsonResponder } from "../_shared/http.ts";
import {
  toDesignValidationError,
  validateDesignDoc,
  type DesignDoc,
  type DesignFormat,
  type AspectRatio,
  type FontVariantLookup,
  type ValidationContext,
} from "../_shared/design-doc.ts";
import type { MaterializeLogoResult } from "../_shared/brand-logo.ts";
import type { RenderPageInfo } from "../_shared/design-render-status.ts";

// Mirrors EDITABLE_STATUSES in supabase/functions/mcp/queries.ts and the SQL copy inside
// post_design_check_and_sync (20260702000001_post_designs.sql) — kept in sync by hand, same as
// those two already are with each other.
const EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente"];

// doc_version passed to the create/update RPCs — DesignDocInputSchema's `version: z.literal(1)`
// is the only schema version that exists yet; index.ts's RPC-wrapper deps use this constant.
export const DOC_VERSION = 1;

function starterFormatForTipo(tipo: string): DesignFormat | null {
  switch (tipo) {
    case "feed":
      return "feed";
    case "carrossel":
      return "carrossel";
    case "reels":
      return "reel_cover";
    default:
      return null; // 'stories' (unsupported, §5.4) and anything else unrecognized.
  }
}

// Product default, not a technical constraint — 9:16 is reel_cover's only allowed ratio; 4:5
// is picked for feed/carrossel as the more space-efficient modern default (both formats also
// allow 1:1, the user can switch once the doc exists).
const STARTER_ASPECT_RATIO: Record<DesignFormat, AspectRatio> = {
  feed: "4:5",
  carrossel: "4:5",
  reel_cover: "9:16",
};

function buildStarterDocInput(format: DesignFormat, coverFileId: number | null): unknown {
  const background = coverFileId
    ? { type: "image", file_id: coverFileId, fit: "cover" }
    : { type: "solid", color: "#ffffff" };
  return {
    version: 1,
    format,
    aspect_ratio: STARTER_ASPECT_RATIO[format],
    pages: [{ background, layers: [] }],
  };
}

export interface DesignRow {
  id: number;
  doc: DesignDoc;
  rev: number;
  render_status: string;
  is_stale: boolean;
}

export interface PostRow {
  id: number;
  tipo: string;
  status: string;
}

export interface PostDesignManageDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  getUser: (token: string) => Promise<{ id: string } | null>;
  getProfile: (userId: string) => Promise<{ conta_id: string } | null>;
  isFeatureEnabled: (contaId: string) => Promise<boolean>;
  getPost: (postId: number, contaId: string) => Promise<PostRow | null>;
  hasVideoMedia: (postId: number) => Promise<boolean>;
  getCoverFileId: (postId: number, contaId: string) => Promise<number | null>;
  getExistingDesign: (postId: number, contaId: string) => Promise<DesignRow | null>;
  // `created` is computed atomically inside the RPC (see migration 20260702000006) — the ONLY
  // place that can tell "I inserted this row" apart from "lost the create race, here's the
  // winner's row" apart from "a row already existed". Inferring it caller-side (e.g. from
  // "did I have to call this at all") double-audits a single creation under a concurrent race.
  getOrCreateDesign: (
    contaId: string,
    postId: number,
    starterDoc: DesignDoc,
    updatedBy: string,
  ) => Promise<DesignRow & { created: boolean }>;
  updateDesign: (
    contaId: string,
    postId: number,
    doc: DesignDoc,
    expectedRev: number,
    updatedBy: string,
  ) => Promise<DesignRow>;
  deleteDesign: (contaId: string, postId: number) => Promise<void>;
  // Not CheckFileIds directly — this dep is wired once at module scope (Deno.serve is not
  // per-request), so it takes contaId explicitly; the handler closes over it per-request when
  // building ValidationContext.checkFileIds below.
  checkFileIds: (ids: number[], contaId: string) => Promise<Set<number>>;
  // POST /brand-logo (§5.4 / T3.2) — tenancy check + the SSRF-hardened import, injected so the
  // route tests never touch the network.
  clienteExists: (clienteId: number, contaId: string) => Promise<boolean>;
  materializeBrandLogo: (args: {
    contaId: string;
    clienteId: number;
    uploadedBy: string;
  }) => Promise<MaterializeLogoResult>;
  fonts: FontVariantLookup;
  getRenderPages: (
    postId: number,
    contaId: string,
    tipo: string,
    doc: DesignDoc,
  ) => Promise<RenderPageInfo[]>;
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

function docStats(doc: DesignDoc) {
  return {
    format: doc.format,
    page_count: doc.pages.length,
    layer_count: doc.pages.reduce((sum, p) => sum + p.layers.length, 0),
    doc_bytes: JSON.stringify(doc).length,
  };
}

function mapDesignRpcError(message: string): { status: number; body: Record<string, unknown> } {
  if (message === "post_not_found") return { status: 404, body: { error: "post_not_found" } };
  if (message.startsWith("post_not_editable:")) {
    return {
      status: 409,
      body: { error: "post_not_editable", status: message.slice("post_not_editable:".length) },
    };
  }
  if (message.startsWith("rev_conflict:")) {
    return {
      status: 409,
      body: { error: "rev_conflict", current_rev: Number(message.slice("rev_conflict:".length)) },
    };
  }
  if (message === "design_not_found") {
    return { status: 404, body: { error: "design_not_found" } };
  }
  if (message.startsWith("invalid_format:")) {
    return { status: 400, body: { error: "invalid_format" } };
  }
  if (message === "file_not_found_or_forbidden") {
    return { status: 400, body: { error: "file_not_found_or_forbidden" } };
  }
  // Never surface a raw/unrecognized RPC exception message to the client (security rule).
  return { status: 500, body: { error: "internal_error" } };
}

export function createPostDesignManageHandler(deps: PostDesignManageDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
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

    if (req.method === "POST") {
      // Path-based sub-route (the post-media-manage precedent): POST /brand-logo is the ONLY
      // POST this function serves — lazy logo materialization, §5.4.
      const parts = new URL(req.url).pathname.split("/").filter(Boolean);
      const sub = parts[parts.indexOf("post-design-manage") + 1];
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

    if (req.method === "GET") {
      const url = new URL(req.url);
      const postId = parseInt(url.searchParams.get("post_id") ?? "", 10);
      if (isNaN(postId)) return json({ error: "invalid_post_id" }, 400);

      const post = await deps.getPost(postId, contaId);
      if (!post) return json({ error: "post_not_found" }, 404);

      let design = await deps.getExistingDesign(postId, contaId);
      let created = false;

      if (!design) {
        if (!EDITABLE_STATUSES.includes(post.status)) {
          return json({ error: "post_not_editable", status: post.status }, 409);
        }
        const format = starterFormatForTipo(post.tipo);
        if (!format) return json({ error: "unsupported_post_tipo" }, 400);

        const postHasVideoMedia = await deps.hasVideoMedia(postId);
        // Designed blocked state, not an internal bug: a feed/carrossel post with video media
        // can never hold a design (design §5.4 post_has_video_media). Surface it as itself —
        // funneling it into the starter-doc validation below masked it as a 500 internal_error
        // and the editor showed a generic load failure with no way for the user to understand.
        if (format !== "reel_cover" && postHasVideoMedia) {
          return json({ error: "post_has_video_media" }, 400);
        }

        const coverFileId = format === "reel_cover" ? null : await deps.getCoverFileId(postId, contaId);
        const ctx: ValidationContext = {
          postTipo: post.tipo,
          postHasVideoMedia,
          fonts: deps.fonts,
          checkFileIds: (ids) => deps.checkFileIds(ids, contaId),
        };
        const validated = await validateDesignDoc(buildStarterDocInput(format, coverFileId), ctx);
        if (!validated.ok) {
          // A starter doc this handler built itself failing validation is an internal bug, not
          // a client error — never leak validation internals for a doc the caller never sent.
          deps.logError("post-design-manage:starter-doc", validated.issues);
          return json({ error: "internal_error" }, 500);
        }

        try {
          const result = await deps.getOrCreateDesign(contaId, postId, validated.doc, user.id);
          design = result;
          created = result.created;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          const mapped = mapDesignRpcError(message);
          if (mapped.status === 500) deps.logError("post-design-manage:get-or-create", e);
          return json(mapped.body, mapped.status);
        }
      }

      if (created) {
        await deps.insertAuditLog({
          conta_id: contaId,
          actor_user_id: user.id,
          action: "create",
          resource_type: "post_design",
          resource_id: String(design.id),
          metadata: { post_id: postId, ...docStats(design.doc), rev: design.rev },
        });
      }

      if (design.is_stale) {
        deps.waitUntil(
          deps.triggerRender(design.id, design.rev)
            .catch((e) => deps.logError("post-design-manage:trigger-render", e)),
        );
      }

      const pages = await deps.getRenderPages(postId, contaId, post.tipo, design.doc);
      return json({
        design: design.doc,
        rev: design.rev,
        render: { status: design.render_status, pages },
      });
    }

    if (req.method === "PUT") {
      let body: { post_id?: unknown; doc?: unknown; expected_rev?: unknown };
      try {
        body = await req.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }
      const postId = typeof body.post_id === "number" ? body.post_id : NaN;
      if (isNaN(postId)) return json({ error: "invalid_post_id" }, 400);
      if (typeof body.expected_rev !== "number") return json({ error: "invalid_request" }, 400);

      const post = await deps.getPost(postId, contaId);
      if (!post) return json({ error: "post_not_found" }, 404);
      if (!EDITABLE_STATUSES.includes(post.status)) {
        return json({ error: "post_not_editable", status: post.status }, 409);
      }

      const ctx: ValidationContext = {
        postTipo: post.tipo,
        postHasVideoMedia: await deps.hasVideoMedia(postId),
        fonts: deps.fonts,
        checkFileIds: (ids) => deps.checkFileIds(ids, contaId),
      };
      const validated = await validateDesignDoc(body.doc, ctx);
      if (!validated.ok) return json(toDesignValidationError(validated), 400);

      let design: DesignRow;
      try {
        design = await deps.updateDesign(contaId, postId, validated.doc, body.expected_rev, user.id);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const mapped = mapDesignRpcError(message);
        if (mapped.status === 500) deps.logError("post-design-manage:update", e);
        return json(mapped.body, mapped.status);
      }

      await deps.insertAuditLog({
        conta_id: contaId,
        actor_user_id: user.id,
        action: "update",
        resource_type: "post_design",
        resource_id: String(design.id),
        metadata: { post_id: postId, ...docStats(design.doc), rev: design.rev },
      });

      if (design.is_stale) {
        deps.waitUntil(
          deps.triggerRender(design.id, design.rev)
            .catch((e) => deps.logError("post-design-manage:trigger-render", e)),
        );
      }

      return json({ design: design.doc, rev: design.rev, warnings: validated.warnings });
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const postId = parseInt(url.searchParams.get("post_id") ?? "", 10);
      if (isNaN(postId)) return json({ error: "invalid_post_id" }, 400);

      const post = await deps.getPost(postId, contaId);
      if (!post) return json({ error: "post_not_found" }, 404);
      if (!EDITABLE_STATUSES.includes(post.status)) {
        return json({ error: "post_not_editable", status: post.status }, 409);
      }

      try {
        await deps.deleteDesign(contaId, postId);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const mapped = mapDesignRpcError(message);
        if (mapped.status === 500) deps.logError("post-design-manage:delete", e);
        return json(mapped.body, mapped.status);
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
