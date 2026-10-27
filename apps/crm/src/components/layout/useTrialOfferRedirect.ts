import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import { getEffectivePlanWithSource, getWorkspaceSubscription } from '@/services/billing';
import { isTrialOfferEligible } from '@/pages/configuracao/cobranca/plan-display';

/**
 * Paths where the owner must never be bounced to /comecar: the offer screen itself, the
 * onboarding/OAuth hand-offs that have to finish where they started, and billing settings.
 */
export const TRIAL_OFFER_EXEMPT_PREFIXES = [
  '/comecar',
  '/workspace-setup',
  '/oauth',
  '/conectar',
  '/configuracao',
];

export interface TrialOfferRedirectState {
  /** True only while one of the two billing queries is still loading. */
  pending: boolean;
  /** True when this owner should be sent to /comecar once. */
  redirect: boolean;
}

/**
 * Decides whether the signed-in owner of the ACTIVE workspace should land on /comecar.
 *
 * Fails open: a loading state never redirects (it only reports `pending`) and a failed query
 * resolves to no redirect, so a billing outage cannot trap anyone away from the app. The
 * queries share their keys with ComecarPage, TrialNudgeCard and CobrancaPage, so the cache is
 * shared. `getEffectivePlanWithSource` reads the active workspace only, so the
 * `trialOfferSeenAt` marker of another workspace the user owns never leaks in.
 */
export function useTrialOfferRedirect(pathname: string): TrialOfferRedirectState {
  const { role, workspaceRole } = useAuth();
  // Follow the ACTIVE workspace role, not the stale profile-level role.
  const isOwner = (workspaceRole ?? role) === 'owner';
  const exempt = TRIAL_OFFER_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const enabled = isOwner && !exempt;

  const plan = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: () => getEffectivePlanWithSource(),
    enabled,
  });
  const sub = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => getWorkspaceSubscription(),
    enabled,
  });

  if (!enabled) return { pending: false, redirect: false };
  if (plan.isError || sub.isError) return { pending: false, redirect: false };
  if (plan.isLoading || sub.isLoading) return { pending: true, redirect: false };
  if (plan.data === undefined || sub.data === undefined) return { pending: false, redirect: false };

  return {
    pending: false,
    redirect: isTrialOfferEligible(plan.data, sub.data) && plan.data.trialOfferSeenAt === null,
  };
}
