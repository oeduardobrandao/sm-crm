import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockMaybeSingle, mockMembershipGetUser, mockGetContaId } = vi.hoisted(() => ({
  mockMaybeSingle: vi.fn(),
  mockMembershipGetUser: vi.fn(),
  mockGetContaId: vi.fn(),
}));

// The shared manual mock, with the two functions this suite counts wrapped in spies.
vi.mock('../../lib/supabase', async () => {
  const mock = await import('../../lib/__mocks__/supabase');
  return {
    ...mock,
    getCurrentProfile: vi.fn(mock.getCurrentProfile),
    patchCachedProfile: vi.fn(mock.patchCachedProfile),
  };
});

vi.mock('../../store/core', () => ({
  supabase: {
    auth: { getUser: mockMembershipGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
      }),
    }),
  },
  getContaId: mockGetContaId,
}));

vi.mock('../../lib/analytics', () => ({
  identifyWorkspaceUser: vi.fn(),
  resetAnalytics: vi.fn(),
}));

import * as supabaseModule from '../../lib/supabase';
import { AuthProvider, useAuth } from '../AuthContext';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __setCurrentUser: (user: { id: string; email?: string } | null) => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mocked = supabaseModule as MockedSupabaseModule;
const getCurrentProfileSpy = vi.mocked(supabaseModule.getCurrentProfile);
const patchCachedProfileSpy = vi.mocked(supabaseModule.patchCachedProfile);

let renders: Array<{ loading: boolean; empresa: unknown }> = [];

function Probe() {
  const auth = useAuth();
  renders.push({ loading: auth.loading, empresa: auth.profile?.empresa });
  return (
    <div>
      <span data-testid="loading">{String(auth.loading)}</span>
      <span data-testid="empresa">{String(auth.profile?.empresa ?? '')}</span>
      <span data-testid="telefone">{String(auth.profile?.telefone ?? '')}</span>
      <span data-testid="nome">{String(auth.profile?.nome ?? '')}</span>
      <button onClick={() => auth.patchProfile({ empresa: 'Agência', telefone: '11999999999' })}>
        patch
      </button>
    </div>
  );
}

function renderWithAuth() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AuthProvider.patchProfile', () => {
  beforeEach(() => {
    renders = [];
    mocked.__resetSupabaseMock();
    mocked.__setCurrentUser({ id: 'user-1' });
    mocked.__setCurrentProfile({
      id: 'user-1',
      nome: 'Ana',
      role: 'owner',
      conta_id: 'conta-1',
      active_workspace_id: 'conta-1',
      empresa: '',
    });
    mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockGetContaId.mockResolvedValue('conta-1');
    mockMaybeSingle.mockResolvedValue({ data: { role: 'owner' }, error: null });
    getCurrentProfileSpy.mockClear();
    patchCachedProfileSpy.mockClear();
  });

  it('merges the patch into the profile without loading or a refetch', async () => {
    renderWithAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('empresa')).toHaveTextContent('');

    const fetchesBefore = getCurrentProfileSpy.mock.calls.length;
    renders = [];

    act(() => {
      screen.getByRole('button', { name: 'patch' }).click();
    });

    expect(screen.getByTestId('empresa')).toHaveTextContent('Agência');
    expect(screen.getByTestId('telefone')).toHaveTextContent('11999999999');
    // Fields outside the patch are kept.
    expect(screen.getByTestId('nome')).toHaveTextContent('Ana');
    // No skeleton swap: loading stayed false on every render after the patch.
    expect(renders.length).toBeGreaterThan(0);
    expect(renders.every((r) => r.loading === false)).toBe(true);
    expect(getCurrentProfileSpy.mock.calls.length).toBe(fetchesBefore);

    // The module-level cache gets the same patch, so a later non-forced read agrees.
    expect(patchCachedProfileSpy).toHaveBeenCalledWith({
      empresa: 'Agência',
      telefone: '11999999999',
    });
    await expect(supabaseModule.getCurrentProfile()).resolves.toMatchObject({
      empresa: 'Agência',
      telefone: '11999999999',
      nome: 'Ana',
    });
  });
});
