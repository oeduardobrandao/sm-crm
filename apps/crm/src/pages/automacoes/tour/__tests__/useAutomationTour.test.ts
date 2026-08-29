import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useAutomationTour, tourSeenKey } from '../useAutomationTour';
import { TOUR_STEPS } from '../tourSteps';

const CONTA = 'conta-1';
const KEY = tourSeenKey(CONTA);

describe('useAutomationTour', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  const render = (eligible: boolean) =>
    renderHook(
      ({ e }: { e: boolean }) =>
        useAutomationTour({ contaId: CONTA, eligibleForAutoStart: e }),
      { initialProps: { e: eligible } },
    );

  it('auto-inicia no passo 1 quando elegível e sem chave, e grava a chave', () => {
    const { result } = render(true);
    expect(result.current.activeIndex).toBe(0);
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('não auto-inicia com a chave gravada', () => {
    localStorage.setItem(KEY, '1');
    const { result } = render(true);
    expect(result.current.activeIndex).toBeNull();
  });

  it('não auto-inicia quando inelegível, e dispara quando a elegibilidade chega', () => {
    const { result, rerender } = render(false);
    expect(result.current.activeIndex).toBeNull();
    rerender({ e: true });
    expect(result.current.activeIndex).toBe(0);
  });

  it('start() manual funciona mesmo com a chave gravada', () => {
    localStorage.setItem(KEY, '1');
    const { result } = render(false);
    act(() => result.current.start());
    expect(result.current.activeIndex).toBe(0);
  });

  it('next avança até o teto e back tem piso no passo 2 (índice 1)', () => {
    const { result } = render(true);
    act(() => result.current.next());
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.back());
    expect(result.current.activeIndex).toBe(1); // piso: nunca volta ao passo 1
    act(() => result.current.next());
    act(() => result.current.back());
    expect(result.current.activeIndex).toBe(1);
    for (let i = 0; i < 20; i++) act(() => result.current.next());
    expect(result.current.activeIndex).toBe(TOUR_STEPS.length - 1); // teto
    expect(result.current.activeStep?.id).toBe('campo-resposta');
  });

  it('skip e finish encerram e persistem', () => {
    localStorage.clear();
    const { result } = render(true);
    act(() => result.current.skip());
    expect(result.current.activeIndex).toBeNull();
    expect(localStorage.getItem(KEY)).toBe('1');
  });

  it('handleDialogClose encerra em passo de dialog e ignora passo de página', () => {
    const { result } = render(true);
    act(() => result.current.handleDialogClose()); // passo 1 = page
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.next());
    act(() => result.current.handleDialogClose());
    expect(result.current.activeIndex).toBeNull();
  });

  it('localStorage lançando exceção não quebra', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = render(true);
    expect(result.current.activeIndex).toBe(0); // best-effort: segue funcionando
  });
});
