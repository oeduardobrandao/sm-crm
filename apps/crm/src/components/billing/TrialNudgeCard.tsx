import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Timer, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getEffectivePlanWithSource,
  getReverseTrialOffer,
  getWorkspaceSubscription,
  startReverseTrial,
  REVERSE_TRIAL_OFFER_KEY,
} from '@/services/billing';
import { captureEvent } from '@/lib/analytics';
import { isTrialOfferEligible } from '@/pages/configuracao/cobranca/plan-display';
import { isNativeApp } from '@/native/platform';

const DISMISS_DAYS = 7;

/**
 * True when the stored dismissal is still inside its window. A missing or
 * unparseable value counts as "never dismissed" — a corrupt entry should fail
 * toward showing the card, not toward hiding it forever.
 */
function isDismissalActive(raw: string | null): boolean {
  if (!raw) return false;
  const at = new Date(raw).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < DISMISS_DAYS * 86_400_000;
}

export function TrialNudgeCard() {
  const { t } = useTranslation('billing');
  const { role, workspaceRole, profile } = useAuth();
  // Follow the ACTIVE workspace role, not the stale profile-level role — a user
  // can be owner in one workspace and agent in another (see DashboardPage).
  const isOwner = (workspaceRole ?? role) === 'owner';
  // The trial offer is a purchase flow: never inside the iOS app (apps/mobile
  // DECISIONS.md D33). Hooks stay unconditional; the queries just never run.
  const native = isNativeApp();
  const storageKey = `trial_nudge_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const queryClient = useQueryClient();
  const [dismissed, setDismissed] = useState(() =>
    isDismissalActive(localStorage.getItem(storageKey)),
  );
  const [starting, setStarting] = useState(false);

  const { data: effectivePlan } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled: isOwner && !dismissed && !native,
  });
  const { data: subscription } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner && !dismissed && !native,
  });

  // Reverse trial (14 days of Pro without a card): with the kill switch on, this card is the
  // opt-in for existing Free workspaces and the server decides eligibility. A failed offer read
  // falls back to the card-first offer below.
  const offerQuery = useQuery({
    queryKey: REVERSE_TRIAL_OFFER_KEY,
    queryFn: () => getReverseTrialOffer(),
    enabled: isOwner && !dismissed && !native,
  });
  const offer = offerQuery.data;

  if (native || !isOwner || dismissed) return null;

  function handleDismiss() {
    localStorage.setItem(storageKey, new Date().toISOString());
    setDismissed(true);
  }

  if (offer === undefined && !offerQuery.isError) return null;
  if (offer?.enabled) {
    if (!offer.eligible) return null;
    const handleStartReverseTrial = async () => {
      setStarting(true);
      try {
        const result = await startReverseTrial('nudge');
        if (!result.started) {
          toast.error(t('reverseTrial.nudge.error'));
        } else {
          captureEvent('reverse_trial_started', { source: 'nudge' });
          toast.success(t('reverseTrial.welcome.title'));
        }
        void queryClient.invalidateQueries({ queryKey: ['billing'] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-limits'] });
        void queryClient.invalidateQueries({ queryKey: ['workspace-usage'] });
      } catch {
        toast.error(t('reverseTrial.nudge.error'));
      } finally {
        setStarting(false);
      }
    };
    return (
      <div className="card trial-nudge">
        <Timer size={22} aria-hidden="true" className="trial-nudge__icon" />
        <div className="trial-nudge__body">
          <p className="trial-nudge__title">{t('reverseTrial.nudge.title')}</p>
          <p className="trial-nudge__text">{t('reverseTrial.nudge.text')}</p>
        </div>
        <button
          type="button"
          className="btn-primary trial-nudge__cta"
          disabled={starting}
          onClick={() => void handleStartReverseTrial()}
        >
          {t('reverseTrial.nudge.cta')}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('trialNudge.dismissAria')}
          className="trial-nudge__close"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  // Wait for both answers before deciding: rendering on partial data would flash
  // the card at a paying customer.
  if (effectivePlan === undefined || subscription === undefined) return null;
  // Free (resolved: a brand-new workspace has plan_id = NULL), not a comped `manual` plan and
  // never trialed. Shared with /comecar so the two surfaces agree on who is offered the trial.
  if (!isTrialOfferEligible(effectivePlan, subscription)) return null;

  return (
    <div className="card trial-nudge">
      <Timer size={22} aria-hidden="true" className="trial-nudge__icon" />
      <div className="trial-nudge__body">
        <p className="trial-nudge__title">{t('trialNudge.title')}</p>
        <p className="trial-nudge__text">{t('trialNudge.text')}</p>
      </div>
      <Link
        to="/comecar"
        className="btn-primary trial-nudge__cta"
        onClick={() => captureEvent('trial_nudge_clicked')}
      >
        {t('trialNudge.cta')}
      </Link>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t('trialNudge.dismissAria')}
        className="trial-nudge__close"
      >
        <X size={16} />
      </button>
    </div>
  );
}
