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
  /** Seats already priced into the tier (= max_team_members). NULL = unlimited base. */
  included_seats: number | null;
  /** Per-seat add-on price in centavos (monthly). NULL until the seat price is configured. */
  seat_addon_brl: number | null;
  /** Per-seat add-on price in centavos (annual ≈ 10× monthly). */
  seat_addon_brl_annual: number | null;
}

export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  /** Purchased EXTRA seats mirrored from Stripe (workspace_subscriptions.purchased_seats). NULL → 0. */
  seats: number;
}

/** Server-computed seat block from the workspace-limits edge function. */
export interface WorkspaceSeats {
  included: number | null;
  purchased: number;
  effective: number | null;
  used: number;
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
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization, included_seats:max_team_members, seat_addon_brl, seat_addon_brl_annual',
    )
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as BillingPlan[];
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
    .select('status, plan_id, current_period_end, cancel_at_period_end, purchased_seats')
    .eq('workspace_id', profile.conta_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    status: (data.status as string | null) ?? null,
    plan_id: (data.plan_id as string | null) ?? null,
    current_period_end: (data.current_period_end as string | null) ?? null,
    cancel_at_period_end: (data.cancel_at_period_end as boolean) ?? false,
    // purchased_seats counts EXTRA seats only; NULL (no row written yet) → 0.
    seats: (data.purchased_seats as number | null) ?? 0,
  };
}

/** Starts Stripe Checkout; returns the hosted URL to redirect to. */
export async function startCheckout(
  planId: string,
  interval: BillingInterval,
  promoCode?: string,
  extraSeats?: number,
): Promise<string> {
  const body: Record<string, unknown> = { plan_id: planId, interval };
  if (promoCode) body.promo_code = promoCode;
  // EXTRA seats beyond the tier-included base; omit when 0 to mirror promo_code.
  if (extraSeats != null && extraSeats > 0) body.extra_seats = extraSeats;
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

/**
 * Owner-only in-app seat change. Posts EXTRA seats (beyond the tier base) to
 * `billing-seats`, which performs the validated Stripe `subscriptions.update`
 * with proration. The webhook is the sole writer of `purchased_seats`; the UI
 * refetches `workspace-limits` after this resolves.
 */
export async function changeSeats(extraSeats: number): Promise<void> {
  const res = await fetch(`${FUNCTIONS_BASE}/billing-seats`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ extra_seats: extraSeats }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
}

/**
 * Server-computed seat block from `workspace-limits` (members + pending invites
 * counted server-side, matching the invite gate). Returns null when the response
 * carries no seats block (e.g. a free workspace with no seat plumbing). Reuse this
 * rather than a second round-trip; gate the caller with `enabled: isOwner`.
 */
export async function getWorkspaceSeats(): Promise<WorkspaceSeats | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');
  const res = await fetch(`${FUNCTIONS_BASE}/workspace-limits`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return (data.seats as WorkspaceSeats | undefined) ?? null;
}
