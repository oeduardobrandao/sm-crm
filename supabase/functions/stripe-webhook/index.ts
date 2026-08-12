import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17";
import { stripe, cryptoProvider } from "../_shared/stripe.ts";
import {
  extractInvoiceSubscriptionId,
  resolvePlanFromPriceId,
  statusToPlanId,
  type InvoiceSubscriptionSource,
  type PlanPriceRow,
} from "../_shared/billing-logic.ts";
import { canWebhookWrite, shouldCancelDeniedCheckoutSub } from "../_shared/pagarme-logic.ts";
import {
  buildFailureEpisode,
  buildRecoveryEpisode,
  isRecoveredStatus,
  selectDunningStage,
} from "../_shared/dunning-logic.ts";
import {
  buildAmountColumns,
  clearedAmountColumns,
  fetchStripeAmount,
} from "../_shared/stripe-amount.ts";
import { writeWorkspacePlan } from "../_shared/plan-writer.ts";
import { notifyOwnerOfFailure } from "../_shared/dunning-notify.ts";

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

  // Ownership guard: a Stripe webhook may only write a row Stripe owns, and only for the
  // subscription id registered on it. (Re)binding a new id is allowed only when the event came
  // from checkout.session.completed (`session` non-null) — the sole event authorized by the
  // workspace itself via client_reference_id. Everything else (late events from an old
  // subscription, rows owned by Pagar.me) is an intentional no-op: retrying cannot change
  // ownership, so we ack instead of erroring.
  const { data: existingRow, error: existingErr } = await svc
    .from("workspace_subscriptions")
    .select(
      "provider, stripe_subscription_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (existingErr) {
    // A failed read must NOT masquerade as "no row": canWebhookWrite(null, ...) authorizes a
    // bind, which could write over a row another provider owns. Throw → 5xx → redelivery.
    throw new Error(`ownership read failed for workspace ${workspaceId}: ${existingErr.message}`);
  }
  const allowed = canWebhookWrite(
    existingRow ?? null,
    { provider: "stripe", subscriptionId: sub.id, isAuthorizedBind: session != null },
    new Date(),
  );
  if (!allowed) {
    if (shouldCancelDeniedCheckoutSub(session != null, sub.status)) {
      // Fase 3 review hardening: a denied checkout.session.completed strands a PAID Stripe
      // subscription (the deny is the cross-provider guard). Cancel it so it never invoices
      // again; a cancel failure throws → 5xx → Stripe redelivers and retries the cancel
      // (the redelivered event re-retrieves the sub; once canceled this branch acks).
      await stripe.subscriptions.cancel(sub.id);
      console.error(
        `[stripe-webhook] CRITICAL: canceled stripe subscription ${sub.id} from denied checkout on workspace ${workspaceId} (cross-provider conflict); check for a first payment to refund manually`,
      );
      return;
    }
    console.warn(
      `[stripe-webhook] write denied for subscription ${sub.id} on workspace ${workspaceId}: row not owned by this stripe subscription`,
    );
    return;
  }

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

  // Price the subscription once here so admin reads never have to call Stripe live.
  // On failure CLEAR the mirror instead of keeping the old amount: this event may
  // be the price change itself, and readers treat any non-null amount as
  // authoritative (no retry). A cleared row is re-priced live and written back on
  // the next admin read, so it self-heals.
  let amountCols: Record<string, unknown>;
  try {
    const amt = await fetchStripeAmount(stripe, sub.id, resolved?.interval ?? null);
    amountCols = buildAmountColumns(amt);
  } catch (err) {
    console.error("[stripe-webhook] amount fetch failed:", (err as Error).message);
    amountCols = clearedAmountColumns();
  }

  const columns = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    // The guard above authorized this write, so stamping ownership is both safe and REQUIRED:
    // an authorized reclaim of a churned Pagar.me row must flip the row back to Stripe, or
    // every later Stripe event for it would be denied by the guard and the admin would keep
    // labeling a live Stripe subscription as Pagar.me. Stripe subscriptions have no card
    // installments, so a leftover from a Pagar.me era is cleared in the same write.
    provider: "stripe",
    installments: null,
    status: sub.status,
    plan_id: resolved?.plan_id ?? null,
    billing_interval: resolved?.interval ?? null,
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    ...amountCols,
    ...recovery,
    updated_at: new Date().toISOString(),
  };

  if (existingRow) {
    // Compare-and-set on BOTH ownership coordinates observed at guard time: the provider AND
    // the registered stripe_subscription_id. Provider alone closes the cross-provider race
    // (pagarme bind mid-flight) but not the same-provider one: a delayed event for the OLD
    // Stripe subscription and an authorized checkout rebind to a NEW one can both pass the
    // guard on the same read snapshot — whichever writes second must lose. Zero rows matched
    // → throw → 5xx → Stripe redelivers → the next attempt re-reads fresh state and the guard
    // re-decides (the delayed old-subscription event is then denied on the id mismatch).
    // Errors are propagated for the same reason: a silently failed write must not ack.
    let update = svc
      .from("workspace_subscriptions")
      .update(columns)
      .eq("workspace_id", workspaceId)
      .eq("provider", existingRow.provider ?? "stripe");
    update = existingRow.stripe_subscription_id == null
      ? update.is("stripe_subscription_id", null)
      : update.eq("stripe_subscription_id", existingRow.stripe_subscription_id);
    const { data: updated, error: updateErr } = await update.select("workspace_id");
    if (updateErr) {
      throw new Error(`subscription write failed for workspace ${workspaceId}: ${updateErr.message}`);
    }
    if (!updated?.length) {
      throw new Error(`concurrent ownership change on workspace ${workspaceId}, retrying via redelivery`);
    }
  } else {
    // Plain INSERT, deliberately NOT an upsert: if a concurrent writer created the row between
    // our "no row" read and this statement (e.g. a pagarme-checkout bind in Fase 3+), an upsert
    // with onConflict would resolve by UPDATING that fresh row with Stripe columns — bypassing
    // the ownership decision in exactly the race the CAS exists for. The unique violation
    // throws instead: 5xx → Stripe redelivers → the next attempt reads the row and re-decides.
    const { error: insertErr } = await svc
      .from("workspace_subscriptions")
      .insert({ workspace_id: workspaceId, ...columns });
    if (insertErr) {
      throw new Error(`subscription insert failed for workspace ${workspaceId}: ${insertErr.message}`);
    }
  }

  const targetPlanId = statusToPlanId(sub.status, subscribedPlanId, defaultPlanId);
  if (targetPlanId !== null) {
    await writeWorkspacePlan(svc, workspaceId, targetPlanId, "stripe");
  }
}

