import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGuideProgress } from '../useGuideProgress';
import { loadGuideProgress, saveGuideProgress, EMPTY_PROGRESS } from '../guideStorage';
import type { GuideSignals } from '../useGuideSignals';

const ALL_ON = () => true;
const NO_SIGNALS: GuideSignals = {
  values: {},
  latestClienteId: null,
  clientes: { status: 'pending', count: 0 },
  workflows: { status: 'pending', count: 0 },
};

describe('useGuideProgress', () => {
  beforeEach(() => localStorage.clear());

  it('começa com 0 de 15 e nada concluído', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    expect(result.current.totals).toEqual({ done: 0, total: 15 });
    expect(result.current.isConcluded).toBe(false);
  });

  it('markSeen conclui página SEM sinal, mas não página COM sinal', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.markSeen('t1p1'));
    act(() => result.current.markSeen('t1p2'));
    expect(result.current.doneIds.has('t1p1')).toBe(true);
    expect(result.current.doneIds.has('t1p2')).toBe(false);
    expect(result.current.totals.done).toBe(1);
  });

  it('sinal true conclui a página mesmo sem ser vista', () => {
    const signals = { ...NO_SIGNALS, values: { hasCliente: true } };
    const { result } = renderHook(() => useGuideProgress('ws-1', signals, ALL_ON));
    expect(result.current.doneIds.has('t1p2')).toBe(true);
  });

  it('persiste vistas e dismissal no localStorage', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.markSeen('t1p1'));
    act(() => result.current.dismiss());
    const stored = loadGuideProgress('ws-1');
    expect(stored.pagesSeen).toContain('t1p1');
    expect(stored.dismissedAt).toBeTruthy();
  });

  it('signalsSatisfied exige só os sinais da trilha filtrada', () => {
    const semHub = (f: string) => f !== 'feature_hub_portal';
    const signals = {
      ...NO_SIGNALS,
      values: { hasCliente: true, hasInstagram: true, hasMembro: true, hasWorkflow: true },
    };
    const comHub = renderHook(() => useGuideProgress('ws-1', signals, ALL_ON));
    expect(comHub.result.current.signalsSatisfied).toBe(false);
    const filtrado = renderHook(() => useGuideProgress('ws-1', signals, semHub));
    expect(filtrado.result.current.signalsSatisfied).toBe(true);
    expect(filtrado.result.current.isConcluded).toBe(true);
    expect(filtrado.result.current.totals.total).toBe(14);
  });

  it('conclude persiste concludedAt e isConcluded fica true', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.conclude());
    expect(result.current.isConcluded).toBe(true);
    expect(loadGuideProgress('ws-1').concludedAt).toBeTruthy();
  });

  it('recordTrailCompleted grava uma vez só', () => {
    const { result } = renderHook(() => useGuideProgress('ws-1', NO_SIGNALS, ALL_ON));
    act(() => result.current.recordTrailCompleted('t1'));
    act(() => result.current.recordTrailCompleted('t1'));
    expect(loadGuideProgress('ws-1').trailsCompleted).toEqual(['t1']);
  });

  it('contaId null é inerte (não lê nem grava)', () => {
    saveGuideProgress('unknown', { ...EMPTY_PROGRESS, pagesSeen: ['t1p1'] });
    const { result } = renderHook(() => useGuideProgress(null, NO_SIGNALS, ALL_ON));
    expect(result.current.totals.done).toBe(0);
    act(() => result.current.markSeen('t1p1'));
    expect(loadGuideProgress('unknown').pagesSeen).toEqual(['t1p1']);
  });

  it('contaId null -> id depois do mount ressincroniza com o progresso salvo e não sobrescreve', () => {
    saveGuideProgress('ws-1', {
      ...EMPTY_PROGRESS,
      pagesSeen: ['t1p1'],
      dismissedAt: '2026-08-01T00:00:00.000Z',
    });
    const { result, rerender } = renderHook(
      ({ contaId }: { contaId: string | null }) => useGuideProgress(contaId, NO_SIGNALS, ALL_ON),
      { initialProps: { contaId: null as string | null } },
    );
    expect(result.current.totals.done).toBe(0);

    rerender({ contaId: 'ws-1' });

    expect(result.current.doneIds.has('t1p1')).toBe(true);
    expect(result.current.progress.dismissedAt).toBeTruthy();

    act(() => result.current.markSeen('t2p1'));

    const stored = loadGuideProgress('ws-1');
    expect(stored.pagesSeen).toEqual(expect.arrayContaining(['t1p1', 't2p1']));
    expect(stored.dismissedAt).toBeTruthy();
  });

  it('troca de contaId entre workspaces troca o estado e isola o storage', () => {
    saveGuideProgress('ws-1', { ...EMPTY_PROGRESS, pagesSeen: ['t1p1'] });
    const { result, rerender } = renderHook(
      ({ contaId }: { contaId: string | null }) => useGuideProgress(contaId, NO_SIGNALS, ALL_ON),
      { initialProps: { contaId: 'ws-1' as string | null } },
    );
    expect(result.current.doneIds.has('t1p1')).toBe(true);

    rerender({ contaId: 'ws-2' });

    expect(result.current.doneIds.has('t1p1')).toBe(false);
    expect(result.current.totals.done).toBe(0);

    act(() => result.current.markSeen('t1p1'));

    expect(loadGuideProgress('ws-2').pagesSeen).toEqual(['t1p1']);
    expect(loadGuideProgress('ws-1').pagesSeen).toEqual(['t1p1']);
  });
});
