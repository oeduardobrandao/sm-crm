import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildAmountColumns,
  fetchStripeAmount,
  STRIPE_TIMEOUT_MS,
  type StripeClient,
} from "../_shared/stripe-amount.ts";

// Peak Stripe throughput = STRIPE_CONCURRENCY requests every STRIPE_TIMEOUT_MS at worst; 8 keeps
// us well under Stripe's rate limit even with a large paying/trialing base. The timeout is enforced
// twice: the SDK's per-request `timeout` aborts the underlying fetch (freeing the connection), and
// withTimeout backstops the await — together they stop a stalled call from running the edge isolate
// to its kill.
const STRIPE_CONCURRENCY = 8;

/**
 * Rejects if `p` has not settled within `ms`, so an awaited external call can't hang a handler
 * until the edge runtime kills the isolate. The underlying promise stays handled after the race
 * is lost (its late settle hits the no-op resolve/reject), so no unhandled rejection escapes.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export interface PriceableSub {
  workspace_id: string;
  /** Which provider owns this row ('stripe' | 'pagarme'). NOT NULL in the db (default
   * 'stripe'); nullable here so a missing select surfaces as stripe semantics, never a crash. */
  provider: string | null;
  status?: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  stripe_subscription_id: string | null;
  // Mirror columns (20260730000007), written by stripe-webhook. NULL amount_cents
  // means the webhook has not priced this row yet.
  amount_cents: number | null;
  currency: string | null;
  amount_interval: string | null;
  discount_label: string | null;
}

export interface PlanMeta {
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
}

/**
 * Decides how to price a subscription row: mirror columns when the webhook has
 * priced it, otherwise catalog fallback plus a request for a (bounded) live
 * fetch that will write the result back to the mirror.
 */
export function resolveMirrorAmount(
  s: Pick<
    PriceableSub,
    | "provider"
    | "amount_cents"
    | "currency"
    | "amount_interval"
    | "discount_label"
    | "billing_interval"
    | "stripe_subscription_id"
  >,
  planMeta: PlanMeta | undefined,
): {
  amount_cents: number | null;
  interval: string | null;
  discount_label: string | null;
  amount_source: "stripe" | "pagarme" | "catalog" | null;
  needsLiveFetch: boolean;
} {
  const isPagarme = s.provider === "pagarme";
  if (s.amount_cents != null) {
    return {
      amount_cents: s.amount_cents,
      interval: s.amount_interval ?? s.billing_interval,
      discount_label: s.discount_label,
      amount_source: isPagarme ? "pagarme" : "stripe",
      needsLiveFetch: false,
    };
  }
  const catalog = planMeta
    ? (s.billing_interval === "year" ? planMeta.price_brl_annual : planMeta.price_brl)
    : null;
  return {
    amount_cents: catalog ?? null,
    interval: s.billing_interval,
    discount_label: null,
    amount_source: catalog != null ? "catalog" : null,
    // A Pagar.me row is priced synchronously at checkout; its stripe_subscription_id (if any)
    // is a leftover from before the switch — fetching it would price a dead subscription and
    // write it back over the Pagar.me mirror.
    needsLiveFetch: !isPagarme && !!s.stripe_subscription_id,
  };
}

/**
 * Prices subscription rows from the mirror columns, falling back to the plan's
 * catalog price. Rows the webhook has not priced yet (NULL amount_cents with a
 * subscription id) are fetched live from Stripe in bounded, time-bounded batches
 * and the result is written back to the mirror, so each row pays the live-fetch
 * cost at most once. Shared by get-mrr and get-trials so both report the same
 * discount-aware amounts the workspaces list shows.
 */
export async function priceSubscriptionRows<T extends PriceableSub>(
  svc: SupabaseClient,
  rows: T[],
  nameByWs: Map<string, string>,
  planById: Map<string, PlanMeta>,
): Promise<
  Array<
    T & {
      name: string;
      plan_name: string | null;
      interval: string | null;
      amount_cents: number | null;
      discount_label: string | null;
      amount_source: "stripe" | "pagarme" | "catalog" | null;
    }
  >
> {
  const resolved = rows.map((s) => ({
    row: s,
    planMeta: s.plan_id ? planById.get(s.plan_id) : undefined,
    result: resolveMirrorAmount(s, s.plan_id ? planById.get(s.plan_id) : undefined),
  }));

  let stripeClient: StripeClient | null = null;
  if (resolved.some((r) => r.result.needsLiveFetch)) {
    try {
      stripeClient = (await import("../_shared/stripe.ts")).stripe;
    } catch (err) {
      console.error("[platform-admin] stripe import failed:", (err as Error).message);
    }
  }

  const liveFetch = async (r: (typeof resolved)[number]) => {
    if (!stripeClient || !r.row.stripe_subscription_id) return;
    try {
      const amt = await withTimeout(
        fetchStripeAmount(stripeClient, r.row.stripe_subscription_id, r.row.billing_interval),
        STRIPE_TIMEOUT_MS,
        "stripe retrieve",
      );
      r.result = {
        amount_cents: amt.amount_cents,
        interval: amt.interval ?? r.row.billing_interval,
        discount_label: amt.discount_label,
        amount_source: "stripe",
        needsLiveFetch: false,
      };
      // Write back so the next load reads the mirror instead of Stripe. CAS on provider: if a
      // concurrent Pagar.me bind took the row while the Stripe fetch was in flight, zero rows
      // match — this is an opportunistic cache refresh, so we just skip and log (the in-memory
      // result for THIS response still shows the read-time snapshot, which is acceptable).
      const { data: written, error } = await svc
        .from("workspace_subscriptions")
        .update(buildAmountColumns(amt))
        .eq("workspace_id", r.row.workspace_id)
        .eq("provider", "stripe")
        // Same-provider pin: a webhook rebind to a NEW Stripe subscription mid-fetch keeps
        // provider = 'stripe', so the id observed at read time must also still match — or this
        // write-back would stamp the OLD subscription's amount into the new one's mirror.
        .eq("stripe_subscription_id", r.row.stripe_subscription_id)
        .select("workspace_id");
      if (error) {
        console.error("[platform-admin] amount write-back failed:", error.message);
      } else if (!written?.length) {
        console.warn(
          `[platform-admin] amount write-back skipped for workspace ${r.row.workspace_id}: provider changed mid-fetch`,
        );
      }
    } catch (err) {
      console.error("[platform-admin] price stripe fetch failed:", (err as Error).message);
    }
  };

  const pending = resolved.filter((r) => r.result.needsLiveFetch);
  for (let i = 0; i < pending.length; i += STRIPE_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + STRIPE_CONCURRENCY).map(liveFetch));
  }

  return resolved.map((r) => ({
    ...r.row,
    name: nameByWs.get(r.row.workspace_id) ?? "—",
    plan_name: r.planMeta?.name ?? null,
    interval: r.result.interval,
    amount_cents: r.result.amount_cents,
    discount_label: r.result.discount_label,
    amount_source: r.result.amount_source,
  }));
}
