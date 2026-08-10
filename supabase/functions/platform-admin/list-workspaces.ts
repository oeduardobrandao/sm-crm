import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Admin workspaces list. One round trip: the admin_list_workspaces RPC
 * (migrations 20260730000008, 20260810000001-2, 20260811000005) does the
 * joins, counts, owner lookup (auth.users), the filtered-set total_members,
 * total_clients and total_with_overrides counts and reads subscription
 * amounts from the mirror columns. No Stripe calls here.
 */
export async function handleListWorkspaces(
  svc: SupabaseClient,
  body: { search?: string; plan_id?: string; offset?: number; limit?: number },
  headers: Record<string, string>,
) {
  const { search, plan_id, offset = 0, limit = 20 } = body;
  const { data, error } = await svc.rpc("admin_list_workspaces", {
    p_search: search ?? null,
    p_plan_id: plan_id ?? null,
    p_offset: offset,
    p_limit: limit,
  });
  if (error) throw error;
  const payload = (data ?? {}) as {
    workspaces?: unknown[];
    total?: number;
    total_members?: number;
    total_clients?: number;
    total_with_overrides?: number;
  };
  return new Response(
    JSON.stringify({
      workspaces: payload.workspaces ?? [],
      total: payload.total ?? 0,
      total_members: payload.total_members ?? 0,
      total_clients: payload.total_clients ?? 0,
      total_with_overrides: payload.total_with_overrides ?? 0,
    }),
    { status: 200, headers },
  );
}
