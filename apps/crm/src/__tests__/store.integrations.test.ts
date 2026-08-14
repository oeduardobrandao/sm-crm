import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

describe('getInstagramAccountStatuses', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('returns an empty map for empty input without querying', async () => {
    const map = await store.getInstagramAccountStatuses([]);
    expect(map.size).toBe(0);
    expect(mockedSupabase.__getSupabaseCalls()).toHaveLength(0);
  });

  it('derives revoked / expired / canPublish / canAutomate per client', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [
        {
          client_id: 1,
          authorization_status: 'active',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: ['instagram_business_content_publish'],
          comments_subscribed_at: null,
        },
        {
          client_id: 2,
          authorization_status: 'revoked',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: [],
          comments_subscribed_at: null,
        },
        {
          client_id: 3,
          authorization_status: 'active',
          token_expires_at: '2000-01-01T00:00:00.000Z',
          permissions: ['instagram_business_content_publish'],
          comments_subscribed_at: null,
        },
        {
          client_id: 4,
          authorization_status: 'active',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: ['instagram_business_content_publish', 'instagram_business_manage_comments'],
          comments_subscribed_at: '2026-08-01T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const map = await store.getInstagramAccountStatuses([1, 2, 3, 4]);

    expect(map.get(1)).toEqual({
      revoked: false,
      expired: false,
      canPublish: true,
      canAutomate: false,
    });
    expect(map.get(2)).toEqual({
      revoked: true,
      expired: false,
      canPublish: false,
      canAutomate: false,
    });
    expect(map.get(3)).toEqual({
      revoked: false,
      expired: true,
      canPublish: true,
      canAutomate: false,
    });
    expect(map.get(4)).toEqual({
      revoked: false,
      expired: false,
      canPublish: true,
      canAutomate: true,
    });
  });

  it('canAutomate is false when the permission is present but the comments webhook was never confirmed', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [
        {
          client_id: 5,
          authorization_status: 'active',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: ['instagram_business_manage_comments'],
          comments_subscribed_at: null,
        },
      ],
      error: null,
    });

    const map = await store.getInstagramAccountStatuses([5]);

    expect(map.get(5)?.canAutomate).toBe(false);
  });

  it('canAutomate requires an active, non-expired authorization even with permissions and subscription', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [
        {
          client_id: 6,
          authorization_status: 'revoked',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: ['instagram_business_manage_comments'],
          comments_subscribed_at: '2026-08-01T00:00:00.000Z',
        },
        {
          client_id: 7,
          authorization_status: 'active',
          token_expires_at: '2000-01-01T00:00:00.000Z',
          permissions: ['instagram_business_manage_comments'],
          comments_subscribed_at: '2026-08-01T00:00:00.000Z',
        },
        {
          client_id: 8,
          authorization_status: 'active',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: ['instagram_business_manage_comments'],
          comments_subscribed_at: '2026-08-01T00:00:00.000Z',
        },
      ],
      error: null,
    });

    const map = await store.getInstagramAccountStatuses([6, 7, 8]);

    expect(map.get(6)?.canAutomate).toBe(false); // revoked, despite permissions + subscription
    expect(map.get(7)?.canAutomate).toBe(false); // expired token, despite permissions + subscription
    expect(map.get(8)?.canAutomate).toBe(true); // active + scope + subscription
  });

  it('throws when the query errors', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: null,
      error: { message: 'db error' },
    });
    await expect(store.getInstagramAccountStatuses([1])).rejects.toBeTruthy();
  });
});
