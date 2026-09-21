import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_MIN_FUTURE_MS,
  SCHEDULE_SAFETY_MARGIN_MS,
  isEligibleToScheduleNow,
  nextApprovalAwaited,
  partitionByScheduleEligibility,
  shouldOfferAutoSchedule,
  shouldShowAwaitingApproval,
  targetsTikTokService,
} from '../autoScheduleNudge';

// Fixed clock so every boundary case is exact; the helpers take `now` as an
// optional argument precisely so these tests need no fake timers.
const NOW = new Date('2026-09-17T12:00:00.000Z').getTime();
const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('isEligibleToScheduleNow', () => {
  it('rejects a null or empty date', () => {
    expect(isEligibleToScheduleNow(null, NOW)).toBe(false);
    expect(isEligibleToScheduleNow(undefined, NOW)).toBe(false);
    expect(isEligibleToScheduleNow('', NOW)).toBe(false);
  });

  it('rejects an unparseable date instead of throwing', () => {
    expect(isEligibleToScheduleNow('not a date', NOW)).toBe(false);
  });

  it('rejects a date already in the past (the 22 stuck posts in production)', () => {
    expect(isEligibleToScheduleNow(at(-3 * 24 * 60 * 60 * 1000), NOW)).toBe(false);
  });

  // Decision 1: the server floor is 10 min (instagram-publish-utils.ts:86). The
  // client adds a 2 min safety margin so a confirm landing at the exact boundary
  // does not arrive at the server already invalid.
  it('rejects the server boundary itself: exactly now + 10 min', () => {
    expect(isEligibleToScheduleNow(at(SCHEDULE_MIN_FUTURE_MS), NOW)).toBe(false);
  });

  it('rejects anything inside the safety margin: now + 11 min', () => {
    expect(isEligibleToScheduleNow(at(11 * 60 * 1000), NOW)).toBe(false);
  });

  it('accepts exactly now + 10 min + the safety margin', () => {
    expect(
      isEligibleToScheduleNow(at(SCHEDULE_MIN_FUTURE_MS + SCHEDULE_SAFETY_MARGIN_MS), NOW),
    ).toBe(true);
  });

  it('accepts a comfortably future date', () => {
    expect(isEligibleToScheduleNow(at(2 * 60 * 60 * 1000), NOW)).toBe(true);
  });
});

describe('shouldOfferAutoSchedule', () => {
  const allTrue = {
    status: 'aprovado_cliente',
    platform: 'instagram',
    autoPublishOnApproval: true,
    schedulingFeatureEnabled: true,
    tiktokFeatureEnabled: true,
    isFinalApprovalCycle: true,
  };

  it('is true only when every gate passes', () => {
    expect(shouldOfferAutoSchedule(allTrue)).toBe(true);
  });

  it('is false for any status other than aprovado_cliente', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, status: 'aprovado_interno' })).toBe(false);
    expect(shouldOfferAutoSchedule({ ...allTrue, status: 'agendado' })).toBe(false);
    expect(shouldOfferAutoSchedule({ ...allTrue, status: null })).toBe(false);
  });

  it('is false when the client does not auto-publish on approval', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, autoPublishOnApproval: false })).toBe(false);
  });

  it('is false when the plan has no feature_post_scheduling', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, schedulingFeatureEnabled: false })).toBe(false);
  });

  // Decision 3 / the PR #400 regression: a post in the FIRST cycle of a
  // dual-approval fluxo must never be offered, or it publishes before the
  // second client approval.
  it('is false when this is not the final approval cycle', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, isFinalApprovalCycle: false })).toBe(false);
  });

  // Decisão 5 da spec (correção do Codex): tiktok-publish/handler.ts:85-89 exige
  // feature_tiktok ALÉM de feature_post_scheduling. O gate só se aplica aos posts
  // que passam por aquele endpoint -- 'tiktok' e 'both' (decisão 6).
  it('is false for a tiktok post when feature_tiktok is off', () => {
    expect(
      shouldOfferAutoSchedule({ ...allTrue, platform: 'tiktok', tiktokFeatureEnabled: false }),
    ).toBe(false);
  });

  it('is false for a both post when feature_tiktok is off', () => {
    expect(
      shouldOfferAutoSchedule({ ...allTrue, platform: 'both', tiktokFeatureEnabled: false }),
    ).toBe(false);
  });

  it('is true for tiktok and both when feature_tiktok is on', () => {
    expect(shouldOfferAutoSchedule({ ...allTrue, platform: 'tiktok' })).toBe(true);
    expect(shouldOfferAutoSchedule({ ...allTrue, platform: 'both' })).toBe(true);
  });

  // O gate é condicional: um post de Instagram nunca toca tiktok-publish, então
  // feature_tiktok não pode bloqueá-lo em nenhum dos dois valores.
  it('ignores feature_tiktok entirely for an instagram post', () => {
    expect(
      shouldOfferAutoSchedule({ ...allTrue, platform: 'instagram', tiktokFeatureEnabled: false }),
    ).toBe(true);
    expect(
      shouldOfferAutoSchedule({ ...allTrue, platform: null, tiktokFeatureEnabled: false }),
    ).toBe(true);
  });
});

