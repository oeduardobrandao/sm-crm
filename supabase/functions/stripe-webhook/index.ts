import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { stripe, cryptoProvider } from "../_shared/stripe.ts";
import {
  resolvePlanFromPriceId,
  resolveSubscriptionSeats,
  statusToPlanId,
  type PlanPriceRow,
} from "../_shared/billing-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_WEBHOOK_SECRET =
  Deno.env.get("STRIPE_WEBHOOK_SECRET") ??
  (() => {
    throw new Error("STRIPE_WEBHOOK_SECRET environment variable is required");
  })();

export interface SubItem {
  price?: { id?: string | null } | null;
  quantity?: number | null;
  current_period_end?: number | null;
}

/**
 * Pure decision logic for syncSubscription. Classifies all subscription items
 * by price_id (never by array index), resolves the tier item, computes purchased
 * seats, and derives the period-end from the resolved tier item.
 *
 *  - `planIdToWrite`: value for statusToPlanId's subscribedPlanId path — null means
 *    "no tier resolved, leave workspaces.plan_id unchanged" (kills the silent default fallback).
 *  - `mirrorPlanId`: value for workspace_subscriptions.plan_id — the resolved tier, or the
 *    prior mirror value when nothing resolves (never overwritten with null).
 *  - `purchasedSeats`: Stripe seat quantity, forced to 0 unless status is active/trialing.
 *  - `periodEndUnix`: current_period_end from the resolved tier item (basil fallback), or null.
 *  - `mustThrow`: true when an ACTIVE/TRIALING sub has a seat item but no resolvable tier —
 *    the caller must throw 5xx so Stripe redelivers (a shared seat price cannot identify a tier).
 */
export function resolveSyncTarget(args: {
  items: SubItem[];
  status: string;
  plans: PlanPriceRow[];
  priorPlanId: string | null;
}): {
  planIdToWrite: string | null;
  mirrorPlanId: string | null;
  billingInterval: "month" | "year" | null;
  purchasedSeats: number;
  periodEndUnix: number | null;
  mustThrow: boolean;
} {
  const { items, status, plans, priorPlanId } = args;

  // 1. Resolve the TIER item by scanning every item (order-independent).
  let resolved: { plan_id: string; interval: "month" | "year" } | null = null;
  let tierItem: SubItem | null = null;
  for (const it of items) {
    const pid = it?.price?.id ?? null;
    if (!pid) continue;
    const r = resolvePlanFromPriceId(pid, plans);
    if (r) {
      resolved = r;
      tierItem = it;
      break;
    }
  }

  // 2. Purchased seats from the seat item(s), status-aware.
  // Cast to billing-logic's SubItem shape; resolveSubscriptionSeats guards null price internally.
  const seats = resolveSubscriptionSeats(
    items as Parameters<typeof resolveSubscriptionSeats>[0],
    plans,
  );
  const seatsLive = status === "active" || status === "trialing";
  const purchasedSeats = seatsLive ? seats.purchased_seats : 0;

  // 3. Did a seat item exist at all? Presence-based (independent of quantity).
  const hasSeatItem = seats.has_seat_item;

  // 4. Active/trialing sub with a seat item but no tier -> unrecoverable; force redelivery.
  const mustThrow = seatsLive && tierItem === null && hasSeatItem;

  // 5. period-end: prefer the resolved tier item; else fall back to the first item present.
  const periodEndUnix = (tierItem?.current_period_end ?? items?.[0]?.current_period_end) ?? null;

  return {
    planIdToWrite: resolved?.plan_id ?? null,
    mirrorPlanId: resolved?.plan_id ?? priorPlanId ?? null,
    billingInterval: resolved?.interval ?? null,
    purchasedSeats,
    periodEndUnix,
    mustThrow,
  };
}

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

  const plans = await loadPlanPriceRows(svc);
  const defaultPlanId = await getDefaultPlanId(svc);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;

  // Read the prior mirror plan_id so we never overwrite it with null when no tier resolves.
  const { data: priorRow } = await svc
    .from("workspace_subscriptions").select("plan_id")
    .eq("workspace_id", workspaceId).maybeSingle();
  const priorPlanId = (priorRow?.plan_id as string | null) ?? null;

  // Classify ALL items by price_id (never index 0); current_period_end lives on the item
  // in basil (2025-03-31)+. The subscription-root value (acacia) is preferred when present.
  const subPeriod = sub as unknown as { current_period_end?: number };
  const items = (sub.items?.data ?? []) as unknown as SubItem[];

  const target = resolveSyncTarget({
    items,
    status: sub.status,
    plans,
    priorPlanId,
  });

  if (target.mustThrow) {
    // Active sub with a seat item but no resolvable tier: a shared seat price cannot
    // identify a tier, so the default fallback cannot recover it. Throw 5xx for redelivery.
    console.error(
      `[stripe-webhook] active subscription ${sub.id} has a seat item but no resolvable tier price`,
    );
    throw new Error("Unresolvable tier on active subscription with seat item");
  }

  const periodEndUnix = subPeriod.current_period_end ?? target.periodEndUnix ?? null;

  await svc.from("workspace_subscriptions").upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan_id: target.mirrorPlanId,
    billing_interval: target.billingInterval,
    purchased_seats: target.purchasedSeats,
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id" });

  // No tier resolved -> leave workspaces.plan_id unchanged (skip writeWorkspacePlan),
  // matching past_due/incomplete null semantics. Never write the default on an unresolved tier.
  if (target.planIdToWrite === null) return;

  const targetPlanId = statusToPlanId(sub.status, target.planIdToWrite, defaultPlanId);
  if (targetPlanId !== null) {
    await writeWorkspacePlan(svc, workspaceId, targetPlanId);
  }
}

async function handlePaymentFailed(svc: SupabaseClient, invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;
  const { data: row } = await svc
    .from("workspace_subscriptions").select("workspace_id")
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (!row?.workspace_id) throw new Error(`No workspace for failed-invoice customer ${customerId}`);
  // Idempotent: assign Stripe's authoritative attempt counter, never increment.
  await svc.from("workspace_subscriptions").update({
    status: "past_due",
    failed_payment_count: invoice.attempt_count ?? 0,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", row.workspace_id);
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
    .select(
      "id, stripe_price_id, stripe_price_id_annual, stripe_price_id_seat, stripe_price_id_seat_annual",
    );
  return (data ?? []) as PlanPriceRow[];
}

async function getDefaultPlanId(svc: SupabaseClient): Promise<string> {
  const { data } = await svc.from("plans").select("id").eq("is_default", true).maybeSingle();
  return (data?.id as string) ?? "free";
}
