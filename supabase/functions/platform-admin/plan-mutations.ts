import { SupabaseClient } from "npm:@supabase/supabase-js@2";
// Single source of truth for plan columns. Keeping a local copy here is what caused
// max_mcp_keys / feature_mcp to be silently dropped by the admin plan editor.
import { RESOURCE_COLUMNS, FEATURE_COLUMNS, RATE_COLUMNS } from "../_shared/entitlements.ts";
// Same allowlist the pagarme-checkout function itself enforces (PAGARME_PAID_PLAN_IDS). Without
// mirroring it here, enabling pagarme_12x_enabled on any other plan id passes this validation
// and then every checkout for that plan 400s "Plano inválido." at the gateway.
import { PAGARME_PAID_PLAN_IDS } from "../_shared/billing-logic.ts";

// Enabling 12x on a plan advertises it publicly; a misconfigured plan (no Pagar.me
// annual plan id, or no positive annual price) 400s at checkout for every workspace
// on that plan. Reject the mutation instead of persisting a broken config. `planId` is the
// row's own id — always known directly from the request (update-plan's `plan_id`, or
// create-plan's own `id` when supplied) — so unlike planIdAnnual/priceBrlAnnual this never
// needs the merge-over-current-row read.
function validatePagarme12x(
  enabled: unknown,
  planIdAnnual: unknown,
  priceBrlAnnual: unknown,
  planId: unknown,
  installmentCents: unknown,
  priceBrl: unknown,
): string | null {
  if (!enabled) return null;
  const idOk = typeof planIdAnnual === "string" && planIdAnnual.trim() !== "";
  const priceOk = typeof priceBrlAnnual === "number" && priceBrlAnnual > 0;
  if (!idOk || !priceOk) {
    return "pagarme_12x_enabled requires pagarme_plan_id_annual and a positive price_brl_annual";
  }
  // The 12x carries its own per-installment price (ceiling-checked against the monthly
  // price so the financed installment can never exceed paying month-to-month).
  const installmentOk = typeof installmentCents === "number" && installmentCents > 0 &&
    typeof priceBrl === "number" && installmentCents < priceBrl;
  if (!installmentOk) {
    return "pagarme_12x_enabled requires 0 < pagarme_installment_cents < price_brl (mensal)";
  }
  if (
    typeof planId === "string" &&
    !(PAGARME_PAID_PLAN_IDS as readonly string[]).includes(planId)
  ) {
    return `pagarme_12x_enabled is only supported for plans: ${PAGARME_PAID_PLAN_IDS.join(", ")}`;
  }
  return null;
}

export async function handleCreatePlan(
  svc: SupabaseClient,
  body: Record<string, unknown>,
  headers: Record<string, string>,
) {
  const { name, is_default, action: _, ...rest } = body;
  if (!name) {
    return new Response(JSON.stringify({ error: "name is required" }), { status: 400, headers });
  }

  // A fresh row has no prior state to merge over: the payload alone determines
  // whether the resulting row would be enabled without a valid config.
  const createValidationError = validatePagarme12x(
    rest.pagarme_12x_enabled,
    rest.pagarme_plan_id_annual,
    rest.price_brl_annual,
    rest.id,
    rest.pagarme_installment_cents,
    rest.price_brl,
  );
  if (createValidationError) {
    return new Response(JSON.stringify({ error: createValidationError }), { status: 400, headers });
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
  if (rest.pagarme_12x_enabled !== undefined) insert.pagarme_12x_enabled = rest.pagarme_12x_enabled;
  if (rest.pagarme_plan_id_annual !== undefined) insert.pagarme_plan_id_annual = rest.pagarme_plan_id_annual;
  if (rest.pagarme_installment_cents !== undefined) insert.pagarme_installment_cents = rest.pagarme_installment_cents;

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

  // Explicitly disabling never needs validation. Otherwise, if the payload alone
  // doesn't fully determine the resulting enabled/id/price trio, read the current
  // row and merge the incoming fields over it before checking the invariant.
  const needsCurrentRead = rest.pagarme_12x_enabled === false
    ? false
    : rest.pagarme_12x_enabled === true
      ? rest.pagarme_plan_id_annual === undefined || rest.price_brl_annual === undefined ||
        rest.pagarme_installment_cents === undefined || rest.price_brl === undefined
      : rest.pagarme_plan_id_annual !== undefined || rest.price_brl_annual !== undefined ||
        rest.pagarme_installment_cents !== undefined || rest.price_brl !== undefined;

  let current: Record<string, unknown> | null = null;
  if (needsCurrentRead) {
    const { data: currentRow, error: readError } = await svc
      .from("plans")
      .select(
        "pagarme_12x_enabled, pagarme_plan_id_annual, price_brl_annual, pagarme_installment_cents, price_brl",
      )
      .eq("id", plan_id)
      .single();
    if (readError) throw readError;
    current = currentRow;
  }

  const effectiveEnabled = rest.pagarme_12x_enabled !== undefined
    ? rest.pagarme_12x_enabled
    : current?.pagarme_12x_enabled;
  const effectivePlanIdAnnual = rest.pagarme_plan_id_annual !== undefined
    ? rest.pagarme_plan_id_annual
    : current?.pagarme_plan_id_annual;
  const effectivePriceBrlAnnual = rest.price_brl_annual !== undefined
    ? rest.price_brl_annual
    : current?.price_brl_annual;
  const effectiveInstallmentCents = rest.pagarme_installment_cents !== undefined
    ? rest.pagarme_installment_cents
    : current?.pagarme_installment_cents;
  const effectivePriceBrl = rest.price_brl !== undefined
    ? rest.price_brl
    : current?.price_brl;

  const updateValidationError = validatePagarme12x(
    effectiveEnabled,
    effectivePlanIdAnnual,
    effectivePriceBrlAnnual,
    plan_id,
    effectiveInstallmentCents,
    effectivePriceBrl,
  );
  if (updateValidationError) {
    return new Response(JSON.stringify({ error: updateValidationError }), { status: 400, headers });
  }

  if (rest.is_default) {
    await svc.from("plans").update({ is_default: false }).eq("is_default", true);
  }

  const updatePayload: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const allowedScalar = [
    "name", "is_default", "price_brl", "price_brl_annual", "sort_order", "is_active",
    "stripe_product_id", "stripe_price_id", "stripe_price_id_annual",
    "pagarme_12x_enabled", "pagarme_plan_id_annual", "pagarme_installment_cents",
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
