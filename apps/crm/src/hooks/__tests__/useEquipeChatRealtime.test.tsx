import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/lib/supabase');
vi.mock('../useWorkspaceLimits', () => ({ useWorkspaceLimits: vi.fn() }));

import * as mockedSupabase from '@/lib/supabase';
import { useWorkspaceLimits } from '../useWorkspaceLimits';
import { useEquipeChatRealtime } from '../useEquipeChatRealtime';
import { AuthContext } from '../../context/AuthContext';

type ChannelFilter = { event: string; schema: string; table: string; filter?: string } | null;

type MockedSupabase = typeof mockedSupabase & {
  __resetSupabaseMock: () => void;
  __getChannelCalls: () => string[];
  __getEquipeMensagemSubscription: () => ChannelFilter;
  __emitEquipeMensagemInsert: (row: unknown) => void;
  removedChannelCalls: unknown[];
};
const m = mockedSupabase as unknown as MockedSupabase;

const mockedUseWorkspaceLimits = vi.mocked(useWorkspaceLimits);

function setFeature(enabled: boolean) {
  mockedUseWorkspaceLimits.mockReturnValue({
    limits: null,
    features: { feature_team_chat: enabled } as never,
    planName: null,
    isLoading: false,
    isUnlimited: false,
  } as never);
}

/** The hook's real shape for an unlimited workspace: `features` is null,
 * never a features object with every flag set to true. */
function setUnlimited() {
  mockedUseWorkspaceLimits.mockReturnValue({
    limits: null,
    features: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  } as never);
}

function makeWrapper(userId: string | null, workspaceId: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuthContext.Provider
        value={
          {
            user: userId ? { id: userId } : null,
            profile: workspaceId ? { conta_id: workspaceId } : null,
            role: 'owner',
            workspaceRole: 'owner',
            membershipResolved: true,
            canSeeFinancials: 'unknown',
            loading: false,
            refetchProfile: async () => {},
            signOut: async () => {},
          } as never
        }
      >
        {children}
      </AuthContext.Provider>
    </QueryClientProvider>
  );
  return { Wrapper, qc };
}

beforeEach(() => {
  m.__resetSupabaseMock();
  vi.clearAllMocks();
  setFeature(true);
});

describe('useEquipeChatRealtime', () => {
  it('subscribes to a channel named equipe-chat:<user>:<workspace> when the feature is on', () => {
    const { Wrapper } = makeWrapper('user-1', 'conta-1');
    renderHook(() => useEquipeChatRealtime(null), { wrapper: Wrapper });

    expect(m.__getChannelCalls()).toContain('equipe-chat:user-1:conta-1');
    expect(m.__getEquipeMensagemSubscription()).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'equipe_mensagens',
    });
  });

  it('does not subscribe when feature_team_chat is off', () => {
    setFeature(false);
    const { Wrapper } = makeWrapper('user-1', 'conta-1');
    renderHook(() => useEquipeChatRealtime(null), { wrapper: Wrapper });

    expect(m.__getChannelCalls()).not.toContain('equipe-chat:user-1:conta-1');
    expect(m.__getEquipeMensagemSubscription()).toBeNull();
  });

  it('subscribes for an unlimited workspace (features: null, isUnlimited: true)', () => {
    setUnlimited();
    const { Wrapper } = makeWrapper('user-1', 'conta-1');
    renderHook(() => useEquipeChatRealtime(null), { wrapper: Wrapper });

    expect(m.__getChannelCalls()).toContain('equipe-chat:user-1:conta-1');
    expect(m.__getEquipeMensagemSubscription()).toMatchObject({
      event: 'INSERT',
      schema: 'public',
      table: 'equipe_mensagens',
    });
  });

  it('invalidates equipe-mensagens (active thread) and equipe-conversas for an insert into the active conversation', () => {
    const { Wrapper, qc } = makeWrapper('user-1', 'conta-1');
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEquipeChatRealtime(7), { wrapper: Wrapper });

    act(() => {
      m.__emitEquipeMensagemInsert({ conversa_id: 7, conta_id: 'conta-1' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['equipe-mensagens', 7] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['equipe-conversas'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['equipe-chat-unread'] });
  });

  it('invalidates equipe-conversas and equipe-chat-unread (not the active thread) for an insert into another conversation', () => {
    const { Wrapper, qc } = makeWrapper('user-1', 'conta-1');
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEquipeChatRealtime(7), { wrapper: Wrapper });

    act(() => {
      m.__emitEquipeMensagemInsert({ conversa_id: 9, conta_id: 'conta-1' });
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['equipe-conversas'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['equipe-chat-unread'] });
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['equipe-mensagens', 7] });
  });

  it('ignores a payload from a different workspace (bleed guard)', () => {
    const { Wrapper, qc } = makeWrapper('user-1', 'conta-1');
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEquipeChatRealtime(7), { wrapper: Wrapper });

    act(() => {
      m.__emitEquipeMensagemInsert({ conversa_id: 7, conta_id: 'conta-X' });
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('removes the channel on unmount and stops reacting to inserts afterwards', () => {
    const { Wrapper, qc } = makeWrapper('user-1', 'conta-1');
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { unmount } = renderHook(() => useEquipeChatRealtime(7), { wrapper: Wrapper });
    const before = m.removedChannelCalls.length;

    unmount();

    expect(m.removedChannelCalls.length).toBe(before + 1);

    // Real cleanup, not just a call-count check: a hook that skipped its
    // effect-cleanup return would still pass an assertion that only counts
    // removeChannel() calls. Confirm the listener is actually gone by
    // emitting after unmount and expecting no invalidation at all.
    act(() => {
      m.__emitEquipeMensagemInsert({ conversa_id: 7, conta_id: 'conta-1' });
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
