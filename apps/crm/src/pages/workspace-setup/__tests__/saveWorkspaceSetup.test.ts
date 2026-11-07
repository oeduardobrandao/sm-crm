import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/supabase');

import * as supabaseModule from '../../../lib/supabase';
import { saveWorkspaceSetup } from '../saveWorkspaceSetup';

type QueryCall = {
  table: string;
  operation: string;
  payload?: unknown;
  modifiers: Array<{ method: string; args: unknown[] }>;
};

const mocked = supabaseModule as typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown }>
  ) => void;
  __getSupabaseCalls: () => QueryCall[];
};

const WS_ID = '3f9a1c2b-0000-4000-8000-000000000000';

const input = {
  userId: 'u-1',
  workspaceId: WS_ID,
  nome: 'Ana',
  empresa: 'Agência Ótima',
  telefone: '(11) 99999-9999',
  marketingOptIn: true,
};

const writes = () => mocked.__getSupabaseCalls().filter((c) => c.operation === 'update');
const eqArgs = (call: QueryCall) =>
  call.modifiers.filter((m) => m.method === 'eq').map((m) => m.args);

describe('saveWorkspaceSetup', () => {
  beforeEach(() => {
    mocked.__resetSupabaseMock();
  });

  it('rewrites the placeholder slug and saves the profile last', async () => {
    mocked.__queueSupabaseResult('workspaces', 'select', {
      data: { slug: 'workspace-3f9a1c2b' },
    });

    await saveWorkspaceSetup(input);

    const calls = mocked.__getSupabaseCalls();
    expect(calls.map((c) => `${c.table}:${c.operation}`)).toEqual([
      'workspaces:select',
      'workspaces:update',
      'contas:update',
      'profiles:update',
    ]);
    expect(eqArgs(calls[0])).toEqual([['id', WS_ID]]);

    const [ws, contas, profile] = writes();
    expect(ws.payload).toEqual({ name: 'Agência Ótima', slug: 'agencia-otima-3f9a1c2b' });
    expect(eqArgs(ws)).toEqual([['id', WS_ID]]);
    expect(contas.payload).toEqual({ nome: 'Agência Ótima', slug: 'agencia-otima-3f9a1c2b' });
    expect(eqArgs(contas)).toEqual([['id', WS_ID]]);
    expect(profile.payload).toEqual({
      nome: 'Ana',
      telefone: '(11) 99999-9999',
      marketing_opt_in: true,
      empresa: 'Agência Ótima',
    });
    expect(eqArgs(profile)).toEqual([['id', 'u-1']]);
  });

  it('keeps an existing slug untouched', async () => {
    mocked.__queueSupabaseResult('workspaces', 'select', {
      data: { slug: 'agencia-velha-3f9a1c2b' },
    });

    await saveWorkspaceSetup(input);

    const [ws, contas] = writes();
    expect(ws.payload).toEqual({ name: 'Agência Ótima' });
    expect(ws.payload).not.toHaveProperty('slug');
    expect(contas.payload).toEqual({ nome: 'Agência Ótima' });
  });

  it('treats the contas mirror as best-effort', async () => {
    mocked.__queueSupabaseResult('workspaces', 'select', {
      data: { slug: 'workspace-3f9a1c2b' },
    });
    mocked.__queueSupabaseResult('contas', 'update', {
      error: { code: '42501', message: 'permission denied' },
    });

    await expect(saveWorkspaceSetup(input)).resolves.toBeUndefined();
    expect(writes().map((c) => c.table)).toEqual(['workspaces', 'contas', 'profiles']);
  });

  it('rejects and never touches the profile when the workspace update fails', async () => {
    mocked.__queueSupabaseResult('workspaces', 'select', {
      data: { slug: 'workspace-3f9a1c2b' },
    });
    mocked.__queueSupabaseResult('workspaces', 'update', {
      error: { message: 'boom' },
    });

    await expect(saveWorkspaceSetup(input)).rejects.toBeTruthy();
    expect(mocked.__getSupabaseCalls().some((c) => c.table === 'profiles')).toBe(false);
  });

  it('rejects when the slug lookup fails', async () => {
    mocked.__queueSupabaseResult('workspaces', 'select', { error: { message: 'boom' } });

    await expect(saveWorkspaceSetup(input)).rejects.toBeTruthy();
    expect(writes()).toEqual([]);
  });

  it('rejects when the profile update fails', async () => {
    mocked.__queueSupabaseResult('workspaces', 'select', {
      data: { slug: 'agencia-3f9a1c2b' },
    });
    mocked.__queueSupabaseResult('profiles', 'update', { error: { message: 'boom' } });

    await expect(saveWorkspaceSetup(input)).rejects.toBeTruthy();
  });
});
