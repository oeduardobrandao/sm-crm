// backfill-metrics: rebuilds month-end snapshot rows from Stripe + Pagar.me history (spec §3).
// Prod-only: prod and staging share one Stripe account, so the guard is enforced here, before
// any remote or database call.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { fetchAllRows } from "../_shared/paginate.ts";
import { pagarmeFetch } from "../_shared/pagarme.ts";
import { loadStripe } from "../_shared/stripe-loader.ts";
import { STRIPE_TIMEOUT_MS, stripeAmountFromSubscription } from "../_shared/stripe-amount.ts";
import { fetchInternalWorkspaceIdsOrThrow } from "../_shared/internal-workspaces.ts";
import { type SnapshotRow, writeSnapshot } from "../_shared/metrics-snapshot.ts";
import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import { withTimeout } from "./pricing.ts";
import {
  type BackfillLocal,
  type BackfillPlanRow,
  buildBackfill,
  type PagarmeSubLite,
  type StripeSubLite,
} from "./metrics-backfill-logic.ts";

export interface BackfillDeps {
  allowed: boolean;
  now: () => Date;
  loadLocal: () => Promise<BackfillLocal>;
  loadInternalIds: () => Promise<Set<string>>;
  listStripeSubs: () => Promise<StripeSubLite[]>;
  listPagarmeSubs: () => Promise<PagarmeSubLite[]>;
  write: (date: string, rows: SnapshotRow[]) => Promise<{ written: number; skipped: boolean }>;
}

export interface BackfillReport {
  months_written: number;
  months_kept_cron: number;
  rows_written: number;
  skipped: { stripe_unmapped: number; pagarme_unmapped: number; pagarme_divergent: number };
}

type Num = number | null | undefined;

export function toStripeSubLite(raw: unknown): StripeSubLite {
  const s = raw as {
    id: string;
    customer: string | { id?: string } | null;
    status: string;
    start_date?: Num;
    trial_start?: Num;
    trial_end?: Num;
    ended_at?: Num;
    items?: { data?: Array<{ price?: { id?: string } }> };
  };
  const amt = stripeAmountFromSubscription(raw, null);
  return {
    id: s.id,
    customer: typeof s.customer === "string" ? s.customer : s.customer?.id ?? "",
    status: s.status,
    start_date: s.start_date ?? null,
    trial_start: s.trial_start ?? null,
    trial_end: s.trial_end ?? null,
    ended_at: s.ended_at ?? null,
    price_id: s.items?.data?.[0]?.price?.id ?? null,
    amount_cents: amt.amount_cents,
    interval: amt.interval,
  };
}

export function toPagarmeSubLite(raw: unknown): PagarmeSubLite {
  const s = raw as {
    id: string;
    status: string;
    created_at?: string | null;
    start_at?: string | null;
    canceled_at?: string | null;
    interval?: string | null;
    items?: Array<{ pricing_scheme?: { price?: number | null } | null } | null> | null;
    metadata?: { workspace_id?: string | null; plan_id?: string | null } | null;
  };
  return {
    id: s.id,
    status: s.status,
    created_at: s.created_at ?? null,
    start_at: s.start_at ?? null,
    canceled_at: s.canceled_at ?? null,
    interval: s.interval ?? null,
    price_cents: s.items?.[0]?.pricing_scheme?.price ?? null,
    metadata_workspace_id: s.metadata?.workspace_id ?? null,
    metadata_plan_id: s.metadata?.plan_id ?? null,
  };
}

export async function handleBackfillMetrics(
  headers: Record<string, string>,
  deps: BackfillDeps,
): Promise<Response> {
  if (!deps.allowed) {
    return new Response(JSON.stringify({ error: "backfill_not_allowed" }), { status: 403, headers });
  }
  try {
    const [local, internalIds, stripe, pagarme] = await Promise.all([
      deps.loadLocal(),
      deps.loadInternalIds(),
      deps.listStripeSubs(),
      deps.listPagarmeSubs(),
    ]);
    const plan = buildBackfill({ stripe, pagarme, local, internalIds, todaySP: saoPauloDate(deps.now()) });
    const report: BackfillReport = { months_written: 0, months_kept_cron: 0, rows_written: 0, skipped: plan.skipped };
    for (const { date, rows } of plan.dates) {
      const res = await deps.write(date, rows);
      if (res.skipped) report.months_kept_cron++;
      else {
        report.months_written++;
        report.rows_written += res.written;
      }
    }
    return new Response(JSON.stringify(report), { status: 200, headers });
  } catch (err) {
    console.error("[platform-admin] backfill-metrics failed:", (err as Error).message);
    return new Response(JSON.stringify({ error: "backfill_failed" }), { status: 500, headers });
  }
}

