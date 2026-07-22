import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { usePendingApprovalsCount } from '../usePendingApprovalsCount';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({
    posts: [
      { status: 'enviado_cliente' },
      { status: 'enviado_cliente' },
      { status: 'aprovado_cliente' },
    ],
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('usePendingApprovalsCount', () => {
  it('counts only enviado_cliente posts', async () => {
    const { result } = renderHook(() => usePendingApprovalsCount('tok'), { wrapper });
    await waitFor(() => expect(result.current).toBe(2));
  });
});
