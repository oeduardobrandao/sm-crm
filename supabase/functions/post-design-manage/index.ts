import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { fetchPostMedia } from "../_shared/instagram-publish-utils.ts";
import { materializeBrandLogo, type HubBrandLogoRow } from "../_shared/brand-logo.ts";
import { deleteObject, getObjectBytes, putObject } from "../_shared/r2.ts";
import { createPostDesignManageHandler, type DesignMeta, type PostRow } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  getDesignMeta: async (postId, contaId): Promise<DesignMeta | null> => {
    const { data } = await svc
      .from("post_designs")
      .select("id, rev, doc_r2_key")
      .eq("post_id", postId)
      .eq("conta_id", contaId)
      .maybeSingle();
    return data as DesignMeta | null;
  },

  getOrCreateDesignBlob: async (contaId, postId, r2Key, docHash, docBytes, updatedBy) => {
    const { data, error } = await svc.rpc("get_or_create_post_design_blob", {
      p_conta_id: contaId,
      p_post_id: postId,
      p_r2_key: r2Key,
      p_doc_hash: docHash,
      p_doc_bytes: docBytes,
      p_updated_by: updatedBy,
    }).single();
    if (error) throw new Error(error.message);
    const row = data as { o_id: number; o_rev: number; o_doc_r2_key: string | null; o_created: boolean };
    return { id: row.o_id, rev: row.o_rev, doc_r2_key: row.o_doc_r2_key, created: row.o_created };
  },

  saveDesignBlob: async (contaId, postId, expectedRev, docHash, r2Key, docBytes, editorVersion, updatedBy) => {
    const { data, error } = await svc.rpc("save_post_design_blob", {
      p_conta_id: contaId,
      p_post_id: postId,
      p_expected_rev: expectedRev,
      p_doc_hash: docHash,
      p_r2_key: r2Key,
      p_doc_bytes: docBytes,
      p_editor_version: editorVersion,
      p_updated_by: updatedBy,
    }).single();
    if (error) throw new Error(error.message);
    const row = data as { o_rev: number; o_prev_r2_key: string | null };
    return { rev: row.o_rev, prevR2Key: row.o_prev_r2_key };
  },

  deleteDesign: async (contaId, postId) => {
    const { error } = await svc.rpc("delete_post_design", {
      p_conta_id: contaId,
      p_post_id: postId,
    });
    if (error) throw new Error(error.message);
  },

  fetchBlob: (key) => getObjectBytes(key),
  putBlob: (key, bytes) => putObject(key, bytes, "application/octet-stream"),
  deleteBlob: (key) => deleteObject(key),

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

  insertAuditLog: (entry) => insertAuditLog(svc, entry),

  logError: (context, error) => {
    console.error(`[${context}]`, error);
  },
}));
