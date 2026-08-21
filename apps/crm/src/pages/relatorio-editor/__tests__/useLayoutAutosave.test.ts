import { act, renderHook } from '@testing-library/react';
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

beforeEach(() => {
  vi.useFakeTimers();
  updateMock.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useLayoutAutosave', () => {
  it('applyLayout: otimista na hora, persiste após 1500ms, saving liga e desliga', async () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
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
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
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
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    act(() => result.current.applyLayout(result.current.layout));
    expect(result.current.saving).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('layout inválido no flush: toast de erro e NENHUM request', async () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    const invalid = { version: 1, blocks: [{ id: '', type: 'cover', size: 'full' }] } as ReportLayout;
    act(() => result.current.applyLayout(invalid));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o relatório');
  });

  it('falha do request: toast de erro e saving desliga', async () => {
    updateMock.mockRejectedValueOnce(new Error('rede'));
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    act(() => result.current.applyLayout({ ...baseLayout, accent: '#333333' }));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o relatório');
    expect(result.current.saving).toBe(false);
  });

  it('setTitle persiste após 400ms com dirty ref', async () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
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
      () => new Promise((r) => {
        resolveReq = r;
      }),
    );
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
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
    const { result, unmount } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
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

    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
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
});
