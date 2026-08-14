import { supabase } from '../lib/supabase';

export type BillingInterval = 'month' | 'year';

export interface BillingPlan {
  id: string;
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
  sort_order: number;
  max_clients: number | null;
  max_team_members: number | null;
  storage_quota_bytes: number | null;
  feature_hub_portal: boolean;
  feature_analytics_reports: boolean;
  feature_brand_customization: boolean;
  pagarme_12x_enabled: boolean;
  /** Per-installment price of the 12x annual, in centavos. Null = plan has no 12x configured. */
  pagarme_installment_cents: number | null;
}

export interface PublicPricingPlan {
  id: string;
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
  sort_order: number;
  max_clients: number | null;
  max_team_members: number | null;
  max_workflow_templates: number | null;
  max_instagram_accounts: number | null;
  max_hub_tokens: number | null;
  storage_quota_bytes: number | null;
  feature_analytics_reports: boolean;
  feature_post_scheduling: boolean;
  feature_leads: boolean;
  feature_financial: boolean;
  feature_contracts: boolean;
  feature_brand_customization: boolean;
  feature_mcp: boolean;
  pagarme_12x_enabled: boolean;
  /** Per-installment price of the 12x annual, in centavos. Null = plan has no 12x configured. */
  pagarme_installment_cents: number | null;
}

const INTERNAL_PLAN_IDS = new Set(['lifetime']);

export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  next_payment_attempt: string | null;
  /** 'stripe' | 'pagarme' | null — which provider currently owns the subscription. */
  provider: string | null;
  /** Pagar.me installment count (12 for the annual-upfront-in-12x plan); null for Stripe. */
  installments: number | null;
  /** 'month' | 'year' | null. Null = price não resolvido (legado); trate como "não anual". */
  billingInterval: string | null;
  /** True enquanto a linha carrega uma troca mensal→12x agendada (janela do switch). */
  switchScheduled: boolean;
  /**
   * True once the workspace has ever held a Stripe or Pagar.me subscription — the
   * trial eligibility flag. The raw stripe_subscription_id / pagarme_subscription_id
   * are deliberately dropped in the service and never reach component state.
   */
  hasEverSubscribed: boolean;
}

export type CheckoutSource = 'onboarding' | 'billing';

/**
 * Thrown by the Pagar.me service calls on a non-ok response. Carries the server's
 * `code` alongside the human-readable `error` message so callers can branch on
 * specific failure reasons (e.g. a declined card) without string-matching the message.
 */
export class BillingApiError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'BillingApiError';
    this.code = code;
  }
}

const FUNCTIONS_BASE = (import.meta.env.VITE_SUPABASE_URL as string) + '/functions/v1';

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

/** Active plans for the pricing display. plans RLS allows public SELECT. */
export async function listActivePlans(): Promise<BillingPlan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization, pagarme_12x_enabled, pagarme_installment_cents',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as BillingPlan[]).map((plan) => ({
    ...plan,
    pagarme_12x_enabled: Boolean(plan.pagarme_12x_enabled),
  }));
}

export async function listPublicPricingPlans(): Promise<PublicPricingPlan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, max_workflow_templates, max_instagram_accounts, max_hub_tokens, storage_quota_bytes, feature_analytics_reports, feature_post_scheduling, feature_leads, feature_financial, feature_contracts, feature_brand_customization, feature_mcp, pagarme_12x_enabled, pagarme_installment_cents',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PublicPricingPlan[])
    .filter((plan) => !INTERNAL_PLAN_IDS.has(plan.id))
    .map((plan) => ({ ...plan, pagarme_12x_enabled: Boolean(plan.pagarme_12x_enabled) }));
}

/**
 * The current workspace's effective plan id (`workspaces.plan_id`). This is the
 * source of truth for what plan the workspace is on — including admin/comp overrides
 * like Lifetime, which have no Stripe subscription. Owner can read their own
 * workspace row via the `ws_select_member` RLS policy. Returns null when unset
 * (resolves to the default plan elsewhere).
 */
export async function getEffectivePlanId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('conta_id')
    .eq('id', user.id)
    .single();
  if (!profile?.conta_id) return null;
  const { data, error } = await supabase
    .from('workspaces')
    .select('plan_id')
    .eq('id', profile.conta_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.plan_id as string | null) ?? null;
}

