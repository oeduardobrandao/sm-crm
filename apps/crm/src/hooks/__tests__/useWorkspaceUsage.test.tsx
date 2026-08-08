import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc: rpcMock } }));

import { useWorkspaceUsage } from '../useWorkspaceUsage';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => rpcMock.mockReset());

describe('useWorkspaceUsage', () => {
  it('returns the usage object from the workspace_usage RPC', async () => {
    rpcMock.mockResolvedValue({ data: { clients: 2, storage_used_bytes: 12345 }, error: null });
    const { result } = renderHook(() => useWorkspaceUsage(), { wrapper });
    await waitFor(() => expect(result.current.usage).not.toBeNull());
    expect(rpcMock).toHaveBeenCalledWith('workspace_usage');
    expect(result.current.usage).toEqual({ clients: 2, storage_used_bytes: 12345 });
  });

  it('flags isError when the RPC fails', async () => {
    rpcMock.mockResolvedValue({ data: null, error: new Error('boom') });
    const { result } = renderHook(() => useWorkspaceUsage(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.usage).toBeNull();
  });
});
