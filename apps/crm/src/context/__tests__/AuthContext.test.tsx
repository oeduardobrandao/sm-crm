import { render, screen, waitFor } from '@testing-library/react';
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
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="role">{auth.role}</span>
      <span data-testid="user">{auth.user?.id ?? 'anon'}</span>
      <span data-testid="loading">{String(auth.loading)}</span>
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
});
