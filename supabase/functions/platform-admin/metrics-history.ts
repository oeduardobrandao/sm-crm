import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { buildMonths, computeCloses, type RunRecord, type SnapshotRecord } from "./metrics-logic.ts";

/** get-metrics-history: month closes from the completion markers, classified in metrics-logic. */
export async function handleGetMetricsHistory(
  svc: SupabaseClient,
  headers: Record<string, string>,
  now: Date = new Date(),
): Promise<Response> {
  const runs = await fetchAllRows<RunRecord>((from, to) =>
    svc
      .from("metrics_snapshot_runs")
      .select("snapshot_date, source")
      .order("snapshot_date", { ascending: true })
      .range(from, to),
  );
  const closes = computeCloses(runs, saoPauloDate(now).slice(0, 7));
  const dates = closes.map((c) => c.close_date).filter((d): d is string => !!d);

  const rowsByDate = new Map<string, SnapshotRecord[]>();
  for (const ids of chunk(dates)) {
    // (snapshot_date, workspace_id) is unique, so it is a total order for .range() paging.
    const rows = await fetchAllRows<SnapshotRecord>((from, to) =>
      svc
        .from("workspace_subscription_snapshots")
        .select(
          "workspace_id, snapshot_date, provider, plan_id, plan_name, status, billing_interval, monthly_cents, amount_source, provider_switch",
        )
        .in("snapshot_date", ids)
        .order("snapshot_date", { ascending: true })
        .order("workspace_id", { ascending: true })
        .range(from, to),
    );
    for (const r of rows) {
      const list = rowsByDate.get(r.snapshot_date) ?? [];
      list.push(r);
      rowsByDate.set(r.snapshot_date, list);
    }
  }

  const body = {
    generated_at: now.toISOString(),
    first_month: closes[0]?.month ?? null,
    months: buildMonths(closes, rowsByDate),
  };
  return new Response(JSON.stringify(body), { status: 200, headers });
}
