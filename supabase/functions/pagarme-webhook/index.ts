// Serve shell for pagarme-webhook. Trust boundary (spike-validated): secret token in the URL
// path + the dashboard's HTTP Basic delivery auth, both compared timing-safe — Pagar.me has no
// HMAC signature. No CORS on purpose: this is server-to-server, like stripe-webhook.
// Never log the payload or the Authorization header (LGPD/PCI).

import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { notifyOwnerOfFailure } from "../_shared/dunning-notify.ts";
import { parseWebhookEnvelope } from "./logic.ts";
import { createPagarmeWebhookGateway } from "./gateway.ts";
import { createPagarmeWebhookHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAGARME_WEBHOOK_TOKEN = Deno.env.get("PAGARME_WEBHOOK_TOKEN") ??
  (() => {
    throw new Error("PAGARME_WEBHOOK_TOKEN environment variable is required");
  })();
// "user:senha" — exactly the credentials typed into the dashboard's "Habilitar autenticação".
const PAGARME_WEBHOOK_BASIC = Deno.env.get("PAGARME_WEBHOOK_BASIC") ??
  (() => {
    throw new Error("PAGARME_WEBHOOK_BASIC environment variable is required");
  })();
const EXPECTED_AUTH = "Basic " + btoa(PAGARME_WEBHOOK_BASIC);

const DB_TIMEOUT_MS = 10_000;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const pathToken = segments[segments.length - 1] ?? "";
  if (!timingSafeEqual(pathToken, PAGARME_WEBHOOK_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(auth, EXPECTED_AUTH)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const envelope = parseWebhookEnvelope(raw);
  if (!envelope) return new Response("Invalid payload", { status: 400 });

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Dedup: short-circuit known events. Handlers are also idempotent, so this is best-effort —
  // but a FAILED dedup read must not proceed (a redelivered final e-mail is user-visible).
  const { data: dup, error: dupErr } = await svc
    .from("pagarme_webhook_events").select("event_id").eq("event_id", envelope.id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();
  if (dupErr) {
    console.error(`[pagarme-webhook] dedup read failed for ${envelope.id}: ${dupErr.message}`);
    return new Response("Handler error", { status: 500 });
  }
  if (dup) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  const handler = createPagarmeWebhookHandler({
    db: svc,
    gateway: createPagarmeWebhookGateway(),
    notify: (workspaceId, stage) =>
      notifyOwnerOfFailure(
        svc,
        workspaceId,
        { stage, nextPaymentAttemptIso: null },
        { logPrefix: "[pagarme-webhook]" },
      ),
  });

  let action: string;
  try {
    action = await handler(envelope);
  } catch (err) {
    // Do NOT record the event — return 5xx so Pagar.me redelivers.
    console.error(
      `[pagarme-webhook] handler error for ${envelope.type} ${envelope.id}:`,
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Handler error", { status: 500 });
  }

  const { error: insErr } = await svc
    .from("pagarme_webhook_events").insert({ event_id: envelope.id, type: envelope.type })
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (insErr) {
    // Best-effort like stripe-webhook: the event was handled; a redelivery hits idempotent
    // handlers (and the dunning key gate). Log so a dead ledger is visible.
    console.error(`[pagarme-webhook] ledger insert failed for ${envelope.id}: ${insErr.message}`);
  }
  console.log(`[pagarme-webhook] ${envelope.type} ${envelope.id}: ${action}`);
  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
