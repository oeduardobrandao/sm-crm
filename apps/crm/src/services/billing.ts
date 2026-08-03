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
}

const INTERNAL_PLAN_IDS = new Set(['lifetime']);

export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  next_payment_attempt: string | null;
  /**
   * True once the workspace has ever held a Stripe subscription — the trial
   * eligibility flag. The raw stripe_subscription_id is deliberately dropped in
   * the service and never reaches component state.
   */
  hasEverSubscribed: boolean;
}

export type CheckoutSource = 'onboarding' | 'billing';

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
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingPlan[];
}

export async function listPublicPricingPlans(): Promise<PublicPricingPlan[]> {
  const { data, error } = await supabase
    .from('plans')
    .select(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, max_workflow_templates, max_instagram_accounts, max_hub_tokens, storage_quota_bytes, feature_analytics_reports, feature_post_scheduling, feature_leads, feature_financial, feature_contracts, feature_brand_customization, feature_mcp',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PublicPricingPlan[]).filter((plan) => !INTERNAL_PLAN_IDS.has(plan.id));
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
      'status, plan_id, current_period_end, cancel_at_period_end, past_due_since, next_payment_attempt, stripe_subscription_id',
    )
    .eq('workspace_id', profile.conta_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { stripe_subscription_id: subscriptionId, ...rest } = data as Record<string, unknown>;
  return {
    ...(rest as Omit<WorkspaceSubscription, 'hasEverSubscribed'>),
    hasEverSubscribed: Boolean(subscriptionId),
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
