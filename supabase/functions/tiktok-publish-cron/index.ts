// supabase/functions/tiktok-publish-cron/index.ts
//
// Env wiring only — business logic lives in core.ts, auth gate in handler.ts (per
// tiktok-refresh-cron/{index,core,handler}.ts's split, Task A6). `svc` is created here and
// hoisted BEFORE core.ts's try block runs, so a broken claim query still reaches
// reportCronFailure instead of dying silently (the retention initiative's cron-failure lesson).

import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getFreshTikTokToken, tiktokFetch } from "../_shared/tiktok.ts";
import { signGetUrl } from "../_shared/r2.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { createTikTokPublishCronHandler } from "./handler.ts";
import { runTikTokPublishCron } from "./core.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createTikTokPublishCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return runTikTokPublishCron({
      // deno-lint-ignore no-explicit-any
      svc: svc as any,
      getFreshTikTokToken,
      tiktokFetch,
      signGetUrl,
      reportCronFailure,
    });
  },
}));
