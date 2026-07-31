import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders, resolveAllowedOrigin } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAID_PLANS = ["start", "pro", "max"];

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
    if (!PAID_PLANS.includes(planId)) return json({ error: "Invalid plan" }, 400, headers);

    const { data: plan } = await svc
      .from("plans")
      .select("id, stripe_price_id, stripe_price_id_annual")
      .eq("id", planId).single();
    const priceId = interval === "year" ? plan?.stripe_price_id_annual : plan?.stripe_price_id;
    if (!priceId) return json({ error: "Plan price not configured" }, 400, headers);

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
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        metadata: { workspace_id: workspaceId, plan_id: planId },
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

    // Marketing signal for the checkout_abandoned trigger. Placed AFTER the
    // session exists so only a reachable checkout page is recorded.
    //
    // Log and swallow, never fail the checkout: the Stripe session is already
    // live at this point, so throwing would 500 a user who is one click from
    // paying and push them to start another session. Losing one marketing
    // trigger is by far the cheaper failure. stripe_session_id is UNIQUE, so a
    // retried request reusing a session is a no-op, not a duplicate.
    //
    // supabase-js resolves with { error } on a PostgREST failure rather than
    // throwing, so the error must be checked explicitly -- a bare try/catch
    // alone would silently drop RLS/constraint/FK failures with no log line.
    //
    // abortSignal(10s) is load-bearing, not redundant with the try/catch: an
    // unbounded await on a stalled PostgREST call can have its isolate killed
    // by the edge runtime before `return json({ url: session.url })` below
    // ever runs -- a kill bypasses catch entirely, so the user would lose a
    // live, payable Stripe checkout URL. The timeout forces a stall to
    // surface as an ordinary catchable rejection/error instead. This write
    // must never be able to block the checkout -- do not remove this bound.
    try {
      const { error } = await svc
        .from("checkout_attempts")
        .insert({
          workspace_id: workspaceId,
          stripe_session_id: session.id,
          plan_id: planId,
        })
        .abortSignal(AbortSignal.timeout(10_000));
      if (error) {
        console.error("[billing-checkout] checkout_attempts insert failed:", error.message);
      }
    } catch (e) {
      console.error(
        "[billing-checkout] checkout_attempts insert failed:",
        e instanceof Error ? e.message : String(e),
      );
    }

    return json({ url: session.url }, 200, headers);
  } catch (err) {
    console.error("[billing-checkout] error:", err);
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
