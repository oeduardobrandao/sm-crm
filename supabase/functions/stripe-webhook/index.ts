import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { stripe, cryptoProvider } from "../_shared/stripe.ts";
import {
  resolvePlanFromPriceId,
  statusToPlanId,
  type PlanPriceRow,
} from "../_shared/billing-logic.ts";
import {
  buildFailureEpisode,
  buildRecoveryEpisode,
  isRecoveredStatus,
  selectDunningStage,
  type DunningEpisode,
} from "../_shared/dunning-logic.ts";
import { sendDunningEmail } from "../_shared/dunning-email.ts";
import { appBaseUrl } from "../_shared/app-url.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_WEBHOOK_SECRET =
  Deno.env.get("STRIPE_WEBHOOK_SECRET") ??
  (() => {
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable is required");
  })();

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("Missing signature", { status: 400 });

  const bodyText = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      bodyText, sig, STRIPE_WEBHOOK_SECRET, undefined, cryptoProvider,
    );
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Dedup: short-circuit known events. Handlers are also idempotent, so this is best-effort.
  const { data: existing } = await svc
    .from("stripe_webhook_events").select("event_id").eq("event_id", event.id).maybeSingle();
  if (existing) return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });

  try {
    await handleEvent(svc, event);
  } catch (err) {
    // Do NOT record the event — return 5xx so Stripe redelivers.
    console.error(`[stripe-webhook] handler error for ${event.type}:`, err);
    return new Response("Handler error", { status: 500 });
  }

  await svc.from("stripe_webhook_events").insert({ event_id: event.id, type: event.type });
  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

async function handleEvent(svc: SupabaseClient, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!session.subscription) return;
      const subId = typeof session.subscription === "string"
        ? session.subscription : session.subscription.id;
      const sub = await stripe.subscriptions.retrieve(subId);
      await syncSubscription(svc, sub, session);
      break;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      await syncSubscription(svc, event.data.object as Stripe.Subscription, null);
      break;
    }
    case "invoice.payment_failed": {
      await handlePaymentFailed(svc, event.data.object as Stripe.Invoice);
      break;
    }
    default:
      break;
  }
}

async function syncSubscription(
  svc: SupabaseClient,
  sub: Stripe.Subscription,
  session: Stripe.Checkout.Session | null,
) {
  const workspaceId = await resolveWorkspaceId(svc, sub, session);
  if (!workspaceId) throw new Error(`Could not resolve workspace for subscription ${sub.id}`);

  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  const plans = await loadPlanPriceRows(svc);
  const resolved = priceId ? resolvePlanFromPriceId(priceId, plans) : null;
  const defaultPlanId = await getDefaultPlanId(svc);
  const subscribedPlanId = resolved?.plan_id ?? defaultPlanId;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // current_period_end lives on the subscription root in older API versions (acacia) and
  // on the first subscription item in basil (2025-03-31)+. Webhook payloads use the account's
  // API version regardless of the SDK pin, so read whichever is present.
  const subPeriod = sub as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const periodEndUnix = subPeriod.current_period_end
    ?? subPeriod.items?.data?.[0]?.current_period_end
    ?? null;

  // Upsert only writes the columns provided, so spreading {} leaves the episode fields untouched
  // for non-recovery statuses. This is also the fix for failed_payment_count never resetting —
  // without it a recovered workspace reads as permanently troubled in the admin.
  const recovery = isRecoveredStatus(sub.status) ? buildRecoveryEpisode() : {};

  await svc.from("workspace_subscriptions").upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan_id: resolved?.plan_id ?? null,
    billing_interval: resolved?.interval ?? null,
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    ...recovery,
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id" });

  const targetPlanId = statusToPlanId(sub.status, subscribedPlanId, defaultPlanId);
  if (targetPlanId !== null) {
    await writeWorkspacePlan(svc, workspaceId, targetPlanId);
  }
}

