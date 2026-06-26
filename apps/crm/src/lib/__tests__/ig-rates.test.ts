import { describe, it, expect } from 'vitest';
import {
  computeRates,
  percentileRank,
  igAlignedScore,
  quartiles,
  performanceTier,
  IG_RATE_WEIGHTS,
  MIN_SAMPLE,
  buildRateDistributions,
  selectRateSamples,
  scorePost,
  buildBaseline,
  formatRate,
  postRateSortValue,
  type PostMetricRow,
} from '../ig-rates';

// ---- ports: mirror supabase/functions/__tests__/mcp-content_test.ts ----
describe('computeRates', () => {
  it('0 is real, missing is null, views 0/missing -> null', () => {
    const r = computeRates({ shares: 0, likes: 0, saved: 4, comments: 2, impressions: 100 }, [
      'shares',
    ]);
    expect(r.like_rate).toBe(0);
    expect(r.save_rate).toBe(0.04);
    expect(r.comment_rate).toBe(0.02);
    expect(r.share_rate).toBeNull();
    expect(computeRates({ shares: 1, likes: 1, saved: 1, comments: 1, impressions: 0 })).toEqual({
      share_rate: null,
      like_rate: null,
      save_rate: null,
      comment_rate: null,
    });
    expect(
      computeRates({ shares: 1, likes: 1, saved: 1, comments: 1, impressions: 50 }, ['impressions'])
        .like_rate,
    ).toBeNull();
  });
  it('missing/non-array unavailable normalizes to [] (rates compute normally)', () => {
    // computeRates default param; buildRateDistributions handles null rows (see below)
    const r = computeRates({ shares: 2, likes: 10, saved: 1, comments: 1, impressions: 100 });
    expect(r.share_rate).toBe(0.02);
    expect(r.like_rate).toBe(0.1);
  });
});

describe('percentileRank', () => {
  it('midrank for ties; null for empty/null', () => {
    expect(percentileRank(5, [])).toBeNull();
    expect(percentileRank(null, [1, 2, 3])).toBeNull();
    expect(percentileRank(10, [10, 10, 20, 30])).toBe(0.25);
    expect(percentileRank(30, [10, 10, 20, 30])).toBe(0.875);
  });
});

describe('igAlignedScore', () => {
  it('weights present components, renormalizes, small-sample excluded', () => {
    const big = Array.from({ length: 5 }, (_, i) => i / 100);
    const dist = { share_rate: big, like_rate: big, save_rate: big, comment_rate: big };
    expect(
      igAlignedScore(
        { share_rate: 0.05, like_rate: 0.05, save_rate: 0.05, comment_rate: 0.05 },
        dist,
      ),
    ).toBe(100);
    expect(
      igAlignedScore(
        { share_rate: null, like_rate: 0.05, save_rate: 0.05, comment_rate: 0.05 },
        dist,
      ),
    ).toBe(100);
    const tiny = { share_rate: [0.01], like_rate: [0.01], save_rate: [0.01], comment_rate: [0.01] };
    expect(
      igAlignedScore(
        { share_rate: 0.02, like_rate: 0.02, save_rate: 0.02, comment_rate: 0.02 },
        tiny,
      ),
    ).toBeNull();
    expect(MIN_SAMPLE).toBe(5);
    expect(IG_RATE_WEIGHTS).toEqual({
      share_rate: 0.4,
      like_rate: 0.3,
      save_rate: 0.2,
      comment_rate: 0.1,
    });
  });
});

describe('quartiles + performanceTier', () => {
  it('matches the Deno test', () => {
    const q = quartiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(q).not.toBeNull();
    expect(q!.p50).toBeGreaterThanOrEqual(5);
    expect(q!.p50).toBeLessThanOrEqual(6);
    expect(quartiles([])).toBeNull();
    expect(performanceTier(null, q)).toBeNull();
    expect(performanceTier(100, q)).toBe('top_quartile');
    expect(performanceTier(1, q)).toBe('bottom_quartile');
  });
});