describe('targetsTikTokService', () => {
  it('is true only for tiktok and both', () => {
    expect(targetsTikTokService('tiktok')).toBe(true);
    expect(targetsTikTokService('both')).toBe(true);
    expect(targetsTikTokService('instagram')).toBe(false);
    expect(targetsTikTokService(null)).toBe(false);
    expect(targetsTikTokService(undefined)).toBe(false);
  });
});

describe('partitionByScheduleEligibility', () => {
  it('splits eligible posts from the ones needing a date', () => {
    const posts = [
      { id: 1, scheduled_at: at(2 * 60 * 60 * 1000) },
      { id: 2, scheduled_at: null },
      { id: 3, scheduled_at: at(-60 * 60 * 1000) },
      { id: 4, scheduled_at: at(3 * 60 * 60 * 1000) },
    ];
    const { eligible, missingDate } = partitionByScheduleEligibility(posts, NOW);
    expect(eligible.map((p) => p.id)).toEqual([1, 4]);
    expect(missingDate.map((p) => p.id)).toEqual([2, 3]);
  });

  it('returns two empty arrays for an empty input', () => {
    expect(partitionByScheduleEligibility([], NOW)).toEqual({ eligible: [], missingDate: [] });
  });
});

describe('nextApprovalAwaited', () => {
  const step = (ordem: number, nome: string, tipo: string, open: boolean) => ({
    ordem,
    nome,
    tipo,
    open,
  });

  it('names the second open approval when two are open (the case the server skips)', () => {
    expect(
      nextApprovalAwaited([
        step(1, 'Aprovação da Copy', 'aprovacao_cliente', true),
        step(2, 'Mídia', 'padrao', true),
        step(3, 'Aprovação da Mídia', 'aprovacao_cliente', true),
      ]),
    ).toBe('Aprovação da Mídia');
  });

  it('is null when this is the last open approval', () => {
    expect(
      nextApprovalAwaited([
        step(1, 'Aprovação da Copy', 'aprovacao_cliente', false),
        step(3, 'Aprovação da Mídia', 'aprovacao_cliente', true),
      ]),
    ).toBeNull();
  });

  it('is null with no approval steps, or none open', () => {
    expect(nextApprovalAwaited([])).toBeNull();
    expect(nextApprovalAwaited([step(1, 'Mídia', 'padrao', true)])).toBeNull();
  });

  it('orders by ordem regardless of input order', () => {
    expect(
      nextApprovalAwaited([
        step(5, 'Aprovação final', 'aprovacao_cliente', true),
        step(1, 'Aprovação da Copy', 'aprovacao_cliente', true),
        step(3, 'Aprovação intermediária', 'aprovacao_cliente', true),
      ]),
    ).toBe('Aprovação intermediária');
  });
});

describe('shouldShowAwaitingApproval', () => {
  const base = {
    status: 'aprovado_cliente',
    autoPublishOnApproval: true,
    awaitedApproval: 'Aprovação da Mídia',
  };

  it('shows only when approved, auto-publish is on and a later approval is awaited', () => {
    expect(shouldShowAwaitingApproval(base)).toBe(true);
    expect(shouldShowAwaitingApproval({ ...base, status: 'enviado_cliente' })).toBe(false);
    expect(shouldShowAwaitingApproval({ ...base, status: 'agendado' })).toBe(false);
    expect(shouldShowAwaitingApproval({ ...base, autoPublishOnApproval: false })).toBe(false);
    expect(shouldShowAwaitingApproval({ ...base, awaitedApproval: null })).toBe(false);
  });
});
