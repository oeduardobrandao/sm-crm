import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import {
  getReverseTrialOffer,
  startReverseTrial,
  REVERSE_TRIAL_OFFER_KEY,
} from '@/services/billing';
import { captureEvent } from '@/lib/analytics';
import { TRIAL_OFFER_EXEMPT_PREFIXES } from './useTrialOfferRedirect';

export interface ReverseTrialStartState {
  /** True only before this mount has settled (offer loading or the start call in flight). */
  pending: boolean;
  /** End date of a trial this mount just started; drives the one-time welcome dialog. */
  welcomeEndsAt: string | null;
  dismissWelcome: () => void;
}

/**
 * Starts the reverse trial (14 days of Pro without a card) the first time an eligible owner
 * reaches the app. Spec Part 2, "Start paths".
 *
 * - Owner of the ACTIVE workspace only, never on the exempt paths (so a /comecar intent checkout
 *   runs first) and never while the owner still has to finish /workspace-setup (`disabled`).
 * - Runs inside the iOS app too: starting the trial is not a purchase.
 * - One attempt per mount. A refusal or an error ends quietly (fail open, no retry loop); the
 *   next visit tries again.
 * - Once settled it never reports `pending` again, same contract as `useTrialOfferRedirect`.
 */
export function useReverseTrialStart(
  pathname: string,
  opts?: { disabled?: boolean },
): ReverseTrialStartState {
  const { role, workspaceRole } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = (workspaceRole ?? role) === 'owner';
  const exempt = TRIAL_OFFER_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const enabled = isOwner && !exempt && !opts?.disabled;

  const offer = useQuery({
    queryKey: REVERSE_TRIAL_OFFER_KEY,
    queryFn: () => getReverseTrialOffer(),
    enabled,
  });

  const attempted = useRef(false);
  const settled = useRef(false);
  // Flips to true once the single start attempt has finished (any result), so a refusal that
  // changes nothing else still re-renders and ends `pending`.
  const [startDone, setStartDone] = useState(false);
  const [welcomeEndsAt, setWelcomeEndsAt] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const shouldStart = enabled && offer.data?.auto === true && !attempted.current;

  useEffect(() => {
    // `attempted` flips inside this effect, so re-running it (shouldStart turning false) must
    // not cancel the call in flight: completion is guarded by `mounted` instead.
    if (!shouldStart) return;
    attempted.current = true;
    startReverseTrial('signup')
      .then((result) => {
        if (!result.started) return;
        captureEvent('reverse_trial_started', { source: 'signup' });
        void queryClient.invalidateQueries({ queryKey: ['billing'] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-limits'] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-usage'] });
        if (mounted.current) setWelcomeEndsAt(result.endsAt);
      })
      .catch(() => {
        // Fail open: no redirect, no retry this mount.
      })
      .finally(() => {
        if (mounted.current) setStartDone(true);
      });
  }, [shouldStart, queryClient]);

  const dismissWelcome = useCallback(() => setWelcomeEndsAt(null), []);

  let pending = false;
  if (enabled && !settled.current) {
    const offerDone = offer.isFetched || offer.isError;
    if (!offerDone || (offer.data?.auto === true && !startDone)) {
      pending = true;
    } else {
      settled.current = true;
    }
  }

  return { pending, welcomeEndsAt, dismissWelcome };
}
