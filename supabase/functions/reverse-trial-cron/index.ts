import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { capturePostHog } from "../_shared/posthog.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { createReverseTrialCronHandler, runReverseTrialCron } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const CRON_NAME = "reverse-trial-cron";

Deno.serve(createReverseTrialCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    // Bounded global fetch: a stalled PostgREST call would otherwise hang until the edge
    // runtime kills the isolate, bypassing catch and cron-failure triage.
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          fetch(input, {
            ...init,
            signal: init?.signal
              ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)])
              : AbortSignal.timeout(10_000),
          }),
      },
    });

    try {
      const result = await runReverseTrialCron({
        db: svc,
        now: () => new Date(),
        capture: (event, distinctId, props) => capturePostHog(event, distinctId, props),
      });

      if (result.errors.length > 0) {
        // A partial failure is still a completed run; triage reads cron_failures.
        await reportCronFailure(svc, CRON_NAME, {
          failed: result.errors.length,
          errors: result.errors.map((e) => ({ error: e })),
        });
      }

      return json({ success: true, ended: result.ended, skipped: result.skipped, failed: result.errors.length });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[${CRON_NAME}] run failed:`, message);
      await reportCronFailure(svc, CRON_NAME, { failed: 1, errors: [{ error: message }] });
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
