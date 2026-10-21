import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { stripe } from "../_shared/stripe.ts";
import { createAffiliateConnectGateway } from "../_shared/affiliate-connect.ts";
import { resolveMinPayoutCents } from "../_shared/affiliate-commission.ts";
import { createAffiliatePayoutCronHandler, runAffiliatePayouts } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const CRON_NAME = "affiliate-payout-cron";

Deno.serve(createAffiliatePayoutCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (req: Request): Promise<Response> => {
    const json = createJsonResponder(buildCorsHeaders(req));
    // Bounded global fetch: a stalled PostgREST call surfaces as a throw instead of an
    // isolate kill that would bypass the triage report below.
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
      const result = await runAffiliatePayouts({
        db: svc,
        connect: createAffiliateConnectGateway(stripe),
        now: () => new Date(),
        minPayoutCents: resolveMinPayoutCents(Deno.env.get("AFFILIATE_MIN_PAYOUT_CENTS")),
      });
      if (result.errors.length > 0) {
        await reportCronFailure(svc, CRON_NAME, {
          failed: result.errors.length,
          errors: result.errors.map((e) => ({ error: e })),
        });
      }
      return json({ success: true, ...result });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[${CRON_NAME}] run failed:`, message);
      await reportCronFailure(svc, CRON_NAME, { failed: 1, errors: [{ error: message }] });
      return json({ error: "Internal server error" }, 500);
    }
  },
}));