// ---- CRM glue ----
const rows: PostMetricRow[] = [
  {
    media_type: 'VIDEO',
    reach: 100,
    impressions: 100,
    saved: 4,
    shares: 2,
    likes: 10,
    comments: 1,
    unavailable_metrics: [],
  },
  // null unavailable_metrics must coerce to [] (DB can return null):
  {
    media_type: 'VIDEO',
    reach: 200,
    impressions: 200,
    saved: 6,
    shares: 4,
    likes: 30,
    comments: 3,
    unavailable_metrics: null as unknown as string[],
  },
  {
    media_type: 'IMAGE',
    reach: 50,
    impressions: 0,
    saved: 1,
    shares: 0,
    likes: 1,
    comments: 0,
    unavailable_metrics: [],
  }, // 0 views -> excluded
];

describe('buildRateDistributions', () => {
  it('coerces null unavailable, excludes null rates, keeps reach', () => {
    const d = buildRateDistributions(rows);
    // VIDEO share_rate: 0.02 and 0.02 (4/200) -> two values; IMAGE row has 0 views -> no rates
    expect(d.byFormat.VIDEO.share_rate).toEqual([0.02, 0.02]);
    expect(d.overall.like_rate).toEqual([0.1, 0.15]);
    expect(d.byFormat.IMAGE.share_rate).toEqual([]); // 0 views -> null -> excluded
    expect(d.overall.reach).toEqual([100, 200, 50]); // reach kept regardless of views
  });
});

describe('selectRateSamples', () => {
  it('uses format sample when >= MIN_SAMPLE else overall', () => {
    const overall: Record<string, number[]> = {
      share_rate: [1, 2, 3, 4, 5],
      like_rate: [],
      save_rate: [],
      comment_rate: [],
    };
    const fmt: Record<string, number[]> = {
      share_rate: [9],
      like_rate: [],
      save_rate: [],
      comment_rate: [],
    };
    const dists = {
      overall: { ...overall, reach: [] },
      byFormat: { VIDEO: { ...fmt, reach: [] } },
    } as never;
    const out = selectRateSamples('VIDEO', dists);
    expect(out.share_rate).toEqual([1, 2, 3, 4, 5]); // fmt has 1 (<5) -> falls back to overall
  });
});

describe('scorePost', () => {
  it('composes media_type -> selectRateSamples -> igAlignedScore', () => {
    // the `rows` fixture yields only <MIN_SAMPLE buckets -> no usable component -> null
    expect(
      scorePost(
        {
          media_type: 'VIDEO',
          rates: { share_rate: 0.02, like_rate: 0.1, save_rate: 0.02, comment_rate: 0.01 },
        },
        buildRateDistributions(rows),
      ),
    ).toBeNull();
    // a usable overall like_rate sample (>=5); format absent -> falls back to overall
    const dists = {
      overall: {
        share_rate: [],
        like_rate: [0.05, 0.06, 0.07, 0.08, 0.09],
        save_rate: [],
        comment_rate: [],
        reach: [],
      },
      byFormat: {},
    } as never;
    expect(
      scorePost(
        {
          media_type: 'IMAGE',
          rates: { share_rate: null, like_rate: 0.08, save_rate: null, comment_rate: null },
        },
        dists,
      ),
    ).toBe(70); // midrank of 0.08 in the 5-sample like_rate dist = 0.7 -> 70
  });
});

describe('buildBaseline', () => {
  it('mirrors MCP get_performance_baseline shape; quartiles gated by MIN_SAMPLE', () => {
    const d = buildRateDistributions(rows);
    const b = buildBaseline(d, rows.length);
    expect(b.sample_size).toBe(3);
    expect(b.weights).toEqual(IG_RATE_WEIGHTS);
    expect(typeof b.weights_note).toBe('string');
    expect(b.overall.share_rate.n).toBe(2);
    expect(b.overall.share_rate.quartiles).toBeNull(); // n=2 < 5
    expect(b.by_format.VIDEO.like_rate.n).toBe(2);
  });
});

describe('formatRate + postRateSortValue', () => {
  it('formats fractions as pt-BR % and dashes null', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.018)).toBe('1,8%');
    expect(formatRate(0)).toBe('0,0%');
  });
  it('reads rate keys + ig_score, null for unknown', () => {
    const post = {
      rates: { share_rate: 0.02, like_rate: null, save_rate: 0.01, comment_rate: 0 },
      ig_score: 73,
    };
    expect(postRateSortValue(post, 'share_rate')).toBe(0.02);
    expect(postRateSortValue(post, 'like_rate')).toBeNull();
    expect(postRateSortValue(post, 'ig_score')).toBe(73);
    expect(postRateSortValue(post, 'reach')).toBeNull();
  });
});
