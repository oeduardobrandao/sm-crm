import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";
import { decideSeatItemUpdate } from "../_shared/billing-logic.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
    const extraSeats = Math.max(0, Math.trunc(Number(body.extra_seats)));
    if (!Number.isFinite(extraSeats)) {
      return json({ error: "Invalid extra_seats" }, 400, headers);
    }

    // Load the Stripe subscription mirror + the active tier (for base seats + seat price id).
    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_subscription_id, plan_id, status")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (!subRow?.stripe_subscription_id) {
      return json({ error: "Sem assinatura ativa" }, 400, headers);
    }

    const { data: plan } = await svc
      .from("plans")
      .select("max_team_members, stripe_price_id_seat, stripe_price_id_seat_annual")
      .eq("id", subRow.plan_id).single();
    const base = plan?.max_team_members as number | null;

    // Validate the decrease under the SAME advisory lock the seat-count trigger uses,
    // closing the TOCTOU vs a concurrent invite. occupied = members + pending invites.
    // If base IS NULL (unlimited tier) the floor check is vacuous (capacity is unlimited).
    const { data: occupiedRow, error: occErr } = await svc
      .rpc("seat_occupancy_locked", { ws_id: workspaceId });
    if (occErr) {
      console.error("[billing-seats] occupancy rpc error:", occErr);
      return json({ error: "Internal server error" }, 500, headers);
    }
    const occupied = Number(occupiedRow ?? 0);
    if (base !== null && base + extraSeats < occupied) {
      return json({ error: "Reduza usuários antes de remover assentos" }, 409, headers);
    }

    // Retrieve the live subscription to find the existing seat line item (if any).
    const sub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
    const seatPriceMonthly = plan?.stripe_price_id_seat ?? null;
    const seatPriceAnnual = plan?.stripe_price_id_seat_annual ?? null;
    const seatPriceIds = new Set(
      [seatPriceMonthly, seatPriceAnnual].filter((x): x is string => !!x),
    );
    let seatItemId: string | null = null;
    let seatPriceId: string | null = null;
    for (const it of sub.items?.data ?? []) {
      if (it.price?.id && seatPriceIds.has(it.price.id)) {
        seatItemId = it.id;
        seatPriceId = it.price.id;
        break;
      }
    }
    // Adding a seat needs an interval-matched seat price; pick by the tier item's interval.
    if (!seatPriceId) {
      const tierIsAnnual = (sub.items?.data ?? []).some(
        (it) => it.price?.recurring?.interval === "year",
      );
      seatPriceId = tierIsAnnual ? seatPriceAnnual : seatPriceMonthly;
    }
    if (extraSeats > 0 && !seatItemId && !seatPriceId) {
      return json({ error: "Seat price not configured for this interval" }, 400, headers);
    }

    const decision = decideSeatItemUpdate({ seatItemId, seatPriceId, extraSeats });

    // billing-seats does NOT write workspace_subscriptions.purchased_seats — the
    // resulting customer.subscription.updated webhook is the only writer.
    if (decision.kind !== "noop") {
      await stripe.subscriptions.update(subRow.stripe_subscription_id, {
        items: decision.items,
        proration_behavior: "create_prorations",
      });
    }

    return json({ ok: true, trialing: sub.status === "trialing" }, 200, headers);
  } catch (err) {
    console.error("[billing-seats] error:", err);
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
