import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getObjectBytes, putObject } from "../_shared/r2.ts";
import {
  createDesignRenderHandler,
  type ClaimedDesign,
  type DesignRowMeta,
  type RenderServiceResult,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();
const RENDER_SERVICE_URL = Deno.env.get("RENDER_SERVICE_URL") ??
  (() => {
    throw new Error("RENDER_SERVICE_URL is required");
  })();
const RENDER_SERVICE_SECRET = Deno.env.get("RENDER_SERVICE_SECRET") ??
  (() => {
    throw new Error("RENDER_SERVICE_SECRET is required");
  })();

// The service renders every frame in one call; the fetch carries its own finite timeout so a
// hung request can never leave the row stuck 'rendering' silently (edge kills bypass catch —
// reference_edge_kills_r2_sdk_hang; the sweep cron is the backstop either way).
const RENDER_SERVICE_TIMEOUT_MS = 55_000;

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Mirrors the SQL editability list (save_design_blob / finalize_design_render).
const EDITABLE_STATUSES = ["rascunho", "revisao_interna", "correcao_cliente", "enviado_cliente"];

Deno.serve(createDesignRenderHandler({
  buildCorsHeaders,
  cronSecret: CRON_SECRET,
  timingSafeEqual,

  readDesignRow: async (designId): Promise<DesignRowMeta | null> => {
    const { data } = await svc
      .from("designs")
      .select("id, rev, render_status")
      .eq("id", designId)
      .maybeSingle();
    return data as DesignRowMeta | null;
  },

  claimDesignRender: async (designId): Promise<ClaimedDesign | null> => {
    const { data, error } = await svc.rpc("claim_design_render", { p_design_id: designId });
    if (error) throw new Error(error.message);
    const row = (data as Array<Record<string, unknown>> | null)?.[0];
    if (!row) return null;
    return {
      id: row.design_id as number,
      conta_id: row.conta_id as string,
      post_id: (row.post_id as number | null) ?? null,
      doc_r2_key: (row.doc_r2_key as string | null) ?? null,
      doc_hash: row.doc_hash as string,
      format: row.format as string,
      post_tipo: (row.post_tipo as string | null) ?? null,
      post_status: (row.post_status as string | null) ?? null,
    };
  },

  fetchBlob: (key) => getObjectBytes(key),

  callRenderService: async (bytes, tipo): Promise<RenderServiceResult> => {
    const res = await fetch(`${RENDER_SERVICE_URL}/api/render`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${RENDER_SERVICE_SECRET}`,
        "content-type": "application/octet-stream",
        "x-post-tipo": tipo,
      },
      body: bytes.slice().buffer as ArrayBuffer,
      signal: AbortSignal.timeout(RENDER_SERVICE_TIMEOUT_MS),
    });
    if (res.status === 422) {
      // Either a structured validation result or an unparseable-document error — both map to
      // a RenderServiceResult the handler can fail the row with.
      const body = await res.json().catch(() => null);
      if (body && typeof body === "object" && "validation" in body) {
        return body as RenderServiceResult;
      }
      return {
        validation: { ok: false, errors: [{ code: "invalid_document", message: "Documento inválido." }] },
        derived: { format: null, tipo: null },
        pages: [],
      };
    }
    if (!res.ok) throw new Error(`render service returned ${res.status}`);
    return (await res.json()) as RenderServiceResult;
  },

  putObject,

  finalizeDesignRender: async (designId, claimedHash, manifest) => {
    const { data, error } = await svc.rpc("finalize_design_render", {
      p_design_id: designId,
      p_claimed_hash: claimedHash,
      p_manifest: manifest,
    });
    if (error) throw new Error(error.message);
    return data as "rendered" | "stale";
  },

  failDesignRender: async (designId, errorMessage) => {
    const { error } = await svc.rpc("fail_design_render", {
      p_design_id: designId,
      p_error: errorMessage,
    });
    if (error) throw new Error(error.message);
  },

  queueFileDeletion: async (r2Key) => {
    await svc.from("file_deletions").insert({ r2_key: r2Key });
  },

  syncPostTipo: async (postId, contaId, tipo) => {
    const { error } = await svc
      .from("workflow_posts")
      .update({ tipo })
      .eq("id", postId)
      .eq("conta_id", contaId)
      .in("status", EDITABLE_STATUSES);
    if (error) throw new Error(error.message);
  },

  logError: (context, error) => {
    console.error(`[${context}]`, error);
  },
}));
