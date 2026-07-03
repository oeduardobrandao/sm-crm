import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getObjectBytes, putObject } from "../_shared/r2.ts";
import { renderPage } from "../_shared/design-render-core.ts";
import {
  createDesignRenderHandler,
  type ClaimedDesign,
  type DesignRow,
  type ManifestEntry,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

Deno.serve(createDesignRenderHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,

  readDesignRow: async (designId): Promise<DesignRow | null> => {
    const { data } = await svc
      .from("post_designs")
      .select("id, conta_id, post_id, rev, doc, doc_hash, render_status, render_manifest")
      .eq("id", designId)
      .maybeSingle();
    if (!data) return null;
    return data as unknown as DesignRow;
  },

  claimDesignRender: async (designId): Promise<ClaimedDesign | null> => {
    const { data, error } = await svc.rpc("claim_design_render", {
      p_design_id: designId,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    return row ? (row as unknown as ClaimedDesign) : null;
  },

  finalizeDesignRender: async (designId, claimedHash, manifest) => {
    const { data, error } = await svc.rpc("finalize_design_render", {
      p_design_id: designId,
      p_claimed_hash: claimedHash,
      p_manifest: manifest,
    });
    if (error) throw error;
    return data as "rendered" | "stale";
  },

  failDesignRender: async (designId, errorMessage) => {
    await svc.rpc("fail_design_render", {
      p_design_id: designId,
      p_error: errorMessage,
    });
  },

  writeManifest: async (designId, manifest: ManifestEntry[]) => {
    const { error } = await svc
      .from("post_designs")
      .update({ render_manifest: manifest })
      .eq("id", designId);
    if (error) throw error;
  },

  queueFileDeletion: async (r2Key) => {
    await svc.from("file_deletions").insert({ r2_key: r2Key });
  },

  renderPage,

  resolveFileBytes: async (fileId, contaId) => {
    const { data: file } = await svc
      .from("files")
      .select("r2_key, mime_type")
      .eq("id", fileId)
      .eq("conta_id", contaId)
      .maybeSingle();
    if (!file) throw new Error(`file ${fileId} not found for tenant`);
    const bytes = await getObjectBytes(file.r2_key);
    if (!bytes) throw new Error(`file ${fileId} bytes missing in R2`);
    return { bytes, mimeType: file.mime_type };
  },

  resolveFontBytes: async (r2Key) => {
    const bytes = await getObjectBytes(r2Key);
    if (!bytes) throw new Error(`font asset missing in R2: ${r2Key}`);
    return bytes;
  },

  putObject,

  logError: (context, error) => {
    // Internal-only — raw satori/resvg/DB errors never reach clients (security rule);
    // fail_design_render carries only the sanitized message passed alongside this call.
    console.error(`[${context}]`, error);
  },

  selfInvoke: async (designId, rev, pageIndex) => {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/design-render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ design_id: designId, rev, page_index: pageIndex }),
    });
    if (!res.ok) throw new Error(`design-render self-invoke returned ${res.status}`);
  },

  // deno-lint-ignore no-undef -- EdgeRuntime is a Supabase Edge Runtime global, not a module import.
  waitUntil: (promise) => { EdgeRuntime.waitUntil(promise); },
}));
