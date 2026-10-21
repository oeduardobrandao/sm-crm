import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { createGeoAutocompleteHandler, HORA_PADRAO } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(createGeoAutocompleteHandler({
  buildCorsHeaders,
  getUser: async (jwt: string) => {
    const { data, error } = await db.auth.getUser(jwt);
    if (error) {
      // A malformed, bad or expired token (GoTrue 400/401/403) is the caller's problem (401).
      if (error.status === 400 || error.status === 401 || error.status === 403) return null;
      throw new Error(`auth.getUser: ${error.message}`);
    }
    return data?.user ? { id: data.user.id } : null;
  },
  rateLimit: (key, max, win) => checkRateLimit(db, key, max, win),
  // Optional: unset means the CRM field stays a plain text input (503 here).
  apiKey: () => Deno.env.get("GEOAPIFY_API_KEY") || undefined,
  limiteHora: () => {
    const n = parseInt(Deno.env.get("GEOAPIFY_HOURLY_CAP") ?? "", 10);
    return Number.isInteger(n) && n > 0 ? n : HORA_PADRAO;
  },
  fetch: (url, init) => fetch(url, init),
}));
