// Shared shape of one admin-metrics snapshot row and the single writer through the
// admin_metrics_write_snapshot RPC (migration 20260925130001). Used by metrics-snapshot-cron
// (daily close) and platform-admin backfill-metrics (month-end rebuild).

import { toMonthlyCents } from "./billing-logic.ts";

export type AmountSource = "stripe" | "pagarme" | "catalog" | "backfill" | "unpriced";

export interface SnapshotRow {
  workspace_id: string;
  provider: "stripe" | "pagarme";
  plan_id: string | null;
  plan_name: string | null;
  status: string;
  billing_interval: string | null;
  monthly_cents: number;
  amount_source: AmountSource;
  provider_switch: boolean;
}

/** One workspace_subscriptions row after priceSubscriptionRows. */
export interface PricedSnapshotSource {
  workspace_id: string;
  provider: string | null;
  status: string | null;
  plan_id: string | null;
  plan_name: string | null;
  interval: string | null;
  amount_cents: number | null;
  amount_source: "stripe" | "pagarme" | "catalog" | null;
  switched_from_stripe_subscription_id: string | null;
}

export function toSnapshotRows(
  priced: PricedSnapshotSource[],
  internalIds: Set<string>,
): SnapshotRow[] {
  return priced
    .filter((r) => !!r.status && !internalIds.has(r.workspace_id))
    .map((r) => {
      // `unpriced` only when pricing resolved nothing. A real zero amount (a 100% coupon) keeps
      // its source with 0 cents, so it classifies as not paying instead of inheriting the
      // previous close's value in the history read.
      return {
        workspace_id: r.workspace_id,
        provider: r.provider === "pagarme" ? "pagarme" : "stripe",
        plan_id: r.plan_id,
        plan_name: r.plan_name,
        status: r.status as string,
        billing_interval: r.interval,
        monthly_cents: toMonthlyCents(r.interval, r.amount_cents) ?? 0,
        amount_source: r.amount_cents == null || r.amount_source == null ? "unpriced" : r.amount_source,
        provider_switch: !!r.switched_from_stripe_subscription_id,
      };
    });
}

export type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export async function writeSnapshot(
  svc: RpcClient,
  date: string,
  source: "cron" | "backfill",
  rows: SnapshotRow[],
): Promise<{ written: number; skipped: boolean }> {
  const { data, error } = await svc.rpc("admin_metrics_write_snapshot", {
    p_date: date,
    p_source: source,
    p_rows: rows,
  });
  if (error) throw new Error(`admin_metrics_write_snapshot failed: ${error.message}`);
  const d = (data ?? {}) as { written?: number; skipped?: boolean };
  return { written: d.written ?? 0, skipped: !!d.skipped };
}
