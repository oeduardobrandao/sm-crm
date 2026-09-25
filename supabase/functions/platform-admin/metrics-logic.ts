// Pure logic behind get-metrics-history (spec 2026-09-25-admin-metricas-historico-design.md §4).
// No I/O: the handler hands in the completion markers and the rows of each month close.

import { monthRange } from "../_shared/sao-paulo-date.ts";

export interface SnapshotRecord {
  workspace_id: string;
  snapshot_date: string;
  provider: "stripe" | "pagarme";
  plan_id: string | null;
  plan_name: string | null;
  status: string;
  monthly_cents: number;
  provider_switch: boolean;
}

export interface RunRecord {
  snapshot_date: string;
  source: "cron" | "backfill";
}

export interface MonthClose {
  month: string;
  close_date: string | null;
  source: "cron" | "backfill" | null;
  closed: boolean;
}

export type WorkspaceClass = "paying" | "past_due" | "out";

export interface Movements {
  new: number;
  expansion: number;
  contraction: number;
  past_due: number;
  recovered: number;
  churn: number;
  switch: number;
}

export interface ChurnBlock {
  logos: number;
  lost_cents: number;
  base_logos: number;
  base_cents: number;
  logo_pct: number | null;
  revenue_pct: number | null;
}

export interface MetricsMonth {
  month: string;
  missing: boolean;
  close_date: string | null;
  closed: boolean;
  source: "cron" | "backfill" | null;
  mrr_cents: number | null;
  arr_cents: number | null;
  paying_count: number | null;
  by_provider: { stripe: number; pagarme: number } | null;
  by_plan: { plan_id: string | null; name: string; mrr_cents: number }[] | null;
  movements_since: string | null;
  movements: Movements | null;
  churn: ChurnBlock | null;
}

/**
 * paying: active with a positive amount (aggregateMrr's eligibility), plus a Pagar.me trial that
 * is a Stripe switch in progress (the customer still pays Stripe until the period ends).
 */
export function classOf(r: SnapshotRecord | undefined): WorkspaceClass {
  if (!r) return "out";
  if (r.status === "active" && r.monthly_cents > 0) return "paying";
  if (r.status === "trialing" && r.provider === "pagarme" && r.provider_switch && r.monthly_cents > 0) {
    return "paying";
  }
  if (r.status === "past_due") return "past_due";
  return "out";
}

/** One close per calendar month from the first marker month to `currentMonth`. */
export function computeCloses(runs: RunRecord[], currentMonth: string): MonthClose[] {
  if (!runs.length) return [];
  const latestByMonth = new Map<string, RunRecord>();
  for (const r of runs) {
    const m = r.snapshot_date.slice(0, 7);
    const prev = latestByMonth.get(m);
    if (!prev || r.snapshot_date > prev.snapshot_date) latestByMonth.set(m, r);
  }
  const first = [...latestByMonth.keys()].sort()[0];
  return monthRange(first, currentMonth).map((month) => {
    const run = latestByMonth.get(month);
    return {
      month,
      close_date: run?.snapshot_date ?? null,
      source: run?.source ?? null,
      closed: month < currentMonth,
    };
  });
}

function byWorkspace(rows: SnapshotRecord[]): Map<string, SnapshotRecord> {
  return new Map(rows.map((r) => [r.workspace_id, r]));
}

export function diffCloses(
  prevRows: SnapshotRecord[],
  curRows: SnapshotRecord[],
): { movements: Movements; churn: ChurnBlock } {
  const prev = byWorkspace(prevRows);
  const cur = byWorkspace(curRows);
  const m: Movements = { new: 0, expansion: 0, contraction: 0, past_due: 0, recovered: 0, churn: 0, switch: 0 };
  let logos = 0;
  let lost = 0;
  let baseLogos = 0;
  let baseCents = 0;

  for (const id of new Set([...prev.keys(), ...cur.keys()])) {
    const p = prev.get(id);
    const c = cur.get(id);
    const pk = classOf(p);
    const ck = classOf(c);
    const pv = p?.monthly_cents ?? 0;
    const cv = c?.monthly_cents ?? 0;
    if (pk !== "out") {
      baseLogos++;
      baseCents += pv;
    }
    if (pk === "out" && ck === "paying") m.new += cv;
    else if (pk === "paying" && ck === "paying") {
      const delta = cv - pv;
      if (p!.provider !== c!.provider) m.switch += delta;
      else if (delta > 0) m.expansion += delta;
      else m.contraction += delta;
    } else if (pk === "paying" && ck === "past_due") m.past_due -= pv;
    else if (pk === "paying" && ck === "out") {
      m.churn -= pv;
      logos++;
      lost += pv;
    } else if (pk === "past_due" && ck === "paying") m.recovered += cv;
    else if (pk === "past_due" && ck === "out") {
      // Already left MRR as past_due; counts only in the churn block, at its last amount.
      logos++;
      lost += pv;
    }
    // past_due -> past_due, out -> past_due, out -> out: R$ 0.
  }

  return {
    movements: m,
    churn: {
      logos,
      lost_cents: lost,
      base_logos: baseLogos,
      base_cents: baseCents,
      logo_pct: baseLogos > 0 ? logos / baseLogos : null,
      revenue_pct: baseCents > 0 ? (lost + Math.abs(m.contraction)) / baseCents : null,
    },
  };
}

function aggregate(rows: SnapshotRecord[]) {
  let mrr = 0;
  let paying = 0;
  const byProvider = { stripe: 0, pagarme: 0 };
  const byPlan = new Map<string, { plan_id: string | null; name: string; mrr_cents: number }>();
  for (const r of rows) {
    if (classOf(r) !== "paying") continue;
    mrr += r.monthly_cents;
    paying++;
    byProvider[r.provider] += r.monthly_cents;
    const key = r.plan_id ?? "";
    const entry = byPlan.get(key) ?? { plan_id: r.plan_id, name: r.plan_name ?? r.plan_id ?? "Sem plano", mrr_cents: 0 };
    entry.mrr_cents += r.monthly_cents;
    byPlan.set(key, entry);
  }
  return {
    mrr,
    paying,
    byProvider,
    byPlan: [...byPlan.values()].sort((a, b) => b.mrr_cents - a.mrr_cents),
  };
}

export function buildMonths(
  closes: MonthClose[],
  rowsByDate: Map<string, SnapshotRecord[]>,
): MetricsMonth[] {
  const out: MetricsMonth[] = [];
  let prev: { month: string; rows: SnapshotRecord[] } | null = null;
  for (const c of closes) {
    if (!c.close_date) {
      out.push({
        month: c.month, missing: true, close_date: null, closed: c.closed, source: null,
        mrr_cents: null, arr_cents: null, paying_count: null, by_provider: null, by_plan: null,
        movements_since: null, movements: null, churn: null,
      });
      continue;
    }
    const rows = rowsByDate.get(c.close_date) ?? [];
    const agg = aggregate(rows);
    const diff = prev ? diffCloses(prev.rows, rows) : null;
    out.push({
      month: c.month,
      missing: false,
      close_date: c.close_date,
      closed: c.closed,
      source: c.source,
      mrr_cents: agg.mrr,
      arr_cents: agg.mrr * 12,
      paying_count: agg.paying,
      by_provider: agg.byProvider,
      by_plan: agg.byPlan,
      movements_since: prev?.month ?? null,
      movements: diff?.movements ?? null,
      churn: diff?.churn ?? null,
    });
    prev = { month: c.month, rows };
  }
  return out;
}
