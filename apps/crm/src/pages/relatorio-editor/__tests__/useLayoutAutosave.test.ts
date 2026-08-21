import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMock, toastErrorMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('../../../services/reportDocs', () => ({ updateReportDoc: updateMock }));
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));

import { useLayoutAutosave } from '../useLayoutAutosave';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const baseLayout: ReportLayout = {
  version: 1,
  blocks: [{ id: 'a', type: 'cover', size: 'full' }],
};

// Achado C1: o hook agora escreve de volta no cache via useQueryClient(), o
// que exige um QueryClientProvider no contexto de TODO renderHook — sem ele
// useQueryClient() lança. Um qc por teste (padrão de RelatorioEditorPage.
// test.tsx), acessível pelos testes que verificam o write-back.
let qc: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

beforeEach(() => {
  vi.useFakeTimers();
  updateMock.mockResolvedValue(undefined);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useLayoutAutosave', () => {
  it('applyLayout: otimista na hora, persiste após 1500ms, saving liga e desliga', async () => {
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const next: ReportLayout = { ...baseLayout, accent: '#0f766e' };
    act(() => result.current.applyLayout(next));
    expect(result.current.layout).toBe(next);
    expect(result.current.saving).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith('doc-1', { layout: next });
    expect(result.current.saving).toBe(false);
  });

  it('duas edições dentro da janela: um único request com o estado final', async () => {
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const l1: ReportLayout = { ...baseLayout, accent: '#111111' };
    const l2: ReportLayout = { ...baseLayout, accent: '#222222' };
    act(() => result.current.applyLayout(l1));
    act(() => {
      vi.advanceTimersByTime(700);
      result.current.applyLayout(l2);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('doc-1', { layout: l2 });
  });

  it('applyLayout com a MESMA referência: nenhum save agendado', () => {
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    act(() => result.current.applyLayout(result.current.layout));
    expect(result.current.saving).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('layout inválido no flush: toast de erro e NENHUM request', async () => {
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const invalid = {
      version: 1,
      blocks: [{ id: '', type: 'cover', size: 'full' }],
    } as ReportLayout;
    act(() => result.current.applyLayout(invalid));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o relatório');
  });

  it('falha do request: retém edição para retry, saving fica true', async () => {
    updateMock.mockRejectedValueOnce(new Error('rede'));
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const layout = { ...baseLayout, accent: '#333333' };
    act(() => result.current.applyLayout(layout));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o relatório');
    // Payload retido → saving continua true até que o retry suceda
    expect(result.current.saving).toBe(true);
    // Retry agendado (5000ms)
    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it('setTitle persiste após 400ms com dirty ref', async () => {
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    act(() => result.current.setTitle('Relatório de Abril'));
    expect(result.current.title).toBe('Relatório de Abril');
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith('doc-1', { title: 'Relatório de Abril' });
  });

  it('terceira edição durante request em voo mantém saving true', async () => {
    let resolveReq: ((value?: any) => void) | null = null;
    updateMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveReq = r;
        }),
    );
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const l1: ReportLayout = { ...baseLayout, accent: '#111111' };
    const l3: ReportLayout = { ...baseLayout, accent: '#333333' };

    // edit1 → saving=true, timer scheduled
    act(() => result.current.applyLayout(l1));
    expect(result.current.saving).toBe(true);

    // advance 1500 → request starts
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(true); // ainda true, request em voo

    // edit3 durante request em voo → new timer, pendingLayout updated
    act(() => result.current.applyLayout(l3));
    expect(result.current.saving).toBe(true);

    // resolve primeiro request
    act(() => {
      resolveReq?.();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // RACE CONDITION: antes do fix, saving zeraria aqui mesmo com edição pendente
    expect(result.current.saving).toBe(true);

    // advance próximos 1500ms → segundo request com l3
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith('doc-1', { layout: l3 });
    expect(result.current.saving).toBe(false);
  });

  it('unmount com edição pendente dá flush imediato', async () => {
    const { result, unmount } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const pending: ReportLayout = { ...baseLayout, accent: '#555555' };

    // edição → debounce agendado mas não rodou
    act(() => result.current.applyLayout(pending));
    expect(updateMock).not.toHaveBeenCalled();

    // unmount → deve dar flush da edição pendente sem esperar timer
    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('doc-1', { layout: pending });
  });

  it('request antigo não sobrescreve edição nova (serialização)', async () => {
    let resolveA: ((value?: any) => void) | null = null;
    let resolveB: ((value?: any) => void) | null = null;
    let callCount = 0;

    updateMock.mockImplementation(
      () =>
        new Promise((r) => {
          callCount++;
          if (callCount === 1) {
            resolveA = r;
          } else if (callCount === 2) {
            resolveB = r;
          }
        }),
    );

    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const l1: ReportLayout = { ...baseLayout, accent: '#111111' };
    const l2: ReportLayout = { ...baseLayout, accent: '#222222' };

    // edit1 → timer scheduled
    act(() => result.current.applyLayout(l1));

    // advance 1500 → request A starts (held open)
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenNthCalledWith(1, 'doc-1', { layout: l1 });

    // edit2 → reschedule timer
    act(() => result.current.applyLayout(l2));

    // advance 1500 → request B appends to chain (still waiting for A)
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    // Chain: B hasn't executed yet because A is still in-flight
    expect(updateMock).toHaveBeenCalledTimes(1);

    // resolve A → chain moves to B
    act(() => {
      resolveA?.();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // NOW B fires with l2
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenNthCalledWith(2, 'doc-1', { layout: l2 });

    // resolve B
    act(() => {
      resolveB?.();
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Assert: last write is always the most recent edit
    expect(updateMock.mock.calls.at(-1)?.[1].layout).toBe(l2);
  });

  it('falha transitória não perde a edição: retém e re-tenta', async () => {
    updateMock.mockRejectedValueOnce(new Error('timeout'));
    updateMock.mockResolvedValueOnce(undefined);
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const layout = { ...baseLayout, accent: '#444444' };

    // edit → advance 1500 (request fails, toast)
    act(() => result.current.applyLayout(layout));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o relatório');
    // Payload retido → saving continua true
    expect(result.current.saving).toBe(true);

    // advance 5000 (retry fires)
    await act(async () => {
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith('doc-1', { layout });
    expect(result.current.saving).toBe(false);
  });

  it('falha seguida de unmount ainda flusha o payload retido', async () => {
    updateMock.mockRejectedValueOnce(new Error('rede'));
    const { result, unmount } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const layout = { ...baseLayout, accent: '#666666' };

    // edit → advance 1500 (request fails)
    act(() => result.current.applyLayout(layout));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(result.current.saving).toBe(true); // Payload retido

    // unmount → appends flush through chain
    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Unmount flush chamado além do failed request
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenNthCalledWith(2, 'doc-1', { layout });
  });

  // Achado C1: sem write-back, uma reentrada na SPA dentro do gcTime (a
  // query ['report-doc', id] usa staleTime: Infinity e nada mais escreve
  // nela) serve o doc PRÉ-edição e o próximo save clobbera o que acabou de
  // ser persistido. O fix: todo save bem-sucedido escreve o resultado de
  // volta no cache — aqui provado seedando a query ANTES do render, como um
  // segundo mount da página faria ao reaproveitar o cache do primeiro.
  it('save bem-sucedido escreve de volta no cache ["report-doc", docId]', async () => {
    qc.setQueryData(['report-doc', 'doc-1'], {
      id: 'doc-1',
      title: 'T',
      layout: baseLayout,
      status: 'ready',
    });
    const { result } = renderHook(
      () => useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const next: ReportLayout = { ...baseLayout, accent: '#0f766e' };
    act(() => result.current.applyLayout(next));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith('doc-1', { layout: next });
    // toEqual, não toBe: o React Query aplica structural sharing no
    // setQueryData e reconstrói o objeto reaproveitando sub-referências
    // deep-equal do valor anterior (ex.: o array `blocks`, inalterado) — o
    // que importa aqui é que o cache reflita o layout novo, não a
    // identidade exata do objeto passado a applyLayout.
    const cached = qc.getQueryData<{ layout: ReportLayout }>(['report-doc', 'doc-1']);
    expect(cached?.layout).toEqual(next);
  });

  // Achado externo P1 (review do PR): a cadeia de save era um useRef — morria
  // com a instância. Navegar para fora (flush de unmount em voo) e reabrir o
  // mesmo doc criava uma cadeia NOVA, e o save da remontagem corria com o
  // flush antigo: o request antigo podia sobrescrever a edição mais nova.
  // Fix: cadeia por documento no escopo do módulo — a remontagem herda a fila.
  it('flush de unmount serializa com os saves da remontagem do mesmo doc', async () => {
    let resolveA: ((value?: unknown) => void) | null = null;
    let callCount = 0;
    updateMock.mockImplementation(
      () =>
        new Promise((r) => {
          callCount++;
          if (callCount === 1) resolveA = r;
          else r(undefined);
        }),
    );

    // Instância A: edita e desmonta antes do debounce → flush em voo (aberto)
    const first = renderHook(
      () => useLayoutAutosave('doc-remount', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const lA: ReportLayout = { ...baseLayout, accent: '#111111' };
    act(() => first.result.current.applyLayout(lA));
    first.unmount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenNthCalledWith(1, 'doc-remount', { layout: lA });

    // Instância B (remontagem imediata): edita → o save espera o flush de A
    const second = renderHook(() => useLayoutAutosave('doc-remount', { layout: lA, title: 'T' }), {
      wrapper,
    });
    const lB: ReportLayout = { ...baseLayout, accent: '#222222' };
    act(() => second.result.current.applyLayout(lB));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1); // B enfileirado atrás de A

    // A resolve → só então B dispara, com a edição mais nova por último
    act(() => {
      resolveA?.();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith('doc-remount', { layout: lB });
  });

  // Mesma classe do achado: a remontagem lê a query ['report-doc', id]
  // (staleTime: Infinity, sem refetch) DURANTE o flush em voo. Sem o write
  // otimista no cleanup, o editor renasceria PRÉ-edição e o próximo save
  // perderia o payload em voo mesmo com os requests em ordem.
  it('unmount com edição pendente escreve layout e título no cache antes do request completar', async () => {
    const resolvers: Array<(value?: unknown) => void> = [];
    updateMock.mockImplementation(
      () =>
        new Promise((r) => {
          resolvers.push(r);
        }),
    );
    qc.setQueryData(['report-doc', 'doc-cache'], {
      id: 'doc-cache',
      title: 'T',
      layout: baseLayout,
      status: 'ready',
    });
    const { result, unmount } = renderHook(
      () => useLayoutAutosave('doc-cache', { layout: baseLayout, title: 'T' }),
      { wrapper },
    );
    const pending: ReportLayout = { ...baseLayout, accent: '#555555' };
    act(() => {
      result.current.applyLayout(pending);
      result.current.setTitle('Relatório de Maio');
    });
    unmount();

    // Sem resolver o request: o cache já reflete a edição — é o que uma
    // remontagem imediata vai ler.
    const cached = qc.getQueryData<{ layout: ReportLayout; title: string }>([
      'report-doc',
      'doc-cache',
    ]);
    expect(cached?.layout).toEqual(pending);
    expect(cached?.title).toBe('Relatório de Maio');

    // Drena a cadeia para não vazar request aberto para outros testes: o
    // flush do layout está em voo; o do título entra na fila atrás dele.
    await act(async () => {
      resolvers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      resolvers.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