async function handlePaymentFailed(svc: SupabaseClient, invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  // past_due_since is selected so buildFailureEpisode can coalesce against its own prior value.
  const { data: row } = await svc
    .from("workspace_subscriptions").select("workspace_id, past_due_since")
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (!row?.workspace_id) throw new Error(`No workspace for failed-invoice customer ${customerId}`);

  const nextAttempt = invoice.next_payment_attempt ?? null;
  const episode = buildFailureEpisode(
    (row.past_due_since as string | null) ?? null,
    invoice.attempt_count ?? 0,
    nextAttempt,
    new Date(),
  );

  await svc.from("workspace_subscriptions").update({
    status: "past_due",
    ...episode,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", row.workspace_id);

  await notifyOwnerOfFailure(svc, row.workspace_id as string, invoice, nextAttempt, episode);
}

/**
 * Tell the owner their payment failed. Swallows everything: a throw here would 500 the handler,
 * Stripe would redeliver, and the customer would get the same mail again.
 *
 * The owner is the only role that can act — billing-checkout and billing-portal are owner-gated.
 */
async function notifyOwnerOfFailure(
  svc: SupabaseClient,
  workspaceId: string,
  invoice: Stripe.Invoice,
  nextAttempt: number | null,
  episode: DunningEpisode,
) {
  try {
    const { data: ws } = await svc
      .from("workspaces").select("name").eq("id", workspaceId).maybeSingle();

    // workspace_members, not profiles.conta_id: profiles has no email column, and conta_id is the
    // legacy single-workspace field. This is the path platform-admin already uses.
    const { data: ownerMember } = await svc
      .from("workspace_members").select("user_id")
      .eq("workspace_id", workspaceId).eq("role", "owner").limit(1).maybeSingle();
    if (!ownerMember?.user_id) return;

    const { data: ownerUser } = await svc.auth.admin.getUserById(ownerMember.user_id as string);
    const to = ownerUser?.user?.email;
    if (!to) return;

    await sendDunningEmail({
      to,
      stage: selectDunningStage(invoice.attempt_count ?? 0, nextAttempt),
      workspaceName: (ws?.name as string | undefined) ?? "seu workspace",
      nextAttemptLabel: formatAttemptLabel(episode.next_payment_attempt),
      billingUrl: `${appBaseUrl()}/configuracao/cobranca`,
    });
  } catch (e) {
    // Internal log only — CLAUDE.md's "generic message" rule governs client responses, not
    // server logs. Without the workspace id and reason, a dead Resend key looks exactly like a
    // one-off blip, and nobody can tell which owner was never warned before losing access.
    console.error(
      `[stripe-webhook] dunning notification failed for workspace ${workspaceId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** "2026-07-24T10:00:00.000Z" -> "24 de julho". Null when Stripe will not retry again. */
function formatAttemptLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

/** Effective-plan write, guarded so admin comps (plan_source='manual') are never overridden. */
async function writeWorkspacePlan(svc: SupabaseClient, workspaceId: string, planId: string) {
  const { data: ws } = await svc
    .from("workspaces").select("plan_source").eq("id", workspaceId).single();
  if (ws?.plan_source === "manual") return;
  await svc.from("workspaces")
    .update({ plan_id: planId, plan_source: "stripe" }).eq("id", workspaceId);
}

async function resolveWorkspaceId(
  svc: SupabaseClient,
  sub: Stripe.Subscription,
  session: Stripe.Checkout.Session | null,
): Promise<string | null> {
  if (sub.metadata?.workspace_id) return sub.metadata.workspace_id;
  if (session?.client_reference_id) return session.client_reference_id;
  if (session?.metadata?.workspace_id) return session.metadata.workspace_id;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer.deleted && customer.metadata?.workspace_id) {
      return customer.metadata.workspace_id;
    }
    const { data } = await svc
      .from("workspace_subscriptions").select("workspace_id")
      .eq("stripe_customer_id", customerId).maybeSingle();
    if (data?.workspace_id) return data.workspace_id;
  }
  return null;
}

async function loadPlanPriceRows(svc: SupabaseClient): Promise<PlanPriceRow[]> {
  const { data } = await svc.from("plans")
    .select("id, stripe_price_id, stripe_price_id_annual");
  return (data ?? []) as PlanPriceRow[];
}

async function getDefaultPlanId(svc: SupabaseClient): Promise<string> {
  const { data } = await svc.from("plans").select("id").eq("is_default", true).maybeSingle();
  return (data?.id as string) ?? "free";
}
