import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import { getAnalyticsOverview } from '../analytics';

type MockedSupabaseModule = typeof supabaseModule & {
  __queueSupabaseResult: (table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

const TEST_ACCOUNT = {
  id: 1,
  ig_user_id: 'ig-123',
  client_id: 1,
  follower_count: 1050,
  profile_views_28d: 200,
  website_clicks_28d: 50,
};

// Use a fixed dateRange so the period boundaries are deterministic:
// current: Apr 1–14, previous: ~Mar 19–Mar 31
const DATE_RANGE = { start: '2026-04-01', end: '2026-04-14' };

describe('analytics delta calculations', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({ conta_id: 'conta-1' });
  });

  it('handles zero previous follower delta without division by zero (deltaPercent = 100)', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: TEST_ACCOUNT,
      error: null,
    });
    // current posts, previous posts (both empty — we're testing follower delta only)
    mockedSupabase.__queueSupabaseResult('instagram_posts', 'select',
      { data: [], error: null },
      { data: [], error: null },
    );
    // Follower history: growth in current period only, nothing in previous period
    mockedSupabase.__queueSupabaseResult('instagram_follower_history', 'select', {
      data: [
        { date: '2026-04-01', follower_count: 1000 },
        { date: '2026-04-14', follower_count: 1050 },
      ],
      error: null,
    });

    const result = await getAnalyticsOverview(1, 30, DATE_RANGE);

    // followerDeltaCurrent = 50, followerDeltaPrevious = 0
    // makeDelta(50, 0) → deltaPercent = 100, direction = 'up'
    expect(result.data.followers.deltaPercent).toBe(100);
    expect(result.data.followers.direction).toBe('up');
    expect(result.data.followers.current).toBe(50);
    expect(result.data.followers.previous).toBe(0);
  });

  it('returns stable direction and zero deltaPercent when current equals previous', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: TEST_ACCOUNT,
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_posts', 'select',
      { data: [], error: null },
      { data: [], error: null },
    );
    // Both current (+30) and previous (+30) show the same follower growth
    mockedSupabase.__queueSupabaseResult('instagram_follower_history', 'select', {
      data: [
        { date: '2026-03-19', follower_count: 900 },
        { date: '2026-03-30', follower_count: 930 },
        { date: '2026-04-01', follower_count: 1000 },
        { date: '2026-04-14', follower_count: 1030 },
      ],
      error: null,
    });

    const result = await getAnalyticsOverview(1, 30, DATE_RANGE);

    // followerDeltaCurrent = 30, followerDeltaPrevious = 30
    // makeDelta(30, 30) → delta = 0, deltaPercent = 0, direction = 'stable'
    expect(result.data.followers.direction).toBe('stable');
    expect(result.data.followers.deltaPercent).toBe(0);
    expect(result.data.followers.delta).toBe(0);
  });

  it('returns down direction when current is lower than previous', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: TEST_ACCOUNT,
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('instagram_posts', 'select',
      { data: [], error: null },
      { data: [], error: null },
    );
    // Current period: lost 20 followers. Previous period: gained 40.
    mockedSupabase.__queueSupabaseResult('instagram_follower_history', 'select', {
      data: [
        { date: '2026-03-19', follower_count: 960 },
        { date: '2026-03-30', follower_count: 1000 },
        { date: '2026-04-01', follower_count: 1020 },
        { date: '2026-04-14', follower_count: 1000 },
      ],
      error: null,
    });

    const result = await getAnalyticsOverview(1, 30, DATE_RANGE);

    // followerDeltaCurrent = -20, followerDeltaPrevious = 40
    expect(result.data.followers.direction).toBe('down');
    expect(result.data.followers.current).toBe(-20);
  });
});
