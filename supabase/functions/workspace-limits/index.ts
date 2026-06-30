import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";
import { effectivePlanLimit } from "../_shared/entitlements-rpc.ts";
import { buildSeatsBlock } from "./seats-block.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

    const { data: profile } = await svc
      .from("profiles")
      .select("conta_id")
      .eq("id", user.id)
      .single();

    if (!profile?.conta_id) {
      return new Response(JSON.stringify({
        plan_name: null,
        limits: null,
        features: null,
      }), { status: 200, headers });
    }

    const workspaceId = profile.conta_id;

    const ent = await resolveEntitlements(svc, workspaceId);
    if (!ent) {
      return new Response(JSON.stringify({ plan_name: null, limits: null, features: null }),
        { status: 200, headers });
    }

    // Server-computed seats block (matches the invite gate: members + pending invites).
    // `included` is the plan's base max_team_members (not the override-merged limit);
    // `effective` comes from the additive RPC; `purchased` is the Stripe seat mirror.
    const { data: ws } = await svc
      .from("workspaces").select("plan_id").eq("id", workspaceId).single();
    let includedSeats: number | null = null;
    if (ws?.plan_id) {
      const { data: plan } = await svc
        .from("plans").select("max_team_members").eq("id", ws.plan_id).single();
      includedSeats = (plan?.max_team_members as number | null) ?? null;
    } else {
      const { data: plan } = await svc
        .from("plans").select("max_team_members").eq("is_default", true).maybeSingle();
      includedSeats = (plan?.max_team_members as number | null) ?? null;
    }

    const { data: sub } = await svc
      .from("workspace_subscriptions")
      .select("purchased_seats, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const purchasedSeats =
      sub && (sub.status === "active" || sub.status === "trialing")
        ? ((sub.purchased_seats as number | null) ?? 0)
        : 0;

    const effectiveSeats = await effectivePlanLimit(svc, workspaceId, "max_team_members");

    const [{ count: members }, { count: pending }] = await Promise.all([
      svc.from("workspace_members").select("*", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      svc.from("invites").select("*", { count: "exact", head: true })
        .eq("conta_id", workspaceId).eq("status", "pending"),
    ]);

    const seats = buildSeatsBlock({
      includedSeats,
      purchasedSeats,
      effectiveSeats,
      members: members ?? 0,
      pendingInvites: pending ?? 0,
    });

    return new Response(JSON.stringify({
      plan_name: ent.planName, limits: ent.limits, features: ent.features, seats,
    }), { status: 200, headers });
  } catch (err) {
    console.error("[workspace-limits] error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
