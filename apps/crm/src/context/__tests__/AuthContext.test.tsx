import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');
vi.mock('../../store', async () => {
  const actual = await vi.importActual<typeof import('../../store')>('../../store');
  return {
    ...actual,
    initStoreRole: vi.fn(async () => undefined),
  };
});

import * as supabaseModule from '../../lib/supabase';
import { AuthProvider, useAuth } from '../AuthContext';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
  __setCurrentUser: (user: { id: string } | null) => void;
  __emitAuthChange: (event: string, session: { user: { id: string } | null } | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="role">{auth.role}</span>
      <span data-testid="user">{auth.user?.id ?? 'anon'}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
      <button onClick={() => { void auth.signOut(); }}>sair</button>
    </div>
  );
}

describe('AuthProvider', () => {
  it('hydrates the authenticated user role from the cached profile', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-99' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-99',
      nome: 'Joana Lima',
      role: 'admin',
      conta_id: 'conta-admin',
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('false');
    });

    expect(screen.getByTestId('user')).toHaveTextContent('user-99');
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
  });

  it('clears profile when onAuthStateChange emits a signed-out session', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
    });

    await act(async () => {
      mockedSupabase.__emitAuthChange('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('anon');
      expect(screen.getByTestId('role')).toHaveTextContent('agent');
    });
  });

  it('signOut clears the profile from context', async () => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentUser({ id: 'user-1' });
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('owner');
    });

    await act(async () => {
      screen.getByText('sair').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('role')).toHaveTextContent('agent');
    });
  });

  it('useAuth throws when used outside AuthProvider', () => {
    // Silence the expected React error boundary log.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within AuthProvider');
    } finally {
      spy.mockRestore();
    }
  });
});
