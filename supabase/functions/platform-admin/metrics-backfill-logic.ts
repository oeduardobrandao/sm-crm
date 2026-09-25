// Pure backfill of month-end snapshot rows from provider history (spec §3). No I/O.

import {
  closeInstant,
  lastDayOfMonth,
  monthRange,
  previousMonth,
  saoPauloDate,
} from "../_shared/sao-paulo-date.ts";
import { type PlanPriceRow, resolvePlanFromPriceId, toMonthlyCents } from "../_shared/billing-logic.ts";
import type { SnapshotRow } from "../_shared/metrics-snapshot.ts";

export interface StripeSubLite {
  id: string;
  customer: string;
  status: string;
  start_date: number | null; // unix seconds
  trial_start: number | null;
  trial_end: number | null;
  ended_at: number | null;
  price_id: string | null;
  amount_cents: number | null; // net of the coupon it carries today
  interval: string | null;
}

export interface PagarmeSubLite {
  id: string;
  status: string;
  created_at: string | null;
  start_at: string | null;
  canceled_at: string | null;
  interval: string | null;
  price_cents: number | null;
  metadata_workspace_id: string | null;
  metadata_plan_id: string | null;
}

export interface BackfillPlanRow extends PlanPriceRow {
  name: string;
  price_brl_annual: number | null;
}

export interface BackfillLocal {
  customerToWorkspace: Map<string, string>;
  pagarmeSubToWorkspace: Map<string, string>;
  workspaceIds: Set<string>;
  plans: BackfillPlanRow[];
}

export interface BackfillSkipped {
  stripe_unmapped: number;
  pagarme_unmapped: number;
  pagarme_divergent: number;
}

export interface BackfillPlan {
  dates: { date: string; rows: SnapshotRow[] }[];
  skipped: BackfillSkipped;
}

const ms = (sec: number | null) => (sec == null ? null : sec * 1000);
const iso = (s: string | null) => (s ? new Date(s).getTime() : null);

export function stripeStatusAt(s: StripeSubLite, t: Date): "active" | "trialing" | null {
  const now = t.getTime();
  const start = ms(s.start_date);
  if (start == null || start > now) return null;
  const ended = ms(s.ended_at);
  if (ended != null && ended <= now) return null;
  const ts = ms(s.trial_start);
  const te = ms(s.trial_end);
  if (ts != null && te != null && ts <= now && now < te) return "trialing";
  return "active";
}

export function pagarmeStatusAt(s: PagarmeSubLite, t: Date): "active" | "trialing" | null {
  const now = t.getTime();
  const created = iso(s.created_at) ?? iso(s.start_at);
  if (created == null || created > now) return null;
  const canceled = iso(s.canceled_at);
  if (canceled != null && canceled <= now) return null;
  const start = iso(s.start_at);
  if (start != null && start > now) return "trialing"; // Pagar.me "future" = our trial
  return "active";
}

export function mapPagarmeWorkspace(
  s: PagarmeSubLite,
  local: BackfillLocal,
): { workspace_id: string } | { skip: "unmapped" | "divergent" } {
  const mirrored = local.pagarmeSubToWorkspace.get(s.id);
  if (mirrored) {
    if (s.metadata_workspace_id && s.metadata_workspace_id !== mirrored) return { skip: "divergent" };
    return { workspace_id: mirrored };
  }
  if (s.metadata_workspace_id && local.workspaceIds.has(s.metadata_workspace_id)) {
    return { workspace_id: s.metadata_workspace_id };
  }
  return { skip: "unmapped" };
}

interface Candidate {
  id: string;
  workspace_id: string;
  provider: "stripe" | "pagarme";
  startMs: number;
  statusAt: (t: Date) => "active" | "trialing" | null;
  plan_id: string | null;
  plan_name: string | null;
  billing_interval: string | null;
  monthly_cents: number;
  /** A price was resolved (possibly 0, e.g. a 100% coupon). False -> `unpriced`. */
  priced: boolean;
}

