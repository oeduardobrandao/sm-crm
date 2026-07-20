// Env wiring only — business logic lives in core.ts, auth gate in handler.ts (per
// tiktok-refresh-cron/{index,core,handler}.ts's split, Task A6/C4 convention). `svc` is
// created here and hoisted BEFORE core.ts's try block runs, so a broken account query still
// reaches reportCronFailure instead of dying silently (see core.ts's top comment).
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getFreshTikTokToken, tiktokFetch } from "../_shared/tiktok.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { importTikTokVideos, refreshStoredPostMetrics } from "../tiktok-integration/import.ts";
import { createTikTokSyncCronHandler } from "./handler.ts";
import { runTikTokSyncCron } from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createTikTokSyncCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const concurrency = Math.max(1, parseInt(Deno.env.get("SYNC_CONCURRENCY") || "5", 10) || 5);
    return runTikTokSyncCron({
      // deno-lint-ignore no-explicit-any
      svc: svc as any,
      getFreshTikTokToken,
      reportCronFailure,
      tiktokFetch,
      effectivePlanFeature,
      importTikTokVideos,
      refreshStoredPostMetrics,
      concurrency,
    });
  },
}));
