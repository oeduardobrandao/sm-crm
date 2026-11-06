import { i18n } from '@mesaas/i18n';
import { TIKTOK_LIMITS, TIKTOK_MSG, tiktokErrorMessage } from '@mesaas/tiktok-messages';

// Spec 2026-10-08-tiktok-audit-readiness A0-A7: every composer decision lives here, pure.
// TikTokSettingsPanel only renders what these functions return.

export interface TikTokReadiness {
  complete: boolean;
  reason?: string;
}

export interface ComposerInputs {
  loading: boolean;
  loadError: string | null;
  creator: {
    can_post?: boolean;
    cannot_post_reason?: string;
    app_audited?: boolean;
    privacy_level_options?: string[];
    max_video_post_duration_sec?: number;
  } | null;
  tipo: string | null | undefined;
  /** workflow_posts.platform: o teto do carrossel cai para o do Instagram com 'both'. */
  platform?: string | null;
  privacyLevel: string | undefined;
  disclosureOn: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  media:
    | {
        kind: 'image' | 'video';
        duration_seconds: number | null;
        media_lost_at?: string | null;
        mime_type?: string;
        size_bytes?: number;
      }[]
    | undefined;
  mediaError: boolean;
}

// pt copy kept for compatibility (imported elsewhere); the functions below return the
// translated text through i18n at call time.
export const DISCLOSURE_INCOMPLETE_MSG =
  'Indique se o conteúdo promove você, um terceiro ou ambos.';
export const CREATOR_LOADING_MSG = 'Carregando informações do criador no TikTok…';
export const MEDIA_LOADING_MSG = 'Carregando mídias do post…';
export const MEDIA_ERROR_MSG = 'Não foi possível carregar as mídias. Reabra o post.';
export const UNAUDITED_OPTION_SUFFIX = '(disponível após a aprovação do app)';
export const BRANDED_PRIVATE_OPTION_SUFFIX = '(não disponível para conteúdo de marca)';
export const BRANDED_PRIVATE_HELPER = 'Conteúdo de marca não pode ter visibilidade privada.';

// A missing field (older deploy) counts as audited, so the composer behaves as it did before.
export function isAppAudited(creator: ComposerInputs['creator']): boolean {
  return creator?.app_audited !== false;
}

export function isPublicAccountInTestMode(creator: ComposerInputs['creator']): boolean {
  return (
    !isAppAudited(creator) && (creator?.privacy_level_options ?? []).includes('PUBLIC_TO_EVERYONE')
  );
}

export function longestVideoSeconds(media: ComposerInputs['media']): number | null {
  const durations = (media ?? [])
    .filter((m) => m.kind === 'video' && m.duration_seconds != null)
    .map((m) => m.duration_seconds as number);
  return durations.length ? Math.max(...durations) : null;
}

export function cannotPostMessage(creator: ComposerInputs['creator']): string | null {
  if (creator?.can_post !== false) return null;
  return (
    tiktokErrorMessage(creator.cannot_post_reason) ?? i18n.t('entregas:tiktokRules.cannotPost')
  );
}

// The first failing rule sets the reason. Order matters: mediaError is checked before
// media === undefined so a failed query never reads as "still loading".
export function computeTikTokReadiness(i: ComposerInputs): TikTokReadiness {
  const fail = (reason: string): TikTokReadiness => ({ complete: false, reason });
  if (i.loading) return fail(i18n.t('entregas:tiktokRules.creatorLoading'));
  if (i.loadError) return fail(i.loadError);
  const cannot = cannotPostMessage(i.creator);
  if (cannot) return fail(cannot);
  if (isPublicAccountInTestMode(i.creator)) return fail(TIKTOK_MSG.publicAccountInTestMode);
  if (i.mediaError) return fail(i18n.t('entregas:tiktokRules.mediaError'));
  if (i.media === undefined) return fail(i18n.t('entregas:tiktokRules.mediaLoading'));
  if (i.media.length === 0) return fail(TIKTOK_MSG.mediaMissing);
  if (i.media.some((m) => m.media_lost_at != null)) return fail(TIKTOK_MSG.mediaLost);
  const mediaIssue = tiktokMediaIssues(i.tipo, i.platform, i.media)[0];
  if (mediaIssue) return fail(mediaIssue);
  if (!i.privacyLevel) return fail(i18n.t('entregas:tiktokRules.privacyRequired'));
  if (i.disclosureOn && !i.brandOrganic && !i.brandContent)
    return fail(i18n.t('entregas:tiktokRules.disclosureIncomplete'));
  if (i.brandContent && i.privacyLevel === 'SELF_ONLY') return fail(TIKTOK_MSG.brandedPrivate);
  const max = i.creator?.max_video_post_duration_sec;
  const longest = longestVideoSeconds(i.media);
  if (i.tipo === 'reels' && max != null && longest != null && longest > max) {
    return fail(TIKTOK_MSG.durationExceeded(longest, max));
  }
  return { complete: true };
}

