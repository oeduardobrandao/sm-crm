// Env wiring only — business logic lives in core.ts, auth gate in handler.ts (per
// tiktok-integration/{index,handlers}.ts's split). `svc` is created here and hoisted BEFORE
// core.ts's try block runs, so a broken account query still reaches reportCronFailure instead
// of dying silently (the retention initiative's cron-failure lesson — see core.ts's top comment).
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getFreshTikTokToken, tiktokFetch } from "../_shared/tiktok.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { cacheTikTokAvatar } from "../tiktok-integration/import.ts";
import { createTikTokRefreshCronHandler } from "./handler.ts";
import { runTikTokRefreshCron } from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createTikTokRefreshCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return runTikTokRefreshCron({
      // deno-lint-ignore no-explicit-any
      svc: svc as any,
      getFreshTikTokToken,
      reportCronFailure,
      cacheAvatar: cacheTikTokAvatar,
      tiktokFetch,
    });
  },
}));
