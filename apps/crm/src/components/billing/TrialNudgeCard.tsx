import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Timer, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanWithSource, getWorkspaceSubscription } from '@/services/billing';
import { captureEvent } from '@/lib/analytics';
import { isTrialOfferEligible } from '@/pages/configuracao/cobranca/plan-display';

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
  const storageKey = `trial_nudge_dismissed_${profile?.conta_id ?? 'unknown'}`;

  const [dismissed, setDismissed] = useState(() =>
    isDismissalActive(localStorage.getItem(storageKey)),
  );

  const { data: effectivePlan } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled: isOwner && !dismissed,
  });
  const { data: subscription } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner && !dismissed,
  });

  if (!isOwner || dismissed) return null;
  // Wait for both answers before deciding: rendering on partial data would flash
  // the card at a paying customer.
  if (effectivePlan === undefined || subscription === undefined) return null;
  // Free (resolved: a brand-new workspace has plan_id = NULL), not a comped `manual` plan and
  // never trialed. Shared with /comecar so the two surfaces agree on who is offered the trial.
  if (!isTrialOfferEligible(effectivePlan, subscription)) return null;

  function handleDismiss() {
    localStorage.setItem(storageKey, new Date().toISOString());
    setDismissed(true);
  }

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
