import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  emptyProgress,
  loadGuideProgress,
  saveGuideProgress,
  type GuideProgress,
} from './guideStorage';
import { allPages, filterTrails, requiredSignals, type GuideTrail } from './guideContent';
import type { GuideSignals } from './useGuideSignals';

export interface GuideView {
  trails: GuideTrail[];
  doneIds: Set<string>;
  totals: { done: number; total: number };
  isConcluded: boolean;
  signalsSatisfied: boolean;
  progress: GuideProgress;
  markSeen(pageId: string): void;
  setLastPage(pageId: string): void;
  dismiss(): void;
  conclude(): void;
  recordAutoOpen(): void;
  recordTrailCompleted(trailId: string): void;
}

export function useGuideProgress(
  contaId: string | null,
  signals: GuideSignals,
  hasFeature: (flag: string) => boolean,
): GuideView {
  const [progress, setProgress] = useState<GuideProgress>(() =>
    contaId ? loadGuideProgress(contaId) : emptyProgress(),
  );

  // Reflete mudanças de contaId depois do mount (ex.: refetchProfile resolve
  // null -> id sem remontar o provider). Sem isso o hook mantém o estado
  // vazio do primeiro mount e o próximo patch() sobrescreve o progresso já
  // salvo do workspace real.
  const loadedForRef = useRef(contaId);
  useEffect(() => {
    if (loadedForRef.current === contaId) return;
    loadedForRef.current = contaId;
    setProgress(contaId ? loadGuideProgress(contaId) : emptyProgress());
  }, [contaId]);

  const patch = useCallback(
    (updater: (prev: GuideProgress) => GuideProgress) => {
      setProgress((prev) => {
        const next = updater(prev);
        if (contaId) saveGuideProgress(contaId, next);
        return next;
      });
    },
    [contaId],
  );

  const trails = useMemo(() => filterTrails(hasFeature), [hasFeature]);
  const pages = useMemo(() => allPages(trails), [trails]);

  const doneIds = useMemo(() => {
    const done = new Set(progress.pagesDone);
    const seen = new Set(progress.pagesSeen);
    for (const p of pages) {
      if (!p.signal && seen.has(p.id)) done.add(p.id);
      if (p.signal && signals.values[p.signal] === true) done.add(p.id);
    }
    return done;
  }, [pages, progress.pagesDone, progress.pagesSeen, signals.values]);

  const totals = useMemo(
    () => ({ done: pages.filter((p) => doneIds.has(p.id)).length, total: pages.length }),
    [pages, doneIds],
  );

  const signalsSatisfied = useMemo(() => {
    const required = requiredSignals(trails);
    return required.length > 0 && required.every((s) => signals.values[s] === true);
  }, [trails, signals.values]);

  const isConcluded =
    Boolean(progress.concludedAt) || totals.done === totals.total || signalsSatisfied;

  const markSeen = useCallback(
    (pageId: string) =>
      patch((prev) =>
        prev.pagesSeen.includes(pageId)
          ? prev
          : { ...prev, pagesSeen: [...prev.pagesSeen, pageId] },
      ),
    [patch],
  );

  const setLastPage = useCallback(
    (pageId: string) => patch((prev) => ({ ...prev, lastPageId: pageId })),
    [patch],
  );

  const dismiss = useCallback(
    () => patch((prev) => ({ ...prev, dismissedAt: new Date().toISOString() })),
    [patch],
  );

  const conclude = useCallback(
    () =>
      patch((prev) =>
        prev.concludedAt ? prev : { ...prev, concludedAt: new Date().toISOString() },
      ),
    [patch],
  );

  const recordAutoOpen = useCallback(
    () => patch((prev) => ({ ...prev, autoOpenedAt: new Date().toISOString() })),
    [patch],
  );

  const recordTrailCompleted = useCallback(
    (trailId: string) =>
      patch((prev) =>
        prev.trailsCompleted.includes(trailId)
          ? prev
          : { ...prev, trailsCompleted: [...prev.trailsCompleted, trailId] },
      ),
    [patch],
  );

  return {
    trails,
    doneIds,
    totals,
    isConcluded,
    signalsSatisfied,
    progress,
    markSeen,
    setLastPage,
    dismiss,
    conclude,
    recordAutoOpen,
    recordTrailCompleted,
  };
}
