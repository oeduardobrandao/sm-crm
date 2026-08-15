// supabase/functions/instagram-automation-cron/index.ts
// Env wiring apenas; lógica em handler.ts (mesmo shape de instagram-sync-cron/index.ts).
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createInstagramAutomationCronHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

Deno.serve(createInstagramAutomationCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  createServiceDb: () => createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
}));
