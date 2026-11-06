import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
import { whatsAppSupportUrl } from "../_shared/whatsapp.ts";
import { nurtureUnsubPageUrl, nurtureUnsubUrl, signNurtureUnsubToken } from "../_shared/nurture-unsub-token.ts";
import {
  LIFECYCLE_FROM,
  sendFounderSignupNotice,
  sendFounderSubscriptionNotice,
  sendThankYouEmail,
  sendTrialReminderEmail,
  sendViaResend,
  sendWelcomeEmail,
} from "../_shared/lifecycle-emails.ts";
import { type LifecycleCronDeps, runLifecycleEmailCron, runNurturePreview } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

// Read lazily, inside the nurture path only: no fallback and it throws, but a
// missing secret must not take down welcome / thank-you / trial reminder. The
// throw lands in the nurture candidate (or preview) error and goes to triage.
function nurtureUnsubSecret(): string {
  const secret = Deno.env.get("NURTURE_UNSUB_SECRET");
  if (!secret) throw new Error("NURTURE_UNSUB_SECRET is required");
  return secret;
}

const CRON_NAME = "lifecycle-email-cron";
// Nurture emails reply to the founder's own inbox.
const NURTURE_REPLY_TO = "eduardo@mesaas.com.br";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The manual preview recipient from the body: `undefined` when the body asks
 * for no preview (pg_cron sends `{}`; empty or invalid JSON counts as `{}`),
 * `null` when it asks for one with an unusable address. The caller must not
 * fall through to the real sweep on `null`.
 */
async function readPreviewTo(req: Request): Promise<string | null | undefined> {
  let body: unknown = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    body = {};
  }
  if (!body || typeof body !== "object" || !("nurture_preview_to" in body)) return undefined;
  const to = (body as { nurture_preview_to?: unknown }).nurture_preview_to;
  if (typeof to !== "string") return null;
  const trimmed = to.trim();
  return EMAIL_RE.test(trimmed) ? trimmed : null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = buildCorsHeaders(req);
  const json = createJsonResponder(cors);

  if (!timingSafeEqual(req.headers.get("x-cron-secret") ?? "", CRON_SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const previewTo = await readPreviewTo(req);
  if (previewTo === null) return json({ error: "Invalid nurture_preview_to" }, 400);

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
      sendTrialReminder: sendTrialReminderEmail,
      sendFounderSignup: sendFounderSignupNotice,
      sendFounderSubscription: sendFounderSubscriptionNotice,
      // Read per run: flipping the secret needs no deploy. Anything but "on" is off.
      nurtureEnabled: Deno.env.get("NURTURE_EMAILS") === "on",
      nurtureUnsubLinks: async (userId) => {
        const token = await signNurtureUnsubToken(userId, nurtureUnsubSecret());
        return {
          page: nurtureUnsubPageUrl(appBaseUrl(), token),
          oneClick: nurtureUnsubUrl(SUPABASE_URL, token),
        };
      },
      whatsappUrl: whatsAppSupportUrl({ firstName: null }),
      sendNurture: (p) =>
        sendViaResend(
          p.to,
          p.subject,
          p.html,
          p.idempotencyKey,
          LIFECYCLE_FROM,
          NURTURE_REPLY_TO,
          p.headers,
        ),
      report: (detail) => reportCronFailure(svc, CRON_NAME, detail),
    };
    if (previewTo !== undefined) {
      const preview = await runNurturePreview(deps, previewTo);
      return json({ success: true, ...preview });
    }
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
