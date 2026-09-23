import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { type ReactNode } from 'react';

const store = vi.hoisted(() => ({ getMembros: vi.fn() }));
vi.mock('@/store', () => store);
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

import { useCurrentMembro } from '../useCurrentMembro';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useCurrentMembro', () => {
  beforeEach(() => {
    store.getMembros.mockReset();
  });

  it('resolves the membro linked by crm_user_id and reports isSuccess', async () => {
    store.getMembros.mockResolvedValue([
      { id: 1, nome: 'Outra', crm_user_id: 'user-2' },
      { id: 7, nome: 'Eu', crm_user_id: 'user-1' },
    ]);
    const { result } = renderHook(() => useCurrentMembro(), { wrapper: wrapper() });
    expect(result.current.isSuccess).toBe(false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.membro?.id).toBe(7);
    expect(result.current.isError).toBe(false);
  });

  it('returns null membro with isSuccess when nobody is linked', async () => {
    store.getMembros.mockResolvedValue([{ id: 1, nome: 'Outra', crm_user_id: null }]);
    const { result } = renderHook(() => useCurrentMembro(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.membro).toBeNull();
  });

  it('reports isError when getMembros rejects', async () => {
    store.getMembros.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useCurrentMembro(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.membro).toBeNull();
  });
});
