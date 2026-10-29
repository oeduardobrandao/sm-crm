import { useState, useRef, useEffect, useCallback, type ReactElement } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Calendar, AlertCircle, RefreshCw, X, Send, Loader2, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { sanitizeUrl } from '@/utils/security';
import type { WorkflowPost } from '../../../store';
import type { PostMedia } from '../../../store/posts';
import { getPostPublishState, PLATFORM_LABELS } from '../postLabels';
import { hasAutoPublishTarget } from '../platformTargets';
import { validatePostMedia } from '../instagramLimits';
import { getPublishErrorDisplay } from '../publishErrorCopy';
import type { Platform } from './PlatformSelector';
import { declarationBrandedFlag, TikTokPostingDeclaration } from './TikTokPostingDeclaration';
import {
  cancelInstagramSchedule,
  retryInstagramPublish,
  publishInstagramPostNow,
} from '../../../services/instagram';
import {
  cancelTikTokSchedule,
  publishTikTokPostNow,
  retryTikTokPublish,
} from '../../../services/tiktok';
import { scheduleApprovedPost, scheduleSuccessMessage } from '../scheduleApprovedPost';
import { useSuggestionMoveGuard } from '../hooks/useSuggestionMoveGuard';

// =============================================================================
// Platform-aware publishing button (Task C3, TikTok integration Phase C).
// `platform === 'instagram'` (the default when `post.platform` is unset) keeps every
// call site, copy string, and gating rule byte-identical to the pre-TikTok component —
// grep this file for `targetsInstagram`/`targetsTikTok`: every branch that changes
// behavior for tiktok/both is additive and reduces to the original expression when
// `platform === 'instagram'`. 'tiktok' routes to services/tiktok.ts exclusively; 'both'
// schedules/cancels via the TikTok service (server validates both platforms) and fires
// publish-now/retry against both services, surfacing each platform's outcome separately.
// =============================================================================

const TIKTOK_UNAUDITED_MESSAGE =
  'App TikTok em modo de teste: apenas publicação privada (SELF_ONLY) é permitida até a auditoria do TikTok';

type PlatformChipState = 'published' | 'pending' | 'failed';

function instagramChipState(post: WorkflowPost): PlatformChipState {
  if (post.instagram_media_id) return 'published';
  if (post.publish_error && !post.instagram_media_id) return 'failed';
  return 'pending';
}

function tiktokChipState(post: WorkflowPost): PlatformChipState {
  if (post.tiktok_publish_status === 'published') return 'published';
  if (post.tiktok_publish_status === 'failed') return 'failed';
  return 'pending';
}

const CHIP_STYLES: Record<PlatformChipState, { bg: string; color: string; icon: string }> = {
  published: { bg: 'rgba(62, 207, 142, 0.12)', color: '#3ecf8e', icon: '✓' },
  pending: { bg: 'rgba(245, 163, 66, 0.12)', color: '#f5a342', icon: '⏳' },
  failed: { bg: 'rgba(245, 90, 66, 0.12)', color: '#f55a42', icon: '✗' },
};

/** Copy key for the per-platform variants: anything that isn't tiktok/both reads as Instagram. */
function platformCopyKey(platform: Platform): 'both' | 'tiktok' | 'instagram' {
  if (platform === 'both') return 'both';
  if (platform === 'tiktok') return 'tiktok';
  return 'instagram';
}

function PlatformChip({
  label,
  state,
  pendingLabel,
}: {
  label: string;
  state: PlatformChipState;
  pendingLabel?: string;
}) {
  const { t } = useTranslation('postPanels');
  const style = CHIP_STYLES[state];
  const text =
    state === 'pending' && pendingLabel ? pendingLabel : t(`scheduleButton.chip.${state}`);
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ background: style.bg, color: style.color }}
    >
      {label} {style.icon} {text}
    </span>
  );
}

/** Per-platform status chips + "Ver no TikTok" link. Renders nothing for
 * `platform === 'instagram'` (or unset) — chips are additive, TikTok-surface-only UI. */
