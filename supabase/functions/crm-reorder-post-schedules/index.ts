// supabase/functions/crm-reorder-post-schedules/index.ts
// Authenticated (CRM JWT) counterpart to the Hub's hub-posts PATCH reorder.
// Verifies the user, resolves their account, checks the client belongs to it,
// then calls the shared reorder_post_schedules RPC with the agency allowlist.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createCrmReorderHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createCrmReorderHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  }),
}));
