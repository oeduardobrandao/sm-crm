import { SupabaseClient } from "npm:@supabase/supabase-js@2";
// Single source of truth for plan columns. Keeping a local copy here is what caused
// max_mcp_keys / feature_mcp to be silently dropped by the admin plan editor.
import { RESOURCE_COLUMNS, FEATURE_COLUMNS, RATE_COLUMNS } from "../_shared/entitlements.ts";

export async function handleCreatePlan(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { name, is_default, action: _, ...rest } = body;
  if (!name) {
    return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers });
  }

  if (is_default) {
    await svc.from("plans").update({ is_default: false }).eq("is_default", true);
  }

  const insert: Record<string, unknown> = { name, is_default: is_default || false };
  const allColumns = [...RESOURCE_COLUMNS, ...FEATURE_COLUMNS, ...RATE_COLUMNS];
  for (const col of allColumns) {
    if (rest[col] !== undefined) insert[col] = rest[col];
  }
  if (rest.price_brl !== undefined) insert.price_brl = rest.price_brl;
  if (rest.price_brl_annual !== undefined) insert.price_brl_annual = rest.price_brl_annual;
  if (rest.sort_order !== undefined) insert.sort_order = rest.sort_order;
  if (rest.is_active !== undefined) insert.is_active = rest.is_active;
  if (rest.stripe_product_id !== undefined) insert.stripe_product_id = rest.stripe_product_id;
  if (rest.stripe_price_id !== undefined) insert.stripe_price_id = rest.stripe_price_id;
  if (rest.stripe_price_id_annual !== undefined) insert.stripe_price_id_annual = rest.stripe_price_id_annual;

  const { data, error } = await svc
    .from("plans")
    .insert(insert)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ plan: data }), { status: 201, headers });
}

export async function handleUpdatePlan(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { plan_id, action: _, ...rest } = body;
  if (!plan_id) {
    return new Response(JSON.stringify({ error: "plan_id is required" }), { status: 400, headers });
  }

  if (rest.is_default) {
    await svc.from("plans").update({ is_default: false }).eq("is_default", true);
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const allowedScalar = [
    "name", "is_default", "price_brl", "price_brl_annual", "sort_order", "is_active",
    "stripe_product_id", "stripe_price_id", "stripe_price_id_annual",
  ];
  for (const key of allowedScalar) {
    if (rest[key] !== undefined) updatePayload[key] = rest[key];
  }

  const allColumns = [...RESOURCE_COLUMNS, ...FEATURE_COLUMNS, ...RATE_COLUMNS];
  for (const col of allColumns) {
    if (rest[col] !== undefined) updatePayload[col] = rest[col];
  }

  const { data, error } = await svc
    .from("plans")
    .update(updatePayload)
    .eq("id", plan_id)
    .select()
    .single();
  if (error) throw error;

  return new Response(JSON.stringify({ plan: data }), { status: 200, headers });
}
