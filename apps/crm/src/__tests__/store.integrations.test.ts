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

  it('derives revoked / expired / canPublish per client', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [
        {
          client_id: 1,
          authorization_status: 'active',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: ['instagram_business_content_publish'],
        },
        {
          client_id: 2,
          authorization_status: 'revoked',
          token_expires_at: '2999-01-01T00:00:00.000Z',
          permissions: [],
        },
        {
          client_id: 3,
          authorization_status: 'active',
          token_expires_at: '2000-01-01T00:00:00.000Z',
          permissions: ['instagram_business_content_publish'],
        },
      ],
      error: null,
    });

    const map = await store.getInstagramAccountStatuses([1, 2, 3]);

    expect(map.get(1)).toEqual({ revoked: false, expired: false, canPublish: true });
    expect(map.get(2)).toEqual({ revoked: true, expired: false, canPublish: false });
    expect(map.get(3)).toEqual({ revoked: false, expired: true, canPublish: true });
  });

  it('throws when the query errors', async () => {
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: null,
      error: { message: 'db error' },
    });
    await expect(store.getInstagramAccountStatuses([1])).rejects.toBeTruthy();
  });
});
