import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
// Single source of truth for plan columns (includes max_mcp_keys / feature_mcp).
import { RESOURCE_COLUMNS, FEATURE_COLUMNS, RATE_COLUMNS } from "../_shared/entitlements.ts";
import { buildAmountColumns, fetchStripeAmount } from "../_shared/stripe-amount.ts";
import { loadStripe } from "../_shared/stripe-loader.ts";

type PlanRow = Record<string, unknown>;

export function extractLimits(plan: PlanRow): Record<string, number | null> {
  const limits: Record<string, number | null> = {};
  for (const col of [...RESOURCE_COLUMNS, ...RATE_COLUMNS]) {
    limits[col] = (plan[col] as number | null) ?? null;
  }
  return limits;
}

export function extractFeatures(plan: PlanRow): Record<string, boolean> {
  const features: Record<string, boolean> = {};
  for (const col of FEATURE_COLUMNS) {
    features[col] = (plan[col] as boolean) ?? false;
  }
  return features;
}

// ─── Workspaces ────────────────────────────────────────────────

export async function handleGetWorkspace(
  svc: SupabaseClient,
  body: { workspace_id: string },
  headers: Record<string, string>,
  opts: { readOnly?: boolean } = {},
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: ws, error } = await svc
    .from("workspaces")
    .select("id, name, logo_url, created_at, plan_id, plan_source")
    .eq("id", workspace_id)
    .single();
  if (error || !ws) {
    return new Response(JSON.stringify({ error: "Workspace not found" }), { status: 404, headers });
  }

  const { data: members } = await svc
    .from("workspace_members")
    .select("user_id, role, joined_at")
    .eq("workspace_id", workspace_id);

  const enrichedMembers = await Promise.all(
    (members || []).map(async (m) => {
      const { data: profile } = await svc
        .from("profiles")
        .select("nome, telefone, marketing_opt_in")
        .eq("id", m.user_id)
        .single();
      const { data: authUser } = await svc.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        name: profile?.nome || "Unknown",
        email: authUser?.user?.email || "Unknown",
        telefone: profile?.telefone || null,
        marketing_opt_in: profile?.marketing_opt_in ?? false,
        role: m.role,
        joined_at: m.joined_at,
      };
    })
  );

  const owner = enrichedMembers.find((m) => m.role === "owner") || null;

  const { count: clientCount } = await svc
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", workspace_id);

  const { count: integrationCount } = await svc
    .from("integracoes_status")
    .select("id", { count: "exact", head: true })
    .eq("conta_id", workspace_id);

  const { data: override } = await svc
    .from("workspace_plan_overrides")
    .select("resource_overrides, feature_overrides, notes")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  let plan = null;
  let resolvedLimits: Record<string, number | null> | null = null;
  let resolvedFeatures: Record<string, boolean> | null = null;

  if (ws.plan_id) {
    const { data: planData } = await svc.from("plans").select("*").eq("id", ws.plan_id).single();
    if (planData) {
      plan = planData;
      resolvedLimits = { ...extractLimits(planData), ...(override?.resource_overrides || {}) };
      resolvedFeatures = { ...extractFeatures(planData), ...(override?.feature_overrides || {}) };
    }
  } else {
    const { data: defaultPlan } = await svc.from("plans").select("*").eq("is_default", true).maybeSingle();
    if (defaultPlan) {
      plan = defaultPlan;
      resolvedLimits = extractLimits(defaultPlan);
      resolvedFeatures = extractFeatures(defaultPlan);
    }
  }

  const subscription = await buildSubscriptionDetail(svc, workspace_id, opts);

  return new Response(JSON.stringify({
    workspace: ws,
    owner,
    members: enrichedMembers,
    plan: plan ? { id: plan.id, name: plan.name } : null,
    override: override ? {
      resource_overrides: override.resource_overrides,
      feature_overrides: override.feature_overrides,
      notes: override.notes,
    } : null,
    resolved_limits: resolvedLimits,
    resolved_features: resolvedFeatures,
    subscription,
    usage: {
      client_count: clientCount || 0,
      member_count: enrichedMembers.length,
      integration_count: integrationCount || 0,
    },
  }), { status: 200, headers });
}

// ─── Stripe subscription detail (live amount, catalog fallback) ────────────────
// Amount/coupon helpers live in ../_shared/stripe-amount.ts (shared with the
// lifecycle founder notices).

