import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders, resolveAllowedOrigin } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";
import { isWorkspaceOwner } from "../_shared/workspace-role.ts";
import { stripePortalBlocked } from "../_shared/pagarme-logic.ts";

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
      .from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "No workspace" }, 400, headers);
    const workspaceId = profile.conta_id as string;

    // Owner is checked against workspace_members for THIS workspace, never
    // against profiles.role — the same check billing-checkout makes, and for
    // stronger reasons: the Billing Portal cancels plans and swaps the card on
    // file, so this is a WRITE surface. profiles.role is global and
    // switch_workspace rewrites conta_id/active_workspace_id without touching
    // it, so an agent in workspace B whose stale role still read 'owner' could
    // manage B's subscription. This client is service-role, so RLS does not
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

    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_customer_id, provider, status, switched_from_stripe_subscription_id")
      .eq("workspace_id", workspaceId).maybeSingle();
    if (!subRow?.stripe_customer_id) return json({ error: "No subscription" }, 400, headers);
    // Linha pagarme (in force ou com janela de switch viva) nao abre o portal: o "renovar"
    // de la desfaria o cancel_at_period_end na Stripe, o webhook resultante e negado
    // pos-flip e nada local perceberia ate o leg D (spec do switch).
    if (stripePortalBlocked(subRow)) {
      return json({ error: "Sua assinatura atual é gerenciada fora do portal Stripe." }, 409, headers);
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: `${resolveAllowedOrigin(req)}/configuracao/cobranca`,
    });

    return json({ url: portal.url }, 200, headers);
  } catch (err) {
    console.error("[billing-portal] error:", err);
    return json({ error: "Internal server error" }, 500, headers);
  }
});

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}
