import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import {
  getEffectivePlanWithSource,
  getWorkspaceSubscription,
  listActivePlans,
  type EffectivePlan,
} from '@/services/billing';
import { captureEvent } from '@/lib/analytics';
import {
  ADD_CARD_PATH,
  formatTrialDate,
  formatTrialHour,
  isReverseTrialRunning,
  reverseTrialPhase,
} from '@/lib/reverseTrial';
import { isNativeApp } from '@/native/platform';
import { ReverseTrialEndDialog, formatCentavosBRL } from './ReverseTrialEndDialog';

const DAY_MS = 86_400_000;
const CARD_ADDED_DAYS = 3;

function readStorage(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(storage: () => Storage, key: string, value: string): void {
  try {
    storage().setItem(key, value);
  } catch {
    // Private mode or blocked storage: the banner still works, it just forgets.
  }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

/** Converted during the trial, first charge still ahead, card added in the last 3 days. */
function isRecentCardAdded(plan: EffectivePlan | undefined, now: Date): boolean {
  const rt = plan?.reverseTrial;
  if (!plan || !rt || plan.planSource === 'trial') return false;
  if (rt.outcome !== 'converted' || !rt.cardAddedAt || rt.firstPaidAt) return false;
  const at = Date.parse(rt.cardAddedAt);
  return !Number.isNaN(at) && now.getTime() - at < CARD_ADDED_DAYS * DAY_MS;
}

/**
 * Countdown banner of the reverse trial (spec Part 3), rendered inside GlobalBannerContainer,
 * which owns the fixed stack and --banner-height on every shell. Owner and admins only; only the
 * owner gets the "Adicionar cartão" button (checkout is owner-only). In the iOS app it shows the
 * date and days left with no button, price or link. Also hosts the end-of-trial prompt.
 */
export function ReverseTrialBanner() {
  const { t } = useTranslation('billing');
  const { role, workspaceRole, profile } = useAuth();
  const effectiveRole = workspaceRole ?? role;
  const isOwner = effectiveRole === 'owner';
  const canSee = isOwner || effectiveRole === 'admin';
  const native = isNativeApp();
  const workspaceKey = profile?.conta_id ?? 'unknown';
  const dismissKey = `reverse_trial_banner_dismissed_${workspaceKey}`;
  const viewedKey = `reverse_trial_banner_viewed_${workspaceKey}`;
  const endDialogKey = `reverse_trial_end_dialog_${workspaceKey}`;

  const now = new Date();
  const { data: plan } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled: canSee,
  });
  const running = isReverseTrialRunning(plan);
  const endsAt = plan?.reverseTrial?.endsAt ?? null;
  const { phase, daysLeft } =
    running && endsAt ? reverseTrialPhase(now, endsAt) : { phase: 'ended' as const, daysLeft: 0 };
  const cardAdded = !native && isRecentCardAdded(plan, now);

  const { data: subscription } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner && cardAdded,
  });
  const { data: plans } = useQuery({
    queryKey: ['billing', 'plans'],
    queryFn: listActivePlans,
    enabled: canSee && cardAdded,
  });

  const [dismissed, setDismissed] = useState(() => readStorage(session, dismissKey) !== null);
  const [endDialogOpen, setEndDialogOpen] = useState(false);

  const visiblePhase = running && phase !== 'ended' ? phase : null;
  const showCountdown =
    canSee && visiblePhase !== null && !(visiblePhase === 'normal' && dismissed);

  // At most once a day per workspace (São Paulo date of the first view).
  useEffect(() => {
    if (!showCountdown || !visiblePhase) return;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
      new Date(),
    );
    if (readStorage(local, viewedKey) === today) return;
    writeStorage(local, viewedKey, today);
    captureEvent('reverse_trial_banner_viewed', { days_left: daysLeft, phase: visiblePhase });
  }, [showCountdown, visiblePhase, daysLeft, viewedKey]);

  // End-of-trial prompt: owner, web only, last 3 days, once per session.
  const wantsEndDialog =
    isOwner && !native && (visiblePhase === 'ending' || visiblePhase === 'last_day');
  useEffect(() => {
    if (!wantsEndDialog) return;
    if (readStorage(session, endDialogKey) !== null) return;
    writeStorage(session, endDialogKey, '1');
    setEndDialogOpen(true);
  }, [wantsEndDialog, endDialogKey]);

  const endDialog =
    endsAt && plan?.planId ? (
      <ReverseTrialEndDialog
        open={endDialogOpen}
        onClose={() => setEndDialogOpen(false)}
        endsAt={endsAt}
        planId={plan.planId}
        daysLeft={daysLeft}
      />
    ) : null;

  if (!canSee) return null;

  if (cardAdded && plan) {
    const firstChargeAt = subscription?.current_period_end ?? plan.reverseTrial.endsAt;
    const paidPlan = plans?.find((p) => p.id === plan.planId);
    const cents =
      subscription?.provider === 'pagarme'
        ? null
        : subscription?.billingInterval === 'year'
          ? (paidPlan?.price_brl_annual ?? null)
          : (paidPlan?.price_brl ?? null);
    if (!firstChargeAt) return null;
    const date = formatTrialDate(firstChargeAt);
    return (
      <div role="status" className="banner-bar reverse-trial-banner reverse-trial-banner--success">
        <Check size={16} aria-hidden="true" className="reverse-trial-banner__icon" />
        <div className="banner-content reverse-trial-banner__text">
          <strong>{t('reverseTrial.banner.cardLead')}</strong>{' '}
          {cents
            ? t('reverseTrial.banner.cardText', { amount: formatCentavosBRL(cents), date })
            : t('reverseTrial.banner.cardTextNoAmount', { date })}
        </div>
        {isOwner && (
          <Link to="/configuracao/cobranca" className="reverse-trial-banner__link">
            {t('reverseTrial.banner.viewBilling')}
          </Link>
        )}
      </div>
    );
  }

  if (!showCountdown || !visiblePhase || !endsAt) return endDialog;

  const date = formatTrialDate(endsAt);
  const days = t('reverseTrial.days', { count: daysLeft });
  const hour = formatTrialHour(endsAt);
  let lead: string;
  let text: string;
  if (native) {
    lead = t('reverseTrial.banner.nativeLead', { date });
    text =
      visiblePhase === 'last_day'
        ? t('reverseTrial.banner.nativeLastDay', { hour })
        : t('reverseTrial.banner.nativeText', { days });
  } else if (visiblePhase === 'normal') {
    lead = t('reverseTrial.banner.normalLead', { days });
    text = t('reverseTrial.banner.normalText', { date });
  } else if (visiblePhase === 'ending') {
    lead = t('reverseTrial.banner.endingLead', { days, date });
    text = t('reverseTrial.banner.endingText');
  } else {
    lead = t('reverseTrial.banner.lastDayLead', { hour });
    text = t('reverseTrial.banner.lastDayText');
  }

  const tone = visiblePhase === 'normal' ? 'info' : 'warning';

  return (
    <>
      <div
        role="status"
        className={`banner-bar reverse-trial-banner reverse-trial-banner--${tone}`}
        data-phase={visiblePhase}
      >
        <div className="banner-content reverse-trial-banner__text">
          <strong>{lead}</strong> {text}
        </div>
        {isOwner && !native && (
          <Link
            to={ADD_CARD_PATH}
            className="reverse-trial-banner__cta"
            onClick={() => captureEvent('reverse_trial_add_card_clicked', { surface: 'banner' })}
          >
            {t('reverseTrial.addCard')}
          </Link>
        )}
        {visiblePhase === 'normal' && (
          <button
            type="button"
            className="banner-dismiss reverse-trial-banner__dismiss"
            aria-label={t('reverseTrial.banner.dismissAria')}
            onClick={() => {
              writeStorage(session, dismissKey, '1');
              setDismissed(true);
            }}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>
      {endDialog}
    </>
  );
}
