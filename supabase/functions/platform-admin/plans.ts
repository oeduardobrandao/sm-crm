import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── Plans ─────────────────────────────────────────────────────

export async function handleListPlans(
  svc: SupabaseClient,
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
