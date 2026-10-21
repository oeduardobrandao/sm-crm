import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { createHubAgendaHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(createHubAgendaHandler({
  buildCorsHeaders,
  createDb: () => svc,
  now: () => new Date().toISOString(),
  // deno-lint-ignore no-explicit-any
  rateLimit: (db, key, max, win) => checkRateLimit(db as any, key, max, win),
  auditLog: (entry) => insertAuditLog(svc, entry),
}));
