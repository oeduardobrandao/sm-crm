import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { revertPlanTarget } from "./revert-target.ts";
import { handleCreatePlan, handleUpdatePlan } from "./plan-mutations.ts";
// Single source of truth for plan columns (includes max_mcp_keys / feature_mcp).
import { RESOURCE_COLUMNS, FEATURE_COLUMNS, RATE_COLUMNS } from "../_shared/entitlements.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type PlanRow = Record<string, unknown>;

function extractLimits(plan: PlanRow): Record<string, number | null> {
  const limits: Record<string, number | null> = {};
  for (const col of [...RESOURCE_COLUMNS, ...RATE_COLUMNS]) {
    limits[col] = (plan[col] as number | null) ?? null;
  }
  return limits;
}

function extractFeatures(plan: PlanRow): Record<string, boolean> {
  const features: Record<string, boolean> = {};
  for (const col of FEATURE_COLUMNS) {
    features[col] = (plan[col] as boolean) ?? false;
  }
  return features;
}

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const token = authHeader.replace("Bearer ", "");
    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const { data: admin } = await svc
      .from("platform_admins")
      .select("id, email")
      .eq("user_id", user.id)
      .single();

    const body = await req.json();
    const { action } = body;

    if (action === "verify-admin") {
      return new Response(JSON.stringify({ is_admin: !!admin }), { status: 200, headers });
    }

    if (!admin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
    }

    switch (action) {
      case "list-workspaces":
        return await handleListWorkspaces(svc, body, headers);
      case "get-workspace":
        return await handleGetWorkspace(svc, body, headers);
      case "list-plans":
        return await handleListPlans(svc, headers);
      case "create-plan":
        return await handleCreatePlan(svc, body, headers);
      case "update-plan":
        return await handleUpdatePlan(svc, body, headers);
      case "delete-plan":
        return await handleDeletePlan(svc, body, headers);
      case "set-workspace-plan":
        return await handleSetWorkspacePlan(svc, body, admin.id, headers);
      case "unset-workspace-plan":
        return await handleUnsetWorkspacePlan(svc, body, admin.id, headers);
      case "set-workspace-overrides":
        return await handleSetWorkspaceOverrides(svc, body, admin.id, headers);
      case "clear-workspace-overrides":
        return await handleClearWorkspaceOverrides(svc, body, admin.id, headers);
      case "list-workspace-mcp-keys":
        return await handleListWorkspaceMcpKeys(svc, body, headers);
      case "revoke-mcp-key":
        return await handleRevokeMcpKey(svc, body, user.id, headers);
      case "revoke-all-mcp-keys":
        return await handleRevokeAllMcpKeys(svc, body, user.id, headers);
      case "list-workspace-oauth-grants":
        return await handleListWorkspaceOAuthGrants(svc, body, headers);
      case "revoke-oauth-grant":
        return await handleRevokeOAuthGrant(svc, body, user.id, headers);
      case "revoke-all-oauth-grants":
        return await handleRevokeAllOAuthGrants(svc, body, user.id, headers);
      case "list-admins":
        return await handleListAdmins(svc, headers);
      case "invite-admin":
        return await handleInviteAdmin(svc, body, admin.id, headers);
      case "remove-admin":
        return await handleRemoveAdmin(svc, body, admin.id, headers);
      case "list-banners":
        return await handleListBanners(svc, body, headers);
      case "create-banner":
        return await handleCreateBanner(svc, body, admin.id, headers);
      case "update-banner":
        return await handleUpdateBanner(svc, body, headers);
      case "delete-banner":
        return await handleDeleteBanner(svc, body, headers);
      case "list-kb-articles":
        return await handleListKbArticles(svc, body, headers);
      case "get-kb-article":
        return await handleGetKbArticle(svc, body, headers);
      case "create-kb-article":
        return await handleCreateKbArticle(svc, body, admin.id, headers);
      case "update-kb-article":
        return await handleUpdateKbArticle(svc, body, headers);
      case "delete-kb-article":
        return await handleDeleteKbArticle(svc, body, headers);
      case "list-kb-context-links":
        return await handleListKbContextLinks(svc, body, headers);
      case "upsert-kb-context-link":
        return await handleUpsertKbContextLink(svc, body, headers);
      case "delete-kb-context-link":
        return await handleDeleteKbContextLink(svc, body, headers);
      default:
        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    }
  } catch (err) {
    console.error("[platform-admin] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});

// ─── MCP keys (platform-level observe/revoke; token_hash never selected) ───
const MCP_KEY_COLS =
  "id, name, token_suffix, scopes, last_used_at, expires_at, revoked_at, created_at";

async function handleListWorkspaceMcpKeys(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string },
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data, error } = await svc
    .from("mcp_api_keys").select(MCP_KEY_COLS)
    .eq("conta_id", body.workspace_id).order("created_at", { ascending: false });
  if (error) throw error;
  return new Response(JSON.stringify({ keys: data ?? [] }), { status: 200, headers });
}

