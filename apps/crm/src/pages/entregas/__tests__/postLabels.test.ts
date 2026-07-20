import { describe, expect, it } from 'vitest';
import { getPostPublishState } from '../postLabels';

describe('getPostPublishState', () => {
  // ─── Pre-existing behavior (IG-only / no platform info) — must stay unchanged ──

  it('returns the raw status for non-agendado posts', () => {
    expect(getPostPublishState({ status: 'aprovado_cliente', scheduled_at: null })).toBe(
      'aprovado_cliente',
    );
  });

  it('returns agendado when scheduled_at is in the future', () => {
    expect(getPostPublishState({ status: 'agendado', scheduled_at: '2099-01-01T00:00:00Z' })).toBe(
      'agendado',
    );
  });

  it('returns publicando when scheduled_at is due', () => {
    expect(getPostPublishState({ status: 'agendado', scheduled_at: '2000-01-01T00:00:00Z' })).toBe(
      'publicando',
    );
  });

  it('returns agendado when scheduled_at is missing', () => {
    expect(getPostPublishState({ status: 'agendado', scheduled_at: null })).toBe('agendado');
  });

  // ─── TikTok extension ────────────────────────────────────────────────────────

  it.each(['initiated', 'processing'] as const)(
    'returns publicando for platform tiktok when tiktok_publish_status is %s, even if not due',
    (s) => {
      expect(
        getPostPublishState({
          status: 'agendado',
          scheduled_at: '2099-01-01T00:00:00Z',
          platform: 'tiktok',
          tiktok_publish_status: s,
        }),
      ).toBe('publicando');
    },
  );

  it('returns publicando for platform both when tiktok_publish_status is processing, even if not due', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'both',
        tiktok_publish_status: 'processing',
      }),
    ).toBe('publicando');
  });

  it('returns agendado for platform tiktok when tiktok_publish_status is null and not due', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: null,
      }),
    ).toBe('agendado');
  });

  it('ignores tiktok_publish_status for platform instagram', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'instagram',
        tiktok_publish_status: 'processing',
      }),
    ).toBe('agendado');
  });

  it('ignores tiktok_publish_status when platform is undefined (defaults to instagram)', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        tiktok_publish_status: 'processing',
      }),
    ).toBe('agendado');
  });

  it('does not treat failed or published tiktok_publish_status as publicando', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: 'failed',
      }),
    ).toBe('agendado');
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2099-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: 'published',
      }),
    ).toBe('agendado');
  });

  it('due scheduled_at still wins even when tiktok_publish_status would say otherwise', () => {
    expect(
      getPostPublishState({
        status: 'agendado',
        scheduled_at: '2000-01-01T00:00:00Z',
        platform: 'tiktok',
        tiktok_publish_status: 'failed',
      }),
    ).toBe('publicando');
  });
});
