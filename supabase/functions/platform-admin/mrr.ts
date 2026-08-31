import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aggregateMrr, MRR_STATUSES, toMonthlyCents } from "../_shared/billing-logic.ts";
import { priceSubscriptionRows } from "./pricing.ts";
import { fetchOwnerContacts } from "./owner-contact.ts";

/**
 * last_activity_at per workspace, via the same admin_workspace_last_activity RPC the
 * Workspaces list and retention radar use — one definition of "activity" everywhere
 * (newest human work artifact, not sign-ins, not cron writes).
 */
async function fetchLastActivity(
  svc: SupabaseClient,
  workspaceIds: string[],
): Promise<Map<string, string | null>> {
  if (!workspaceIds.length) return new Map();
  const { data, error } = await svc.rpc("admin_workspace_last_activity", {
    workspace_ids: workspaceIds,
  });
  if (error) throw error;
  return new Map(
    ((data ?? []) as Array<{ workspace_id: string; last_activity_at: string | null }>).map(
      (a) => [a.workspace_id, a.last_activity_at],
    ),
  );
}

/**
 * Monthly recurring revenue + the paying-workspace breakdown behind it, driven by the Stripe
 * subscription mirror (workspace_subscriptions), NOT by plan-assignment counts -- so comped/manual
 * plan grants (which have no subscription row) never inflate it. Only subscriptions actually
 * collecting count (`active` — see MRR_STATUSES); `past_due` (payment failed, provider retrying)
 * is excluded until it recovers. Each is priced from its live Stripe amount, net of coupons; if
 * Stripe is unreachable it falls back to the plan's catalog price. Annual is normalized to monthly, and
 * the total is the exact sum of the per-workspace monthly amounts returned in `workspaces`.
 *
 * Extracted from index.ts (was an inline, un-exported handleGetMrr) so the owner-contact
 * enrichment added here for the admin CSV export is unit-testable. `fetchOwnerContactsFn` is
 * injectable so tests can substitute a fixture without re-testing fetchOwnerContacts itself.
 */
export async function handleGetMrr(
  svc: SupabaseClient,
  headers: Record<string, string>,
  fetchOwnerContactsFn: typeof fetchOwnerContacts = fetchOwnerContacts,
) {
  const { data: subs, error: subsError } = await svc
    .from("workspace_subscriptions")
    .select(
      "workspace_id, provider, status, plan_id, billing_interval, stripe_subscription_id, amount_cents, currency, amount_interval, discount_label",
    )
    .in("status", [...MRR_STATUSES]);
  if (subsError) throw subsError;

  const rows = subs ?? [];
  const wsIds = rows.map((s) => s.workspace_id);
  const planIds = [...new Set(rows.map((s) => s.plan_id).filter(Boolean))] as string[];

  const nameByWs = new Map<string, string>();
  const createdByWs = new Map<string, string>();
  if (wsIds.length) {
    const { data: wsRows } = await svc
      .from("workspaces")
      .select("id, name, created_at")
      .in("id", wsIds);
    for (const w of wsRows ?? []) {
      nameByWs.set(w.id, w.name);
      createdByWs.set(w.id, w.created_at);
    }
  }

  const planById = new Map<
    string,
    { name: string; price_brl: number | null; price_brl_annual: number | null }
  >();
  if (planIds.length) {
    const { data: planRows } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", planIds);
    for (const p of planRows ?? []) {
      planById.set(p.id, {
        name: p.name,
        price_brl: p.price_brl ?? null,
        price_brl_annual: p.price_brl_annual ?? null,
      });
    }
  }

  const priceable = await priceSubscriptionRows(svc, rows, nameByWs, planById);

  const { mrr_cents, paying_count, priced } = aggregateMrr(priceable);
  const pricedWsIds = [...new Set(priced.map((r) => r.workspace_id))];
  const [ownerContacts, lastActivityByWs] = await Promise.all([
    fetchOwnerContactsFn(svc, pricedWsIds),
    fetchLastActivity(svc, pricedWsIds),
  ]);
  const workspaces = priced
    .map((r) => {
      const owner = ownerContacts.get(r.workspace_id);
      return {
        workspace_id: r.workspace_id,
        name: r.name,
        plan_name: r.plan_name,
        status: r.status,
        interval: r.interval,
        monthly_cents: r.monthly_cents,
        discount_label: r.discount_label,
        amount_source: r.amount_source,
        created_at: createdByWs.get(r.workspace_id) ?? null,
        last_activity_at: lastActivityByWs.get(r.workspace_id) ?? null,
        owner_name: owner?.name ?? null,
        owner_email: owner?.email ?? null,
        owner_telefone: owner?.telefone ?? null,
        owner_marketing_opt_in: owner?.marketing_opt_in ?? false,
      };
    })
    .sort((a, b) => b.monthly_cents - a.monthly_cents);

  return new Response(JSON.stringify({ mrr_cents, paying_count, currency: "brl", workspaces }), {
    status: 200,
    headers,
  });
}

