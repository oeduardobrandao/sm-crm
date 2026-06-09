import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { stripe } from "../_shared/stripe.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_BASE_URL = Deno.env.get("OAUTH_REDIRECT_BASE") || "http://localhost:5173";

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

    const { data: subRow } = await svc
      .from("workspace_subscriptions")
      .select("stripe_customer_id").eq("workspace_id", profile.conta_id).maybeSingle();
    if (!subRow?.stripe_customer_id) return json({ error: "No subscription" }, 400, headers);

    const portal = await stripe.billingPortal.sessions.create({
      customer: subRow.stripe_customer_id,
      return_url: `${APP_BASE_URL}/configuracao/cobranca`,
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
