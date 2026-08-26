import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getClientesMock, getMembrosMock, getWorkflowsMock, getPortfolioSummaryMock, hasAnyHubTokenMock } =
  vi.hoisted(() => ({
    getClientesMock: vi.fn(),
    getMembrosMock: vi.fn(),
    getWorkflowsMock: vi.fn(),
    getPortfolioSummaryMock: vi.fn(),
    hasAnyHubTokenMock: vi.fn(),
  }));

vi.mock('../../../store', () => ({
  getClientes: getClientesMock,
  getMembros: getMembrosMock,
  getWorkflows: getWorkflowsMock,
}));
vi.mock('../../../services/analytics', () => ({ getPortfolioSummary: getPortfolioSummaryMock }));
vi.mock('../../../store/hub', () => ({ hasAnyHubToken: hasAnyHubTokenMock }));

import { useGuideSignals } from '../useGuideSignals';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useGuideSignals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getClientesMock.mockResolvedValue([{ id: 3 }, { id: 9 }]);
    getMembrosMock.mockResolvedValue([]);
    getWorkflowsMock.mockResolvedValue([{ id: 1 }]);
    getPortfolioSummaryMock.mockResolvedValue({ accounts: [] });
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

  it('pega o cliente mais recente pelo maior id', async () => {
    const { result } = renderHook(() => useGuideSignals(true), { wrapper });
    await waitFor(() => expect(result.current.latestClienteId).toBe(9));
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
