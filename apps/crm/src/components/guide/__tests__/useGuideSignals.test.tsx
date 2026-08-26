import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getClientesMock,
  getMembrosMock,
  getWorkflowsMock,
  hasAnyInstagramAccountMock,
  hasAnyHubTokenMock,
} = vi.hoisted(() => ({
  getClientesMock: vi.fn(),
  getMembrosMock: vi.fn(),
  getWorkflowsMock: vi.fn(),
  hasAnyInstagramAccountMock: vi.fn(),
  hasAnyHubTokenMock: vi.fn(),
}));

vi.mock('../../../store', () => ({
  getClientes: getClientesMock,
  getMembros: getMembrosMock,
  getWorkflows: getWorkflowsMock,
}));
vi.mock('../../../services/analytics', () => ({
  hasAnyInstagramAccount: hasAnyInstagramAccountMock,
}));
vi.mock('../../../store/hub', () => ({ hasAnyHubToken: hasAnyHubTokenMock }));

import { useGuideSignals } from '../useGuideSignals';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGuideSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ordenado newest-first (created_at desc, id desc), como getClientes() real —
    // um cliente importado/backfilled pode ter id maior porém created_at mais antigo.
    getClientesMock.mockResolvedValue([{ id: 3 }, { id: 9 }]);
    getMembrosMock.mockResolvedValue([]);
    getWorkflowsMock.mockResolvedValue([{ id: 1 }]);
    hasAnyInstagramAccountMock.mockResolvedValue(false);
    hasAnyHubTokenMock.mockResolvedValue(true);
  });

  it('deriva sinais de queries bem-sucedidas', async () => {
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.values.hasCliente).toBe(true));
    expect(result.current.values.hasMembro).toBe(false);
    expect(result.current.values.hasWorkflow).toBe(true);
    expect(result.current.values.hasInstagram).toBe(false);
    expect(result.current.values.hasHubToken).toBe(true);
    expect(result.current.clientes).toEqual({ status: 'success', count: 2 });
  });

  it('hasInstagram reflete o resultado de hasAnyInstagramAccount quando bem-sucedida', async () => {
    hasAnyInstagramAccountMock.mockResolvedValue(true);
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.values.hasInstagram).toBe(true));
  });

  it('hasInstagram fica INCONCLUSIVO (chave ausente) quando a query falha — nunca falso confirmado', async () => {
    hasAnyInstagramAccountMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.values.hasCliente).toBe(true));
    expect('hasInstagram' in result.current.values).toBe(false);
  });

  it('latestClienteId é o PRIMEIRO da lista (mais recente), não o maior id', async () => {
    // getClientes() ordena created_at desc — data[0] é o mais recente mesmo que
    // um cliente importado mais antigo carregue um id numericamente maior (data[1] = 9).
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.clientes.status).toBe('success'));
    expect(result.current.latestClienteId).toBe(3);
  });

  it('query em erro fica INCONCLUSIVA: chave ausente, nunca false', async () => {
    hasAnyHubTokenMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.values.hasCliente).toBe(true));
    expect('hasHubToken' in result.current.values).toBe(false);
  });

  it('erro em clientes vira status error, nunca count 0 confiável', async () => {
    getClientesMock.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.clientes.status).toBe('error'));
    expect('hasCliente' in result.current.values).toBe(false);
  });

  it('enabled=false não dispara nenhuma query', () => {
    renderHook(() => useGuideSignals(false), { wrapper });
    expect(getClientesMock).not.toHaveBeenCalled();
    expect(hasAnyHubTokenMock).not.toHaveBeenCalled();
  });
});
