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

function updateCalls() {
  return mockedSupabase
    .__getSupabaseCalls()
    .filter((entry) => entry.table === 'hub_briefing_questions' && entry.operation === 'update');
}

describe('reorderBriefingQuestions', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('updates display_order once per row, scoped by id', async () => {
    mockedSupabase.__queueSupabaseResult(
      'hub_briefing_questions',
      'update',
      { data: null, error: null },
      { data: null, error: null },
    );

    await store.reorderBriefingQuestions([
      { id: 'q1', display_order: 2 },
      { id: 'q2', display_order: 0 },
    ]);

    const calls = updateCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0].payload).toEqual({ display_order: 2 });
    expect(calls[0].modifiers).toContainEqual({ method: 'eq', args: ['id', 'q1'] });
    expect(calls[1].payload).toEqual({ display_order: 0 });
    expect(calls[1].modifiers).toContainEqual({ method: 'eq', args: ['id', 'q2'] });
  });

  it('throws when an update fails', async () => {
    mockedSupabase.__queueSupabaseResult('hub_briefing_questions', 'update', {
      data: null,
      error: { message: 'boom' },
    });

    await expect(
      store.reorderBriefingQuestions([{ id: 'q1', display_order: 1 }]),
    ).rejects.toBeTruthy();
  });

  it('does nothing when there are no updates', async () => {
    await store.reorderBriefingQuestions([]);
    expect(updateCalls()).toHaveLength(0);
  });
});
