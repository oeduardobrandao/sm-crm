import { describe, expect, it } from 'vitest';
import {
  postEligibility,
  canMakeEditable,
  galleryDesignForHeld,
  shouldShowHeldInfoBanner,
} from '../applyEligibility';

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

// ============================================================
// canMakeEditable — Task 6 entry-point gating ("Tornar editável no Estúdio")
// ============================================================

describe('canMakeEditable', () => {
  const okPost = { tipo: 'feed', status: 'rascunho' };
  const okOpts = { estudioBlocked: false, aiImagesBlocked: false, hasDesign: false };

  it('eligible: feed/carrossel, editable status, no design, features on', () => {
    expect(canMakeEditable(okPost, okOpts)).toBe(true);
    expect(canMakeEditable({ tipo: 'carrossel', status: 'correcao_cliente' }, okOpts)).toBe(true);
    // enviado_cliente is in EDITABLE_STATUSES too.
    expect(canMakeEditable({ tipo: 'feed', status: 'enviado_cliente' }, okOpts)).toBe(true);
  });

  it('feature_estudio off (fail-closed for this entry point) → false', () => {
    expect(canMakeEditable(okPost, { ...okOpts, estudioBlocked: true })).toBe(false);
  });

  it('feature_ai_images off → false', () => {
    expect(canMakeEditable(okPost, { ...okOpts, aiImagesBlocked: true })).toBe(false);
  });

  it('design already attached → false', () => {
    expect(canMakeEditable(okPost, { ...okOpts, hasDesign: true })).toBe(false);
  });

  it('reels are unsupported by design-import (cover-only design, not a full-post import)', () => {
    expect(canMakeEditable({ tipo: 'reels', status: 'rascunho' }, okOpts)).toBe(false);
  });

  it('stories are unsupported', () => {
    expect(canMakeEditable({ tipo: 'stories', status: 'rascunho' }, okOpts)).toBe(false);
  });

  it('locked statuses → false', () => {
    for (const status of ['aprovado_interno', 'aprovado_cliente', 'agendado', 'postado']) {
      expect(canMakeEditable({ tipo: 'feed', status }, okOpts)).toBe(false);
    }
  });
});

// ============================================================
// Held ≠ ownership helpers (Task 6) — drawer info banner + gallery-lock decision
// ============================================================

describe('galleryDesignForHeld', () => {
  it('null design stays null', () => {
    expect(galleryDesignForHeld(null)).toBe(null);
  });

  it('held design becomes null (gallery must NOT lock while held)', () => {
    const design = { id: 1, media_apply_held: true };
    expect(galleryDesignForHeld(design)).toBe(null);
  });

  it('non-held design passes through unchanged (normal ownership applies)', () => {
    const design = { id: 1, media_apply_held: false };
    expect(galleryDesignForHeld(design)).toBe(design);
  });
});

describe('shouldShowHeldInfoBanner', () => {
  it('false when there is no design', () => {
    expect(shouldShowHeldInfoBanner(null)).toBe(false);
  });

  it('false when the design is not held (ownership banner takes over instead)', () => {
    expect(shouldShowHeldInfoBanner({ media_apply_held: false })).toBe(false);
  });

  it('true when held', () => {
    expect(shouldShowHeldInfoBanner({ media_apply_held: true })).toBe(true);
  });
});
