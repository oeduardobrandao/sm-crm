import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import { buildRateDistributions } from '../../lib/ig-rates';
import { getAccountHealth, getPostAnalyticsById } from '../analytics';

type Resp = { data?: unknown; error?: unknown };
type MockedSupabaseModule = typeof supabaseModule & {
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Resp[]
  ) => void;
  __queueSupabaseRpc: (name: string, ...responses: Resp[]) => void;
  __getSupabaseCalls: () => Array<Record<string, unknown>>;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mocked = supabaseModule as MockedSupabaseModule;

describe('getAccountHealth', () => {
  beforeEach(() => {
    mocked.__resetSupabaseMock();
    mocked.__setCurrentProfile({ conta_id: 'conta-1' });
  });

  it('maps the RPC payload and coerces numerics', async () => {
    mocked.__queueSupabaseRpc('ig_account_health', {
      data: {
        followers: '1200',
        band: '1k_5k',
        metrics: {
          engagement_rate: '3.5',
          posts_30d: 12,
          reel_views: null,
          reels_share: 0.4,
        },
        best_post: { id: 'post-1', ratio: '2.5' },
        benchmarks: [
          { metric: 'engagement_rate', source: 'mercado', sample_size: '500', cuts: ['1', 2, '3'] },
          { metric: 'posts_30d', source: 'mesaas', sample_size: null, cuts: [4, 5] },
          { metric: 'bogus', source: 'mesaas', sample_size: 1, cuts: [1] },
        ],
      },
      error: null,
    });

    const res = await getAccountHealth(7);

    expect(mocked.__getSupabaseCalls()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: 'rpc:ig_account_health', operation: 'rpc' }),
      ]),
    );
    expect(res).toEqual({
      followers: 1200,
      band: '1k_5k',
      metrics: { engagement_rate: 3.5, posts_30d: 12, reel_views: null, reels_share: 0.4 },
      bestPost: { id: 'post-1', ratio: 2.5 },
      benchmarks: {
        engagement_rate: {
          metric: 'engagement_rate',
          source: 'mercado',
          sample_size: 500,
          cuts: [1, 2, 3],
        },
        posts_30d: { metric: 'posts_30d', source: 'mesaas', sample_size: null, cuts: [4, 5] },
      },
    });
  });

  it('returns null when the RPC returns null', async () => {
    mocked.__queueSupabaseRpc('ig_account_health', { data: null, error: null });
    expect(await getAccountHealth(7)).toBeNull();
  });

  it('handles missing best_post and benchmarks', async () => {
    mocked.__queueSupabaseRpc('ig_account_health', {
      data: { followers: 10, band: null, metrics: {}, best_post: null, benchmarks: null },
      error: null,
    });
    const res = await getAccountHealth(7);
    expect(res).toEqual({
      followers: 10,
      band: null,
      metrics: { engagement_rate: null, posts_30d: null, reel_views: null, reels_share: null },
      bestPost: null,
      benchmarks: {},
    });
  });

  it('throws on RPC error', async () => {
    mocked.__queueSupabaseRpc('ig_account_health', { data: null, error: new Error('boom') });
    await expect(getAccountHealth(7)).rejects.toThrow('boom');
  });
});

describe('getPostAnalyticsById', () => {
  beforeEach(() => {
    mocked.__resetSupabaseMock();
    mocked.__setCurrentProfile({ conta_id: 'conta-1' });
  });

  it('returns the mapped post with tags', async () => {
    mocked.__queueSupabaseResult('instagram_accounts', 'select', {
      data: { id: 1, client_id: 7 },
      error: null,
    });
    mocked.__queueSupabaseResult('instagram_posts', 'select', {
      data: {
        id: 'p1',
        media_type: 'REEL',
        reach: 100,
        impressions: 200,
        likes: 8,
        comments: 1,
        saved: 1,
        shares: 0,
        unavailable_metrics: [],
      },
      error: null,
    });
    mocked.__queueSupabaseResult('instagram_post_tag_assignments', 'select', {
      data: [
        {
          post_id: 'p1',
          tag_id: 't1',
          instagram_post_tags: { id: 't1', tag_name: 'x', color: '#fff' },
        },
      ],
      error: null,
    });

    const post = await getPostAnalyticsById(7, 'p1');
    expect(post).not.toBeNull();
    expect(post!.id).toBe('p1');
    expect(post!.engagement_rate).toBe(10);
    expect(post!.views).toBe(200);
    expect(post!.ig_score).toBeNull();
    expect(post!.tags).toEqual([{ id: 't1', tag_name: 'x', color: '#fff' }]);
  });

  it('computes the IG Score when given the client distributions', async () => {
    mocked.__queueSupabaseResult('instagram_accounts', 'select', {
      data: { id: 1, client_id: 7 },
      error: null,
    });
    const row = {
      id: 'p1',
      media_type: 'REEL',
      reach: 100,
      impressions: 200,
      likes: 8,
      comments: 1,
      saved: 1,
      shares: 2,
      unavailable_metrics: [],
    };
    mocked.__queueSupabaseResult('instagram_posts', 'select', { data: row, error: null });
    mocked.__queueSupabaseResult('instagram_post_tag_assignments', 'select', {
      data: [],
      error: null,
    });
    const peers = Array.from({ length: 8 }, (_, i) => ({
      ...row,
      id: `peer-${i}`,
      likes: 2 + i,
      comments: i % 3,
      saved: i % 4,
      shares: i % 5,
    }));

    const post = await getPostAnalyticsById(7, 'p1', buildRateDistributions(peers));
    expect(post).not.toBeNull();
    expect(post!.ig_score).not.toBeNull();
  });

  it('returns null when the post is not found', async () => {
    mocked.__queueSupabaseResult('instagram_accounts', 'select', {
      data: { id: 1, client_id: 7 },
      error: null,
    });
    mocked.__queueSupabaseResult('instagram_posts', 'select', { data: null, error: null });
    expect(await getPostAnalyticsById(7, 'nope')).toBeNull();
  });
});
