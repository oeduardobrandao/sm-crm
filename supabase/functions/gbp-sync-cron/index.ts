// Env wiring only: business logic in core.ts, auth gate in handler.ts (tiktok-sync-cron's split).
// `svc` is created once at module scope, before core.ts runs: a broken query still reaches
// reportCronFailure, and a client that cannot be built fails the boot instead of every run.
import { createClient } from "npm:@supabase/supabase-js@2";
import * as gbpApi from "../_shared/gbp-api.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { effectivePlanFeature } from "../_shared/entitlements-rpc.ts";
import { getFreshGoogleToken } from "../_shared/google.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { runGbpSyncCron } from "./core.ts";
import { createGbpSyncCronHandler } from "./handler.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const CRON_SECRET = requireEnv("CRON_SECRET");
// getFreshGoogleToken and the revocation retry decrypt with it; fail at boot, not per location.
requireEnv("TOKEN_ENCRYPTION_KEY");

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function intEnv(name: string, fallback: number): number {
  const parsed = parseInt(Deno.env.get(name) || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

Deno.serve(createGbpSyncCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: () =>
    runGbpSyncCron({
      svc,
      api: gbpApi,
      getFreshGoogleToken,
      reportCronFailure,
      effectivePlanFeature,
      // Read per invocation: changing either secret needs no deploy. core.ts caps concurrency at 4.
      batchLimit: intEnv("GOOGLE_SYNC_BATCH_LIMIT", 25),
      concurrency: intEnv("GOOGLE_SYNC_CONCURRENCY", 4),
    }),
}));
