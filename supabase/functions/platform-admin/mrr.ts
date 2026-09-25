import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { aggregateMrr, MRR_STATUSES, toMonthlyCents } from "../_shared/billing-logic.ts";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";
import { fetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";
import { priceSubscriptionRows } from "./pricing.ts";
import { fetchOwnerContacts } from "./owner-contact.ts";

// workspace_subscriptions' primary key is workspace_id alone (migration
// 20260609120003) -- there is no separate `id` column, so the pagination
// order/tiebreak IS workspace_id.
interface MrrSubRow {
  workspace_id: string;
  provider: string | null;
  status: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  stripe_subscription_id: string | null;
  amount_cents: number | null;
  currency: string | null;
  amount_interval: string | null;
  discount_label: string | null;
}

interface TrialSubRow {
  workspace_id: string;
  provider: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  amount_cents: number | null;
  currency: string | null;
  amount_interval: string | null;
  discount_label: string | null;
}

/**
 * last_activity_at per workspace, via the same admin_workspace_last_activity RPC the
 * Workspaces list and retention radar use — one definition of "activity" everywhere
 * (newest human work artifact, not sign-ins, not cron writes).
 */
async function fetchLastActivity(
  svc: SupabaseClient,
  workspaceIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!workspaceIds.length) return result;
  // admin_workspace_last_activity is a setof RPC -- subject to the same PostgREST
  // row cap as a table select -- so its workspace_ids argument is chunked too.
  for (const ids of chunk(workspaceIds)) {
    const { data, error } = await svc.rpc("admin_workspace_last_activity", {
      workspace_ids: ids,
    });
    if (error) throw error;
    for (const a of (data ?? []) as Array<{
      workspace_id: string;
      last_activity_at: string | null;
    }>) {
      result.set(a.workspace_id, a.last_activity_at);
    }
  }
  return result;
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
  fetchInternalIdsFn: (svc: SupabaseClient) => Promise<Set<string>> = fetchInternalWorkspaceIds,
) {
  const allRows = await fetchAllRows<MrrSubRow>((from, to) =>
    svc
      .from("workspace_subscriptions")
      .select(
        "workspace_id, provider, status, plan_id, billing_interval, stripe_subscription_id, amount_cents, currency, amount_interval, discount_label",
      )
      .in("status", [...MRR_STATUSES])
      .order("workspace_id", { ascending: true })
      .range(from, to),
  );
  // Internal (seeded/demo) workspaces never count as revenue; the metrics snapshots exclude them
  // too, so the tile and the history chart agree. Fails open (display only, nothing persisted).
  const internalIds = await fetchInternalIdsFn(svc);
  const rows = allRows.filter((s) => !internalIds.has(s.workspace_id));
  const wsIds = rows.map((s) => s.workspace_id);
  const planIds = [...new Set(rows.map((s) => s.plan_id).filter(Boolean))] as string[];

  const nameByWs = new Map<string, string>();
  const createdByWs = new Map<string, string>();
  for (const ids of chunk(wsIds)) {
    const { data: wsRows, error: wsErr } = await svc
      .from("workspaces")
      .select("id, name, created_at")
      .in("id", ids);
    if (wsErr) throw wsErr; // was silently ignored; a missing name must not zero a paying row
    for (const w of wsRows ?? []) {
      nameByWs.set(w.id, w.name);
      createdByWs.set(w.id, w.created_at);
    }
  }

  const planById = new Map<
    string,
    { name: string; price_brl: number | null; price_brl_annual: number | null }
  >();
  for (const ids of chunk(planIds)) {
    const { data: planRows, error: planErr } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", ids);
    if (planErr) throw planErr;
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
  fetchInternalIdsFn: (svc: SupabaseClient) => Promise<Set<string>> = fetchInternalWorkspaceIds,
) {
  const allRows = await fetchAllRows<TrialSubRow>((from, to) =>
    svc
      .from("workspace_subscriptions")
      .select(
        "workspace_id, provider, plan_id, billing_interval, stripe_subscription_id, current_period_end, amount_cents, currency, amount_interval, discount_label",
      )
      .eq("status", "trialing")
      .order("workspace_id", { ascending: true })
      .range(from, to),
  );
  // Internal (seeded/demo) workspaces never count as revenue; the metrics snapshots exclude them
  // too, so the tile and the history chart agree. Fails open (display only, nothing persisted).
  const internalIds = await fetchInternalIdsFn(svc);
  const rows = allRows.filter((s) => !internalIds.has(s.workspace_id));
  const wsIds = rows.map((s) => s.workspace_id);
  const planIds = [...new Set(rows.map((s) => s.plan_id).filter(Boolean))] as string[];

  const nameByWs = new Map<string, string>();
  const createdByWs = new Map<string, string>();
  for (const ids of chunk(wsIds)) {
    const { data: wsRows, error: wsErr } = await svc
      .from("workspaces")
      .select("id, name, created_at")
      .in("id", ids);
    if (wsErr) throw wsErr; // was silently ignored; a missing name must not zero a paying row
    for (const w of wsRows ?? []) {
      nameByWs.set(w.id, w.name);
      createdByWs.set(w.id, w.created_at);
    }
  }

  const planById = new Map<
    string,
    { name: string; price_brl: number | null; price_brl_annual: number | null }
  >();
  for (const ids of chunk(planIds)) {
    const { data: planRows, error: planErr } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", ids);
    if (planErr) throw planErr;
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
