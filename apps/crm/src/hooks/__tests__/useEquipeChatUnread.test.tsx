import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { mockGetEquipeChatUnread } = vi.hoisted(() => ({
  mockGetEquipeChatUnread: vi.fn(),
}));
vi.mock('@/store', () => ({ getEquipeChatUnread: mockGetEquipeChatUnread }));
vi.mock('../useWorkspaceLimits', () => ({ useWorkspaceLimits: vi.fn() }));

import { useWorkspaceLimits } from '../useWorkspaceLimits';
import { useEquipeChatUnread } from '../useEquipeChatUnread';

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

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetEquipeChatUnread.mockResolvedValue(5);
});

describe('useEquipeChatUnread', () => {
  it('returns 0 and never queries while feature_team_chat is off', async () => {
    setFeature(false);
    const { result } = renderHook(() => useEquipeChatUnread(), { wrapper: Wrapper });

    expect(result.current).toBe(0);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockGetEquipeChatUnread).not.toHaveBeenCalled();
  });

  it('returns the query result when feature_team_chat is on', async () => {
    setFeature(true);
    const { result } = renderHook(() => useEquipeChatUnread(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current).toBe(5));
    expect(mockGetEquipeChatUnread).toHaveBeenCalledTimes(1);
  });

  it('returns the query result for an unlimited workspace (features: null, isUnlimited: true)', async () => {
    setUnlimited();
    const { result } = renderHook(() => useEquipeChatUnread(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current).toBe(5));
    expect(mockGetEquipeChatUnread).toHaveBeenCalledTimes(1);
  });
});
