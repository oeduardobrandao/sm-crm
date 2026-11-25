import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { getEffectivePlanWithSource } from '@/services/billing';
import { useWorkspaceUsage } from '@/hooks/useWorkspaceUsage';
import { captureEvent } from '@/lib/analytics';
import { ADD_CARD_PATH, formatTrialDate, hubPauseDate, isExReverseTrial } from '@/lib/reverseTrial';
import { isNativeApp } from '@/native/platform';
import { ReverseTrialEndedDialog } from './ReverseTrialEndedDialog';

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the dialog may show again on a later visit, which is harmless.
  }
}

/**
 * Downgrade state after a reverse trial (spec Part 5): a persistent banner for the owner and
 * admins, with the Hub pause date before the pause and "paused" after it, plus a one-time
 * dialog on the first visit. Text only inside the iOS app. Rendered inside
 * GlobalBannerContainer.
 */
export function ReverseTrialEndedBanner() {
  const { role, workspaceRole } = useAuth();
  const effectiveRole = workspaceRole ?? role;
  const canSee = effectiveRole === 'owner' || effectiveRole === 'admin';
  const { data: plan } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled: canSee,
  });
  const endedAt = plan?.reverseTrial?.endedAt ?? null;
  if (!canSee || !isExReverseTrial(plan) || !endedAt) return null;
  return <EndedState endedAt={endedAt} isOwner={effectiveRole === 'owner'} />;
}

function EndedState({ endedAt, isOwner }: { endedAt: string; isOwner: boolean }) {
  const { t } = useTranslation('billing');
  const { profile } = useAuth();
  const native = isNativeApp();
  const { usage } = useWorkspaceUsage();
  const dialogKey = `reverse_trial_ended_dialog_${profile?.conta_id ?? 'unknown'}_${endedAt}`;
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (readLocal(dialogKey) !== null) return;
    writeLocal(dialogKey, '1');
    setDialogOpen(true);
  }, [dialogKey]);

  const date = formatTrialDate(endedAt);
  const pauseAt = hubPauseDate(endedAt);
  const paused = Date.now() >= pauseAt.getTime();
  // Free creates no Hub links, so links only exist if they were created during the trial.
  // While usage is unknown the line stays, since hiding a real pause warning is worse.
  const hasHubLinks = usage?.hub_tokens !== 0;

  return (
    <>
      <div role="status" className="banner-bar reverse-trial-banner reverse-trial-banner--ended">
        <div className="banner-content reverse-trial-banner__text">
          {native ? (
            <>
              <strong>{t('reverseTrial.ended.nativeLead', { date })}</strong>{' '}
              {t('reverseTrial.ended.nativeText')}
            </>
          ) : (
            <>
              <strong>{t('reverseTrial.ended.bannerLead', { date })}</strong>
              {hasHubLinks && (
                <>
                  {' '}
                  {paused
                    ? t('reverseTrial.ended.bannerHubPaused')
                    : t('reverseTrial.ended.bannerHubPausing', {
                        date: formatTrialDate(pauseAt),
                      })}
                </>
              )}
            </>
          )}
        </div>
        {isOwner && !native && (
          <Link
            to={ADD_CARD_PATH}
            className="reverse-trial-banner__cta"
            onClick={() =>
              captureEvent('reverse_trial_add_card_clicked', { surface: 'ended_banner' })
            }
          >
            {t('reverseTrial.ended.recover')}
          </Link>
        )}
      </div>
      <ReverseTrialEndedDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        endedAt={endedAt}
        pauseAt={pauseAt}
        paused={paused}
        usage={usage}
        showActions={isOwner && !native}
      />
    </>
  );
}
