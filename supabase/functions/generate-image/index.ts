// generate-image entrypoint (design §8, plan T6.1). JWT ON (no config.toml entry → the
// platform gateway verifies the caller's Supabase JWT; the handler still resolves the user for
// conta scoping). Deploy: --use-api, NO --no-verify-jwt.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createGeminiProvider } from "../_shared/image-gen/gemini.ts";
import { effectivePlanFeature, effectivePlanLimit } from "../_shared/entitlements-rpc.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { deleteObject, getObjectBytes, putObject, signGetUrl } from "../_shared/r2.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { createGenerateImageHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// REQUIRED here (unlike the mcp function, where it's optional): generate-image exists ONLY to
// generate, so a missing key is a deploy error, not a degraded mode.
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ??
  (() => {
    throw new Error("GEMINI_API_KEY is required");
  })();

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

Deno.serve(createGenerateImageHandler({
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
  // Identical dep bundle to mcp/index.ts — one core, one wiring shape.
  imageGen: {
    db: svc,
    provider: createGeminiProvider(GEMINI_API_KEY),
    isFeatureEnabled: (contaId, feature) => effectivePlanFeature(svc as never, contaId, feature),
    monthlyLimit: (contaId) => effectivePlanLimit(svc as never, contaId, "rate_ai_images_per_month"),
    checkRateLimit: (key, max, windowSeconds) => checkRateLimit(svc as never, key, max, windowSeconds),
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
  insertAuditLog: (entry) => insertAuditLog(svc, entry),
  logError: (context, error) => console.error(`[${context}]`, error),
}));
