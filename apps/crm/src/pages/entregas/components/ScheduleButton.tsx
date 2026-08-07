import { useState, useRef, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
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
import { sanitizeUrl } from '@/utils/security';
import type { WorkflowPost } from '../../../store';
import type { PostMedia } from '../../../store/posts';
import { getPostPublishState, PLATFORM_LABELS } from '../postLabels';
import { validatePostMedia } from '../instagramLimits';
import { getPublishErrorDisplay } from '../publishErrorCopy';
import type { Platform } from './PlatformSelector';
import {
  scheduleInstagramPost,
  cancelInstagramSchedule,
  retryInstagramPublish,
  publishInstagramPostNow,
} from '../../../services/instagram';
import {
  scheduleTikTokPost,
  cancelTikTokSchedule,
  publishTikTokPostNow,
  retryTikTokPublish,
} from '../../../services/tiktok';

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

const CHIP_TEXT: Record<PlatformChipState, string> = {
  published: 'publicado',
  pending: 'pendente',
  failed: 'falhou',
};

function PlatformChip({
  label,
  state,
  pendingLabel,
}: {
  label: string;
  state: PlatformChipState;
  pendingLabel?: string;
}) {
  const style = CHIP_STYLES[state];
  const text = state === 'pending' && pendingLabel ? pendingLabel : CHIP_TEXT[state];
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
function PlatformStatusRow({ post }: { post: WorkflowPost }) {
  const platform: Platform = post.platform ?? 'instagram';
  const targetsInstagram = platform === 'instagram' || platform === 'both';
  const targetsTikTok = platform === 'tiktok' || platform === 'both';
  if (!targetsTikTok) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {targetsInstagram && (
        <PlatformChip label={PLATFORM_LABELS.instagram} state={instagramChipState(post)} />
      )}
      <PlatformChip
        label={PLATFORM_LABELS.tiktok}
        state={tiktokChipState(post)}
        pendingLabel={post.tiktok_publish_status === 'processing' ? 'processando' : undefined}
      />
      {post.tiktok_post_url && (
        <a
          href={sanitizeUrl(post.tiktok_post_url)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: 'var(--primary-color)' }}
        >
          <ExternalLink className="h-3 w-3" /> Ver no TikTok
        </a>
      )}
    </div>
  );
}

function publishNowDescription(platform: Platform): string {
  if (platform === 'both') {
    return 'O post será publicado imediatamente no Instagram e no TikTok. Esta ação não pode ser desfeita.';
  }
  if (platform === 'tiktok') {
    return 'O post será publicado imediatamente no TikTok. Esta ação não pode ser desfeita.';
  }
  return 'O post será publicado imediatamente no Instagram. Esta ação não pode ser desfeita.';
}

function publishingProgressLabel(platform: Platform): string {
  if (platform === 'both') return 'Enviando para o Instagram e o TikTok…';
  if (platform === 'tiktok') return 'Enviando para o TikTok…';
  return 'Enviando para o Instagram…';
}

function scheduleSuccessMessage(platform: Platform): string {
  if (platform === 'both') return 'Post agendado para publicação no Instagram e no TikTok';
  if (platform === 'tiktok') return 'Post agendado para publicação no TikTok';
  return 'Post agendado para publicação no Instagram';
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
  /** C2's `TikTokSettingsPanel.onCompletenessChange` contract, held by the parent (keyed by
   * post id) and threaded through here. Ignored when the post doesn't target TikTok. */
  tiktokSettingsComplete?: boolean;
  /** Overrides the button `title` shown while a tiktok/both post is gated on
   * `tiktokSettingsComplete === false`. Lets a mount with no TikTok settings UI (e.g. the
   * compact calendar panel) point the user elsewhere instead of the default
   * "Complete as configurações do TikTok", which implies a settings panel that isn't there. */
  tiktokIncompleteTooltip?: string;
  /** Fired when a schedule/publish-now/retry attempt's error message contains the exact
   * unaudited-mode 422 string, so the parent can flip `TikTokSettingsPanel`'s
   * `showTestModeBanner` prop. */
  onTikTokUnaudited?: () => void;
  onStatusChange: () => void;
  /** Use short action labels ("Agendar"/"Publicar") so the buttons fit side-by-side
   *  in narrow containers like the calendar Publicações panel. */
  compact?: boolean;
}

