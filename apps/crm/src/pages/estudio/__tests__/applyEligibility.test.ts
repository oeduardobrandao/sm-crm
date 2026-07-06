import { describe, expect, it } from 'vitest';
import { postEligibility } from '../applyEligibility';

const none = new Set<number>();

describe('postEligibility', () => {
  it('eligible: supported tipo, editable status, no design, no video', () => {
    expect(postEligibility({ id: 1, tipo: 'feed', status: 'rascunho' }, none, none)).toBe(null);
    expect(
      postEligibility({ id: 1, tipo: 'carrossel', status: 'correcao_cliente' }, none, none),
    ).toBe(null);
    expect(postEligibility({ id: 1, tipo: 'reels', status: 'revisao_interna' }, none, none)).toBe(
      null,
    );
    // enviado_cliente joined the editable set (20260706000001): the art keeps updating
    // while the post awaits client review.
    expect(postEligibility({ id: 1, tipo: 'feed', status: 'enviado_cliente' }, none, none)).toBe(
      null,
    );
  });

  it('stories (and anything unknown) → tipo_unsupported, checked FIRST', () => {
    expect(
      postEligibility({ id: 1, tipo: 'stories', status: 'aprovado_cliente' }, new Set([1]), none),
    ).toBe('tipo_unsupported');
  });

  it('locked statuses → not_editable', () => {
    for (const status of ['aprovado_interno', 'aprovado_cliente', 'agendado']) {
      expect(postEligibility({ id: 1, tipo: 'feed', status }, none, none)).toBe('not_editable');
    }
  });

  it('post with an attached design → already_designed (before the video check)', () => {
    expect(
      postEligibility({ id: 7, tipo: 'feed', status: 'rascunho' }, new Set([7]), new Set([7])),
    ).toBe('already_designed');
  });

  it('video media blocks feed/carrossel but NOT reels', () => {
    const videos = new Set([9]);
    expect(postEligibility({ id: 9, tipo: 'feed', status: 'rascunho' }, none, videos)).toBe(
      'has_video',
    );
    expect(postEligibility({ id: 9, tipo: 'carrossel', status: 'rascunho' }, none, videos)).toBe(
      'has_video',
    );
    expect(postEligibility({ id: 9, tipo: 'reels', status: 'rascunho' }, none, videos)).toBe(null);
  });
});
