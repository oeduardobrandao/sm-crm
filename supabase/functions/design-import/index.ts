// design-import entrypoint (Estúdio slice C). Own-auth (Bearer JWT verified in application code,
// verify_jwt = false — file-upload-finalize / design-manage pattern, NOT the platform gateway).
// Deploy: --use-api --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";
import { resolveImageProvider, resolveVisionConfig } from "../_shared/image-gen/resolve.ts";
import { extractTextBlocks } from "../_shared/image-gen/vision.ts";
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { createDesignRenderTrigger } from "../_shared/design-render-trigger.ts";
import { createDocServiceClient } from "../_shared/doc-service.ts";
import { deleteObject, getObjectBytes, putObject, signGetUrl } from "../_shared/r2.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { createDesignImportHandler, type FileRow, type PostRow, type ResolvedLink } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();
// Same env vars as mcp/index.ts's doc-service wiring — do not invent new names.
const RENDER_SERVICE_URL = Deno.env.get("RENDER_SERVICE_URL");
const RENDER_SERVICE_SECRET = Deno.env.get("RENDER_SERVICE_SECRET");
const docSvc = RENDER_SERVICE_URL && RENDER_SERVICE_SECRET
  ? createDocServiceClient(RENDER_SERVICE_URL, RENDER_SERVICE_SECRET)
  : null;

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Same provider-selection module as generate-image/mcp; may be undefined (degraded — the core's
// own `provider_error` gate surfaces this rather than a boot-time crash, since design-import is
// not the ONLY reason this deploy exists).
const provider = resolveImageProvider() ?? undefined;

const triggerRender = createDesignRenderTrigger(SUPABASE_URL, CRON_SECRET);

Deno.serve(createDesignImportHandler({
  buildCorsHeaders,

  getUser: async (token) => {
    const { data, error } = await svc.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id };
  },

  getProfile: async (userId) => {
    const { data } = await svc.from("profiles").select("conta_id").eq("id", userId).single();
    return data ? { conta_id: data.conta_id } : null;
  },

  isFeatureEnabled: async (contaId, feature) => {
    const ent = await resolveEntitlements(svc, contaId);
    return ent?.features[feature] === true;
  },

  getPost: async (postId, contaId): Promise<PostRow | null> => {
    const { data } = await svc
      .from("workflow_posts")
      .select("id, titulo, tipo, status")
      .eq("id", postId)
      .eq("conta_id", contaId)
      .maybeSingle();
    return data as PostRow | null;
  },

  hasDesignAttached: async (postId, contaId) => {
    const { data } = await svc
      .from("designs")
      .select("id")
      .eq("post_id", postId)
      .eq("conta_id", contaId)
      .maybeSingle();
    return !!data;
  },

  getPostMedia: async (postId, contaId) => {
    // Genuinely conta-scoped (defense-in-depth — getPost runs first and already enforces this,
    // but the signature must not lie): post_file_links carries its own conta_id column.
    const { data } = await svc
      .from("post_file_links")
      .select("id, sort_order, files!inner(id, kind, r2_key)")
      .eq("post_id", postId)
      .eq("conta_id", contaId)
      .order("sort_order", { ascending: true });
    // deno-lint-ignore no-explicit-any
    return (data ?? []).map((l: any) => ({
      link_id: l.id,
      file_id: l.files.id,
      kind: l.files.kind,
      r2_key: l.files.r2_key,
      sort_order: l.sort_order,
    }));
  },

  getFile: async (fileId, contaId): Promise<FileRow | null> => {
    const { data } = await svc
      .from("files")
      .select("id, kind, r2_key, width, height")
      .eq("id", fileId)
      .eq("conta_id", contaId)
      .maybeSingle();
    return data as FileRow | null;
  },

  resolveLink: async (postId, linkId, contaId): Promise<ResolvedLink | null> => {
    // ONE conta-scoped query joining post_file_links + files — uniform null for every mismatch
    // flavor (not found / foreign conta / not linked to this post / not an image); the handler
    // turns null into a single invalid_reference response regardless of which check failed.
    const { data } = await svc
      .from("post_file_links")
      .select("id, files!inner(id, kind, r2_key, width, height)")
      .eq("id", linkId)
      .eq("post_id", postId)
      .eq("conta_id", contaId)
      .maybeSingle();
    if (!data) return null;
    // deno-lint-ignore no-explicit-any
    const file = (data as any).files as FileRow;
    if (!file || file.kind !== "image") return null;
    return { link_id: (data as { id: number }).id, file };
  },

  checkRateLimit: (key, max, windowSeconds) => checkRateLimit(svc, key, max, windowSeconds),

  signGetUrl: (r2Key) => signGetUrl(r2Key, 3600),

  docService: {
    normalize: (spec) => {
      if (!docSvc) throw new Error("doc service not configured");
      return docSvc.normalize(spec);
    },
    compose: (spec) => {
      if (!docSvc) throw new Error("doc service not configured");
      return docSvc.compose(spec);
    },
  },

  visionApiKey: () => resolveVisionConfig()?.apiKey ?? null,

  extractTextBlocks,

  imageGen: {
    db: svc,
    provider,
    isFeatureEnabled: (contaId, feature) => resolveEntitlements(svc, contaId).then((ent) => ent?.features[feature] === true),
    monthlyLimit: (contaId) => effectivePlanLimit(svc, contaId, "rate_ai_images_per_month"),
    checkRateLimit: (key, max, windowSeconds) => checkRateLimit(svc, key, max, windowSeconds),
    putObject,
    deleteObject,
    insertFile: async (p) => {
      const { data, error } = await svc.rpc("file_insert_with_quota", { p }).single();
      if (error || !data) throw new Error((error as { message?: string })?.message ?? "file insert failed");
      return { id: (data as { id: number }).id };
    },
    resolveFileBytes: (r2Key) => getObjectBytes(r2Key),
    signUrl: (key) => signGetUrl(key, 3600),
    randomUUID: () => crypto.randomUUID(),
    logError: (context, error) => console.error(`[${context}]`, error),
  },

  putBlob: (key, bytes) => putObject(key, bytes, "application/octet-stream"),

  createDesign: async (contaId, input, r2Key, docHash, docBytes, createdBy) => {
    const { data, error } = await svc.rpc("create_design", {
      p_conta_id: contaId,
      p_cliente_id: null,
      p_post_id: input.postId,
      p_format: input.format,
      p_name: input.name,
      p_r2_key: r2Key,
      p_doc_hash: docHash,
      p_doc_bytes: docBytes,
      p_created_by: createdBy,
      p_media_hold: true,
    });
    if (error) throw new Error(error.message);
    return data as number;
  },

  fireRender: (designId, rev) => {
    // deno-lint-ignore no-undef -- EdgeRuntime is a Supabase Edge Runtime global, not an import.
    EdgeRuntime.waitUntil(
      triggerRender(designId, rev).catch((e) => console.error("[design-import:trigger-render]", e)),
    );
  },

  randomUUID: () => crypto.randomUUID(),

  insertAuditLog: (entry) => insertAuditLog(svc, entry),

  logError: (context, error) => {
    console.error(`[${context}]`, error);
  },
}));
