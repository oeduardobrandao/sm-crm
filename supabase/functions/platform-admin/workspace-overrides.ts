import { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Save/clear granular resource+feature overrides on top of a workspace's plan.
//
// Billing webhooks (writeWorkspacePlan for Stripe, grant_pagarme_plan for Pagar.me) write
// workspaces.plan_id directly and never create a workspace_plan_overrides row, so the row is
// created on demand here instead of requiring it to pre-exist.

export async function handleSetWorkspaceOverrides(
  svc: SupabaseClient,
  body: {
    workspace_id: string;
    resource_overrides?: Record<string, number>;
    feature_overrides?: Record<string, boolean>;
    notes?: string;
  },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id, resource_overrides, feature_overrides, notes } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: ws } = await svc
    .from("workspaces")
    .select("plan_id")
    .eq("id", workspace_id)
    .maybeSingle();

  if (!ws?.plan_id) {
    return new Response(
      JSON.stringify({ error: "Workspace has no plan assigned. Assign a plan first." }),
      { status: 400, headers },
    );
  }

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  if (!existing) {
    const { error } = await svc.from("workspace_plan_overrides").insert({
      workspace_id,
      resource_overrides: resource_overrides ?? null,
      feature_overrides: feature_overrides ?? null,
      notes: notes ?? null,
      updated_by: adminId,
    });
    if (error) throw error;
    return new Response(JSON.stringify({ message: "Overrides updated" }), { status: 200, headers });
  }

  const updatePayload: Record<string, unknown> = {
    updated_by: adminId,
    updated_at: new Date().toISOString(),
  };
  if (resource_overrides !== undefined) updatePayload.resource_overrides = resource_overrides;
  if (feature_overrides !== undefined) updatePayload.feature_overrides = feature_overrides;
  if (notes !== undefined) updatePayload.notes = notes;

  const { error } = await svc
    .from("workspace_plan_overrides")
    .update(updatePayload)
    .eq("workspace_id", workspace_id);

  if (error) throw error;

  return new Response(JSON.stringify({ message: "Overrides updated" }), { status: 200, headers });
}

export async function handleClearWorkspaceOverrides(
  svc: SupabaseClient,
  body: { workspace_id: string },
  adminId: string,
  headers: Record<string, string>,
) {
  const { workspace_id } = body;
  if (!workspace_id) {
    return new Response(JSON.stringify({ error: "workspace_id is required" }), { status: 400, headers });
  }

  const { data: existing } = await svc
    .from("workspace_plan_overrides")
    .select("id")
    .eq("workspace_id", workspace_id)
    .maybeSingle();

  // No row means no overrides are in effect — already cleared, nothing to do.
  if (!existing) {
    return new Response(JSON.stringify({ message: "Overrides cleared" }), { status: 200, headers });
  }

  const { error } = await svc
    .from("workspace_plan_overrides")
    .update({
      resource_overrides: null,
      feature_overrides: null,
      updated_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspace_id);

  if (error) throw error;

  return new Response(JSON.stringify({ message: "Overrides cleared" }), { status: 200, headers });
}
