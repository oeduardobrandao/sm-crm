import { describe, expect, it } from 'vitest';
import {
  DESTINATION_STATE_LABELS,
  destinationToggleOptions,
  nativeFormatHint,
  resolveDestinationState,
  seedCaptionFor,
  truncateCaption,
  type DestinationPostFields,
} from '../postDestinations';

const post = (over: Partial<DestinationPostFields> = {}): DestinationPostFields => ({
  status: 'rascunho',
  scheduled_at: null,
  instagram_media_id: null,
  publish_error: null,
  tiktok_publish_status: null,
  ...over,
});
const ig = { platform: 'instagram', status: 'pendente' } as const;
const tt = { platform: 'tiktok', status: 'pendente' } as const;
const geral = { platform: 'geral', status: 'pendente' } as const;
const NOW = new Date('2026-10-08T12:00:00Z');

describe('resolveDestinationState', () => {
  it('Instagram: media id wins; falha needs publish_error AND falha_publicacao', () => {
    expect(resolveDestinationState(post({ instagram_media_id: 'm' }), ig, NOW)).toBe('publicado');
    expect(
      resolveDestinationState(post({ status: 'falha_publicacao', publish_error: 'x' }), ig, NOW),
    ).toBe('falha');
    // TikTok falhou num post "both": status compartilhado não contamina o Instagram
    expect(resolveDestinationState(post({ status: 'falha_publicacao' }), ig, NOW)).toBe('pendente');
  });

  it('a stale publish error does not pin Falhou after the post went back to rascunho', () => {
    expect(resolveDestinationState(post({ publish_error: 'x' }), ig, NOW)).toBe('pendente');
    expect(resolveDestinationState(post({ tiktok_publish_status: 'failed' }), tt, NOW)).toBe(
      'pendente',
    );
  });

  it('TikTok reads tiktok_publish_status', () => {
    expect(resolveDestinationState(post({ tiktok_publish_status: 'published' }), tt, NOW)).toBe(
      'publicado',
    );
    expect(
      resolveDestinationState(
        post({ status: 'falha_publicacao', tiktok_publish_status: 'failed' }),
        tt,
        NOW,
      ),
    ).toBe('falha');
    expect(resolveDestinationState(post({ tiktok_publish_status: 'processing' }), tt, NOW)).toBe(
      'processando',
    );
  });

  it('agendado is processando once due, for auto-publishing destinations only', () => {
    const future = post({ status: 'agendado', scheduled_at: '2026-10-09T12:00:00Z' });
    const due = post({ status: 'agendado', scheduled_at: '2026-10-08T11:00:00Z' });
    expect(resolveDestinationState(future, ig, NOW)).toBe('agendado');
    expect(resolveDestinationState(due, tt, NOW)).toBe('processando');
    expect(resolveDestinationState(future, geral, NOW)).toBe('disponivel');
  });

  it('postado without a media id (manual path, import) is publicado', () => {
    expect(resolveDestinationState(post({ status: 'postado' }), ig, NOW)).toBe('publicado');
  });

  it('Geral is disponivel once the client approved (P2 shim), pending before', () => {
    expect(resolveDestinationState(post({ status: 'aprovado_cliente' }), geral, NOW)).toBe(
      'disponivel',
    );
    expect(resolveDestinationState(post({ status: 'falha_publicacao' }), geral, NOW)).toBe(
      'disponivel',
    );
    expect(resolveDestinationState(post({ status: 'rascunho' }), geral, NOW)).toBe('pendente');
  });

  it('pendente reads as aguardando_aprovacao while the client has the post', () => {
    expect(resolveDestinationState(post({ status: 'enviado_cliente' }), geral, NOW)).toBe(
      'aguardando_aprovacao',
    );
    expect(resolveDestinationState(post({ status: 'enviado_cliente' }), ig, NOW)).toBe(
      'aguardando_aprovacao',
    );
  });

  it('a target status other than pendente wins (P4/P5 write it)', () => {
    expect(resolveDestinationState(post(), { platform: 'tiktok', status: 'falha' }, NOW)).toBe(
      'falha',
    );
    expect(resolveDestinationState(post(), { platform: 'geral', status: 'disponivel' }, NOW)).toBe(
      'disponivel',
    );
  });

  it('labels are Portuguese and have no em dash', () => {
    expect(DESTINATION_STATE_LABELS.falha).toBe('Falhou');
    expect(DESTINATION_STATE_LABELS.aguardando_aprovacao).toBe('Aguardando aprovação');
    for (const label of Object.values(DESTINATION_STATE_LABELS)) expect(label).not.toMatch(/—/);
  });
});

