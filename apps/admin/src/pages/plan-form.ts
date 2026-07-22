import { type Plan, RESOURCE_LIMIT_KEYS, FEATURE_FLAG_KEYS, RATE_LIMIT_KEYS } from '../lib/api';

export const DEFAULT_RESOURCES: Record<string, number> = {
  max_clients: 5,
  max_team_members: 3,
  max_instagram_accounts: 1,
  storage_quota_bytes: 524288000,
  max_leads: 100,
  max_hub_tokens: 3,
  max_workflow_templates: 5,
  max_active_workflows_per_client: 3,
  max_custom_properties_per_template: 5,
  max_posts_per_workflow: 20,
  max_workspaces_per_user: 1,
};

export const DEFAULT_FEATURES: Record<string, boolean> = Object.fromEntries(
  FEATURE_FLAG_KEYS.map((k) => [k, false]),
);

export const DEFAULT_RATES: Record<string, number> = {
  rate_instagram_syncs_per_day: 5,
  rate_ai_analyses_per_month: 10,
  rate_report_generations_per_month: 10,
};

export interface FormState {
  name: string;
  resources: Record<string, number | null>;
  features: Record<string, boolean>;
  rates: Record<string, number | null>;
  is_default: boolean;
  is_active: boolean;
  sort_order: number | null;
  // Prices held as raw reais strings while editing (converted to centavos on submit),
  // so the field doesn't reformat on every keystroke.
  price_brl_input: string;
  price_brl_annual_input: string;
  stripe_product_id: string;
  stripe_price_id: string;
  stripe_price_id_annual: string;
}

export function emptyFormState(): FormState {
  return {
    name: '',
    resources: { ...DEFAULT_RESOURCES },
    features: { ...DEFAULT_FEATURES },
    rates: { ...DEFAULT_RATES },
    is_default: false,
    is_active: true,
    sort_order: null,
    price_brl_input: '',
    price_brl_annual_input: '',
    stripe_product_id: '',
    stripe_price_id: '',
    stripe_price_id_annual: '',
  };
}

export function planToForm(plan: Plan): FormState {
  const resources: Record<string, number | null> = {};
  for (const k of RESOURCE_LIMIT_KEYS) resources[k] = plan[k] as number | null;
  const features: Record<string, boolean> = {};
  for (const k of FEATURE_FLAG_KEYS) features[k] = (plan[k] as boolean) ?? false;
  const rates: Record<string, number | null> = {};
  for (const k of RATE_LIMIT_KEYS) rates[k] = plan[k] as number | null;
  return {
    name: plan.name,
    resources,
    features,
    rates,
    is_default: plan.is_default,
    is_active: plan.is_active,
    sort_order: plan.sort_order ?? null,
    price_brl_input: centavosToReais(plan.price_brl),
    price_brl_annual_input: centavosToReais(plan.price_brl_annual),
    stripe_product_id: plan.stripe_product_id ?? '',
    stripe_price_id: plan.stripe_price_id ?? '',
    stripe_price_id_annual: plan.stripe_price_id_annual ?? '',
  };
}

export function formToPayload(form: FormState): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name,
    is_default: form.is_default,
    is_active: form.is_active,
    price_brl: reaisToCentavos(form.price_brl_input),
    price_brl_annual: reaisToCentavos(form.price_brl_annual_input),
    stripe_product_id: form.stripe_product_id || null,
    stripe_price_id: form.stripe_price_id || null,
    stripe_price_id_annual: form.stripe_price_id_annual || null,
    ...form.resources,
    ...form.features,
    ...form.rates,
  };
  // sort_order is NOT NULL in the DB; omit it when empty so create-plan falls back
  // to the column default (0) and update-plan leaves the existing order untouched.
  if (form.sort_order != null) payload.sort_order = form.sort_order;
  return payload;
}

// Prices are stored in the DB as integer centavos; the admin edits them as reais.
export function centavosToReais(c: number | null | undefined): string {
  if (c == null) return '';
  return (c / 100).toFixed(2);
}

export function reaisToCentavos(input: string): number | null {
  const t = input.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// Parse an integer input (e.g. sort_order) without ever yielding NaN: empty or
// invalid input -> null (so it can be omitted), valid numbers truncate to int.
export function parseIntInput(input: string): number | null {
  const t = input.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}