async function handleRevokeMcpKey(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string; key_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.key_id) {
    return new Response(JSON.stringify({ error: "workspace_id and key_id are required" }), { status: 400, headers });
  }
  const { error } = await svc.from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("id", body.key_id).eq("conta_id", body.workspace_id).is("revoked_at", null);
  if (error) throw error;
  return new Response(JSON.stringify({ message: "Key revoked" }), { status: 200, headers });
}

async function handleRevokeAllMcpKeys(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data, error } = await svc.from("mcp_api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("conta_id", body.workspace_id).is("revoked_at", null).select("id");
  if (error) throw error;
  return new Response(JSON.stringify({ message: "All keys revoked", count: (data ?? []).length }), { status: 200, headers });
}

// ─── MCP OAuth grants (Claude connections; platform-level observe/revoke) ───
async function handleListWorkspaceOAuthGrants(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string },
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data: grants, error } = await svc
    .from("mcp_oauth_grants")
    .select("id, client_id, scopes, created_at, revoked_at, user_id")
    .eq("conta_id", body.workspace_id).order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (grants ?? []) as Array<{ user_id: string; [k: string]: unknown }>;
  const userIds = [...new Set(rows.map((g) => g.user_id))];
  const { data: profs } = userIds.length
    ? await svc.from("profiles").select("id, nome").in("id", userIds)
    : { data: [] as Array<{ id: string; nome: string }> };
  const nameById = new Map((profs ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]));
  const out = rows.map((g) => ({
    id: g.id,
    client_id: g.client_id,
    scopes: g.scopes,
    created_at: g.created_at,
    revoked_at: g.revoked_at,
    connected_by: nameById.get(g.user_id) ?? null,
  }));
  return new Response(JSON.stringify({ grants: out }), { status: 200, headers });
}

async function handleRevokeOAuthGrant(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string; grant_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id || !body.grant_id) {
    return new Response(JSON.stringify({ error: "workspace_id and grant_id are required" }), { status: 400, headers });
  }
  const { error } = await svc.from("mcp_oauth_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("id", body.grant_id).eq("conta_id", body.workspace_id).is("revoked_at", null);
  if (error) throw error;
  return new Response(JSON.stringify({ message: "Connection revoked" }), { status: 200, headers });
}

