// Env wiring only: business logic lives in core.ts, the auth gate in handler.ts (same split as
// tiktok-sync-cron). `svc` is created here, before core.ts's try block, so a broken candidate
// query still reaches reportCronFailure.
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { getFreshGoogleToken } from "../_shared/google.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import * as youtubeApi from "../_shared/youtube-api.ts";
import { createYouTubeSyncCronHandler } from "./handler.ts";
import { runYouTubeSyncCron } from "./core.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = requireEnv("CRON_SECRET");

function intEnv(name: string, fallback: number): number {
  return Math.max(1, parseInt(Deno.env.get(name) || String(fallback), 10) || fallback);
}

Deno.serve(createYouTubeSyncCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return runYouTubeSyncCron({
      svc,
      api: youtubeApi,
      getFreshGoogleToken: (db, connectionId) => getFreshGoogleToken(db, connectionId),
      reportCronFailure,
      effectivePlanFeature,
      storage: svc.storage,
      batchLimit: intEnv("GOOGLE_SYNC_BATCH_LIMIT", 25),
      concurrency: intEnv("GOOGLE_SYNC_CONCURRENCY", 4),
    });
  },
}));