describe('nativeFormatHint', () => {
  it('maps the neutral format to the native one', () => {
    expect(nativeFormatHint('instagram', 'reels')).toBe('Vídeo vertical → Reels');
    expect(nativeFormatHint('tiktok', 'feed')).toBe('Imagem → Foto');
    expect(nativeFormatHint('tiktok', 'stories')).toBeNull();
  });

  it('does not repeat a label that is already neutral (Geral)', () => {
    expect(nativeFormatHint('geral', 'reels')).toBe('Vídeo vertical');
  });
});

describe('truncateCaption', () => {
  it('cuts at max and never leaves half a surrogate pair', () => {
    expect(truncateCaption('abcdef', 3)).toBe('abc');
    expect(truncateCaption('abcdef', null)).toBe('abcdef');
    const emoji = 'ab\u{1F600}'; // length 4 in UTF-16
    expect(truncateCaption(emoji, 3)).toBe('ab');
  });
});

describe('seedCaptionFor', () => {
  it('copies the first non-empty caption in registry order', () => {
    expect(
      seedCaptionFor(
        'geral',
        ['instagram', 'tiktok'],
        { instagram: '', tiktok: 'do tiktok' },
        'feed',
      ),
    ).toEqual({ caption: 'do tiktok', cut: 0 });
    expect(
      seedCaptionFor('tiktok', ['geral', 'instagram'], { instagram: 'ig', geral: 'g' }, 'feed'),
    ).toEqual({ caption: 'ig', cut: 0 });
  });

  it('ignores the destination being added and platforms the post does not have', () => {
    expect(
      seedCaptionFor('instagram', ['geral'], { instagram: 'velha', tiktok: 't' }, 'feed'),
    ).toBe(null);
  });

  it('cuts to the new destination limit (TikTok photo 4000 into Instagram 2200)', () => {
    const long = 'x'.repeat(3000);
    const seed = seedCaptionFor('instagram', ['tiktok'], { tiktok: long }, 'feed');
    expect(seed?.caption).toHaveLength(2200);
    expect(seed?.cut).toBe(800);
  });
});

describe('destinationToggleOptions', () => {
  type Args = Parameters<typeof destinationToggleOptions>[0];
  const base: Args = {
    boardPlatforms: ['instagram', 'geral'],
    current: ['instagram'],
    published: [],
    tipo: 'feed',
    tiktokFeatureEnabled: true,
    hasActiveTikTokAccount: true,
    isExpress: false,
  };
  const opts = (over: Partial<Args> = {}) => destinationToggleOptions({ ...base, ...over });

  it('offers only the board platforms, in registry order', () => {
    expect(opts().map((o) => [o.platform, o.on])).toEqual([
      ['instagram', true],
      ['geral', false],
    ]);
  });

  it('keeps a destination the post already has even if the board dropped it', () => {
    expect(opts({ current: ['instagram', 'tiktok'] }).map((o) => o.platform)).toEqual([
      'instagram',
      'tiktok',
      'geral',
    ]);
  });

  it('TikTok: needs the plan flag to be offered, never on stories, needs an active account', () => {
    const board: Args['boardPlatforms'] = ['instagram', 'tiktok'];
    expect(
      opts({ boardPlatforms: board, tiktokFeatureEnabled: false }).map((o) => o.platform),
    ).toEqual(['instagram']);
    expect(
      opts({ boardPlatforms: board, tipo: 'stories' }).find((o) => o.platform === 'tiktok')
        ?.disabledReason,
    ).toBe('Stories não são suportados no TikTok');
    expect(
      opts({ boardPlatforms: board, hasActiveTikTokAccount: false }).find(
        (o) => o.platform === 'tiktok',
      )?.disabledReason,
    ).toBe('Cliente sem conta TikTok ativa');
  });

  it('Post Express has no Destinos row', () => {
    expect(opts({ isExpress: true })).toEqual([]);
  });

  it('a published destination cannot be turned off', () => {
    const o = opts({ current: ['instagram', 'geral'], published: ['instagram'] });
    expect(o.find((x) => x.platform === 'instagram')?.disabledReason).toBe('Já publicado');
    expect(o.find((x) => x.platform === 'geral')?.disabledReason).toBeNull();
  });
});
