import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders, resolveAllowedOrigin } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";
import {
  buildLineItems,
  clampExtraSeats,
  validatePaidPlan,
} from "../_shared/billing-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Launch promo: typing this code at checkout gives first-time subscribers a free
// trial (one free month on monthly OR annual — a trial works uniformly across
// intervals, unlike a %-off coupon which would zero out a full annual invoice).
// The code is public (shown in the landing banner), so it's a constant, not a secret.
const LAUNCH_PROMO = { code: "BEMVINDO", trialDays: 30 };

Deno.serve(async (req: Request) => {
  const corsHeaders = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const headers = { "Content-Type": "application/json", ...corsHeaders };

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401, headers);
    const token = authHeader.replace("Bearer ", "");

    const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: authError } = await svc.auth.getUser(token);
    if (authError || !user) return json({ error: "Unauthorized" }, 401, headers);

    const { data: profile } = await svc
      .from("profiles").select("role, conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "No workspace" }, 400, headers);
    if (profile.role !== "owner") return json({ error: "Forbidden" }, 403, headers);
    const workspaceId = profile.conta_id as string;

    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id || "");
    const interval = body.interval === "year" ? "year" : "month";
    const promoCode = String(body.promo_code || "").trim().toUpperCase();
    const extraSeats = clampExtraSeats(body.extra_seats);

    const { data: plan } = await svc
      .from("plans")
      .select(
        "id, is_active, stripe_price_id, stripe_price_id_annual, stripe_price_id_seat, stripe_price_id_seat_annual",
      )
      .eq("id", planId).single();
    const priceId = interval === "year" ? plan?.stripe_price_id_annual : plan?.stripe_price_id;

    // DB-driven validation: the plan must exist, be active, and have an
    // interval-matched tier price. This replaces the old hardcoded PAID_PLANS
    // allowlist so the catalog is the single source of truth.
    if (!validatePaidPlan({ is_active: plan?.is_active, tierPriceId: priceId })) {
      return json({ error: "Plan price not configured" }, 400, headers);
    }

    const seatPriceId = (interval === "year"
      ? plan?.stripe_price_id_seat_annual
      : plan?.stripe_price_id_seat) ?? null;

    // Build line items up front so we can 400 BEFORE any Stripe call if a seat was
    // requested on an interval with no matching seat price (Stripe rejects mixed
    // intervals). priceId is guaranteed non-empty by validatePaidPlan above.
    const lineItemsResult = buildLineItems({
      tierPriceId: priceId as string,
      seatPriceId,
      extraSeats,
    });
    if (!lineItemsResult.ok) {
      return json({ error: lineItemsResult.error }, 400, headers);
    }
    const lineItems = lineItemsResult.lineItems;

    // find-or-create Stripe customer for this workspace
    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("workspace_id", workspaceId).maybeSingle();

    let customerId = subRow?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { workspace_id: workspaceId },
      });
      customerId = customer.id;
      await svc.from("workspace_subscriptions").upsert(
        { workspace_id: workspaceId, stripe_customer_id: customerId },
        { onConflict: "workspace_id" },
      );
    }

    // Launch promo → a free trial, but only for first-time subscribers. A wrong or
    // ineligible code fails loudly so the user can fix it before we redirect to Stripe.
    const isFirstTimeSubscriber = !subRow?.stripe_subscription_id;
    let trialDays: number | undefined;
    if (promoCode) {
      if (promoCode !== LAUNCH_PROMO.code) {
        return json({ error: "Código promocional inválido." }, 400, headers);
      }
      if (!isFirstTimeSubscriber) {
        return json(
          { error: "Este código é válido apenas para novos assinantes." },
          400,
          headers,
        );
      }
      trialDays = LAUNCH_PROMO.trialDays;
    }

    const appBaseUrl = resolveAllowedOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: workspaceId,
      line_items: lineItems,
      subscription_data: {
        // seats is AUDIT-ONLY: metadata is client-influenced and must NEVER be read
        // as an entitlement source. The webhook derives purchased seats from the
        // Stripe line-item quantity, never from this value.
        metadata: { workspace_id: workspaceId, plan_id: planId, seats: String(extraSeats) },
        ...(trialDays ? { trial_period_days: trialDays } : {}),
      },
      // Allow promotion codes; skip card collection when a 100%-off coupon leaves
      // nothing due. With a trial we collect the card upfront so billing succeeds
      // when the trial ends.
      allow_promotion_codes: true,
      payment_method_collection: trialDays ? "always" : "if_required",
      success_url: `${appBaseUrl}/configuracao/cobranca?status=success`,
      cancel_url: `${appBaseUrl}/configuracao/cobranca?status=cancelled`,
    });

    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return json({ url: session.url }, 200, headers);
  } catch (err) {
    console.error("[billing-checkout] error:", err);
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
