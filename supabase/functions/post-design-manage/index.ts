import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { fetchPostMedia } from "../_shared/instagram-publish-utils.ts";
import { manifestFontLookup } from "../_shared/fonts/lookup.ts";
import { getRenderPages as computeRenderPages } from "../_shared/design-render-status.ts";
import { materializeBrandLogo, type HubBrandLogoRow } from "../_shared/brand-logo.ts";
import { deleteObject, putObject, signGetUrl } from "../_shared/r2.ts";
import { signMediaUrl, isMediaProxyEnabled } from "../_shared/media-url.ts";
import { createPostDesignManageHandler, DOC_VERSION, type DesignRow, type PostRow } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const signUrl = isMediaProxyEnabled()
  ? (key: string) => signMediaUrl(key)
  : (key: string) => signGetUrl(key, 3600);

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(createPostDesignManageHandler({
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

  isFeatureEnabled: async (contaId) => {
    const ent = await resolveEntitlements(svc, contaId);
    return ent?.features.feature_estudio === true;
  },

  getPost: async (postId, contaId): Promise<PostRow | null> => {
    const { data } = await svc
      .from("workflow_posts")
      .select("id, tipo, status")
      .eq("id", postId)
      .eq("conta_id", contaId)
      .maybeSingle();
    return data as PostRow | null;
  },

  hasVideoMedia: async (postId) => {
    const media = await fetchPostMedia(svc, postId);
    return media.some((m) => m.kind === "video");
  },

  getCoverFileId: async (postId, contaId) => {
    const { data } = await svc
      .from("post_file_links")
      .select("file_id, files!inner(kind)")
      .eq("post_id", postId)
      .eq("conta_id", contaId)
      .eq("is_cover", true)
      .eq("files.kind", "image")
      .maybeSingle();
    return data ? (data as { file_id: number }).file_id : null;
  },

  getExistingDesign: async (postId, contaId): Promise<DesignRow | null> => {
    const { data } = await svc
      .from("post_designs")
      .select("id, doc, rev, render_status, is_stale")
      .eq("post_id", postId)
      .eq("conta_id", contaId)
      .maybeSingle();
    return data as DesignRow | null;
  },

  getOrCreateDesign: async (contaId, postId, starterDoc, updatedBy) => {
    const { data, error } = await svc.rpc("get_or_create_post_design", {
      p_conta_id: contaId,
      p_post_id: postId,
      p_starter_doc: starterDoc,
      p_doc_version: DOC_VERSION,
      p_updated_by: updatedBy,
    }).single();
    if (error) throw error;
    return data as unknown as DesignRow & { created: boolean };
  },

  updateDesign: async (contaId, postId, doc, expectedRev, updatedBy) => {
    const { data, error } = await svc.rpc("update_post_design", {
      p_conta_id: contaId,
      p_post_id: postId,
      p_doc: doc,
      p_doc_version: DOC_VERSION,
      p_expected_rev: expectedRev,
      p_updated_via: "human",
      p_updated_by: updatedBy,
    }).single();
    if (error) throw error;
    return data as unknown as DesignRow;
  },

  deleteDesign: async (contaId, postId) => {
    const { error } = await svc.rpc("delete_post_design", {
      p_conta_id: contaId,
      p_post_id: postId,
    });
    if (error) throw error;
  },

  clienteExists: async (clienteId, contaId) => {
    const { data } = await svc
      .from("clientes")
      .select("id")
      .eq("id", clienteId)
      .eq("conta_id", contaId)
      .maybeSingle();
    return !!data;
  },

  materializeBrandLogo: (args) =>
    materializeBrandLogo({
      getBrand: async (clienteId) => {
        const { data } = await svc
          .from("hub_brand")
          .select("logo_url, logo_file_id")
          .eq("cliente_id", clienteId)
          .maybeSingle();
        return data as HubBrandLogoRow | null;
      },
      resolveDns: (hostname, recordType) => Deno.resolveDns(hostname, recordType),
      fetchUrl: (url, init) => fetch(url, init),
      putObject,
      deleteObject,
      insertFile: async (p) => {
        const { data, error } = await svc.rpc("file_insert_with_quota", { p }).single();
        if (error || !data) throw new Error(error?.message ?? "file insert failed");
        return { id: (data as { id: number }).id };
      },
      claimLogoFileId: async (clienteId, fileId) => {
        const { data, error } = await svc
          .from("hub_brand")
          .update({ logo_file_id: fileId })
          .eq("cliente_id", clienteId)
          .is("logo_file_id", null)
          .select("id");
        if (error) throw error;
        return (data ?? []).length > 0;
      },
      deleteFileRow: async (fileId) => {
        const { error } = await svc.from("files").delete().eq("id", fileId);
        if (error) throw error;
      },
      randomUUID: () => crypto.randomUUID(),
      logError: (context, error) => console.error(`[${context}]`, error),
    }, args),

  checkFileIds: async (ids, contaId) => {
    if (ids.length === 0) return new Set();
    const { data } = await svc
      .from("files")
      .select("id")
      .eq("conta_id", contaId)
      .eq("kind", "image")
      .in("id", ids);
    return new Set((data ?? []).map((f) => f.id as number));
  },

  fonts: manifestFontLookup,

  getRenderPages: (postId, contaId, tipo, doc) =>
    computeRenderPages({
      fetchDesignLinks: async (pId, cId) => {
        const { data } = await svc
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
        const { data } = await svc
          .from("post_file_links")
          .select("file_id, files!inner(kind, thumbnail_r2_key)")
          .eq("post_id", pId)
          .eq("conta_id", cId)
          .eq("files.kind", "video")
          .maybeSingle();
        if (!data) return null;
        // deno-lint-ignore no-explicit-any
        const files = (data as any).files;
        return { file_id: (data as { file_id: number }).file_id, thumbnail_r2_key: files.thumbnail_r2_key };
      },
      signUrl,
    }, { postId, contaId, tipo, doc }),

  triggerRender: async (designId, rev) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/design-render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ design_id: designId, rev }),
    });
    if (!res.ok && res.status !== 409 && res.status !== 204) {
      throw new Error(`design-render trigger returned ${res.status}`);
    }
  },

  // deno-lint-ignore no-undef -- EdgeRuntime is a Supabase Edge Runtime global, not a module import.
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },

  insertAuditLog: (entry) => insertAuditLog(svc, entry),

  logError: (context, error) => {
    console.error(`[${context}]`, error);
  },
}));
