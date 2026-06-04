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
  __queueSupabaseRpc: (
    name: string,
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase
    .__getSupabaseCalls()
    .filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

describe('store edit suggestions', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('getPostEditSuggestions returns empty array for empty input', async () => {
    const result = await store.getPostEditSuggestions([]);
    expect(result).toEqual([]);
  });

  it('getPostEditSuggestions queries pending suggestions with in filter', async () => {
    mockedSupabase.__queueSupabaseResult('post_edit_suggestions', 'select', {
      data: [
        {
          id: 1,
          post_id: 100,
          suggested_conteudo: { type: 'doc', content: [] },
          suggested_conteudo_plain: 'novo texto',
          suggested_ig_caption: null,
          changed_fields: ['conteudo'],
          status: 'pending',
          updated_at: '2026-05-25T12:00:00Z',
        },
      ],
      error: null,
    });

    const result = await store.getPostEditSuggestions([100, 101]);

    expect(result).toHaveLength(1);
    expect(result[0].post_id).toBe(100);
    const call = getCalls('post_edit_suggestions', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'in', args: ['post_id', [100, 101]] });
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['status', 'pending'] });
  });

  it('acceptEditSuggestion calls the RPC with suggestion id', async () => {
    mockedSupabase.__queueSupabaseRpc('accept_edit_suggestion', {
      data: null,
      error: null,
    });

    await store.acceptEditSuggestion(42);

    const call = getCalls('rpc:accept_edit_suggestion', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_suggestion_id: 42 });
  });

  it('rejectEditSuggestion calls the RPC with suggestion id', async () => {
    mockedSupabase.__queueSupabaseRpc('reject_edit_suggestion', {
      data: null,
      error: null,
    });

    await store.rejectEditSuggestion(7);

    const call = getCalls('rpc:reject_edit_suggestion', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_suggestion_id: 7 });
  });

  it('acceptEditSuggestion throws on error', async () => {
    mockedSupabase.__queueSupabaseRpc('accept_edit_suggestion', {
      data: null,
      error: { message: 'Suggestion not found' },
    });

    await expect(store.acceptEditSuggestion(999)).rejects.toThrow();
  });

  it('rejectEditSuggestion throws on error', async () => {
    mockedSupabase.__queueSupabaseRpc('reject_edit_suggestion', {
      data: null,
      error: { message: 'Suggestion is not pending' },
    });

    await expect(store.rejectEditSuggestion(999)).rejects.toThrow();
  });
});
