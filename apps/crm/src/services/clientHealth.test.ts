import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import { getClientHealthMonitor, downsample } from './clientHealth';

type Mocked = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __queueSupabaseRpc: (name: string, ...r: Array<{ data?: unknown; error?: unknown }>) => void;
};
const mocked = supabaseModule as Mocked;

// A fully-aggregated RPC row with sane defaults; override per test.
const row = (over: Record<string, unknown> = {}) => ({
  client_id: 1,
  client_name: 'Dr. Ana',
  client_sigla: 'DA',
  client_cor: '#7c5cff',
  connected: true,
  username: 'ana',
  profile_picture_url: null,
  follower_count: 1100,
  authorization_status: 'active',
  token_expires_at: new Date(Date.now() + 30 * 86400000).toISOString(),
  last_synced_at: new Date().toISOString(),
  follower_first: 1000,
  follower_points: 5,
  follower_series: [1000, 1020, 1050, 1080, 1100],
  interactions_cur: 400,
  reach_cur: 10000,
  posts_cur: 8,
  reach_prev: 8000,
  posts_56d: 16,
  last_post_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  pl_agendados: 2,
  pl_em_producao: 1,
  pl_agente: 1,
  pl_falha: 0,
  ...over,
});

beforeEach(() => mocked.__resetSupabaseMock());

describe('downsample', () => {
  it('returns the series unchanged when short enough', () => {
    expect(downsample([1, 2, 3], 12)).toEqual([1, 2, 3]);
  });
  it('reduces a long series to at most max points, keeping first and last', () => {
    const out = downsample(
      Array.from({ length: 100 }, (_, i) => i),
      12,
    );
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99);
  });
});

describe('getClientHealthMonitor', () => {
  it('maps an aggregate row into derived metrics + status', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', { data: [row()], error: null });
    const res = await getClientHealthMonitor();
    const c = res.clients[0];
    expect(c.follower_delta).toBe(100); // 1100 - 1000 (absolute)
    expect(c.follower_delta_pct).toBeCloseTo(10); // 100 / 1000 * 100
    expect(c.engagement_rate).toBeCloseTo(4); // 400 / 10000 * 100
    expect(c.reach_trend_pct).toBeCloseTo(25); // (10000-8000)/8000*100
    expect(c.days_since_last_post).toBe(2);
    expect(c.score).not.toBeNull();
  });

  it('includes disconnected clients (not dropped)', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [
        row({
          client_id: 9,
          connected: false,
          username: null,
          last_synced_at: null,
          follower_first: 0,
          follower_points: 0,
          posts_56d: 0,
        }),
      ],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients).toHaveLength(1);
    expect(res.clients[0].status).toBe('desconectado');
    expect(res.summary.conexao).toBe(1);
  });

  it('flags revoked auth as reconectar', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [row({ authorization_status: 'revoked' })],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients[0].status).toBe('reconectar');
  });

  it('treats null last_synced_at as sincronizando, not stale', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [row({ last_synced_at: null })],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients[0].status).toBe('sincronizando');
  });

  it('null last_post_at → days_since_last_post null and sem_dados when no history', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [row({ last_post_at: null, posts_56d: 0, follower_points: 1 })],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.clients[0].days_since_last_post).toBeNull();
    expect(res.clients[0].status).toBe('sem_dados');
  });

  it('builds summary buckets from statuses', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: [
        row({ client_id: 1 }), // healthy/em_alta-ish → saudaveis bucket region
        row({ client_id: 2, connected: false }), // conexao
        row({
          client_id: 3,
          last_post_at: new Date(Date.now() - 40 * 86400000).toISOString(),
          pl_agendados: 0,
          pl_em_producao: 0,
        }), // inativo → atencao
      ],
      error: null,
    });
    const res = await getClientHealthMonitor();
    expect(res.summary.total).toBe(3);
    expect(res.summary.conexao).toBeGreaterThanOrEqual(1);
    expect(res.summary.atencao).toBeGreaterThanOrEqual(1);
  });

  it('returns empty result on RPC error without throwing', async () => {
    mocked.__queueSupabaseRpc('get_client_health_aggregates', {
      data: null,
      error: { message: 'boom' },
    });
    const res = await getClientHealthMonitor();
    expect(res.clients).toEqual([]);
    expect(res.summary.total).toBe(0);
  });
});
