import { describe, expect, it } from 'vitest';
import {
  brandedCheckboxState,
  computeTikTokReadiness,
  disclosureLabel,
  privacyOptionState,
  type ComposerInputs,
} from '../tiktokComposerRules';

const base: ComposerInputs = {
  loading: false,
  loadError: null,
  creator: {
    can_post: true,
    app_audited: true,
    privacy_level_options: ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS'],
    max_video_post_duration_sec: 600,
  },
  tipo: 'reels',
  privacyLevel: 'SELF_ONLY',
  disclosureOn: false,
  brandOrganic: false,
  brandContent: false,
  media: [{ kind: 'video', duration_seconds: 42, media_lost_at: null }],
  mediaError: false,
};

describe('computeTikTokReadiness', () => {
  it('complete when every rule passes', () => {
    expect(computeTikTokReadiness(base)).toEqual({ complete: true });
  });
  it.each<[string, Partial<ComposerInputs>, string]>([
    ['creator loading', { loading: true }, 'Carregando informações do criador no TikTok…'],
    ['creator error', { loadError: 'Erro X' }, 'Erro X'],
    [
      'cannot post',
      {
        creator: {
          ...base.creator,
          can_post: false,
          cannot_post_reason: 'spam_risk_too_many_posts',
        },
      },
      'Esta conta atingiu o limite diário de publicações do TikTok. Tente novamente amanhã.',
    ],
    [
      'public account in test mode',
      {
        creator: {
          ...base.creator,
          app_audited: false,
          privacy_level_options: ['PUBLIC_TO_EVERYONE', 'SELF_ONLY'],
        },
      },
      'Em modo de teste, a conta do TikTok precisa estar privada. Altere no app do TikTok e reabra o post.',
    ],
    ['media loading', { media: undefined }, 'Carregando mídias do post…'],
    [
      'media error',
      { media: undefined, mediaError: true },
      'Não foi possível carregar as mídias. Reabra o post.',
    ],
    ['no media', { media: [] }, 'Adicione mídia ao post para publicar no TikTok.'],
    [
      'lost media',
      { media: [{ kind: 'video', duration_seconds: 4, media_lost_at: '2026-08-14' }] },
      'Uma das mídias deste post foi perdida. Substitua-a antes de publicar.',
    ],
    ['no privacy', { privacyLevel: undefined }, 'Escolha a privacidade do post no TikTok.'],
    [
      'disclosure on, nothing checked',
      { disclosureOn: true },
      'Indique se o conteúdo promove você, um terceiro ou ambos.',
    ],
    [
      'branded + private',
      { disclosureOn: true, brandContent: true },
      'A visibilidade de conteúdo de marca não pode ser privada.',
    ],
    [
      'duration over limit',
      { media: [{ kind: 'video', duration_seconds: 750, media_lost_at: null }] },
      'Este vídeo tem 750s. O máximo permitido para esta conta é 600s.',
    ],
  ])('%s', (_name, patch, reason) => {
    expect(computeTikTokReadiness({ ...base, ...patch })).toEqual({ complete: false, reason });
  });
  it('missing can_post/app_audited fields behave like today (older deploy)', () => {
    expect(
      computeTikTokReadiness({ ...base, creator: { privacy_level_options: ['SELF_ONLY'] } }),
    ).toEqual({ complete: true });
  });
  it('null duration never blocks', () => {
    expect(
      computeTikTokReadiness({ ...base, media: [{ kind: 'video', duration_seconds: null }] }),
    ).toEqual({ complete: true });
  });
});

describe('disclosureLabel', () => {
  it('maps the selections', () => {
    expect(disclosureLabel(false, false)).toBeNull();
    expect(disclosureLabel(true, false)).toBe('Conteúdo promocional');
    expect(disclosureLabel(false, true)).toBe('Parceria paga');
    expect(disclosureLabel(true, true)).toBe('Parceria paga');
  });
});

describe('privacyOptionState / brandedCheckboxState', () => {
  it('unaudited: only SELF_ONLY selectable, branded disabled', () => {
    expect(privacyOptionState('SELF_ONLY', { audited: false, brandContent: false })).toEqual({
      disabled: false,
    });
    expect(
      privacyOptionState('FOLLOWER_OF_CREATOR', { audited: false, brandContent: false }),
    ).toEqual({ disabled: true, suffix: '(disponível após a aprovação do app)' });
    expect(brandedCheckboxState({ audited: false, privacyLevel: undefined })).toEqual({
      disabled: true,
      suffix: '(disponível após a aprovação do app)',
    });
  });
  it('audited: branded and SELF_ONLY exclude each other', () => {
    expect(privacyOptionState('SELF_ONLY', { audited: true, brandContent: true })).toEqual({
      disabled: true,
      suffix: '(não disponível para conteúdo de marca)',
    });
    expect(brandedCheckboxState({ audited: true, privacyLevel: 'SELF_ONLY' })).toEqual({
      disabled: true,
      helper: 'Conteúdo de marca não pode ter visibilidade privada.',
    });
    expect(brandedCheckboxState({ audited: true, privacyLevel: 'PUBLIC_TO_EVERYONE' })).toEqual({
      disabled: false,
    });
  });
});
