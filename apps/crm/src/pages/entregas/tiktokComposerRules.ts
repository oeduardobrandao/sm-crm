import { TIKTOK_MSG, tiktokErrorMessage } from '@mesaas/tiktok-messages';

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
  privacyLevel: string | undefined;
  disclosureOn: boolean;
  brandOrganic: boolean;
  brandContent: boolean;
  media:
    | { kind: 'image' | 'video'; duration_seconds: number | null; media_lost_at?: string | null }[]
    | undefined;
  mediaError: boolean;
}

export const DISCLOSURE_INCOMPLETE_MSG =
  'Indique se o conteúdo promove você, um terceiro ou ambos.';
export const CREATOR_LOADING_MSG = 'Carregando informações do criador no TikTok…';
export const MEDIA_LOADING_MSG = 'Carregando mídias do post…';
export const MEDIA_ERROR_MSG = 'Não foi possível carregar as mídias. Reabra o post.';
export const UNAUDITED_OPTION_SUFFIX = '(disponível após a aprovação do app)';
export const BRANDED_PRIVATE_OPTION_SUFFIX = '(não disponível para conteúdo de marca)';
export const BRANDED_PRIVATE_HELPER = 'Conteúdo de marca não pode ter visibilidade privada.';

const CANNOT_POST_FALLBACK =
  'O TikTok não permite novas publicações nesta conta agora. Tente novamente mais tarde.';

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
  return tiktokErrorMessage(creator.cannot_post_reason) ?? CANNOT_POST_FALLBACK;
}

// The first failing rule sets the reason. Order matters: mediaError is checked before
// media === undefined so a failed query never reads as "still loading".
export function computeTikTokReadiness(i: ComposerInputs): TikTokReadiness {
  const fail = (reason: string): TikTokReadiness => ({ complete: false, reason });
  if (i.loading) return fail(CREATOR_LOADING_MSG);
  if (i.loadError) return fail(i.loadError);
  const cannot = cannotPostMessage(i.creator);
  if (cannot) return fail(cannot);
  if (isPublicAccountInTestMode(i.creator)) return fail(TIKTOK_MSG.publicAccountInTestMode);
  if (i.mediaError) return fail(MEDIA_ERROR_MSG);
  if (i.media === undefined) return fail(MEDIA_LOADING_MSG);
  if (i.media.length === 0) return fail(TIKTOK_MSG.mediaMissing);
  if (i.media.some((m) => m.media_lost_at != null)) return fail(TIKTOK_MSG.mediaLost);
  if (!i.privacyLevel) return fail('Escolha a privacidade do post no TikTok.');
  if (i.disclosureOn && !i.brandOrganic && !i.brandContent) return fail(DISCLOSURE_INCOMPLETE_MSG);
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
  if (brandOrganic && !brandContent) return 'Conteúdo promocional';
  if (brandContent) return 'Parceria paga';
  return null;
}

export function privacyOptionState(
  option: string,
  ctx: { audited: boolean; brandContent: boolean },
): { disabled: boolean; suffix?: string } {
  if (!ctx.audited && option !== 'SELF_ONLY') {
    return { disabled: true, suffix: UNAUDITED_OPTION_SUFFIX };
  }
  if (ctx.audited && ctx.brandContent && option === 'SELF_ONLY') {
    return { disabled: true, suffix: BRANDED_PRIVATE_OPTION_SUFFIX };
  }
  return { disabled: false };
}

export function brandedCheckboxState(ctx: { audited: boolean; privacyLevel: string | undefined }): {
  disabled: boolean;
  suffix?: string;
  helper?: string;
} {
  if (!ctx.audited) return { disabled: true, suffix: UNAUDITED_OPTION_SUFFIX };
  if (ctx.privacyLevel === 'SELF_ONLY') return { disabled: true, helper: BRANDED_PRIVATE_HELPER };
  return { disabled: false };
}
