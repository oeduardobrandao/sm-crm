import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const store = vi.hoisted(() => ({ getDiscussaoNaoLidas: vi.fn() }));
vi.mock('../../../../store', () => store);

import { discussaoTriggerBadge, usePostDiscussaoNaoLidas } from '../usePostDiscussaoNaoLidas';

function wrapperWith(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('usePostDiscussaoNaoLidas', () => {
  beforeEach(() => {
    store.getDiscussaoNaoLidas.mockReset();
  });

  it('asks once, with sorted unique ids, and keys the query under the invalidated prefix', async () => {
    const qc = newClient();
    store.getDiscussaoNaoLidas.mockResolvedValue([]);
    const { result } = renderHook(
      () => usePostDiscussaoNaoLidas({ postIds: [9, 3, 9, 5], workflowIds: [2, 1] }),
      { wrapper: wrapperWith(qc) },
    );
    await waitFor(() => expect(store.getDiscussaoNaoLidas).toHaveBeenCalledTimes(1));
    expect(store.getDiscussaoNaoLidas).toHaveBeenCalledWith({
      postIds: [3, 5, 9],
      workflowIds: [1, 2],
    });
    expect(qc.getQueryCache().getAll()[0].queryKey).toEqual([
      'post-discussao-nao-lidas',
      [3, 5, 9],
      [1, 2],
    ]);
    expect(result.current.byPost.size).toBe(0);
  });

  it('does not call the RPC when there is nothing to ask', () => {
    const { result } = renderHook(
      () => usePostDiscussaoNaoLidas({ postIds: [], workflowIds: [] }),
      {
        wrapper: wrapperWith(newClient()),
      },
    );
    expect(store.getDiscussaoNaoLidas).not.toHaveBeenCalled();
    expect(result.current.byPost.size).toBe(0);
    expect(result.current.byWorkflow.size).toBe(0);
  });

  it('maps rows by post and sums unread per workflow', async () => {
    store.getDiscussaoNaoLidas.mockResolvedValue([
      { postId: 1, workflowId: 10, total: 4, naoLidas: 2 },
      { postId: 2, workflowId: 10, total: 1, naoLidas: 1 },
      { postId: 3, workflowId: 11, total: 5, naoLidas: 0 },
      { postId: 4, workflowId: null, total: 2, naoLidas: 2 },
    ]);
    const { result } = renderHook(
      () => usePostDiscussaoNaoLidas({ postIds: [4], workflowIds: [10, 11] }),
      { wrapper: wrapperWith(newClient()) },
    );
    await waitFor(() => expect(result.current.byPost.size).toBe(4));
    expect(result.current.byPost.get(1)).toEqual({
      postId: 1,
      workflowId: 10,
      total: 4,
      naoLidas: 2,
    });
    expect(result.current.byWorkflow.get(10)).toBe(3);
    expect(result.current.byWorkflow.get(11)).toBe(0);
    expect(result.current.byWorkflow.has(4 as never)).toBe(false);
  });

  it('counts a post once even when the server returns it twice', async () => {
    store.getDiscussaoNaoLidas.mockResolvedValue([
      { postId: 1, workflowId: 10, total: 4, naoLidas: 2 },
      { postId: 1, workflowId: 10, total: 4, naoLidas: 2 },
    ]);
    const { result } = renderHook(
      () => usePostDiscussaoNaoLidas({ postIds: [1], workflowIds: [10] }),
      { wrapper: wrapperWith(newClient()) },
    );
    await waitFor(() => expect(result.current.byPost.size).toBe(1));
    expect(result.current.byWorkflow.get(10)).toBe(2);
  });
});

describe('discussaoTriggerBadge', () => {
  it('shows unread with the dot flag and the plural label', () => {
    expect(discussaoTriggerBadge({ total: 9, naoLidas: 3 })).toEqual({
      count: 3,
      unread: true,
      label: '3 mensagens novas na discussão',
    });
  });

  it('uses the singular for one unread message', () => {
    expect(discussaoTriggerBadge({ total: 1, naoLidas: 1 })?.label).toBe(
      '1 mensagem nova na discussão',
    );
  });

  it('shows the total without a dot when nothing is unread', () => {
    expect(discussaoTriggerBadge({ total: 6, naoLidas: 0 })).toMatchObject({
      count: 6,
      unread: false,
    });
  });

  it('renders nothing until the totals arrive (no thread count standing in as messages)', () => {
    expect(discussaoTriggerBadge(undefined)).toBeNull();
  });

  it('renders nothing for an empty discussion', () => {
    expect(discussaoTriggerBadge({ total: 0, naoLidas: 0 })).toBeNull();
  });
});
