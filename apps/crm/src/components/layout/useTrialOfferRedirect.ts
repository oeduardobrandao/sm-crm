import { useRef } from 'react';
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

  // Once the hook has settled in this mount it must never report `pending` again. In TanStack
  // v5 a query that errored with no data goes back to `status: 'pending'` on every refetch
  // (window focus, remount, a `['billing']` invalidation), and `pending` makes ProtectedRoute
  // swap the whole app for a skeleton, which would unmount the page and lose unsaved work.
  const settled = useRef(false);

  if (!enabled) return { pending: false, redirect: false };

  // `isFetched` is monotonic (a first fetch has finished), unlike `isLoading`/`isError`, which a
  // refetch resets for a query that has no data. A failure in either query ends the wait at once.
  const failed = plan.isError || sub.isError;
  if (!settled.current) {
    if (!failed && !(plan.isFetched && sub.isFetched)) {
      return { pending: true, redirect: false };
    }
    settled.current = true;
  }

  // Fail open: no data (a failed or refetching-after-failure query) never redirects. A later
  // successful refetch can still produce a redirect, never a skeleton.
  if (plan.data === undefined || sub.data === undefined) return { pending: false, redirect: false };

  return {
    pending: false,
    redirect: isTrialOfferEligible(plan.data, sub.data) && plan.data.trialOfferSeenAt === null,
  };
}
