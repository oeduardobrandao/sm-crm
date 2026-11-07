import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Sign-out inside the iOS app unregisters this device's push token first (the RPC
// needs the session), but a slow or hung unregister must never keep the user signed in.

const { mockMaybeSingle, mockMembershipGetUser, mockGetContaId, unregister, nativeFlag } =
  vi.hoisted(() => ({
    mockMaybeSingle: vi.fn(),
    mockMembershipGetUser: vi.fn(),
    mockGetContaId: vi.fn(),
    unregister: vi.fn<() => Promise<void>>(),
    nativeFlag: { value: true },
  }));

vi.mock('../../lib/supabase');
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
vi.mock('../../native/platform', () => ({
  isNativeApp: () => nativeFlag.value,
  nativePlatform: () => (nativeFlag.value ? 'ios' : null),
}));
vi.mock('../../native/push', () => ({ unregisterNativePush: unregister }));

import * as supabaseModule from '../../lib/supabase';
import { AuthProvider, useAuth } from '../AuthContext';

type MockedSupabaseModule = typeof supabaseModule & {
  __resetSupabaseMock: () => void;
  __setCurrentUser: (user: { id: string } | null) => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};
const mocked = supabaseModule as MockedSupabaseModule;

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="user">{auth.user?.id ?? 'anon'}</span>
      <button onClick={() => void auth.signOut()}>sair</button>
    </div>
  );
}

async function renderSignedIn() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('user-1'));
}

let order: string[];

beforeEach(() => {
  mocked.__resetSupabaseMock();
  mocked.__setCurrentUser({ id: 'user-1' });
  mocked.__setCurrentProfile({ id: 'user-1', nome: 'Eduardo', role: 'owner', conta_id: 'conta-1' });
  mockMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockMembershipGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockGetContaId.mockResolvedValue('conta-1');
  nativeFlag.value = true;
  order = [];
  const realSignOut = mocked.supabase.auth.signOut.bind(mocked.supabase.auth);
  vi.spyOn(mocked.supabase.auth, 'signOut').mockImplementation(async () => {
    order.push('signOut');
    return realSignOut();
  });
  unregister.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuthContext signOut inside the iOS app', () => {
  it('unregisters the push token before supabase signOut', async () => {
    unregister.mockImplementation(async () => {
      order.push('unregister');
    });
    await renderSignedIn();
    await act(async () => {
      screen.getByText('sair').click();
    });
    await waitFor(() => expect(order).toEqual(['unregister', 'signOut']));
  });

  it('a hung unregister does not block sign-out past 3 seconds', async () => {
    unregister.mockImplementation(() => new Promise<void>(() => {}));
    await renderSignedIn();
    vi.useFakeTimers();
    await act(async () => {
      screen.getByText('sair').click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_900);
    });
    expect(order).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(order).toEqual(['signOut']);
  });

  it('a rejecting unregister does not block sign-out', async () => {
    unregister.mockRejectedValue(new Error('offline'));
    await renderSignedIn();
    await act(async () => {
      screen.getByText('sair').click();
    });
    await waitFor(() => expect(order).toEqual(['signOut']));
  });

  it('on the web, sign-out never touches push', async () => {
    nativeFlag.value = false;
    await renderSignedIn();
    await act(async () => {
      screen.getByText('sair').click();
    });
    await waitFor(() => expect(order).toEqual(['signOut']));
    expect(unregister).not.toHaveBeenCalled();
  });
});