/** Current workspace's subscription row (owner-only via RLS), or null. */
export async function getWorkspaceSubscription(): Promise<WorkspaceSubscription | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('conta_id')
    .eq('id', user.id)
    .single();
  if (!profile?.conta_id) return null;
  const { data, error } = await supabase
    .from('workspace_subscriptions')
    .select(
      'status, plan_id, current_period_end, cancel_at_period_end, past_due_since, next_payment_attempt, provider, installments, billing_interval, stripe_subscription_id, pagarme_subscription_id, ever_subscribed_at, switched_from_stripe_subscription_id',
    )
    .eq('workspace_id', profile.conta_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const {
    stripe_subscription_id: stripeSubscriptionId,
    pagarme_subscription_id: pagarmeSubscriptionId,
    ever_subscribed_at: everSubscribedAt,
    billing_interval: billingInterval,
    switched_from_stripe_subscription_id: switchedFromStripeSubscriptionId,
    ...rest
  } = data as Record<string, unknown>;
  return {
    ...(rest as Omit<
      WorkspaceSubscription,
      'hasEverSubscribed' | 'provider' | 'installments' | 'billingInterval' | 'switchScheduled'
    >),
    provider: (rest.provider as string | null) ?? null,
    installments: (rest.installments as number | null) ?? null,
    billingInterval: (billingInterval as string | null) ?? null,
    switchScheduled: Boolean(switchedFromStripeSubscriptionId),
    hasEverSubscribed: Boolean(stripeSubscriptionId || pagarmeSubscriptionId || everSubscribedAt),
  };
}

/** Starts Stripe Checkout; returns the hosted URL to redirect to. */
export async function startCheckout(
  planId: string,
  interval: BillingInterval,
  source: CheckoutSource = 'billing',
): Promise<string> {
  const res = await fetch(`${FUNCTIONS_BASE}/billing-checkout`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ plan_id: planId, interval, source }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data.url as string;
}

/** Opens the Stripe Billing Portal; returns the hosted URL to redirect to. */
export async function openBillingPortal(): Promise<string> {
  const res = await fetch(`${FUNCTIONS_BASE}/billing-portal`, {
    method: 'POST',
    headers: await authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data.url as string;
}

export interface PagarmeBillingAddress {
  cep: string;
  line_1: string;
  city: string;
  state: string;
}

export interface PagarmeCheckoutPayload {
  plan_id: string;
  card_token: string;
  document: string;
  phone: { ddd: string; number: string };
  billing_address: PagarmeBillingAddress;
  source: CheckoutSource;
  /** Switch mensal Stripe → 12x: consentimento explícito (o backend exige o campo). */
  switch?: true;
}

export interface PagarmeCheckoutResult {
  status: 'trialing' | 'active';
  trial_ends_at: string | null;
  next_charge_at: string | null;
  installment_amount_cents: number;
  /** Presentes apenas na resposta de um switch. */
  switched?: boolean;
  first_charge_at?: string | null;
}

async function parseBillingApiError(res: Response): Promise<BillingApiError> {
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return new BillingApiError(
    (data?.error as string) ?? 'Erro ao processar o pagamento. Tente novamente.',
    data?.code as string | undefined,
  );
}

/** Starts a Pagar.me 12x checkout; the subscription and first charge are created synchronously. */
export async function startPagarmeCheckout(
  payload: PagarmeCheckoutPayload,
): Promise<PagarmeCheckoutResult> {
  const res = await fetch(`${FUNCTIONS_BASE}/pagarme-checkout`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ ...payload, interval: 'year', installments: 12 }),
  });
  if (!res.ok) throw await parseBillingApiError(res);
  return (await res.json()) as PagarmeCheckoutResult;
}

/** Cancels the workspace's active Pagar.me subscription. */
export async function cancelPagarmeSubscription(): Promise<{
  status: 'canceled' | 'reverted';
  access_until: string | null;
}> {
  const res = await fetch(`${FUNCTIONS_BASE}/pagarme-subscription`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ action: 'cancel' }),
  });
  if (!res.ok) throw await parseBillingApiError(res);
  return (await res.json()) as { status: 'canceled' | 'reverted'; access_until: string | null };
}

/** Swaps the card on file for the workspace's Pagar.me subscription. */
export async function updatePagarmeCard(
  cardToken: string,
  billingAddress: PagarmeBillingAddress,
): Promise<void> {
  const res = await fetch(`${FUNCTIONS_BASE}/pagarme-subscription`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({
      action: 'update_card',
      card_token: cardToken,
      billing_address: billingAddress,
    }),
  });
  if (!res.ok) throw await parseBillingApiError(res);
}
