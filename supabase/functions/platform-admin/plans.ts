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
      // Reverse-trial workspaces sit on the trial plan (Pro) without paying: count them apart
      // so the plan count keeps meaning "workspaces on this plan", not "trying it for free".
      const { count } = await svc
        .from("workspaces")
        .select("*", { count: "exact", head: true })
        .eq("plan_id", plan.id)
        .or("plan_source.is.null,plan_source.neq.trial");
      const { count: trialCount } = await svc
        .from("workspaces")
        .select("*", { count: "exact", head: true })
        .eq("plan_id", plan.id)
        .eq("plan_source", "trial");
      return { ...plan, workspace_count: count || 0, trial_workspace_count: trialCount || 0 };
    })
  );

  return new Response(JSON.stringify({ plans: enriched }), { status: 200, headers });
}
