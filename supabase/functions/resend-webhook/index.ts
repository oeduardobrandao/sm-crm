// Serve shell for resend-webhook. Trust boundary: Svix signature (RESEND_WEBHOOK_SECRET).
// No CORS on purpose: server-to-server. Deploy with --no-verify-jwt.

import { createClient } from "npm:@supabase/supabase-js@2";
import { type ApplyEventArgs, handleResendWebhook } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET") ??
  (() => {
    throw new Error("RESEND_WEBHOOK_SECRET environment variable is required");
  })();

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function applyEvent(a: ApplyEventArgs): Promise<boolean> {
  const { data, error } = await svc.rpc("email_sends_apply_event", {
    p_svix_id: a.svixId,
    p_email_id: a.emailId,
    p_event: a.event,
    p_sent_at: a.sentAt,
    p_category: a.category,
    p_type: a.type,
    p_has_tag: a.hasTag,
    p_bounce_type: a.bounceType,
    p_bounce_subtype: a.bounceSubtype,
    p_bounce_message: a.bounceMessage,
    p_recipient: a.recipient,
    p_subject: a.subject,
  }).abortSignal(AbortSignal.timeout(10_000));
  if (error) {
    // code + message only: details/hint can carry the failing row (recipient, subject).
    console.error("[resend-webhook] rpc failed", error.code, error.message);
    throw new Error("rpc failed");
  }
  return data === true;
}

Deno.serve((req: Request) =>
  handleResendWebhook(req, { secret: RESEND_WEBHOOK_SECRET, now: Date.now, applyEvent })
);
