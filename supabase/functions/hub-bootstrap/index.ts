import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createHubBootstrapHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TOUCH_TIMEOUT_MS = 1500;

Deno.serve(createHubBootstrapHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY),
  now: () => new Date().toISOString(),
  // The edge runtime can hang on I/O and kill the isolate with no error logs, so this
  // is bounded by an explicit timeout as well as a catch.
  touchToken: async (token: string) => {
    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    await Promise.race([
      db.rpc("hub_token_touch", { p_token: token }),
      new Promise((resolve) => setTimeout(resolve, TOUCH_TIMEOUT_MS)),
    ]);
  },
}));
