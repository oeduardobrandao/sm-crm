// supabase/functions/automation-media/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { copyObjectSigned, headObjectSigned, signGetUrl, signPutUrl, trashObject } from "../_shared/r2.ts";
import { createAutomationMediaHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createAutomationMediaHandler({
  buildCorsHeaders,
  createDb: () =>
    createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
  signPutUrl,
  signGetUrl,
  headObject: headObjectSigned,
  trashObject,
  copyObject: copyObjectSigned,
}));