export function PlatformStatusRow({ post }: { post: WorkflowPost }) {
  const { t } = useTranslation('postPanels');
  const platform: Platform = post.platform ?? 'instagram';
  const targetsInstagram = platform === 'instagram' || platform === 'both';
  const targetsTikTok = platform === 'tiktok' || platform === 'both';
  if (!targetsTikTok) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {targetsInstagram && (
          <PlatformChip label={PLATFORM_LABELS.instagram} state={instagramChipState(post)} />
        )}
        <PlatformChip
          label={PLATFORM_LABELS.tiktok}
          state={tiktokChipState(post)}
          pendingLabel={
            post.tiktok_publish_status === 'processing'
              ? t('scheduleButton.chip.processing')
              : undefined
          }
        />
        {post.tiktok_post_url && (
          <a
            href={sanitizeUrl(post.tiktok_post_url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium"
            style={{ color: 'var(--primary-color)' }}
          >
            <ExternalLink className="h-3 w-3" /> {t('scheduleButton.viewOnTikTok')}
          </a>
        )}
      </div>
      {(post.tiktok_publish_status === 'initiated' ||
        post.tiktok_publish_status === 'processing') && (
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          {t('scheduleButton.tiktokProcessing')}
        </p>
      )}
    </>
  );
}

interface ScheduleButtonProps {
  post: WorkflowPost;
  /** Post media, used for a client-side preflight against Instagram's publishing
   * limits (size, format, aspect ratio, duration). Optional: when omitted, the
   * preflight is skipped entirely and the gate stays server-side only. */
  media?: PostMedia[];
  hasInstagramAccount: boolean;
  igAccountStatus?: { revoked: boolean; expired: boolean; canPublish: boolean } | null;
  /** TikTok analogue of `igAccountStatus`, derived from `tiktok_accounts.authorization_status`
   * (WorkflowDrawer's existing `ttAccount` query — no new query added). Ignored entirely when
   * `platform === 'instagram'`. */
  ttAccountStatus?: { revoked: boolean; expired: boolean } | null;
  /** The TikTok settings panel's readiness (`onReadinessChange`, spec A0), held by the parent
   * and threaded through here. Ignored when the post doesn't target TikTok. */
  tiktokSettingsComplete?: boolean;
  /** Overrides the button `title` shown while a tiktok/both post is gated on
   * `tiktokSettingsComplete === false`. Lets a mount with no TikTok settings UI (e.g. the
   * compact calendar panel) point the user elsewhere instead of the default
   * "Complete as configurações do TikTok", which implies a settings panel that isn't there. */
  tiktokIncompleteTooltip?: string;
  /** The first failing A0 rule's pt-BR sentence (the panel's readiness `reason`), shown in the
   * "Falta:" line and as the tooltip/title of the gated buttons. Takes precedence over
   * `tiktokIncompleteTooltip`. */
  tiktokIncompleteReason?: string;
  /** Fired when a schedule/publish-now/retry attempt's error message contains the exact
   * unaudited-mode 422 string, so the parent can flip `TikTokSettingsPanel`'s
   * `showTestModeBanner` prop. */
  onTikTokUnaudited?: () => void;
  onStatusChange: () => void;
  /** Use short action labels ("Agendar"/"Publicar") so the buttons fit side-by-side
   *  in narrow containers like the calendar Publicações panel. */
  compact?: boolean;
  /** feature_multiplatform: a legenda aparece sem conta do Instagram, então o botão
   *  explica por que não há "Agendar" em vez de sumir calado. */
  explainMissingInstagramAccount?: boolean;
  /** Awaited before any call to the publish edge functions: lets the editor flush a
   *  field write still in flight (ex.: colaboradores) so the server reads the new value. */
  beforeServerAction?: () => Promise<unknown>;
}

export type ScheduleButtonVisibility = 'hidden' | 'missing-ig-account-note' | 'shown';

/**
 * Scheduling / publishing state and commands for one post, shared by the desktop
 * `ScheduleButton` and the phone editor's bottom bar and "Antes de agendar" checklist
 * (one instance per mounted editor, so the two phone surfaces share loading state).
 * Nothing here renders: `visibility` says whether a surface should show at all.
 */
export function useScheduleActions({
  post,
  media,
  hasInstagramAccount,
  igAccountStatus,
  ttAccountStatus,
  tiktokSettingsComplete = false,
  tiktokIncompleteTooltip,
  tiktokIncompleteReason,
  onTikTokUnaudited,
  onStatusChange,
  explainMissingInstagramAccount = false,
  beforeServerAction,
}: Omit<ScheduleButtonProps, 'compact'>) {
  const { t } = useTranslation('postPanels');
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishPct, setPublishPct] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Scheduling and publishing-now move the post to agendado / postado: ask first when the
  // client's suggestion on it is still unreviewed. Its dialog renders with the publish-now one.
  const { confirmMove, dialog: moveGuardDialog } = useSuggestionMoveGuard();

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => stopProgressTimer, [stopProgressTimer]);

  const platform: Platform = post.platform ?? 'instagram';
  const targetsInstagram = platform === 'instagram' || platform === 'both';
  const targetsTikTok = platform === 'tiktok' || platform === 'both';

  // platform === 'instagram' (the default) reduces this to the original unconditional
  // `if (!hasInstagramAccount) return null;` guard. A TikTok-only post never required an
  // Instagram account and must render regardless.
  // Post só Geral: nada o publica (validateForScheduling também recusa no servidor).
  const visibility: ScheduleButtonVisibility = !hasAutoPublishTarget(post.platform)
    ? 'hidden'
    : targetsInstagram && !hasInstagramAccount
      ? explainMissingInstagramAccount && post.status === 'aprovado_cliente'
        ? 'missing-ig-account-note'
        : 'hidden'
      : 'shown';

  const igTokenBlocked =
    targetsInstagram && !!(igAccountStatus?.revoked || igAccountStatus?.expired);
  const missingPublishPermission =
    targetsInstagram && igAccountStatus ? !igAccountStatus.canPublish : false;
  const ttTokenBlocked = targetsTikTok && !!(ttAccountStatus?.revoked || ttAccountStatus?.expired);
  const accountBlocked = igTokenBlocked || ttTokenBlocked;
  const accountWarning = accountBlocked || missingPublishPermission;

  let warningMessage: string | null = null;
  if (targetsInstagram && igAccountStatus?.revoked) {
    warningMessage = t('scheduleButton.warning.igRevoked');
  } else if (targetsInstagram && igAccountStatus?.expired) {
    warningMessage = t('scheduleButton.warning.igExpired');
  } else if (targetsInstagram && missingPublishPermission) {
    warningMessage = t('scheduleButton.warning.missingPermission');
  } else if (targetsTikTok && ttAccountStatus?.revoked) {
    warningMessage = t('scheduleButton.warning.ttRevoked');
  } else if (targetsTikTok && ttAccountStatus?.expired) {
    warningMessage = t('scheduleButton.warning.ttExpired');
  }

  const tiktokReady = !targetsTikTok || tiktokSettingsComplete === true;
  // Spec A3: `undefined` (no settings saved yet) renders the branded declaration variant.
  const tiktokBranded = declarationBrandedFlag(post.tiktok_settings);
  // Spec B3: Instagram pink stays Instagram's; anything that sends to TikTok uses neutral ink.
  const publishColor =
    platform === 'instagram'
      ? { background: '#E1306C', color: 'white' }
      : { background: 'var(--text-main)', color: 'var(--bg-color)' };

  const flagUnauditedIfPresent = (message: string | undefined) => {
    if (targetsTikTok && message?.includes(TIKTOK_UNAUDITED_MESSAGE)) onTikTokUnaudited?.();
  };

  const handlePublishNow = async () => {
    if (!(await confirmMove(post.id!, 'postado'))) return;
    setPublishing(true);
    setPublishPct(0);
    setLoading(true);

    let pct = 0;
    timerRef.current = setInterval(() => {
      pct += (90 - pct) * 0.08;
      setPublishPct(Math.round(pct));
    }, 300);

    try {
      await beforeServerAction?.();
      if (platform === 'both') {
        let igError: string | undefined;
        let ttError: string | undefined;
        try {
          await publishInstagramPostNow(post.id!);
        } catch (e: any) {
          igError = e.message;
        }
        try {
          await publishTikTokPostNow(post.id!);
        } catch (e: any) {
          ttError = e.message;
          flagUnauditedIfPresent(ttError);
        }
        stopProgressTimer();
        setPublishPct(100);
        await new Promise((r) => setTimeout(r, 600));
        setConfirmOpen(false);

        if (!igError && !ttError) {
          toast.success(t('scheduleButton.toast.sentBoth'));
        } else if (igError && ttError) {
          toast.error(`Instagram: ${igError}; TikTok: ${ttError}`);
        } else if (igError) {
          toast.error(`Instagram: ${igError}`);
          // The TikTok half did go out: say so, or the user only sees the failure.
          toast.success(t('scheduleButton.toast.sentTikTok'));
        } else {
          toast.error(`TikTok: ${ttError}`);
        }
        onStatusChange();
      } else if (platform === 'tiktok') {
        await publishTikTokPostNow(post.id!);
        stopProgressTimer();
        setPublishPct(100);
        await new Promise((r) => setTimeout(r, 600));
        setConfirmOpen(false);
        // Spec A8: TikTok processes the upload asynchronously whether the response says
        // `postado` or still processing, so both get the same "may take a few minutes" notice.
        toast.success(t('scheduleButton.toast.sentTikTok'));
        onStatusChange();
      } else {
        const result = await publishInstagramPostNow(post.id!);
        stopProgressTimer();
        setPublishPct(100);
        await new Promise((r) => setTimeout(r, 600));
        setConfirmOpen(false);
        if (result.status === 'postado') {
          toast.success(t('scheduleButton.toast.publishedInstagram'));
        } else {
          toast.info(result.message ?? t('scheduleButton.toast.publishingSoon'));
        }
        onStatusChange();
      }
    } catch (err: any) {
      stopProgressTimer();
      setConfirmOpen(false);
      flagUnauditedIfPresent(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
      setPublishing(false);
      setPublishPct(0);
    }
  };

  const handleSchedule = async () => {
    if (!(await confirmMove(post.id!, 'agendado'))) return;
    setLoading(true);
    try {
      await beforeServerAction?.();
      // Mesma regra de plataforma que os avisos de agendamento automático usam
      // (pages/entregas/scheduleApprovedPost.ts) -- uma fonte só.
      await scheduleApprovedPost(post);
      toast.success(scheduleSuccessMessage(platform));
      onStatusChange();
    } catch (err: any) {
      flagUnauditedIfPresent(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    try {
      await beforeServerAction?.();
      if (targetsTikTok) {
        await cancelTikTokSchedule(post.id!);
      } else {
        await cancelInstagramSchedule(post.id!);
      }
      toast.success(t('scheduleButton.toast.scheduleCanceled'));
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // "Failed side(s) only" retry targeting for `both` posts (design doc "Status semantics").
  const igFailed =
    post.status === 'falha_publicacao' && !!post.publish_error && !post.instagram_media_id;
  const ttFailed = post.tiktok_publish_status === 'failed';

  // Retry must stay usable for whichever failed side still has a healthy account — it
  // should only be disabled when EVERY failed side is blocked (no side could possibly
  // retry). For a single-platform post the whole post's fate IS that platform, so this
  // reduces to the plain `accountBlocked` check (byte-identical to the pre-fix
  // behavior) — the failedSides disambiguation only matters for `platform === 'both'`,
  // where igTokenBlocked/ttTokenBlocked previously blocked retry wholesale even when
  // only one side had actually failed.
  const bothFailedSidesBlocked = (): boolean => {
    const failedSides: boolean[] = [];
    if (igFailed) failedSides.push(igTokenBlocked);
    if (ttFailed) failedSides.push(ttTokenBlocked);
    return failedSides.length > 0 && failedSides.every(Boolean);
  };
  const retryBlocked = platform === 'both' ? bothFailedSidesBlocked() : accountBlocked;

  const handleRetry = async () => {
    setLoading(true);
    try {
      await beforeServerAction?.();
      if (platform === 'both') {
        const igSkip = igFailed && igTokenBlocked;
        const ttSkip = ttFailed && ttTokenBlocked;
        if (igSkip) {
          toast.info(t('scheduleButton.toast.igReconnectOnlyTikTok'));
        } else if (ttSkip) {
          toast.info(t('scheduleButton.toast.ttReconnectOnlyInstagram'));
        }
        let igError: string | undefined;
        let ttError: string | undefined;
        if (igFailed && !igSkip) {
          try {
            await retryInstagramPublish(post.id!);
          } catch (e: any) {
            igError = e.message;
          }
        }
        if (ttFailed && !ttSkip) {
          try {
            await retryTikTokPublish(post.id!);
          } catch (e: any) {
            ttError = e.message;
          }
        }
        if (!igError && !ttError) {
          toast.success(t('scheduleButton.toast.resent'));
        } else if (igError && ttError) {
          toast.error(`Instagram: ${igError}; TikTok: ${ttError}`);
        } else if (igError) {
          toast.error(`Instagram: ${igError}`);
        } else {
          toast.error(`TikTok: ${ttError}`);
        }
      } else if (platform === 'tiktok') {
        await retryTikTokPublish(post.id!);
        toast.success(t('scheduleButton.toast.resent'));
      } else {
        await retryInstagramPublish(post.id!);
        toast.success(t('scheduleButton.toast.resent'));
      }
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const isStoryPost = post.tipo === 'stories';
  const hasRequiredCaption =
    isStoryPost || !!post.ig_caption?.trim() || (targetsTikTok && !!post.tiktok_caption?.trim());
  const mediaViolations =
    targetsInstagram && media
      ? validatePostMedia(media, {
          forStories: isStoryPost,
          isCarousel: !isStoryPost && media.length > 1,
        })
      : [];
  // Only a loaded, empty list counts: `media` is undefined while the query loads and on
  // mounts that don't pass it (calendar panels), where the server still validates.
  const missingMedia = media !== undefined && media.length === 0;
  const canSchedule =
    !!post.scheduled_at &&
    hasRequiredCaption &&
    !missingMedia &&
    !accountWarning &&
    tiktokReady &&
    mediaViolations.length === 0;
  const canPublishNow =
    hasRequiredCaption &&
    !missingMedia &&
    !accountWarning &&
    tiktokReady &&
    mediaViolations.length === 0;
  const missingItems: string[] = [];
  if (missingMedia) missingItems.push(t('scheduleButton.missing.media'));
  if (!post.scheduled_at) missingItems.push(t('scheduleButton.missing.publishDate'));
  const captionLabel =
    targetsInstagram && targetsTikTok
      ? t('scheduleButton.missing.caption')
      : targetsTikTok
        ? t('scheduleButton.missing.tiktokCaption')
        : t('scheduleButton.missing.instagramCaption');
  if (!isStoryPost && !hasRequiredCaption) missingItems.push(captionLabel);
  if (targetsTikTok && !tiktokReady) {
    missingItems.push(
      tiktokIncompleteReason
        ? tiktokIncompleteReason.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())
        : t('scheduleButton.missing.tiktokSettings'),
    );
  }
  const tiktokBlockedTitle =
    targetsTikTok && !tiktokReady
      ? (tiktokIncompleteReason ??
        tiktokIncompleteTooltip ??
        t('scheduleButton.completeTikTokSettings'))
      : undefined;

  return {
    post,
    platform,
    targetsInstagram,
    targetsTikTok,
    visibility,
    warningMessage,
    accountWarning,
    tiktokReady,
    tiktokBranded,
    publishColor,
    loading,
    confirmOpen,
    setConfirmOpen,
    publishing,
    publishPct,
    handlePublishNow,
    handleSchedule,
    handleCancel,
    handleRetry,
    moveGuardDialog,
    igFailed,
    ttFailed,
    igTokenBlocked,
    ttTokenBlocked,
    retryBlocked,
    isStoryPost,
    hasRequiredCaption,
    missingMedia,
    mediaViolations,
    canSchedule,
    canPublishNow,
    missingItems,
    tiktokBlockedTitle,
  };
}

export type ScheduleActions = ReturnType<typeof useScheduleActions>;

/** The "Publicar agora?" confirmation with its progress bar. Rendered by whichever
 *  surface owns the publish-now button (desktop ScheduleButton or the phone editor). */
export function PublishNowConfirmDialog({ actions }: { actions: ScheduleActions }) {
  const { t } = useTranslation('postPanels');
  const {
    platform,
    targetsTikTok,
    tiktokReady,
    tiktokBranded,
    publishColor,
    confirmOpen,
    setConfirmOpen,
    publishing,
    publishPct,
    canPublishNow,
    handlePublishNow,
    moveGuardDialog,
  } = actions;
  return (
    <>
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(o) => {
          if (!publishing) setConfirmOpen(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {publishing ? t('scheduleButton.publishing') : t('scheduleButton.publishNowQuestion')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {publishing
                ? t(`scheduleButton.publishingWait.${platformCopyKey(platform)}`)
                : t(`scheduleButton.publishNowDescription.${platformCopyKey(platform)}`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {publishing && (
            <div className="px-1">
              <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
                <span>
                  {publishPct < 100
                    ? t(`scheduleButton.progress.${platformCopyKey(platform)}`)
                    : t('scheduleButton.done')}
                </span>
                <span className="tabular-nums font-medium text-stone-900">{publishPct}%</span>
              </div>
              <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 ease-out"
                  style={{
                    width: `${publishPct}%`,
                    background:
                      publishPct < 100
                        ? platform === 'instagram'
                          ? '#E1306C'
                          : 'var(--text-main)'
                        : '#3ecf8e',
                  }}
                />
              </div>
            </div>
          )}
          {!publishing && targetsTikTok && tiktokReady && (
            <TikTokPostingDeclaration brandedContent={tiktokBranded} />
          )}
          {!publishing && (
            <AlertDialogFooter>
              <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
              {/* The TikTok gate can close while the dialog is open (the declaration above
                disappears with it), so the confirm re-checks it. */}
              <Button
                onClick={handlePublishNow}
                disabled={!canPublishNow}
                style={canPublishNow ? publishColor : undefined}
              >
                {t('scheduleButton.publish')}
              </Button>
            </AlertDialogFooter>
          )}
        </AlertDialogContent>
      </AlertDialog>
      {moveGuardDialog}
    </>
  );
}

export function ScheduleButton({ compact = false, ...props }: ScheduleButtonProps) {
  const { t } = useTranslation('postPanels');
  const actions = useScheduleActions(props);
  const { post } = props;
  const {
    platform,
    targetsInstagram,
    targetsTikTok,
    visibility,
    warningMessage,
    accountWarning,
    tiktokReady,
    tiktokBranded,
    publishColor,
    loading,
    setConfirmOpen,
    handleSchedule,
    handleCancel,
    handleRetry,
    retryBlocked,
    mediaViolations,
    canSchedule,
    canPublishNow,
    missingItems,
    tiktokBlockedTitle,
  } = actions;

  if (visibility === 'hidden') return null;
  if (visibility === 'missing-ig-account-note') {
    return (
      <p className="mt-3 text-xs" style={{ color: 'var(--text-light)' }}>
        {t('scheduleButton.connectInstagram')}
      </p>
    );
  }

  if (post.status === 'agendado') {
    return (
      <div className="mt-3">
        {warningMessage && (
          <p
            className="text-xs mb-2 flex items-center gap-1 rounded-md px-2 py-1.5"
            style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}
          >
            <AlertCircle className="h-3 w-3 flex-shrink-0" /> {warningMessage}{' '}
            {t('scheduleButton.scheduledMayFail')}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {getPostPublishState(post) === 'publicando' ? (
            <div
              className="inline-flex items-center gap-1.5 px-3 h-8 mb-2 rounded-md text-xs font-semibold"
              style={
                platform === 'instagram'
                  ? { background: 'rgba(225, 48, 108, 0.12)', color: '#E1306C' }
                  : { background: 'var(--surface-hover)', color: 'var(--text-main)' }
              }
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('scheduleButton.publishing')}
            </div>
          ) : (
            <div
              className="inline-flex items-center gap-1.5 px-3 h-8 mb-2 rounded-md text-xs font-semibold"
              style={{ background: 'rgba(62, 207, 142, 0.12)', color: '#3ecf8e' }}
            >
              <Calendar className="h-3.5 w-3.5" /> {t('scheduleButton.scheduled')}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCancel}
            disabled={loading}
            className="h-8 text-xs"
            style={{ color: '#f55a42', borderColor: 'rgba(245, 90, 66, 0.25)' }}
          >
            <X className="h-3 w-3 mr-1" /> {t('actions.cancel')}
          </Button>
        </div>
        <PlatformStatusRow post={post} />
      </div>
    );
  }

  if (post.status === 'falha_publicacao') {
    return (
      <div className="mt-3">
        {warningMessage && (
          <p
            className="text-xs mb-2 flex items-center gap-1 rounded-md px-2 py-1.5"
            style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}
          >
            <AlertCircle className="h-3 w-3 flex-shrink-0" /> {warningMessage}
          </p>
        )}
        <Button
          onClick={handleRetry}
          disabled={loading || retryBlocked}
          size="sm"
          className="text-xs font-semibold"
          style={!retryBlocked ? { background: '#f55a42', color: 'white' } : undefined}
        >
          <RefreshCw className="h-3 w-3 mr-1" /> {t('scheduleButton.retry')}
        </Button>
        {targetsInstagram &&
          (post.publish_error || post.publish_error_code) &&
          (() => {
            const d = getPublishErrorDisplay(post.publish_error_code);
            return (
              <div className="text-xs mt-1" style={{ color: 'var(--danger-text)' }}>
                <p className="flex items-center gap-1 font-semibold">
                  <AlertCircle className="h-3 w-3" /> {d.titulo}
                </p>
                <p className="mt-0.5">{d.explicacao}</p>
                {d.mostrarDetalhes && post.publish_error && (
                  <p className="mt-0.5 opacity-75">{post.publish_error}</p>
                )}
              </div>
            );
          })()}
        {targetsTikTok && post.tiktok_publish_error && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f55a42' }}>
            <AlertCircle className="h-3 w-3" /> {post.tiktok_publish_error}
          </p>
        )}
        <PlatformStatusRow post={post} />
      </div>
    );
  }

  if (post.status === 'aprovado_cliente') {
    // Spec A0: the reason is shown two ways. `title` stays on the button (asserted by tests and
    // read by assistive tech); the Radix tooltip makes it visible on hover even though a
    // disabled button swallows pointer events, hence the focusable span trigger.
    const withBlockedTooltip = (button: ReactElement) =>
      tiktokBlockedTitle ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>{button}</span>
            </TooltipTrigger>
            <TooltipContent>{tiktokBlockedTitle}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        button
      );

    return (
      <div className="mt-3">
        {warningMessage && (
          <p
            className="text-xs mb-2 flex items-center gap-1 rounded-md px-2 py-1.5"
            style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}
          >
            <AlertCircle className="h-3 w-3 flex-shrink-0" /> {warningMessage}
          </p>
        )}
        {targetsTikTok && tiktokReady && (
          <TikTokPostingDeclaration brandedContent={tiktokBranded} className="mb-2" />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {withBlockedTooltip(
            <Button
              onClick={handleSchedule}
              disabled={!canSchedule || loading}
              size="sm"
              className="text-xs font-semibold"
              style={canSchedule ? { background: '#eab308', color: '#12151a' } : undefined}
              title={tiktokBlockedTitle}
            >
              <Calendar className="h-3 w-3 mr-1" />{' '}
              {compact ? t('scheduleButton.schedule') : t('scheduleButton.schedulePublication')}
            </Button>,
          )}
          {withBlockedTooltip(
            <Button
              onClick={() => setConfirmOpen(true)}
              disabled={!canPublishNow || loading}
              size="sm"
              className="text-xs font-semibold"
              style={canPublishNow ? publishColor : undefined}
              title={tiktokBlockedTitle}
            >
              <Send className="h-3 w-3 mr-1" />{' '}
              {compact ? t('scheduleButton.publish') : t('scheduleButton.publishNow')}
            </Button>,
          )}
        </div>
        {!accountWarning && !canPublishNow && missingItems.length > 0 && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f5a342' }}>
            <AlertCircle className="h-3 w-3" />{' '}
            {t('scheduleButton.missingLine', { items: missingItems.join(', ') })}
          </p>
        )}
        {mediaViolations.length > 0 && (
          <ul className="text-xs mt-1" style={{ color: 'var(--danger-text)' }}>
            {mediaViolations.map((v) => (
              <li key={v} className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {v}
              </li>
            ))}
          </ul>
        )}
        <PublishNowConfirmDialog actions={actions} />
      </div>
    );
  }

  if (post.status === 'postado' && targetsTikTok) {
    return (
      <div className="mt-3">
        <PlatformStatusRow post={post} />
      </div>
    );
  }

  return null;
}