// ─── Default (network) deps ────────────────────────────────────────────────

const STRIPE_MAX_PAGES = 100;
const PAGARME_PAGE_SIZE = 100;
const PAGARME_MAX_PAGES = 50;

type StripeSubsClient = {
  subscriptions: {
    list: (
      params: Record<string, unknown>,
      opts?: { timeout?: number },
    ) => Promise<{ data: unknown[]; has_more: boolean }>;
  };
};

async function listStripeSubscriptions(): Promise<StripeSubLite[]> {
  const client = await loadStripe();
  if (!client) throw new Error("stripe not configured");
  const stripe = client as unknown as StripeSubsClient;
  const out: StripeSubLite[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
    const res = await withTimeout(
      stripe.subscriptions.list(
        { status: "all", limit: 100, expand: ["data.discounts"], ...(startingAfter ? { starting_after: startingAfter } : {}) },
        { timeout: STRIPE_TIMEOUT_MS },
      ),
      STRIPE_TIMEOUT_MS,
      "stripe.subscriptions.list",
    );
    for (const raw of res.data) out.push(toStripeSubLite(raw));
    if (!res.has_more || !res.data.length) return out;
    startingAfter = (res.data[res.data.length - 1] as { id: string }).id;
  }
  // A partial list would write false churn into history: refuse instead.
  throw new Error("stripe subscriptions list exceeded the page cap");
}

async function listPagarmeSubscriptions(): Promise<PagarmeSubLite[]> {
  const out: PagarmeSubLite[] = [];
  for (let page = 1; page <= PAGARME_MAX_PAGES; page++) {
    const res = await pagarmeFetch<{ data?: unknown[] | null }>(
      "GET",
      `/subscriptions?page=${page}&size=${PAGARME_PAGE_SIZE}`,
    );
    const rows = res?.data ?? [];
    for (const raw of rows) out.push(toPagarmeSubLite(raw));
    if (rows.length < PAGARME_PAGE_SIZE) return out;
  }
  throw new Error("pagarme subscriptions list exceeded the page cap");
}

async function loadLocal(svc: SupabaseClient): Promise<BackfillLocal> {
  const subs = await fetchAllRows<{
    workspace_id: string;
    stripe_customer_id: string | null;
    pagarme_subscription_id: string | null;
  }>((from, to) =>
    svc
      .from("workspace_subscriptions")
      .select("workspace_id, stripe_customer_id, pagarme_subscription_id")
      .order("workspace_id", { ascending: true })
      .range(from, to),
  );
  const workspaces = await fetchAllRows<{ id: string }>((from, to) =>
    svc.from("workspaces").select("id").order("id", { ascending: true }).range(from, to),
  );
  const { data: plans, error } = await svc
    .from("plans")
    .select("id, name, stripe_price_id, stripe_price_id_annual, price_brl_annual");
  if (error) throw error;
  const customerToWorkspace = new Map<string, string>();
  const pagarmeSubToWorkspace = new Map<string, string>();
  for (const s of subs) {
    if (s.stripe_customer_id) customerToWorkspace.set(s.stripe_customer_id, s.workspace_id);
    if (s.pagarme_subscription_id) pagarmeSubToWorkspace.set(s.pagarme_subscription_id, s.workspace_id);
  }
  return {
    customerToWorkspace,
    pagarmeSubToWorkspace,
    workspaceIds: new Set(workspaces.map((w) => w.id)),
    plans: (plans ?? []) as BackfillPlanRow[],
  };
}

/** Lazy: nothing here runs until a dep is called, so the 403 guard precedes all I/O. */
export function defaultBackfillDeps(svc: SupabaseClient): BackfillDeps {
  return {
    allowed: Deno.env.get("METRICS_BACKFILL_ALLOWED") === "true",
    now: () => new Date(),
    loadLocal: () => loadLocal(svc),
    loadInternalIds: () => fetchInternalWorkspaceIdsOrThrow(svc),
    listStripeSubs: listStripeSubscriptions,
    listPagarmeSubs: listPagarmeSubscriptions,
    write: (date, rows) => writeSnapshot(svc, date, "backfill", rows),
  };
}
