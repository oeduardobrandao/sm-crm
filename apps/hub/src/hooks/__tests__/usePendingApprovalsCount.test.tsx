import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { usePendingApprovalsCount } from '../usePendingApprovalsCount';

vi.mock('../../api', () => ({ fetchPosts: vi.fn(), fetchLinhas: vi.fn() }));

import { fetchLinhas, fetchPosts } from '../../api';

// One client per test, created outside the wrapper: a client built inside it would be
// replaced on every re-render and drop the cached data.
let qc: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('usePendingApprovalsCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient();
    vi.mocked(fetchPosts).mockResolvedValue({
      posts: [
        { status: 'enviado_cliente' },
        { status: 'enviado_cliente' },
        { status: 'aprovado_cliente' },
      ],
    } as never);
    vi.mocked(fetchLinhas).mockResolvedValue({
      linhas: [{ status: 'enviada' }, { status: 'enviada' }, { status: 'aprovada' }],
    } as never);
  });

  it('counts only enviado_cliente posts', async () => {
    const { result } = renderHook(() => usePendingApprovalsCount('tok', false), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });

  it('badge adds enviada linhas when flag on', async () => {
    const { result } = renderHook(() => usePendingApprovalsCount('tok', true), { wrapper });
    await waitFor(() => expect(result.current).toBe(4));
    expect(fetchPosts).toHaveBeenCalled();
  });

  it('ignores linhas when flag off', async () => {
    const { result } = renderHook(() => usePendingApprovalsCount('tok', false), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
    expect(fetchLinhas).not.toHaveBeenCalled();
  });
});
