// supabase/functions/file-upload-url/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { signPutUrl } from "../_shared/r2.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createFileUploadUrlHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createFileUploadUrlHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
  signPutUrl,
}));