export function stripeDashboardUrl(livemode: boolean, kind: string, id: string): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}${kind}/${id}`;
}

/**
 * Builds the Stripe-subscription view for one workspace. The local mirror
 * (workspace_subscriptions) always reflects the real Stripe status even when an
 * admin has manually comped the workspace's effective plan, so we surface it here.
 * The exact amount (incl. coupons/custom prices) comes live from Stripe; if Stripe
 * is unreachable or the key is unset we fall back to the plan's catalog price.
 *
 * `opts.readOnly` skips the live Stripe fetch (and its write-back to the mirror)
 * entirely -- callers that only hold a read scope (e.g. mcp-admin's `platform:read`)
 * must not trigger an outbound Stripe call or a DB write just by reading a workspace.
 */
export async function buildSubscriptionDetail(
  svc: SupabaseClient,
  workspaceId: string,
  opts: { readOnly?: boolean } = {},
) {
  const { data: row } = await svc
    .from("workspace_subscriptions")
    .select(
      "status, plan_id, billing_interval, current_period_end, cancel_at_period_end, failed_payment_count, stripe_customer_id, stripe_subscription_id, provider, pagarme_subscription_id, installments, amount_cents, gross_cents, currency, amount_interval, discount_label",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row) return null;

  let planName: string | null = null;
  if (row.plan_id) {
    const { data: plan } = await svc.from("plans").select("name").eq("id", row.plan_id).single();
    planName = plan?.name ?? null;
  }

  const provider: "stripe" | "pagarme" = row.provider === "pagarme" ? "pagarme" : "stripe";
  const info = {
    provider,
    status: row.status ?? null,
    plan_id: row.plan_id ?? null,
    plan_name: planName,
    billing_interval: row.billing_interval ?? null,
    current_period_end: row.current_period_end ?? null,
    cancel_at_period_end: row.cancel_at_period_end ?? false,
    failed_payment_count: row.failed_payment_count ?? 0,
    stripe_customer_id: row.stripe_customer_id ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    pagarme_subscription_id: row.pagarme_subscription_id ?? null,
    installments: (row.installments as number | null) ?? null,
    amount_cents: null as number | null,
    gross_cents: null as number | null,
    currency: null as string | null,
    interval: row.billing_interval ?? null,
    discount_label: null as string | null,
    amount_source: null as "stripe" | "pagarme" | "catalog" | null,
    stripe_dashboard_url: null as string | null,
  };

  // A Pagar.me-owned row reads ONLY the mirror (written synchronously at checkout). Never a
  // Stripe live-fetch (its stripe_subscription_id, if present, is a dead pre-switch leftover
  // whose price would clobber the mirror on write-back) and no dashboard URL in v1.
  if (provider === "pagarme") {
    if (row.amount_cents != null) {
      info.amount_cents = row.amount_cents as number;
      info.gross_cents = (row.gross_cents as number | null) ?? null;
      info.currency = (row.currency as string | null) ?? null;
      info.interval = (row.amount_interval as string | null) ?? row.billing_interval ?? null;
      info.discount_label = (row.discount_label as string | null) ?? null;
      info.amount_source = "pagarme";
      return info;
    }
    return applyCatalogFallback(svc, info, row.plan_id ?? null, row.billing_interval ?? null);
  }

  if (!opts.readOnly && row.stripe_subscription_id) {
    // A null client means no loader is registered for this function (e.g. mcp-admin, whose
    // read-only tools never want a live Stripe call) -- fall through to the catalog fallback
    // below without logging anything; that path is expected, not an error.
    const stripe = await loadStripe();
    if (stripe) {
      try {
        const amt = await fetchStripeAmount(stripe, row.stripe_subscription_id, row.billing_interval ?? null);
        info.amount_cents = amt.amount_cents;
        info.gross_cents = amt.gross_cents;
        info.currency = amt.currency;
        info.interval = amt.interval;
        info.discount_label = amt.discount_label;
        info.amount_source = "stripe";
        info.stripe_dashboard_url = stripeDashboardUrl(
          amt.livemode,
          "subscriptions",
          row.stripe_subscription_id,
        );
        // Opportunistic refresh: viewing a workspace updates its cached amount, so
        // the list/MRR pages keep reading a mirror that tracks live Stripe. CAS on provider:
        // if a concurrent Pagar.me bind took the row while the Stripe fetch was in flight,
        // zero rows match — skip and log rather than clobbering the fresh Pagar.me mirror.
        const { data: writtenBack, error: writeBackError } = await svc
          .from("workspace_subscriptions")
          .update(buildAmountColumns(amt))
          .eq("workspace_id", workspaceId)
          .eq("provider", "stripe")
          // Same-provider pin (see pricing.ts liveFetch): the id observed at read time must
          // still match, or a mid-fetch rebind would get the old subscription's amount.
          .eq("stripe_subscription_id", row.stripe_subscription_id)
          .select("workspace_id");
        if (writeBackError) {
          console.error("[platform-admin] amount write-back failed:", writeBackError.message);
        } else if (!writtenBack?.length) {
          console.warn(
            `[platform-admin] amount write-back skipped for workspace ${workspaceId}: provider changed mid-fetch`,
          );
        }
        return info;
      } catch (err) {
        console.error("[platform-admin] stripe fetch failed:", (err as Error).message);
      }
    }
  }

  return applyCatalogFallback(svc, info, row.plan_id ?? null, row.billing_interval ?? null);
}

/** Fills amount from the plan's list price when neither mirror nor live fetch produced one. */
export async function applyCatalogFallback<
  T extends {
    amount_cents: number | null;
    currency: string | null;
    amount_source: "stripe" | "pagarme" | "catalog" | null;
  },
>(
  svc: SupabaseClient,
  info: T,
  planId: string | null,
  billingInterval: string | null,
): Promise<T> {
  if (!planId) return info;
  const { data: plan } = await svc
    .from("plans")
    .select("price_brl, price_brl_annual")
    .eq("id", planId)
    .single();
  const cents = billingInterval === "year" ? plan?.price_brl_annual : plan?.price_brl;
  if (cents != null) {
    info.amount_cents = cents as number;
    info.currency = "brl";
    info.amount_source = "catalog";
  }
  return info;
}
