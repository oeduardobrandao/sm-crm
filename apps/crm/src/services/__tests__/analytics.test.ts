import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../../test/shared/fetchMock';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  generateReport,
  getAnalyticsOverview,
  getPortfolioSummary,
  getPostsAnalytics,
} from '../analytics';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;
const fetchHarness = createFetchMock();

function getLastCall(table: string) {
  const call = mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table).at(-1);
  expect(call).toBeDefined();
  return call!;
}

describe('analytics service', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({ conta_id: 'conta-1' });
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
  });

  it('aggregates an active portfolio summary from multiple Supabase datasets', async () => {
    mockedSupabase.__queueSupabaseResult('clientes', 'select', {
      data: [
        { id: 1, nome: 'Clínica Aurora', sigla: 'CA', cor: '#db2777', especialidade: 'Dermatologia', status: 'ativo' },
        { id: 2, nome: 'Restaurante Sabor', sigla: 'RS', cor: '#ea580c', especialidade: 'Gastronomia', status: 'ativo' },
        { id: 3, nome: 'Arquivo Antigo', sigla: 'AA', cor: '#64748b', especialidade: 'Arquivo', status: 'pausado' },
      ],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [
        {
          id: 10,
          client_id: 1,
          username: 'clinicaaurora',
          profile_picture_url: 'https://cdn.mesaas.com/avatar-1.jpg',
          follower_count: 2500,
          reach_28d: 18000,
          impressions_28d: 22000,
          profile_views_28d: 780,
          website_clicks_28d: 140,
          media_count: 96,
          last_synced_at: '2026-04-15T12:00:00.000Z',
        },
        {
          id: 20,
          client_id: 2,
          username: 'sabornobrasa',
          profile_picture_url: 'https://cdn.mesaas.com/avatar-2.jpg',
          follower_count: 1800,
          reach_28d: 11000,
          impressions_28d: 15000,
          profile_views_28d: 420,
          website_clicks_28d: 90,
          media_count: 52,
          last_synced_at: '2026-04-16T12:00:00.000Z',
        },
      ],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_posts', 'select',
      {
        data: [
          { instagram_account_id: 10, posted_at: '2026-04-10T10:00:00.000Z', likes: 90, comments: 10, saved: 12, shares: 8, reach: 1000 },
          { instagram_account_id: 10, posted_at: '2026-04-12T10:00:00.000Z', likes: 140, comments: 20, saved: 18, shares: 10, reach: 1300 },
          { instagram_account_id: 20, posted_at: '2026-04-11T10:00:00.000Z', likes: 70, comments: 9, saved: 7, shares: 3, reach: 900 },
        ],
        error: null,
      },
      {
        data: [
          { instagram_account_id: 10, posted_at: '2026-04-12T10:00:00.000Z' },
          { instagram_account_id: 10, posted_at: '2026-04-10T10:00:00.000Z' },
          { instagram_account_id: 20, posted_at: '2026-04-11T10:00:00.000Z' },
        ],
        error: null,
      },
    );
    mockedSupabase.__queueSupabaseResult('instagram_follower_history', 'select', {
      data: [
        { instagram_account_id: 10, date: '2026-03-20', follower_count: 2300 },
        { instagram_account_id: 10, date: '2026-04-10', follower_count: 2500 },
        { instagram_account_id: 20, date: '2026-03-20', follower_count: 1810 },
        { instagram_account_id: 20, date: '2026-04-10', follower_count: 1800 },
      ],
      error: null,
    });

    const summary = await getPortfolioSummary(28);

    expect(summary.summary).toEqual({
      total: 2,
      connected: 2,
      growing: 1,
      stagnant: 0,
      declining: 1,
      bestByEngagement: {
        client_name: 'Clínica Aurora',
        engagement_rate_avg: expect.any(Number),
      },
      mostImproved: {
        client_name: 'Clínica Aurora',
        follower_delta: 200,
      },
    });
    expect(summary.accounts[0]).toMatchObject({
      client_name: 'Clínica Aurora',
      username: 'clinicaaurora',
      posts_last_30d: 2,
    });

    const igCall = getLastCall('instagram_accounts');
    expect(igCall.modifiers).toContainEqual({ method: 'in', args: ['client_id', [1, 2]] });
  });

  it('computes overview deltas across current and previous periods', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: {
        id: 42,
        follower_count: 5120,
        profile_views_28d: 610,
        website_clicks_28d: 91,
      },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_posts', 'select',
      {
        data: [
          { likes: 100, comments: 10, saved: 20, shares: 5, reach: 1000, impressions: 1500 },
          { likes: 80, comments: 5, saved: 10, shares: 5, reach: 900, impressions: 1300 },
        ],
        error: null,
      },
      {
        data: [
          { likes: 60, comments: 4, saved: 8, shares: 2, reach: 800, impressions: 1000 },
        ],
        error: null,
      },
    );
    mockedSupabase.__queueSupabaseResult('instagram_follower_history', 'select', {
      data: [
        { date: '2026-03-01', follower_count: 4900 },
        { date: '2026-03-31', follower_count: 5000 },
        { date: '2026-04-01', follower_count: 5000 },
        { date: '2026-04-15', follower_count: 5120 },
      ],
      error: null,
    });

    const overview = await getAnalyticsOverview(9, 30, {
      start: '2026-04-01',
      end: '2026-04-15',
    });

    expect(overview.data.followers).toMatchObject({
      current: 120,
      previous: 100,
      delta: 20,
      direction: 'up',
    });
    expect(overview.data.reach).toMatchObject({
      current: 1900,
      previous: 800,
    });
    expect(overview.data.engagement.current).toBeCloseTo(12.37, 2);
    expect(overview.data.savesRate.current).toBeCloseTo(1.58, 2);
    expect(overview.data.followerCount).toBe(5120);
    expect(overview.fromCache).toBe(false);
  });

  it('enriches post analytics with tags and derived rates', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: { id: 88 },
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_posts', 'select', {
      data: [
        {
          id: 1,
          instagram_post_id: '1789',
          caption: 'Antes e depois do procedimento',
          media_type: 'IMAGE',
          permalink: 'https://instagram.com/p/1',
          posted_at: '2026-04-12T10:00:00.000Z',
          likes: 90,
          comments: 15,
          saved: 18,
          shares: 7,
          reach: 1000,
          impressions: 1400,
          thumbnail_url: null,
        },
        {
          id: 2,
          instagram_post_id: '1790',
          caption: 'Rotina de bastidores',
          media_type: 'REEL',
          permalink: 'https://instagram.com/p/2',
          posted_at: '2026-04-11T10:00:00.000Z',
          likes: 40,
          comments: 4,
          saved: 4,
          shares: 1,
          reach: 800,
          impressions: 1000,
          thumbnail_url: null,
        },
      ],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_post_tag_assignments', 'select', {
      data: [
        {
          post_id: 1,
          tag_id: 10,
          instagram_post_tags: { id: 10, tag_name: 'Conversão', color: '#22c55e' },
        },
      ],
      error: null,
    });

    const result = await getPostsAnalytics(1, 30, 'engagement_rate', 'desc');

    expect(result.total).toBe(2);
    expect(result.posts[0]).toMatchObject({
      id: 1,
      engagement_rate: 13,
      saves_rate: 1.8,
      tags: [{ id: 10, tag_name: 'Conversão', color: '#22c55e' }],
    });
    expect(result.posts[1].engagement_rate).toBeLessThan(result.posts[0].engagement_rate);
  });

  it('returns zero summary when clients query errors out', async () => {
    mockedSupabase.__queueSupabaseResult('clientes', 'select', {
      data: null,
      error: { message: 'boom' },
    });

    const summary = await getPortfolioSummary(28);

    expect(summary).toEqual({
      accounts: [],
      summary: { total: 0, connected: 0, growing: 0, stagnant: 0, declining: 0, bestByEngagement: null, mostImproved: null },
    });
  });

  it('returns zero summary when no active clients exist', async () => {
    mockedSupabase.__queueSupabaseResult('clientes', 'select', {
      data: [
        { id: 1, nome: 'Antigo', status: 'pausado' },
        { id: 2, nome: 'Arquivado', status: 'arquivado' },
      ],
      error: null,
    });

    const summary = await getPortfolioSummary(28);

    expect(summary.summary.total).toBe(0);
    expect(summary.summary.connected).toBe(0);
    expect(summary.accounts).toEqual([]);
  });

  it('reports zero connected when active clients have no instagram accounts', async () => {
    mockedSupabase.__queueSupabaseResult('clientes', 'select', {
      data: [{ id: 1, nome: 'Clínica', status: 'ativo' }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [],
      error: null,
    });

    const summary = await getPortfolioSummary(28);

    expect(summary.summary).toMatchObject({ total: 1, connected: 0, growing: 0, declining: 0, stagnant: 0 });
    expect(summary.summary.bestByEngagement).toBeNull();
    expect(summary.summary.mostImproved).toBeNull();
  });

  it('skips engagement calculation for posts with zero reach', async () => {
    mockedSupabase.__queueSupabaseResult('clientes', 'select', {
      data: [{ id: 1, nome: 'Clínica', status: 'ativo' }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [{ id: 10, client_id: 1, username: 'clinica', follower_count: 1000 }],
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_posts', 'select',
      {
        data: [
          { instagram_account_id: 10, posted_at: '2026-04-10T10:00:00.000Z', likes: 10, comments: 2, saved: 1, shares: 1, reach: 0 },
          { instagram_account_id: 10, posted_at: '2026-04-11T10:00:00.000Z', likes: 50, comments: 5, saved: 5, shares: 0, reach: 1000 },
        ],
        error: null,
      },
      { data: [], error: null },
    );
    mockedSupabase.__queueSupabaseResult('instagram_follower_history', 'select', {
      data: [],
      error: null,
    });

    const summary = await getPortfolioSummary(28);

    // 2 posts counted, but engagement only from the one with reach>0:
    //   (50+5+5+0)/1000 * 100 = 6 → avg across 2 posts = 6/2 = 3
    expect(summary.accounts).toHaveLength(1);
    expect(summary.accounts[0].posts_last_30d).toBe(2);
    expect(summary.accounts[0].engagement_rate_avg).toBe(3);
  });

  it('throws a friendly report generation error when the edge function fails', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 500,
      json: { message: 'Falha ao gerar PDF para a cliente Clínica Aurora' },
    });

    await expect(generateReport(7, '2026-03')).rejects.toThrow(
      'Falha ao gerar PDF para a cliente Clínica Aurora',
    );
  });
});
