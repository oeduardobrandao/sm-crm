import { describe, expect, it } from 'vitest';
import {
  brandedCheckboxState,
  computeTikTokReadiness,
  disclosureLabel,
  privacyOptionState,
  tiktokLimitLines,
  tiktokMediaIssues,
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

describe('tiktokMediaIssues (espelho de validateMediaForTipo)', () => {
  const img = (over: Partial<NonNullable<ComposerInputs['media']>[number]> = {}) => ({
    kind: 'image' as const,
    duration_seconds: null,
    mime_type: 'image/jpeg',
    size_bytes: 1024,
    ...over,
  });
  const vid = { kind: 'video' as const, duration_seconds: 10, mime_type: 'video/mp4' };

  it('vídeo válido e carrossel válido não têm problema', () => {
    expect(tiktokMediaIssues('reels', 'tiktok', [vid])).toEqual([]);
    expect(
      tiktokMediaIssues('carrossel', 'tiktok', [img(), img({ mime_type: 'image/webp' })]),
    ).toEqual([]);
  });
  it('vídeo exige exatamente um arquivo de vídeo', () => {
    expect(tiktokMediaIssues('reels', 'tiktok', [vid, vid])).toHaveLength(1);
    expect(tiktokMediaIssues('reels', 'tiktok', [img()])).toHaveLength(1);
  });
  it('post de fotos recusa vídeo', () => {
    expect(tiktokMediaIssues('carrossel', 'tiktok', [img(), vid])).toEqual([
      'O TikTok não aceita vídeo em post de fotos: imagem e carrossel levam só imagens.',
    ]);
  });
  it('PNG e imagem acima de 20 MB', () => {
    expect(
      tiktokMediaIssues('feed', 'tiktok', [
        img({ mime_type: 'image/png', size_bytes: 21 * 1024 * 1024 }),
      ]),
    ).toEqual([
      'Imagens para o TikTok precisam estar em JPEG ou WebP (PNG não é aceito).',
      'Cada imagem para o TikTok pode ter no máximo 20 MB.',
    ]);
  });
  it('teto do carrossel: 20 só TikTok, 10 com Instagram', () => {
    const eleven = Array.from({ length: 11 }, () => img());
    expect(tiktokMediaIssues('carrossel', 'tiktok', eleven)).toEqual([]);
    expect(tiktokMediaIssues('carrossel', 'both', eleven)).toEqual([
      'Carrossel no TikTok aceita no máximo 10 imagens (este post tem 11).',
    ]);
    expect(
      tiktokMediaIssues(
        'carrossel',
        'tiktok',
        Array.from({ length: 21 }, () => img()),
      ),
    ).toHaveLength(1);
  });
  it('imagem única exige 1 imagem', () => {
    expect(tiktokMediaIssues('feed', 'tiktok', [img(), img()])).toEqual([
      'Post de imagem no TikTok leva exatamente 1 imagem. Para mais, use carrossel.',
    ]);
  });
  it('bloqueia a prontidão com o primeiro problema', () => {
    expect(
      computeTikTokReadiness({ ...base, tipo: 'feed', media: [img({ mime_type: 'image/png' })] }),
    ).toEqual({
      complete: false,
      reason: 'Imagens para o TikTok precisam estar em JPEG ou WebP (PNG não é aceito).',
    });
  });
});

describe('tiktokLimitLines', () => {
  it('vídeo cita a duração da conta quando conhecida', () => {
    expect(tiktokLimitLines('reels', 'tiktok', 600)[0]).toBe(
      '1 vídeo por post, até 600s nesta conta',
    );
    expect(tiktokLimitLines('reels', 'tiktok', null)[0]).toBe('1 vídeo por post');
  });
  it('carrossel usa o teto da combinação de destinos', () => {
    expect(tiktokLimitLines('carrossel', 'both', null)[0]).toBe('Até 10 imagens no carrossel');
    expect(tiktokLimitLines('carrossel', 'tiktok', null)[0]).toBe('Até 20 imagens no carrossel');
  });
  it('stories não tem linhas', () => {
    expect(tiktokLimitLines('stories', 'tiktok', null)).toEqual([]);
  });
});
