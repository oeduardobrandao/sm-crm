import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { signGetUrl } from "../_shared/r2.ts";
import { createPostReferencesHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createPostReferencesHandler({
  buildCorsHeaders,
  // Service role; auth.getUser(token) ainda valida o JWT do chamador (chaves ES256:
  // o gateway não valida, por isso verify_jwt = false no config.toml).
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  signGetUrl,
}));