async function handleRevokeAllOAuthGrants(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id?: string },
  revokerUserId: string,
  headers: Record<string, string>,
) {
  if (!body.workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }
  const { data, error } = await svc.from("mcp_oauth_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: revokerUserId })
    .eq("conta_id", body.workspace_id).is("revoked_at", null).select("id");
  if (error) throw error;
  return new Response(JSON.stringify({ message: "All connections revoked", count: (data ?? []).length }), { status: 200, headers });
}

// ─── Workspaces ────────────────────────────────────────────────

async function handleListWorkspaces(
  svc: ReturnType<typeof createClient>,
  body: { search?: string; plan_id?: string; offset?: number; limit?: number },
  headers: Record<string, string>,
) {
  const { search, plan_id, offset = 0, limit = 20 } = body;

  let query = svc
    .from("workspaces")
    .select("id, name, logo_url, created_at, plan_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (search) {
    query = query.ilike("name", `%${search}%`);
  }

  const { data: workspaces, count, error } = await query;
  if (error) throw error;

  const enriched = await Promise.all(
    (workspaces || []).map(async (ws) => {
      const { data: ownerMember } = await svc
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", ws.id)
        .eq("role", "owner")
        .limit(1)
        .maybeSingle();

      let owner = null;
      if (ownerMember) {
        const { data: ownerProfile } = await svc
          .from("profiles")
          .select("nome, id")
          .eq("id", ownerMember.user_id)
          .single();

        const { data: ownerUser } = await svc.auth.admin.getUserById(ownerMember.user_id);
        owner = {
          name: ownerProfile?.nome || "Unknown",
          email: ownerUser?.user?.email || "Unknown",
        };
      }

      const { count: memberCount } = await svc
        .from("workspace_members")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", ws.id);

      const { count: clientCount } = await svc
        .from("clientes")
        .select("id", { count: "exact", head: true })
        .eq("conta_id", ws.id);

      const { data: planOverride } = await svc
        .from("workspace_plan_overrides")
        .select("resource_overrides, feature_overrides")
        .eq("workspace_id", ws.id)
        .maybeSingle();

      let planName = null;
      let hasOverrides = !!(planOverride?.resource_overrides || planOverride?.feature_overrides);
      if (ws.plan_id) {
        const { data: plan } = await svc.from("plans").select("name").eq("id", ws.plan_id).single();
        planName = plan?.name || null;
      } else {
        const { data: defaultPlan } = await svc.from("plans").select("name").eq("is_default", true).maybeSingle();
        planName = defaultPlan?.name || null;
      }

      return {
        id: ws.id,
        name: ws.name,
        logo_url: ws.logo_url,
        created_at: ws.created_at,
        owner,
        member_count: memberCount || 0,
        client_count: clientCount || 0,
        plan_name: planName,
        has_overrides: hasOverrides,
      };
    })
  );

  // Attach each workspace's Stripe-subscription summary (status, plan, and amount).
  // The amount is fetched live from Stripe for paying rows only — so it reflects
  // coupons/discounts, bounded by the number of real subscriptions on the page —
  // with the plan's catalog price as a fallback. Rows with no subscription do no
  // Stripe work.
  const wsIds = enriched.map((w) => w.id);
  const subByWs = new Map<
    string,
    {
      status: string | null;
      plan_id: string | null;
      billing_interval: string | null;
      stripe_subscription_id: string | null;
    }
  >();
  const planById = new Map<
    string,
    { name: string; price_brl: number | null; price_brl_annual: number | null }
  >();
  if (wsIds.length) {
    const { data: subRows } = await svc
      .from("workspace_subscriptions")
      .select("workspace_id, status, plan_id, billing_interval, stripe_subscription_id")
      .in("workspace_id", wsIds);
    for (const s of subRows ?? []) {
      subByWs.set(s.workspace_id, {
        status: s.status ?? null,
        plan_id: s.plan_id ?? null,
        billing_interval: s.billing_interval ?? null,
        stripe_subscription_id: s.stripe_subscription_id ?? null,
      });
    }
    const { data: planRows } = await svc
      .from("plans")
      .select("id, name, price_brl, price_brl_annual");
    for (const p of planRows ?? []) {
      planById.set(p.id, {
        name: p.name,
        price_brl: p.price_brl ?? null,
        price_brl_annual: p.price_brl_annual ?? null,
      });
    }
  }

  // Load the Stripe client once if any row actually has a subscription to price.
  let stripeClient: StripeClient | null = null;
  if ([...subByWs.values()].some((s) => s.stripe_subscription_id)) {
    try {
      stripeClient = (await import("../_shared/stripe.ts")).stripe;
    } catch (err) {
      console.error("[platform-admin] stripe import failed:", (err as Error).message);
    }
  }

  const enrichedWithSubs = await Promise.all(
    enriched.map(async (w) => {
      const s = subByWs.get(w.id);
      if (!s) return { ...w, subscription: null };

      const planMeta = s.plan_id ? planById.get(s.plan_id) : undefined;
      let amount_cents: number | null = null;
      let currency: string | null = null;
      let interval: string | null = s.billing_interval;
      let discount_label: string | null = null;

      if (stripeClient && s.stripe_subscription_id) {
        try {
          const amt = await fetchStripeAmount(stripeClient, s.stripe_subscription_id, s.billing_interval);
          amount_cents = amt.amount_cents;
          currency = amt.currency;
          interval = amt.interval ?? s.billing_interval;
          discount_label = amt.discount_label;
        } catch (err) {
          console.error("[platform-admin] list stripe fetch failed:", (err as Error).message);
        }
      }
      if (amount_cents == null && planMeta) {
        const cents = s.billing_interval === "year" ? planMeta.price_brl_annual : planMeta.price_brl;
        if (cents != null) {
          amount_cents = cents;
          currency = "brl";
        }
      }

      return {
        ...w,
        subscription: {
          status: s.status,
          plan_name: planMeta?.name ?? null,
          billing_interval: s.billing_interval,
          amount_cents,
          currency,
          interval,
          discount_label,
        },
      };
    }),
  );

  let result = enrichedWithSubs;
  if (plan_id) {
    const { data: plan } = await svc.from("plans").select("name").eq("id", plan_id).single();
    if (plan) {
      result = enrichedWithSubs.filter((ws) => ws.plan_name === plan.name);
    }
  }

  return new Response(JSON.stringify({ workspaces: result, total: count }), { status: 200, headers });
}

async function handleGetWorkspace(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string },
  headers: Record<string, string>,
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
      const { data: profile } = await svc.from("profiles").select("nome").eq("id", m.user_id).single();
      const { data: authUser } = await svc.auth.admin.getUserById(m.user_id);
      return {
        user_id: m.user_id,
        name: profile?.nome || "Unknown",
        email: authUser?.user?.email || "Unknown",
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

  const subscription = await buildSubscriptionDetail(svc, workspace_id);

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

type CouponLike = {
  id: string;
  name?: string | null;
  percent_off?: number | null;
  amount_off?: number | null;
};

/** Reads the active coupon off a subscription (handles both `discounts[]` and legacy `discount`). */
function extractCoupon(sub: unknown): CouponLike | null {
  const s = sub as { discounts?: unknown; discount?: unknown };
  const d = Array.isArray(s.discounts) && s.discounts.length ? s.discounts[0] : s.discount;
  if (!d || typeof d === "string") return null;
  return (d as { coupon?: CouponLike }).coupon ?? null;
}

function stripeDashboardUrl(livemode: boolean, kind: string, id: string): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}${kind}/${id}`;
}

function trimPercent(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

type StripeClient = {
  subscriptions: { retrieve: (id: string, opts: { expand: string[] }) => Promise<unknown> };
};

type StripeAmount = {
  amount_cents: number;
  gross_cents: number | null;
  currency: string;
  interval: string | null;
  discount_label: string | null;
  livemode: boolean;
};

/**
 * Retrieves a subscription's current price from Stripe and applies any active coupon,
 * so the returned amount is what the customer actually pays. Shared by the detail
 * view and the list. `fallbackInterval` is the mirror's billing_interval, used when
 * the price object doesn't carry a recurring interval.
 */
async function fetchStripeAmount(
  stripe: StripeClient,
  subscriptionId: string,
  fallbackInterval: string | null,
): Promise<StripeAmount> {
  let sub: unknown;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price", "discounts"],
    });
  } catch (_e) {
    // Some API versions reject expanding `discounts`; retry with price only.
    sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
  }
  const s = sub as {
    livemode?: boolean;
    items?: {
      data?: Array<{
        quantity?: number;
        price?: { unit_amount?: number | null; currency?: string; recurring?: { interval?: string } };
      }>;
    };
  };
  const item = s.items?.data?.[0];
  const qty = item?.quantity ?? 1;
  const gross = (item?.price?.unit_amount ?? 0) * qty;
  const coupon = extractCoupon(sub);
  let net = gross;
  let discountLabel: string | null = null;
  if (coupon) {
    if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
      net = Math.round(gross * (1 - coupon.percent_off / 100));
      discountLabel = `${coupon.name ?? coupon.id} −${trimPercent(coupon.percent_off)}%`;
    } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
      net = Math.max(0, gross - coupon.amount_off);
      discountLabel = coupon.name ?? coupon.id;
    }
  }
  return {
    amount_cents: net,
    gross_cents: net !== gross ? gross : null,
    currency: item?.price?.currency ?? "brl",
    interval: item?.price?.recurring?.interval ?? fallbackInterval,
    discount_label: discountLabel,
    livemode: s.livemode ?? true,
  };
}

/**
 * Builds the Stripe-subscription view for one workspace. The local mirror
 * (workspace_subscriptions) always reflects the real Stripe status even when an
 * admin has manually comped the workspace's effective plan, so we surface it here.
 * The exact amount (incl. coupons/custom prices) comes live from Stripe; if Stripe
 * is unreachable or the key is unset we fall back to the plan's catalog price.
 */
async function buildSubscriptionDetail(
  svc: ReturnType<typeof createClient>,
  workspaceId: string,
) {
  const { data: row } = await svc
    .from("workspace_subscriptions")
    .select(
      "status, plan_id, billing_interval, current_period_end, cancel_at_period_end, failed_payment_count, stripe_customer_id, stripe_subscription_id",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row) return null;

  let planName: string | null = null;
  if (row.plan_id) {
    const { data: plan } = await svc.from("plans").select("name").eq("id", row.plan_id).single();
    planName = plan?.name ?? null;
  }

  const info = {
    status: row.status ?? null,
    plan_id: row.plan_id ?? null,
    plan_name: planName,
    billing_interval: row.billing_interval ?? null,
    current_period_end: row.current_period_end ?? null,
    cancel_at_period_end: row.cancel_at_period_end ?? false,
    failed_payment_count: row.failed_payment_count ?? 0,
    stripe_customer_id: row.stripe_customer_id ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    amount_cents: null as number | null,
    gross_cents: null as number | null,
    currency: null as string | null,
    interval: row.billing_interval ?? null,
    discount_label: null as string | null,
    amount_source: null as "stripe" | "catalog" | null,
    stripe_dashboard_url: null as string | null,
  };

  if (row.stripe_subscription_id) {
    try {
      const { stripe } = await import("../_shared/stripe.ts");
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
      return info;
    } catch (err) {
      console.error("[platform-admin] stripe fetch failed:", (err as Error).message);
    }
  }

  // Catalog fallback: list price from the plan row × billing interval.
  if (row.plan_id) {
    const { data: plan } = await svc
      .from("plans")
      .select("price_brl, price_brl_annual")
      .eq("id", row.plan_id)
      .single();
    const cents = row.billing_interval === "year" ? plan?.price_brl_annual : plan?.price_brl;
    if (cents != null) {
      info.amount_cents = cents as number;
      info.currency = "brl";
      info.amount_source = "catalog";
    }
  }
  return info;
}

// ─── Plans ─────────────────────────────────────────────────────

async function handleListPlans(
  svc: ReturnType<typeof createClient>,
  headers: Record<string, string>,
) {
  const { data: plans, error } = await svc
    .from("plans")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  const enriched = await Promise.all(
    (plans || []).map(async (plan) => {
      const { count } = await svc
        .from("workspaces")
        .select("*", { count: "exact", head: true })
        .eq("plan_id", plan.id);
      return { ...plan, workspace_count: count || 0 };
    })
  );

  return new Response(JSON.stringify({ plans: enriched }), { status: 200, headers });
}

async function handleDeletePlan(
  svc: ReturnType<typeof createClient>,
  body: { plan_id: string },
  headers: Record<string, string>,
) {
  const { plan_id } = body;
  if (!plan_id) {
    return new Response(JSON.stringify({ error: "plan_id is required" }), { status: 400, headers });
  }

  const { count } = await svc
    .from("workspace_plan_overrides")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan_id);

  const { count: directCount } = await svc
    .from("workspaces")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", plan_id);

  const totalUsage = (count ?? 0) + (directCount ?? 0);

  if (totalUsage > 0) {
    return new Response(JSON.stringify({
      error: `Cannot delete plan: ${totalUsage} workspace(s) are assigned to it`,
    }), { status: 400, headers });
  }

  const { error } = await svc.from("plans").delete().eq("id", plan_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Plan deleted" }), { status: 200, headers });
}

// ─── Workspace Plan Assignment ─────────────────────────────────

async function handleSetWorkspacePlan(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string; plan_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id, plan_id } = body;
  if (!workspace_id || !plan_id) {
    return new Response(JSON.stringify({ error: "workspace_id and plan_id are required" }), { status: 400, headers });
  }

  const { error: wErr } = await svc
    .from("workspaces")
    .update({ plan_id, plan_source: "manual" })
    .eq("id", workspace_id);
  if (wErr) throw wErr;

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (existing) {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .update({
        resource_overrides: null,
        feature_overrides: null,
        notes: null,
        updated_by: adminId,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspace_id);
    if (error) throw error;
  } else {
    const { error } = await svc
      .from("workspace_plan_overrides")
      .insert({ workspace_id, updated_by: adminId });
    if (error) throw error;
  }

  return new Response(JSON.stringify({ message: "Workspace plan updated" }), { status: 200, headers });
}

async function handleUnsetWorkspacePlan(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: sub } = await svc
    .from("workspace_subscriptions")
    .select("status, plan_id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  const { data: def } = await svc
    .from("plans")
    .select("id")
    .eq("is_default", true)
    .maybeSingle();

  const target = revertPlanTarget(
    sub as { status?: string; plan_id?: string } | null,
    (def?.id as string) ?? "free",
  );

  const { error: wErr } = await svc
    .from("workspaces")
    .update({ plan_id: target.plan_id, plan_source: target.plan_source })
    .eq("id", workspace_id);
  if (wErr) throw wErr;

  // clear any manual granular overrides left from the comp
  await svc
    .from("workspace_plan_overrides")
    .update({
      resource_overrides: null,
      feature_overrides: null,
      notes: null,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspace_id);

  return new Response(
    JSON.stringify({ message: "Comp removed", plan_source: target.plan_source }),
    { status: 200, headers },
  );
}

async function handleSetWorkspaceOverrides(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string; resource_overrides?: Record<string, number>; feature_overrides?: Record<string, boolean>; notes?: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id, resource_overrides, feature_overrides, notes } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!existing) {
    return new Response(JSON.stringify({ error: "Workspace has no plan assigned. Assign a plan first." }), { status: 400, headers });
  }

  const updatePayload: Record<string, unknown> = {
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };
  if (resource_overrides !== undefined) updatePayload.resource_overrides = resource_overrides;
  if (feature_overrides !== undefined) updatePayload.feature_overrides = feature_overrides;
  if (notes !== undefined) updatePayload.notes = notes;

  const { error } = await svc
    .from("workspace_plan_overrides")
    .update(updatePayload)
    .eq("workspace_id", workspace_id);

  if (error) throw error;

  return new Response(JSON.stringify({ message: "Overrides updated" }), { status: 200, headers });
}

async function handleClearWorkspaceOverrides(
  svc: ReturnType<typeof createClient>,
  body: { workspace_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!existing) {
    return new Response(JSON.stringify({ error: "Workspace has no plan assigned." }), { status: 400, headers });
  }

  const { error } = await svc
    .from("workspace_plan_overrides")
    .update({
      resource_overrides: null,
      feature_overrides: null,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspace_id);

  if (error) throw error;

  return new Response(JSON.stringify({ message: "Overrides cleared" }), { status: 200, headers });
}

// ─── Admins ────────────────────────────────────────────────────

async function handleListAdmins(
  svc: ReturnType<typeof createClient>,
  headers: Record<string, string>,
) {
  const { data: admins, error } = await svc
    .from("platform_admins")
    .select("id, user_id, email, invited_by, created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;

  const enriched = await Promise.all(
    (admins || []).map(async (a) => {
      let invited_by_email = null;
      if (a.invited_by) {
        const { data: inviter } = await svc
          .from("platform_admins")
          .select("email")
          .eq("id", a.invited_by)
          .single();
        invited_by_email = inviter?.email || null;
      }
      return { ...a, invited_by_email };
    })
  );

  return new Response(JSON.stringify({ admins: enriched }), { status: 200, headers });
}

async function handleInviteAdmin(
  svc: ReturnType<typeof createClient>,
  body: { email: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { email } = body;
  if (!email) {
    return new Response(JSON.stringify({ error: "email is required" }), { status: 400, headers });
  }

  const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const authUser = users?.users?.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );

  if (!authUser) {
    return new Response(JSON.stringify({
      error: "Usuário não encontrado. O usuário precisa criar uma conta primeiro.",
    }), { status: 404, headers });
  }

  const { data: existing } = await svc
    .from("platform_admins")
    .select("id")
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (existing) {
    return new Response(JSON.stringify({ error: "Usuário já é administrador." }), { status: 400, headers });
  }

  const { data, error } = await svc
    .from("platform_admins")
    .insert({ user_id: authUser.id, email: authUser.email!, invited_by: adminId })
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ admin: data }), { status: 201, headers });
}

async function handleRemoveAdmin(
  svc: ReturnType<typeof createClient>,
  body: { admin_id: string },
  callerAdminId: string,
  headers: Record<string, string>,
) {
  const { admin_id } = body;
  if (!admin_id) {
    return new Response(JSON.stringify({ error: "admin_id is required" }), { status: 400, headers });
  }

  if (admin_id === callerAdminId) {
    return new Response(JSON.stringify({ error: "Você não pode remover a si mesmo." }), { status: 400, headers });
  }

  const { error } = await svc.from("platform_admins").delete().eq("id", admin_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Admin removed" }), { status: 200, headers });
}

// ─── Banners ──────────────────────────────────────────────────

const BANNER_COLUMNS = [
  "type", "content", "link", "custom_color", "target_mode",
  "target_plan_ids", "target_workspace_ids", "dismissible",
  "starts_at", "ends_at", "status",
] as const;

async function handleListBanners(
  svc: ReturnType<typeof createClient>,
  body: { status?: string },
  headers: Record<string, string>,
) {
  let query = svc
    .from("global_banners")
    .select("*")
    .order("created_at", { ascending: false });

  if (body.status) {
    query = query.eq("status", body.status);
  }

  const { data: banners, error } = await query;
  if (error) throw error;

  const enriched = await Promise.all(
    (banners || []).map(async (b) => {
      const { count } = await svc
        .from("banner_dismissals")
        .select("id", { count: "exact", head: true })
        .eq("banner_id", b.id);
      return { ...b, dismissal_count: count || 0 };
    })
  );

  return new Response(JSON.stringify({ banners: enriched }), { status: 200, headers });
}

async function handleCreateBanner(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  adminId: string,
  headers: Record<string, string>,
) {
  const { action: _, ...rest } = body;

  if (!rest.type || !rest.content || !rest.target_mode) {
    return new Response(
      JSON.stringify({ error: "type, content, and target_mode are required" }),
      { status: 400, headers },
    );
  }

  const insert: Record<string, unknown> = { created_by: adminId };
  for (const col of BANNER_COLUMNS) {
    if (rest[col] !== undefined) insert[col] = rest[col];
  }

  const { data, error } = await svc
    .from("global_banners")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ banner: data }), { status: 201, headers });
}

async function handleUpdateBanner(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { action: _, banner_id, ...rest } = body;

  if (!banner_id) {
    return new Response(
      JSON.stringify({ error: "banner_id is required" }),
      { status: 400, headers },
    );
  }

  const update: Record<string, unknown> = {};
  for (const col of BANNER_COLUMNS) {
    if (rest[col] !== undefined) update[col] = rest[col];
  }

  if (Object.keys(update).length === 0) {
    return new Response(
      JSON.stringify({ error: "No fields to update" }),
      { status: 400, headers },
    );
  }

  const { data, error } = await svc
    .from("global_banners")
    .update(update)
    .eq("id", banner_id)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ banner: data }), { status: 200, headers });
}

async function handleDeleteBanner(
  svc: ReturnType<typeof createClient>,
  body: { banner_id?: string },
  headers: Record<string, string>,
) {
  const { banner_id } = body;

  if (!banner_id) {
    return new Response(
      JSON.stringify({ error: "banner_id is required" }),
      { status: 400, headers },
    );
  }

  const { data: banner } = await svc
    .from("global_banners")
    .select("status")
    .eq("id", banner_id)
    .single();

  if (banner && banner.status !== "draft") {
    return new Response(
      JSON.stringify({ error: "Only draft banners can be deleted" }),
      { status: 400, headers },
    );
  }

  const { error } = await svc
    .from("global_banners")
    .delete()
    .eq("id", banner_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Banner deleted" }), { status: 200, headers });
}

// ─── Knowledge Base ──────────────────────────────────────────

const KB_ARTICLE_COLUMNS = [
  "title", "slug", "excerpt", "content", "content_plain",
  "cover_image_url", "category", "tags", "status", "display_order",
] as const;

const RESERVED_SLUGS = ["novo", "editar"];

async function handleListKbArticles(
  svc: ReturnType<typeof createClient>,
  body: { category?: string; status?: string },
  headers: Record<string, string>,
) {
  let query = svc
    .from("kb_articles")
    .select("*")
    .order("display_order", { ascending: true });

  if (body.category) {
    query = query.eq("category", body.category);
  }
  if (body.status) {
    query = query.eq("status", body.status);
  }

  const { data: articles, error } = await query;
  if (error) throw error;

  return new Response(JSON.stringify({ articles: articles || [] }), { status: 200, headers });
}

async function handleGetKbArticle(
  svc: ReturnType<typeof createClient>,
  body: { article_id?: string },
  headers: Record<string, string>,
) {
  if (!body.article_id) {
    return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers });
  }
  const { data: article, error } = await svc
    .from("kb_articles")
    .select("*")
    .eq("id", body.article_id)
    .single();
  if (error) throw error;
  return new Response(JSON.stringify({ article }), { status: 200, headers });
}

async function handleCreateKbArticle(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  adminId: string,
  headers: Record<string, string>,
) {
  const { action: _, ...rest } = body;

  if (!rest.title || !rest.slug || !rest.category) {
    return new Response(
      JSON.stringify({ error: "title, slug, and category are required" }),
      { status: 400, headers },
    );
  }

  if (RESERVED_SLUGS.includes(rest.slug as string)) {
    return new Response(
      JSON.stringify({ error: `Slug "${rest.slug}" is reserved` }),
      { status: 400, headers },
    );
  }

  const insert: Record<string, unknown> = { author_id: adminId };
  for (const col of KB_ARTICLE_COLUMNS) {
    if (rest[col] !== undefined) insert[col] = rest[col];
  }

  const { data, error } = await svc
    .from("kb_articles")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ article: data }), { status: 201, headers });
}

async function handleUpdateKbArticle(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { action: _, article_id, ...rest } = body;

  if (!article_id) {
    return new Response(
      JSON.stringify({ error: "article_id is required" }),
      { status: 400, headers },
    );
  }

  if (rest.slug && RESERVED_SLUGS.includes(rest.slug as string)) {
    return new Response(
      JSON.stringify({ error: `Slug "${rest.slug}" is reserved` }),
      { status: 400, headers },
    );
  }

  const update: Record<string, unknown> = {};
  for (const col of KB_ARTICLE_COLUMNS) {
    if (rest[col] !== undefined) update[col] = rest[col];
  }

  if (Object.keys(update).length === 0) {
    return new Response(
      JSON.stringify({ error: "No fields to update" }),
      { status: 400, headers },
    );
  }

  const { data, error } = await svc
    .from("kb_articles")
    .update(update)
    .eq("id", article_id)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ article: data }), { status: 200, headers });
}

async function handleDeleteKbArticle(
  svc: ReturnType<typeof createClient>,
  body: { article_id?: string },
  headers: Record<string, string>,
) {
  const { article_id } = body;

  if (!article_id) {
    return new Response(
      JSON.stringify({ error: "article_id is required" }),
      { status: 400, headers },
    );
  }

  const { error } = await svc
    .from("kb_articles")
    .delete()
    .eq("id", article_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Article deleted" }), { status: 200, headers });
}

async function handleListKbContextLinks(
  svc: ReturnType<typeof createClient>,
  body: { article_id?: string },
  headers: Record<string, string>,
) {
  if (!body.article_id) {
    return new Response(JSON.stringify({ error: "article_id required" }), { status: 400, headers });
  }
  const { data: links, error } = await svc
    .from("kb_context_links")
    .select("*")
    .eq("article_id", body.article_id)
    .order("display_order");
  if (error) throw error;
  return new Response(JSON.stringify({ links: links || [] }), { status: 200, headers });
}

async function handleUpsertKbContextLink(
  svc: ReturnType<typeof createClient>,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { action: _, route_pattern, article_id, label, display_order } = body as {
    action: string;
    route_pattern?: string;
    article_id?: string;
    label?: string;
    display_order?: number;
  };

  if (!route_pattern || !article_id) {
    return new Response(
      JSON.stringify({ error: "route_pattern and article_id are required" }),
      { status: 400, headers },
    );
  }

  const { data: existing } = await svc
    .from("kb_context_links")
    .select("id")
    .eq("route_pattern", route_pattern)
    .eq("article_id", article_id)
    .maybeSingle();

  if (existing) {
    const update: Record<string, unknown> = {};
    if (label !== undefined) update.label = label;
    if (display_order !== undefined) update.display_order = display_order;

    if (Object.keys(update).length > 0) {
      await svc.from("kb_context_links").update(update).eq("id", existing.id);
    }

    return new Response(JSON.stringify({ link_id: existing.id }), { status: 200, headers });
  }

  const { data, error } = await svc
    .from("kb_context_links")
    .insert({
      route_pattern,
      article_id,
      label: label ?? null,
      display_order: display_order ?? 0,
    })
    .select("id")
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ link_id: data.id }), { status: 201, headers });
}

async function handleDeleteKbContextLink(
  svc: ReturnType<typeof createClient>,
  body: { link_id?: string },
  headers: Record<string, string>,
) {
  const { link_id } = body;

  if (!link_id) {
    return new Response(
      JSON.stringify({ error: "link_id is required" }),
      { status: 400, headers },
    );
  }

  const { error } = await svc
    .from("kb_context_links")
    .delete()
    .eq("id", link_id);
  if (error) throw error;

  return new Response(JSON.stringify({ message: "Context link deleted" }), { status: 200, headers });
}
