import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { toMonthlyCents } from "../_shared/billing-logic.ts";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";
import { fetchInternalWorkspaceIds } from "../_shared/internal-workspaces.ts";
import { fetchOwnerContacts } from "./owner-contact.ts";
import { fetchLastActivity } from "./mrr.ts";

/** Subscription statuses that mean "no longer a customer" (same set as the 'cancelado' group). */
export const ENDED_STATUSES = ["canceled", "incomplete_expired", "paused"] as const;

/** How far back the dashboard looks, by the subscription row's last update (the cancel). */
export const CHURN_WINDOW_DAYS = 90;

/**
 * - churn: paid at least one day, then left.
 * - trial_expired: had a trial and never paid (includes trial → failed first charge → canceled).
 * - unknown: canceled before the daily snapshots began (2026-09-25) with no other evidence.
 */
export type EndedKind = "churn" | "trial_expired" | "unknown";

export interface EndedSubRow {
  workspace_id: string;
  status: string | null;
  plan_id: string | null;
  billing_interval: string | null;
  amount_cents: number | null;
  amount_interval: string | null;
  ever_subscribed_at: string | null;
  updated_at: string;
}

export interface SnapshotLite {
  workspace_id: string;
  snapshot_date: string;
  status: string | null;
  monthly_cents: number | null;
}

/**
 * Decides churn vs. trial-ended from local evidence only. A daily snapshot with status `active`
 * is a paid day. `ever_subscribed_at` is set only by the 2026-08-12 backfill and by the Pagar.me
 * checkout (the Stripe webhook never writes it), so when present it marks a paying customer.
 * A `trialing` snapshot with no `active` one is a trial that never converted: Stripe moves a trial
 * whose first charge fails to `past_due`, never `active`.
 */
export function classifyEnded(
  sub: Pick<EndedSubRow, "ever_subscribed_at" | "amount_cents" | "amount_interval" | "billing_interval">,
  snapshots: SnapshotLite[],
): { kind: EndedKind; monthly_cents: number | null } {
  const active = snapshots
    .filter((s) => s.status === "active")
    .sort((a, b) => (a.snapshot_date < b.snapshot_date ? 1 : -1));
  if (active.length > 0) {
    return { kind: "churn", monthly_cents: active[0].monthly_cents ?? null };
  }
  if (sub.ever_subscribed_at) {
    return {
      kind: "churn",
      monthly_cents: toMonthlyCents(sub.amount_interval ?? sub.billing_interval, sub.amount_cents),
    };
  }
  if (snapshots.some((s) => s.status === "trialing")) {
    return { kind: "trial_expired", monthly_cents: null };
  }
  return { kind: "unknown", monthly_cents: null };
}

/**
 * Workspaces whose subscription ended in the last CHURN_WINDOW_DAYS, newest first, each
 * classified as churn / trial_expired / unknown. Internal (demo/seed) workspaces are excluded,
 * like the MRR and trials lists.
 */
export async function handleGetChurned(
  svc: SupabaseClient,
  headers: Record<string, string>,
  now: Date = new Date(),
  fetchOwnerContactsFn: typeof fetchOwnerContacts = fetchOwnerContacts,
  fetchInternalIdsFn: (svc: SupabaseClient) => Promise<Set<string>> = fetchInternalWorkspaceIds,
) {
  const since = new Date(now.getTime() - CHURN_WINDOW_DAYS * 86_400_000).toISOString();
  const allRows = await fetchAllRows<EndedSubRow>((from, to) =>
    svc
      .from("workspace_subscriptions")
      .select(
        "workspace_id, status, plan_id, billing_interval, amount_cents, amount_interval, ever_subscribed_at, updated_at",
      )
      .in("status", [...ENDED_STATUSES])
      .gte("updated_at", since)
      .order("workspace_id", { ascending: true })
      .range(from, to),
  );
  const internalIds = await fetchInternalIdsFn(svc);
  const rows = allRows.filter((s) => !internalIds.has(s.workspace_id));
  const wsIds = rows.map((s) => s.workspace_id);
  const planIds = [...new Set(rows.map((s) => s.plan_id).filter(Boolean))] as string[];

  const wsById = new Map<string, { name: string; created_at: string }>();
  const snapsByWs = new Map<string, SnapshotLite[]>();
  for (const ids of chunk(wsIds)) {
    const { data: wsRows, error: wsErr } = await svc
      .from("workspaces")
      .select("id, name, created_at")
      .in("id", ids);
    if (wsErr) throw wsErr;
    for (const w of wsRows ?? []) wsById.set(w.id, { name: w.name, created_at: w.created_at });

    // Only the statuses classifyEnded reads.
    const snaps = await fetchAllRows<SnapshotLite>((from, to) =>
      svc
        .from("workspace_subscription_snapshots")
        .select("workspace_id, snapshot_date, status, monthly_cents")
        .in("workspace_id", ids)
        .in("status", ["active", "trialing"])
        .order("workspace_id", { ascending: true })
        .order("snapshot_date", { ascending: true })
        .range(from, to),
    );
    for (const s of snaps) {
      const list = snapsByWs.get(s.workspace_id) ?? [];
      list.push(s);
      snapsByWs.set(s.workspace_id, list);
    }
  }

  const planNameById = new Map<string, string>();
  for (const ids of chunk(planIds)) {
    const { data: planRows, error: planErr } = await svc
      .from("plans")
      .select("id, name")
      .in("id", ids);
    if (planErr) throw planErr;
    for (const p of planRows ?? []) planNameById.set(p.id, p.name);
  }

  const [ownerContacts, lastActivityByWs] = await Promise.all([
    fetchOwnerContactsFn(svc, wsIds),
    fetchLastActivity(svc, wsIds),
  ]);

  const workspaces = rows
    .map((r) => {
      const { kind, monthly_cents } = classifyEnded(r, snapsByWs.get(r.workspace_id) ?? []);
      const ws = wsById.get(r.workspace_id);
      const owner = ownerContacts.get(r.workspace_id);
      return {
        workspace_id: r.workspace_id,
        name: ws?.name ?? r.workspace_id,
        plan_name: r.plan_id ? (planNameById.get(r.plan_id) ?? null) : null,
        kind,
        ended_at: r.updated_at,
        monthly_cents,
        created_at: ws?.created_at ?? null,
        last_activity_at: lastActivityByWs.get(r.workspace_id) ?? null,
        owner_name: owner?.name ?? null,
        owner_email: owner?.email ?? null,
        owner_telefone: owner?.telefone ?? null,
        owner_marketing_opt_in: owner?.marketing_opt_in ?? false,
      };
    })
    .sort((a, b) => (a.ended_at < b.ended_at ? 1 : a.ended_at > b.ended_at ? -1 : 0));

  const churned = workspaces.filter((w) => w.kind === "churn");
  return new Response(
    JSON.stringify({
      workspaces,
      churn_count: churned.length,
      trial_expired_count: workspaces.filter((w) => w.kind === "trial_expired").length,
      lost_mrr_cents: churned.reduce((sum, w) => sum + (w.monthly_cents ?? 0), 0),
      window_days: CHURN_WINDOW_DAYS,
      currency: "brl",
    }),
    { status: 200, headers },
  );
}
