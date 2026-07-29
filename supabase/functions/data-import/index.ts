import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";
import { createDataImportHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(
  createDataImportHandler({
    buildCorsHeaders,
    createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as never,
    resolveEntitlements: resolveEntitlements as never,
    geminiKey: Deno.env.get("GEMINI_API_KEY") ?? null,
  }),
);
