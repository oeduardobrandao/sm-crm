import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { sendThankYouEmail, sendWelcomeEmail } from "../_shared/lifecycle-emails.ts";
import { type LifecycleCronDeps, runLifecycleEmailCron } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const CRON_NAME = "lifecycle-email-cron";

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  // Bounded global fetch: a stalled PostgREST call would otherwise hang until the
  // edge runtime kills the isolate, bypassing catch and cron-failure triage
  // entirely (documented repo failure mode). A timeout surfaces as a normal throw.
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
    const deps: LifecycleCronDeps = {
      db: svc as unknown as LifecycleCronDeps["db"],
      appBaseUrl: appBaseUrl(),
      now: () => new Date(),
      sendWelcome: sendWelcomeEmail,
      sendThanks: sendThankYouEmail,
      report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
    };
    const result = await runLifecycleEmailCron(deps);
    return json({ success: true, ...result });
  } catch (e) {
    // appBaseUrl() throwing (missing APP_BASE_URL) lands here too. The DB leg
    // of reportCronFailure records the failure even when Resend is down.
    console.error(
      `[${CRON_NAME}] run failed:`,
      e instanceof Error ? e.message : String(e),
    );
    await reportCronFailure(svc, CRON_NAME, {
      failed: 1,
      errors: [{ error: e instanceof Error ? e.message : String(e) }],
    });
    return json({ error: "Cron run failed" }, 500);
  }
});
