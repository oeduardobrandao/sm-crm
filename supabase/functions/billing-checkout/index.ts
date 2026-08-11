import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders, resolveAllowedOrigin } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";
import {
  buildCheckoutIdempotencyKey,
  resolveCheckoutSource,
  resolveReturnPaths,
  resolveTrialDays,
} from "../_shared/trial.ts";
import { isWorkspaceOwner } from "../_shared/workspace-role.ts";
import { hasEverSubscribed } from "../_shared/billing-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PAID_PLANS = ["start", "pro", "max"];

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
      .from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "No workspace" }, 400, headers);
    const workspaceId = profile.conta_id as string;

    // Owner is checked against workspace_members for THIS workspace, never
    // against profiles.role. profiles.role is global and switch_workspace
    // rewrites conta_id/active_workspace_id without touching it, so a user who
    // owns workspace A and is an agent in workspace B kept role = 'owner' while
    // working inside B — enough to open a paid subscription charged to a
    // workspace they do not own. This client is service-role, so RLS does not
    // hide the membership row.
    const { data: membership } = await svc
      .from("workspace_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!isWorkspaceOwner(membership?.role as string | null | undefined)) {
      return json({ error: "Forbidden" }, 403, headers);
    }

    const body = await req.json().catch(() => ({}));
    const planId = String(body.plan_id || "");
    const interval = body.interval === "year" ? "year" : "month";
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
      .select(
        "stripe_customer_id, stripe_subscription_id, status, ever_subscribed_at, pagarme_subscription_id",
      )
      .eq("workspace_id", workspaceId).maybeSingle();

    // A workspace mid-subscription belongs in the billing portal, not a second
    // checkout. Without this, a stale tab could open a duplicate subscription
    // against the same customer.
    if (subRow?.status === "active" || subRow?.status === "trialing") {
      return json({ error: "Este workspace já tem uma assinatura ativa." }, 409, headers);
    }

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

    // Every workspace that has never subscribed gets the trial. No code, no gate.
    const trialDays = resolveTrialDays(hasEverSubscribed(subRow));
    const source = resolveCheckoutSource(body.source);
    const returnPaths = resolveReturnPaths(source);

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
      // Stripe's own promo box stays open for any real future coupon.
      allow_promotion_codes: true,
      // Always collect the card: a trial has to convert on day 30.
      payment_method_collection: "always",
      success_url: `${appBaseUrl}${returnPaths.success}`,
      cancel_url: `${appBaseUrl}${returnPaths.cancel}`,
    }, {
      // Two tabs racing inside the hour resolve to one session, not two. The
      // source is part of the key because it changes success_url/cancel_url:
      // reusing a key with different parameters is an idempotency_error at
      // Stripe, which would hard-block a user retrying the same plan from a
      // different surface within the hour.
      idempotencyKey: buildCheckoutIdempotencyKey(
        workspaceId,
        planId,
        interval,
        source,
        Date.now(),
      ),
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
    // abortSignal(10s) is load-bearing even though this now runs in the
    // background: it still consumes the isolate's wall clock, and an
    // unbounded call could stall a later invocation reusing the same warm
    // instance. The timeout forces a stall to surface as an ordinary
    // catchable rejection/error instead of an isolate kill.
    //
    // This write must run via EdgeRuntime.waitUntil and NEVER be awaited
    // before the response below. The Stripe checkout session already exists
    // at this point -- awaiting a slow/unavailable PostgREST insert here
    // would make a user wait (up to the 10s bound) for a checkout URL that
    // already exists and cannot be redirected to, risking an abandoned
    // session and a duplicate Stripe Checkout on retry. Do not "simplify"
    // this back into a plain await.
    const recordCheckoutAttempt = async () => {
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
    };

    // EdgeRuntime is a Supabase Edge Runtime global -- not declared in every
    // type environment, and not guaranteed present in every runtime this
    // module might load in (e.g. local tooling). Feature-detect via
    // globalThis (avoids referencing the bare undeclared identifier, which
    // `deno check` rejects with TS2304) and fall back to the previous
    // awaited form so the write still happens somewhere if the global is
    // ever absent, instead of silently vanishing. The check is deliberately
    // on the waitUntil METHOD, not just the EdgeRuntime object, because a
    // present-but-shapeless global would otherwise 500 a live checkout.
    const edgeRuntime = (
      globalThis as { EdgeRuntime?: { waitUntil: (promise: Promise<unknown>) => void } }
    ).EdgeRuntime;
    if (typeof edgeRuntime?.waitUntil === "function") {
      edgeRuntime.waitUntil(recordCheckoutAttempt());
    } else {
      await recordCheckoutAttempt();
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
