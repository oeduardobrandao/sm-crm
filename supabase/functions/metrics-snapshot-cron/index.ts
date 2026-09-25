import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import { chunk, fetchAllRowsKeyset } from "../_shared/paginate.ts";
import { setStripeLoader } from "../_shared/stripe-loader.ts";
import { fetchInternalWorkspaceIdsOrThrow } from "../_shared/internal-workspaces.ts";
import { type PricedSnapshotSource, writeSnapshot } from "../_shared/metrics-snapshot.ts";
import { type PlanMeta, priceSubscriptionRows } from "../platform-admin/pricing.ts";
import { createMetricsSnapshotHandler } from "./handler.ts";

// Same loader registration as platform-admin/index.ts, so unpriced rows get the same live
// Stripe fetch get-mrr does and the day's snapshot matches the MRR tile.
setStripeLoader(() => import("../_shared/stripe.ts").then((m) => m.stripe));

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ??
  (() => {
    throw new Error("CRON_SECRET is required");
  })();

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

interface SubRow {
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
  switched_from_stripe_subscription_id: string | null;
}

async function loadPricedRows(): Promise<PricedSnapshotSource[]> {
  // workspace_subscriptions' primary key is workspace_id alone, so it is the total order — but a
  // durable-history write can't tolerate offset (.range) pagination's races against concurrent
  // writers: a concurrent insert between pages can repeat a workspace_id (the RPC's unique
  // (workspace_id, snapshot_date) then aborts the whole day) and a concurrent removal from the
  // filtered set (e.g. status -> null) can skip one (a false absence written into durable
  // history). Keyset pagination re-anchors each page on the last workspace_id actually seen, so
  // neither race is possible.
  const rows = await fetchAllRowsKeyset<SubRow>(
    (after) => {
      let query = svc
        .from("workspace_subscriptions")
        .select(
          "workspace_id, provider, status, plan_id, billing_interval, stripe_subscription_id, amount_cents, currency, amount_interval, discount_label, switched_from_stripe_subscription_id",
        )
        .not("status", "is", null)
        .order("workspace_id", { ascending: true })
        .limit(1000);
      if (after != null) query = query.gt("workspace_id", after);
      return query;
    },
    (r) => r.workspace_id,
  );
  const planIds = [...new Set(rows.map((r) => r.plan_id).filter(Boolean))] as string[];
  const planById = new Map<string, PlanMeta>();
  for (const ids of chunk(planIds)) {
    const { data, error } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual")
      .in("id", ids);
    if (error) throw error;
    for (const p of data ?? []) {
      planById.set(p.id, { name: p.name, price_brl: p.price_brl ?? null, price_brl_annual: p.price_brl_annual ?? null });
    }
  }
  const priced = await priceSubscriptionRows(svc, rows, new Map(), planById);
  return priced.map((r) => ({
    workspace_id: r.workspace_id,
    provider: r.provider,
    status: r.status ?? null,
    plan_id: r.plan_id,
    plan_name: r.plan_name,
    interval: r.interval,
    amount_cents: r.amount_cents,
    amount_source: r.amount_source,
    switched_from_stripe_subscription_id: r.switched_from_stripe_subscription_id,
  }));
}

Deno.serve(
  createMetricsSnapshotHandler({
    cronSecret: CRON_SECRET,
    timingSafeEqual,
    now: () => new Date(),
    loadPricedRows,
    loadInternalIds: () => fetchInternalWorkspaceIdsOrThrow(svc),
    write: (date, rows) => writeSnapshot(svc, date, "cron", rows),
    reportFailure: (message) => reportCronFailure(svc, "metrics-snapshot-cron", { stack: message }),
  }),
);
