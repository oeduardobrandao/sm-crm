import { useCallback, useEffect, useRef, useState } from 'react';
import { TOUR_STEPS, type TourStep } from './tourSteps';

export function tourSeenKey(contaId: string | null): string {
  return `automacoes_tour_seen:${contaId ?? ''}`;
}

// Best-effort como guideStorage.ts: quota estourada ou Safari private mode
// não pode derrubar a página.
function readSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeSeen(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* best-effort */
  }
}

export interface AutomationTourApi {
  activeIndex: number | null;
  activeStep: TourStep | null;
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  finish: () => void;
  handleDialogClose: () => void;
}

export function useAutomationTour({
  contaId,
  eligibleForAutoStart,
}: {
  contaId: string | null;
  eligibleForAutoStart: boolean;
}): AutomationTourApi {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const key = tourSeenKey(contaId);
  // Uma única chance de auto-início por montagem: a elegibilidade pode oscilar
  // (refetches) e o tour não deve re-disparar depois de dispensado.
  const autoFiredRef = useRef(false);

  useEffect(() => {
    if (!eligibleForAutoStart || autoFiredRef.current) return;
    autoFiredRef.current = true;
    if (readSeen(key)) return;
    // Grava já no auto-início: dispensar sem ler não faz o tour reaparecer.
    writeSeen(key);
    setActiveIndex(0);
  }, [eligibleForAutoStart, key]);

  const start = useCallback(() => {
    writeSeen(key);
    setActiveIndex(0);
  }, [key]);

  const end = useCallback(() => {
    writeSeen(key);
    setActiveIndex(null);
  }, [key]);

  const next = useCallback(
    () => setActiveIndex((i) => (i == null ? i : Math.min(i + 1, TOUR_STEPS.length - 1))),
    [],
  );

  // Piso no índice 1: voltar ao passo 1 exigiria fechar o dialog por baixo do
  // guard de alterações não salvas (decisão do spec).
  const back = useCallback(() => setActiveIndex((i) => (i == null || i <= 1 ? i : i - 1)), []);

  const handleDialogClose = useCallback(() => {
    setActiveIndex((i) => {
      if (i == null || TOUR_STEPS[i].surface !== 'dialog') return i;
      writeSeen(key);
      return null;
    });
  }, [key]);

  return {
    activeIndex,
    activeStep: activeIndex == null ? null : TOUR_STEPS[activeIndex],
    start,
    next,
    back,
    skip: end,
    finish: end,
    handleDialogClose,
  };
}
