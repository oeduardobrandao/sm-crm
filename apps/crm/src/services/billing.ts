import { supabase } from '../lib/supabase';

export type BillingInterval = 'month' | 'year';

export interface BillingPlan {
  id: string;
  name: string;
  price_brl: number | null;
  price_brl_annual: number | null;
  seat_addon_brl: number | null;
  seat_addon_brl_annual: number | null;
  sort_order: number;
  max_clients: number | null;
  max_team_members: number | null;
  storage_quota_bytes: number | null;
  feature_hub_portal: boolean;
  feature_analytics_reports: boolean;
  feature_brand_customization: boolean;
}

export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
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
      'id, name, price_brl, price_brl_annual, seat_addon_brl, seat_addon_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingPlan[];
}

/** Per-seat cost (centavos) for `seats` seats at the given billing interval. */
export function computeSeatCost(
  plan: BillingPlan,
  interval: BillingInterval,
  seats: number,
): number {
  const seatAddonCentavos =
    interval === 'year' ? plan.seat_addon_brl_annual : plan.seat_addon_brl;
  return (seatAddonCentavos ?? 0) * seats;
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
    .select('status, plan_id, current_period_end, cancel_at_period_end')
    .eq('workspace_id', profile.conta_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as WorkspaceSubscription) ?? null;
}

/** Starts Stripe Checkout; returns the hosted URL to redirect to. */
export async function startCheckout(
  planId: string,
  interval: BillingInterval,
  promoCode?: string,
): Promise<string> {
  const body: Record<string, unknown> = { plan_id: planId, interval };
  if (promoCode) body.promo_code = promoCode;
  const res = await fetch(`${FUNCTIONS_BASE}/billing-checkout`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify(body),
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