/**
 * Workspaces on a Stripe trial. Trials are `workspace_subscriptions.status = 'trialing'`, and
 * for a trialing subscription `current_period_end` is the trial-end date. Each trial carries an
 * EXPECTED monthly contribution, priced from the LIVE Stripe amount net of coupons (catalog price
 * as a fallback). Extracted from index.ts alongside handleGetMrr for the same testability reason.
 */
export async function handleGetTrials(
  svc: SupabaseClient,
  headers: Record<string, string>,
  fetchOwnerContactsFn: typeof fetchOwnerContacts = fetchOwnerContacts,
) {
  const { data: subs, error } = await svc
    .from("workspace_subscriptions")
    .select(
      "workspace_id, provider, plan_id, billing_interval, stripe_subscription_id, current_period_end, amount_cents, currency, amount_interval, discount_label",
    )
    .eq("status", "trialing");
  if (error) throw error;

  const rows = subs ?? [];
  const wsIds = rows.map((s) => s.workspace_id);
  const planIds = [...new Set(rows.map((s) => s.plan_id).filter(Boolean))] as string[];

  const nameByWs = new Map<string, string>();
  const createdByWs = new Map<string, string>();
  if (wsIds.length) {
    const { data: wsRows } = await svc
      .from("workspaces")
      .select("id, name, created_at")
      .in("id", wsIds);
    for (const w of wsRows ?? []) {
      nameByWs.set(w.id, w.name);
      createdByWs.set(w.id, w.created_at);
    }
  }

  const planById = new Map<
    string,
    { name: string; price_brl: number | null; price_brl_annual: number | null }
  >();
  if (planIds.length) {
    const { data: planRows } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", planIds);
    for (const p of planRows ?? []) {
      planById.set(p.id, {
        name: p.name,
        price_brl: p.price_brl ?? null,
        price_brl_annual: p.price_brl_annual ?? null,
      });
    }
  }

  const priced = await priceSubscriptionRows(svc, rows, nameByWs, planById);
  const pricedWsIds = [...new Set(priced.map((r) => r.workspace_id))];
  const [ownerContacts, lastActivityByWs] = await Promise.all([
    fetchOwnerContactsFn(svc, pricedWsIds),
    fetchLastActivity(svc, pricedWsIds),
  ]);
  const trials = priced
    .map((r) => {
      const owner = ownerContacts.get(r.workspace_id);
      return {
        workspace_id: r.workspace_id,
        name: r.name,
        plan_name: r.plan_name,
        interval: r.interval,
        trial_ends_at: r.current_period_end ?? null,
        monthly_cents: toMonthlyCents(r.interval, r.amount_cents),
        created_at: createdByWs.get(r.workspace_id) ?? null,
        last_activity_at: lastActivityByWs.get(r.workspace_id) ?? null,
        owner_name: owner?.name ?? null,
        owner_email: owner?.email ?? null,
        owner_telefone: owner?.telefone ?? null,
        owner_marketing_opt_in: owner?.marketing_opt_in ?? false,
      };
    })
    .sort((a, b) => {
      if (!a.trial_ends_at) return 1;
      if (!b.trial_ends_at) return -1;
      return a.trial_ends_at < b.trial_ends_at ? -1 : a.trial_ends_at > b.trial_ends_at ? 1 : 0;
    });

  const trial_mrr_cents = trials.reduce((sum, t) => sum + (t.monthly_cents ?? 0), 0);

  return new Response(
    JSON.stringify({ trials, trial_count: trials.length, trial_mrr_cents, currency: "brl" }),
    { status: 200, headers },
  );
}
