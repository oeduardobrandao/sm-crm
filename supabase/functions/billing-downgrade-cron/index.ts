import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { createStripeSwitchGateway } from "../_shared/stripe-switch.ts";
import { createDowngradeCronGateway } from "./gateway.ts";
import {
  createBillingDowngradeCronHandler,
  type DowngradeCronDeps,
  runBillingDowngradeCron,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const CRON_NAME = "billing-downgrade-cron";

Deno.serve(createBillingDowngradeCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    // Bounded global fetch: a stalled PostgREST call would otherwise hang until the edge
    // runtime kills the isolate, bypassing catch and cron-failure triage entirely
    // (documented repo failure mode). A timeout surfaces as a normal throw instead.
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

    // gateway === null means PAGARME_SECRET_KEY is unset in this environment (dark): leg B's
    // compensating cancel and all of leg C are skipped by the handler, which reports
    // remoteSkipped: true instead.
    const gateway = Deno.env.get("PAGARME_SECRET_KEY") ? createDowngradeCronGateway() : null;

    // stripeGateway === null means STRIPE_SECRET_KEY is unset in this environment (dark):
    // leg D's switch enforcement is skipped by the handler, which reports switchSkipped: true.
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");

    try {
      const deps: DowngradeCronDeps = {
        db: svc,
        gateway,
        stripeGateway: stripeKey ? createStripeSwitchGateway(stripeKey) : null,
        now: () => new Date(),
      };
      const result = await runBillingDowngradeCron(deps);

      if (result.errors.length > 0) {
        // Partial failure is still a completed run: triage reads cron_failures, and the
        // sweep's flip precondition depends on this signal reaching it. Best-effort, before
        // the 200 -- a triage-report failure must not turn a completed run into a 500.
        await reportCronFailure(svc, CRON_NAME, {
          failed: result.errors.length,
          errors: result.errors.map((e) => ({ error: e })),
        });
      }

      return json({ success: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[${CRON_NAME}] run failed:`, message);
      await reportCronFailure(svc, CRON_NAME, {
        failed: 1,
        errors: [{ error: message }],
      });
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