export function disclosureLabel(
  brandOrganic: boolean,
  brandContent: boolean,
): 'Conteúdo promocional' | 'Parceria paga' | null {
  // The literal return type is kept for callers; the value follows the UI language.
  type Label = 'Conteúdo promocional' | 'Parceria paga';
  if (brandOrganic && !brandContent) return i18n.t('entregas:tiktokRules.promotional') as Label;
  if (brandContent) return i18n.t('entregas:tiktokRules.paidPartnership') as Label;
  return null;
}

export function privacyOptionState(
  option: string,
  ctx: { audited: boolean; brandContent: boolean },
): { disabled: boolean; suffix?: string } {
  if (!ctx.audited && option !== 'SELF_ONLY') {
    return { disabled: true, suffix: i18n.t('entregas:tiktokRules.unauditedSuffix') };
  }
  if (ctx.audited && ctx.brandContent && option === 'SELF_ONLY') {
    return { disabled: true, suffix: i18n.t('entregas:tiktokRules.brandedPrivateSuffix') };
  }
  return { disabled: false };
}

export function brandedCheckboxState(ctx: { audited: boolean; privacyLevel: string | undefined }): {
  disabled: boolean;
  suffix?: string;
  helper?: string;
} {
  if (!ctx.audited)
    return { disabled: true, suffix: i18n.t('entregas:tiktokRules.unauditedSuffix') };
  if (ctx.privacyLevel === 'SELF_ONLY')
    return { disabled: true, helper: i18n.t('entregas:tiktokRules.brandedPrivateHelper') };
  return { disabled: false };
}

export function tiktokCarouselMax(platform: string | null | undefined): number {
  return platform === 'both'
    ? TIKTOK_LIMITS.carouselMaxWithInstagram
    : TIKTOK_LIMITS.carouselMaxTikTokOnly;
}

/**
 * Espelho de validateMediaForTipo (supabase/functions/_shared/tiktok-publish-utils.ts):
 * as mesmas regras de mídia que o servidor confere ao agendar, para o editor mostrar o
 * problema antes do clique. Lista vazia (sem mídia) fica com a regra de mídia ausente.
 */
export function tiktokMediaIssues(
  tipo: string | null | undefined,
  platform: string | null | undefined,
  media: ComposerInputs['media'],
): string[] {
  if (!media || media.length === 0 || tipo === 'stories') return [];
  const issues: string[] = [];
  if (tipo === 'reels') {
    if (media.length !== 1 || media[0].kind !== 'video') {
      issues.push(i18n.t('entregas:tiktokRules.videoNeedsOne'));
    }
    return issues;
  }
  const hasVideo = media.some((m) => m.kind === 'video');
  if (hasVideo) {
    issues.push(i18n.t('entregas:tiktokRules.photoNoVideo'));
  } else {
    const images = media.filter((m) => m.kind === 'image');
    if (
      images.some((m) => m.mime_type != null && !TIKTOK_LIMITS.photoMimes.includes(m.mime_type))
    ) {
      issues.push(i18n.t('entregas:tiktokRules.photoFormat'));
    }
    if (images.some((m) => m.size_bytes != null && m.size_bytes > TIKTOK_LIMITS.photoMaxBytes)) {
      issues.push(
        i18n.t('entregas:tiktokRules.photoSize', { mb: TIKTOK_LIMITS.photoMaxBytes / 1024 / 1024 }),
      );
    }
    const cap = tiktokCarouselMax(platform);
    if (tipo === 'carrossel' && media.length > cap) {
      issues.push(i18n.t('entregas:tiktokRules.carouselMax', { cap, count: media.length }));
    }
    if (tipo === 'feed' && media.length !== 1) {
      issues.push(i18n.t('entregas:tiktokRules.feedNeedsOne'));
    }
  }
  return issues;
}

/** Os limites que valem para este post no TikTok, em linhas curtas para o painel. */
export function tiktokLimitLines(
  tipo: string | null | undefined,
  platform: string | null | undefined,
  maxVideoSeconds: number | null | undefined,
): string[] {
  if (tipo === 'reels') {
    return [
      maxVideoSeconds != null
        ? i18n.t('entregas:tiktokRules.limits.videoWithMax', { seconds: maxVideoSeconds })
        : i18n.t('entregas:tiktokRules.limits.video'),
      i18n.t('entregas:tiktokRules.limits.captionVideo', {
        max: TIKTOK_LIMITS.captionVideoMax.toLocaleString(i18n.language),
      }),
    ];
  }
  if (tipo === 'feed' || tipo === 'carrossel') {
    return [
      tipo === 'feed'
        ? i18n.t('entregas:tiktokRules.limits.photoOne')
        : i18n.t('entregas:tiktokRules.limits.photoCarousel', { cap: tiktokCarouselMax(platform) }),
      i18n.t('entregas:tiktokRules.limits.photoFile', {
        mb: TIKTOK_LIMITS.photoMaxBytes / 1024 / 1024,
      }),
      i18n.t('entregas:tiktokRules.limits.captionPhoto', {
        max: TIKTOK_LIMITS.captionPhotoMax.toLocaleString(i18n.language),
        title: TIKTOK_LIMITS.titlePhotoMax,
      }),
    ];
  }
  return [];
}
