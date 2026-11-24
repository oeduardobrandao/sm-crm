import { describe, expect, it } from 'vitest';
import { buildRateDistributions, type PostMetricRow } from '../../../lib/ig-rates';
import {
  formatMediaType,
  formatPublishedAt,
  formatSyncedAgo,
  mediaAccentColor,
  rateBenchmark,
} from '../contaFormat';

function row(media_type: string, likes: number): PostMetricRow {
  return {
    media_type,
    reach: 1000,
    impressions: 1200,
    saved: 5,
    shares: 3,
    likes,
    comments: 2,
    unavailable_metrics: null,
  };
}

describe('formatMediaType / mediaAccentColor', () => {
  it('keeps the existing labels and colors', () => {
    expect(formatMediaType('VIDEO')).toBe('Reel');
    expect(formatMediaType('CAROUSEL_ALBUM')).toBe('Carrossel');
    expect(formatMediaType('IMAGE')).toBe('Imagem');
    expect(mediaAccentColor('VIDEO')).toBe('#8b5cf6');
    expect(mediaAccentColor('OTHER')).toBe('#64748b');
  });
});

describe('formatPublishedAt', () => {
  it('formats the publication instant in São Paulo time', () => {
    expect(formatPublishedAt('2026-11-21T21:02:00Z')).toBe('Publicado em 21 de nov. às 18:02');
    expect(formatPublishedAt('2026-11-22T02:30:00Z')).toBe('Publicado em 21 de nov. às 23:30');
  });
});

describe('formatSyncedAgo', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  it('formats the sync age', () => {
    expect(formatSyncedAgo('2026-11-23T10:00:00Z', now)).toBe('Atualizado há 2 h');
    expect(formatSyncedAgo('2026-11-23T11:45:00Z', now)).toBe('Atualizado há 15 min');
    expect(formatSyncedAgo('2026-11-23T11:59:30Z', now)).toBe('Atualizado agora');
    expect(formatSyncedAgo('2026-11-20T12:00:00Z', now)).toBe('Atualizado há 3 dias');
    expect(formatSyncedAgo(null, now)).toBeNull();
  });
});

describe('rateBenchmark', () => {
  const dists = buildRateDistributions([
    ...[10, 20, 30, 40, 50].map((l) => row('VIDEO', l)),
    row('IMAGE', 5),
    row('IMAGE', 6),
  ]);
  const smallDists = buildRateDistributions([row('IMAGE', 1), row('IMAGE', 2), row('VIDEO', 3)]);
  it('returns quartiles of the chosen sample, null below MIN_SAMPLE or without dists', () => {
    expect(rateBenchmark(dists, 'VIDEO', 'like_rate')).toEqual({
      p50: expect.any(Number),
      p75: expect.any(Number),
    });
    expect(rateBenchmark(smallDists, 'IMAGE', 'like_rate')).toBeNull();
    expect(rateBenchmark(undefined, 'VIDEO', 'like_rate')).toBeNull();
  });
  it('falls back to the overall sample when the format has too few rows', () => {
    // 2 IMAGE rows < MIN_SAMPLE, overall has 7
    expect(rateBenchmark(dists, 'IMAGE', 'like_rate')).not.toBeNull();
  });
});