export function ScheduleButton({
  post,
  media,
  hasInstagramAccount,
  igAccountStatus,
  ttAccountStatus,
  tiktokSettingsComplete = false,
  tiktokIncompleteTooltip,
  onTikTokUnaudited,
  onStatusChange,
  compact = false,
}: ScheduleButtonProps) {
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishPct, setPublishPct] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  if (targetsInstagram && !hasInstagramAccount) return null;

  const igTokenBlocked =
    targetsInstagram && !!(igAccountStatus?.revoked || igAccountStatus?.expired);
  const missingPublishPermission =
    targetsInstagram && igAccountStatus ? !igAccountStatus.canPublish : false;
  const ttTokenBlocked = targetsTikTok && !!(ttAccountStatus?.revoked || ttAccountStatus?.expired);
  const accountBlocked = igTokenBlocked || ttTokenBlocked;
  const accountWarning = accountBlocked || missingPublishPermission;

  let warningMessage: string | null = null;
  if (targetsInstagram && igAccountStatus?.revoked) {
    warningMessage =
      'Token do Instagram foi revogado. Reconecte a conta nas configurações do cliente.';
  } else if (targetsInstagram && igAccountStatus?.expired) {
    warningMessage = 'Token do Instagram expirou. Reconecte a conta nas configurações do cliente.';
  } else if (targetsInstagram && missingPublishPermission) {
    warningMessage =
      'Permissão de publicação não concedida. Reconecte a conta com as permissões necessárias.';
  } else if (targetsTikTok && ttAccountStatus?.revoked) {
    warningMessage =
      'Token do TikTok foi revogado. Reconecte a conta nas configurações do cliente.';
  } else if (targetsTikTok && ttAccountStatus?.expired) {
    warningMessage = 'Token do TikTok expirou. Reconecte a conta nas configurações do cliente.';
  }

  const tiktokReady = !targetsTikTok || tiktokSettingsComplete === true;

  const flagUnauditedIfPresent = (message: string | undefined) => {
    if (targetsTikTok && message?.includes(TIKTOK_UNAUDITED_MESSAGE)) onTikTokUnaudited?.();
  };

  const handlePublishNow = async () => {
    setPublishing(true);
    setPublishPct(0);
    setLoading(true);

    let pct = 0;
    timerRef.current = setInterval(() => {
      pct += (90 - pct) * 0.08;
      setPublishPct(Math.round(pct));
    }, 300);

    try {
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
          toast.success('Post enviado para publicação no Instagram e no TikTok!');
        } else if (igError && ttError) {
          toast.error(`Instagram: ${igError}; TikTok: ${ttError}`);
        } else if (igError) {
          toast.error(`Instagram: ${igError}`);
        } else {
          toast.error(`TikTok: ${ttError}`);
        }
        onStatusChange();
      } else if (platform === 'tiktok') {
        const result = await publishTikTokPostNow(post.id!);
        stopProgressTimer();
        setPublishPct(100);
        await new Promise((r) => setTimeout(r, 600));
        setConfirmOpen(false);
        if (result.status === 'postado') {
          toast.success('Post publicado no TikTok!');
        } else {
          toast.info(result.message ?? 'Post será publicado automaticamente em instantes.');
        }
        onStatusChange();
      } else {
        const result = await publishInstagramPostNow(post.id!);
        stopProgressTimer();
        setPublishPct(100);
        await new Promise((r) => setTimeout(r, 600));
        setConfirmOpen(false);
        if (result.status === 'postado') {
          toast.success('Post publicado no Instagram!');
        } else {
          toast.info(result.message ?? 'Post será publicado automaticamente em instantes.');
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
    setLoading(true);
    try {
      if (targetsTikTok) {
        await scheduleTikTokPost(post.id!, post.scheduled_at!);
      } else {
        await scheduleInstagramPost(post.id!);
      }
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
      if (targetsTikTok) {
        await cancelTikTokSchedule(post.id!);
      } else {
        await cancelInstagramSchedule(post.id!);
      }
      toast.success('Agendamento cancelado');
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
      if (platform === 'both') {
        const igSkip = igFailed && igTokenBlocked;
        const ttSkip = ttFailed && ttTokenBlocked;
        if (igSkip) {
          toast.info('Conta do Instagram precisa ser reconectada — apenas o TikTok será reenviado');
        } else if (ttSkip) {
          toast.info('Conta do TikTok precisa ser reconectada — apenas o Instagram será reenviado');
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
          toast.success('Post reenviado para publicação');
        } else if (igError && ttError) {
          toast.error(`Instagram: ${igError}; TikTok: ${ttError}`);
        } else if (igError) {
          toast.error(`Instagram: ${igError}`);
        } else {
          toast.error(`TikTok: ${ttError}`);
        }
      } else if (platform === 'tiktok') {
        await retryTikTokPublish(post.id!);
        toast.success('Post reenviado para publicação');
      } else {
        await retryInstagramPublish(post.id!);
        toast.success('Post reenviado para publicação');
      }
      onStatusChange();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (post.status === 'agendado') {
    return (
      <div className="mt-3">
        {warningMessage && (
          <p
            className="text-xs mb-2 flex items-center gap-1 rounded-md px-2 py-1.5"
            style={{ color: '#f55a42', background: 'rgba(245, 90, 66, 0.08)' }}
          >
            <AlertCircle className="h-3 w-3 flex-shrink-0" /> {warningMessage} A publicação agendada
            pode falhar.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {getPostPublishState(post) === 'publicando' ? (
            <div
              className="inline-flex items-center gap-1.5 px-3 h-8 mb-2 rounded-md text-xs font-semibold"
              style={{ background: 'rgba(225, 48, 108, 0.12)', color: '#E1306C' }}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Publicando…
            </div>
          ) : (
            <div
              className="inline-flex items-center gap-1.5 px-3 h-8 mb-2 rounded-md text-xs font-semibold"
              style={{ background: 'rgba(62, 207, 142, 0.12)', color: '#3ecf8e' }}
            >
              <Calendar className="h-3.5 w-3.5" /> Agendado
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
            <X className="h-3 w-3 mr-1" /> Cancelar
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
          <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
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
    const isStoryPost = post.tipo === 'stories';
    const hasRequiredCaption =
      isStoryPost || !!post.ig_caption?.trim() || (targetsTikTok && !!post.tiktok_caption?.trim());
    const mediaViolations =
      targetsInstagram && media ? validatePostMedia(media, { forStories: isStoryPost }) : [];
    const canSchedule =
      !!post.scheduled_at &&
      hasRequiredCaption &&
      !accountWarning &&
      tiktokReady &&
      mediaViolations.length === 0;
    const canPublishNow =
      hasRequiredCaption && !accountWarning && tiktokReady && mediaViolations.length === 0;
    const missingItems: string[] = [];
    if (!post.scheduled_at) missingItems.push('data de publicação');
    if (!isStoryPost && !hasRequiredCaption) missingItems.push('legenda do Instagram');
    if (targetsTikTok && !tiktokReady) missingItems.push('configurações do TikTok');
    const tiktokBlockedTitle =
      targetsTikTok && !tiktokReady
        ? (tiktokIncompleteTooltip ?? 'Complete as configurações do TikTok')
        : undefined;

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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            onClick={handleSchedule}
            disabled={!canSchedule || loading}
            size="sm"
            className="text-xs font-semibold"
            style={canSchedule ? { background: '#eab308', color: '#12151a' } : undefined}
            title={tiktokBlockedTitle}
          >
            <Calendar className="h-3 w-3 mr-1" /> {compact ? 'Agendar' : 'Agendar publicação'}
          </Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canPublishNow || loading}
            size="sm"
            className="text-xs font-semibold"
            style={canPublishNow ? { background: '#E1306C', color: 'white' } : undefined}
            title={tiktokBlockedTitle}
          >
            <Send className="h-3 w-3 mr-1" /> {compact ? 'Publicar' : 'Publicar agora'}
          </Button>
        </div>
        {!accountWarning && !canPublishNow && missingItems.length > 0 && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: '#f5a342' }}>
            <AlertCircle className="h-3 w-3" /> Falta: {missingItems.join(', ')}
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
        <AlertDialog
          open={confirmOpen}
          onOpenChange={(o) => {
            if (!publishing) setConfirmOpen(o);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{publishing ? 'Publicando…' : 'Publicar agora?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {publishing
                  ? `Aguarde enquanto o post é publicado ${platform === 'both' ? 'no Instagram e no TikTok' : platform === 'tiktok' ? 'no TikTok' : 'no Instagram'}.`
                  : publishNowDescription(platform)}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {publishing && (
              <div className="px-1">
                <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
                  <span>{publishPct < 100 ? publishingProgressLabel(platform) : 'Concluído!'}</span>
                  <span className="tabular-nums font-medium text-stone-900">{publishPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300 ease-out"
                    style={{
                      width: `${publishPct}%`,
                      background: publishPct < 100 ? '#E1306C' : '#3ecf8e',
                    }}
                  />
                </div>
              </div>
            )}
            {!publishing && (
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <Button
                  onClick={handlePublishNow}
                  style={{ background: '#E1306C', color: 'white' }}
                >
                  Publicar
                </Button>
              </AlertDialogFooter>
            )}
          </AlertDialogContent>
        </AlertDialog>
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
