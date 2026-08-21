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
});
