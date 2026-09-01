import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { ActivePost } from '../../../../store';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const mockUpdate = vi.fn();
vi.mock('../../../../store', () => ({
  updateWorkflowPost: (...args: unknown[]) => mockUpdate(...args),
}));

import { useUpdatePostStatus } from '../useUpdatePostStatus';

function makePost(overrides: Partial<ActivePost> = {}): ActivePost {
  return {
    id: 1,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Fluxo Base',
    titulo: 'Post',
    tipo: 'feed',
    status: 'rascunho',
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...overrides,
  };
}

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
}

describe('useUpdatePostStatus', () => {
  let qc: QueryClient;

  beforeEach(() => {
    qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    mockUpdate.mockReset();
    vi.mocked(toast.error).mockClear();
  });

  it('optimistically patches the active-posts cache before the write resolves', async () => {
    let resolveWrite: (v: unknown) => void = () => {};
    mockUpdate.mockReturnValue(
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
    );
    qc.setQueryData(['active-posts'], [makePost({ id: 5, status: 'rascunho' })]);

    const { result } = renderHook(() => useUpdatePostStatus(), { wrapper: wrapperFor(qc) });
    result.current.mutate({
      id: 5,
      workflowId: 10,
      key: 'revisao_interna',
      canonical: 'revisao_interna',
    });

    await waitFor(() => {
      const cached = qc.getQueryData<ActivePost[]>(['active-posts']);
      expect(cached?.[0]).toMatchObject({ status: 'revisao_interna', custom_status_id: null });
    });

    resolveWrite({});
  });

  it('rolls back the cache and toasts on a failed write', async () => {
    mockUpdate.mockRejectedValue(new Error('boom'));
    qc.setQueryData(['active-posts'], [makePost({ id: 6, status: 'rascunho' })]);

    const { result } = renderHook(() => useUpdatePostStatus(), { wrapper: wrapperFor(qc) });
    result.current.mutate({
      id: 6,
      workflowId: 10,
      key: 'revisao_interna',
      canonical: 'revisao_interna',
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Erro ao atualizar status'));
    expect(qc.getQueryData<ActivePost[]>(['active-posts'])?.[0]).toMatchObject({
      status: 'rascunho',
    });
  });

  it('invalidates active-posts, the owning workflow, and all five board counters on settle', async () => {
    mockUpdate.mockResolvedValue({});
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdatePostStatus(), { wrapper: wrapperFor(qc) });
    result.current.mutate({
      id: 7,
      workflowId: 42,
      key: 'revisao_interna',
      canonical: 'revisao_interna',
    });

    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['active-posts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-posts-with-props', 42] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-posts-counts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-approved-posts-counts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-cleared-cliente-counts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflow-revisao-interna-counts'] });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['workflow-awaiting-cliente-counts'],
      });
    });
  });

  it('skips invalidating a workflow query when there is no owning workflow', async () => {
    mockUpdate.mockResolvedValue({});
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdatePostStatus(), { wrapper: wrapperFor(qc) });
    result.current.mutate({ id: 8, workflowId: null, key: 'rascunho', canonical: 'rascunho' });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['active-posts'] }));
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: expect.arrayContaining(['workflow-posts-with-props']),
      }),
    );
  });

  it('writes only the custom pointer for a custom-status key', async () => {
    mockUpdate.mockResolvedValue({});
    const { result } = renderHook(() => useUpdatePostStatus(), { wrapper: wrapperFor(qc) });

    result.current.mutate({
      id: 9,
      workflowId: 10,
      key: 'custom:11111111-2222-3333-4444-555555555555',
      canonical: 'revisao_interna',
    });

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(9, {
        custom_status_id: '11111111-2222-3333-4444-555555555555',
      }),
    );
  });
});