export function buildBackfill(input: {
  stripe: StripeSubLite[];
  pagarme: PagarmeSubLite[];
  local: BackfillLocal;
  internalIds: Set<string>;
  todaySP: string;
}): BackfillPlan {
  const { local, internalIds } = input;
  const skipped: BackfillSkipped = { stripe_unmapped: 0, pagarme_unmapped: 0, pagarme_divergent: 0 };
  const planName = (id: string | null) => local.plans.find((p) => p.id === id)?.name ?? null;
  const candidates: Candidate[] = [];

  for (const s of input.stripe) {
    if (s.status === "incomplete" || s.status === "incomplete_expired") continue;
    const ws = local.customerToWorkspace.get(s.customer);
    if (!ws) {
      skipped.stripe_unmapped++;
      continue;
    }
    if (internalIds.has(ws) || s.start_date == null) continue;
    const resolved = s.price_id ? resolvePlanFromPriceId(s.price_id, local.plans) : null;
    const interval = s.interval ?? resolved?.interval ?? null;
    candidates.push({
      id: s.id,
      workspace_id: ws,
      provider: "stripe",
      startMs: s.start_date * 1000,
      statusAt: (t) => stripeStatusAt(s, t),
      plan_id: resolved?.plan_id ?? null,
      plan_name: planName(resolved?.plan_id ?? null),
      billing_interval: interval,
      monthly_cents: toMonthlyCents(interval, s.amount_cents) ?? 0,
      priced: s.amount_cents != null,
    });
  }

  for (const s of input.pagarme) {
    if (s.status === "failed") continue; // first charge failed; checkout compensates by cancel
    const mapped = mapPagarmeWorkspace(s, local);
    if ("skip" in mapped) {
      if (mapped.skip === "divergent") skipped.pagarme_divergent++;
      else skipped.pagarme_unmapped++;
      continue;
    }
    const startMs = iso(s.created_at) ?? iso(s.start_at);
    if (internalIds.has(mapped.workspace_id) || startMs == null) continue;
    const interval = s.interval === "month" ? "month" : "year";
    const catalog = local.plans.find((p) => p.id === s.metadata_plan_id)?.price_brl_annual ?? null;
    const price = s.price_cents ?? (interval === "year" ? catalog : null);
    candidates.push({
      id: s.id,
      workspace_id: mapped.workspace_id,
      provider: "pagarme",
      startMs,
      statusAt: (t) => pagarmeStatusAt(s, t),
      plan_id: s.metadata_plan_id,
      plan_name: planName(s.metadata_plan_id),
      billing_interval: interval,
      monthly_cents: toMonthlyCents(interval, price) ?? 0,
      priced: price != null,
    });
  }

  if (!candidates.length) return { dates: [], skipped };

  const firstMonth = saoPauloDate(new Date(Math.min(...candidates.map((c) => c.startMs)))).slice(0, 7);
  const lastClosed = previousMonth(input.todaySP.slice(0, 7));
  const byWorkspace = new Map<string, Candidate[]>();
  for (const c of candidates) byWorkspace.set(c.workspace_id, [...(byWorkspace.get(c.workspace_id) ?? []), c]);

  const dates = monthRange(firstMonth, lastClosed).map((month) => {
    const date = lastDayOfMonth(month);
    const t = closeInstant(date);
    const rows: SnapshotRow[] = [];
    for (const [ws, list] of [...byWorkspace.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const inForce = list
        .map((c) => ({ c, status: c.statusAt(t) }))
        .filter((x): x is { c: Candidate; status: "active" | "trialing" } => x.status != null);
      if (!inForce.length) continue;
      const hasStripe = inForce.some((x) => x.c.provider === "stripe");
      const pagarme = inForce.filter((x) => x.c.provider === "pagarme");
      const pool = pagarme.length ? pagarme : inForce;
      // Latest start wins inside the pool (Pagar.me-only or Stripe-only, never mixed — see
      // `pool` above); a startMs tie is broken by subscription id for a result that is the same
      // regardless of input/pagination order.
      const pick = [...pool].sort((a, b) =>
        b.c.startMs - a.c.startMs || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0)
      )[0];
      rows.push({
        workspace_id: ws,
        provider: pick.c.provider,
        plan_id: pick.c.plan_id,
        plan_name: pick.c.plan_name,
        status: pick.status,
        billing_interval: pick.c.billing_interval,
        monthly_cents: pick.c.monthly_cents,
        amount_source: pick.c.priced ? "backfill" : "unpriced",
        provider_switch: pagarme.length > 0 && hasStripe,
      });
    }
    return { date, rows };
  });

  return { dates, skipped };
}
