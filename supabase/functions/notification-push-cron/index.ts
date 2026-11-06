import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { createApnsClient } from "../_shared/apns.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import {
  createNotificationPushCronHandler,
  type NotificationPushCronDeps,
  runNotificationPushCron,
} from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

// Optional as a set: without all four the cron claims nothing and returns
// skipped, so the function can be deployed and scheduled before the Apple
// Developer account exists.
const APNS_KEY_ID = Deno.env.get("APNS_KEY_ID");
const APNS_TEAM_ID = Deno.env.get("APNS_TEAM_ID");
const APNS_PRIVATE_KEY = Deno.env.get("APNS_PRIVATE_KEY");
const APNS_BUNDLE_ID = Deno.env.get("APNS_BUNDLE_ID");

const apns = APNS_KEY_ID && APNS_TEAM_ID && APNS_PRIVATE_KEY && APNS_BUNDLE_ID
  ? createApnsClient({
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    privateKeyPem: APNS_PRIVATE_KEY,
    bundleId: APNS_BUNDLE_ID,
  })
  : null;

const CRON_NAME = "notification-push-cron";

Deno.serve(createNotificationPushCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    // Bounded global fetch, as in notification-email-cron: a stalled PostgREST
    // call must surface as a throw, not hang until the runtime kills the isolate.
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
      const deps: NotificationPushCronDeps = {
        db: svc as unknown as NotificationPushCronDeps["db"],
        send: apns ? (token, environment, message) => apns.send(token, environment, message) : null,
        now: () => new Date(),
        report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
      };
      const result = await runNotificationPushCron(deps);
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