async function handlePaymentFailed(svc: SupabaseClient, invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  // A failed invoice with no subscription (one-off invoice) has no dunning to run.
  const invoiceSubId = extractInvoiceSubscriptionId(invoice as InvoiceSubscriptionSource);
  if (!invoiceSubId) return;

  // past_due_since is selected so buildFailureEpisode can coalesce against its own prior value.
  // The ownership columns are selected so canWebhookWrite can refuse a failure event that does
  // not belong to the registered subscription (old sub after a rebind, or a Pagar.me-owned row).
  const { data: row } = await svc
    .from("workspace_subscriptions")
    .select(
      "workspace_id, past_due_since, provider, stripe_subscription_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end",
    )
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (!row?.workspace_id) throw new Error(`No workspace for failed-invoice customer ${customerId}`);

  // payment_failed never binds: an unbound row or a mismatched id is a deliberate no-op.
  const allowed = canWebhookWrite(
    row,
    { provider: "stripe", subscriptionId: invoiceSubId, isAuthorizedBind: false },
    new Date(),
  );
  if (!allowed) {
    console.warn(
      `[stripe-webhook] payment_failed ignored for subscription ${invoiceSubId} on workspace ${row.workspace_id}: not the registered subscription`,
    );
    return;
  }

  const nextAttempt = invoice.next_payment_attempt ?? null;
  const episode = buildFailureEpisode(
    (row.past_due_since as string | null) ?? null,
    invoice.attempt_count ?? 0,
    nextAttempt,
    new Date(),
  );

  // CAS on provider AND the registered subscription id (same rationale as syncSubscription):
  // provider alone would let a payment_failed for the OLD subscription mark a freshly rebound
  // NEW Stripe subscription past_due and fire dunning for an obsolete failure. The guard
  // guaranteed row.stripe_subscription_id === invoiceSubId at read time; the CAS asserts it is
  // still true at write time. Zero rows → throw → redelivery re-decides. The dunning e-mail
  // below only fires after a successful write.
  const { data: updated, error: updateErr } = await svc.from("workspace_subscriptions").update({
    status: "past_due",
    ...episode,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", row.workspace_id).eq("provider", "stripe")
    .eq("stripe_subscription_id", invoiceSubId).select("workspace_id");
  if (updateErr) {
    throw new Error(`past_due write failed for workspace ${row.workspace_id}: ${updateErr.message}`);
  }
  if (!updated?.length) {
    throw new Error(`concurrent ownership change on workspace ${row.workspace_id}, retrying via redelivery`);
  }

  await notifyOwnerOfFailure(
    svc,
    row.workspace_id as string,
    {
      stage: selectDunningStage(invoice.attempt_count ?? 0, nextAttempt),
      nextPaymentAttemptIso: episode.next_payment_attempt,
    },
    { logPrefix: "[stripe-webhook]" },
  );
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
