/**
 * Progresso do guia de primeiros passos, por workspace, em localStorage
 * (padrão da casa para UI dispensável; ver spec 2026-08-25).
 */
export interface GuideProgress {
  autoOpenedAt?: string;
  dismissedAt?: string;
  pagesSeen: string[];
  pagesDone: string[];
  trailsCompleted: string[];
  lastPageId?: string;
  concludedAt?: string;
}

export const EMPTY_PROGRESS: GuideProgress = {
  pagesSeen: [],
  pagesDone: [],
  trailsCompleted: [],
};

export function guideStorageKey(contaId: string): string {
  return `guia_v1_${contaId}`;
}

export function loadGuideProgress(contaId: string): GuideProgress {
  try {
    const raw = localStorage.getItem(guideStorageKey(contaId));
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<GuideProgress>;
    return {
      ...EMPTY_PROGRESS,
      ...parsed,
      pagesSeen: Array.isArray(parsed.pagesSeen) ? parsed.pagesSeen : [],
      pagesDone: Array.isArray(parsed.pagesDone) ? parsed.pagesDone : [],
      trailsCompleted: Array.isArray(parsed.trailsCompleted) ? parsed.trailsCompleted : [],
    };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveGuideProgress(contaId: string, p: GuideProgress): void {
  localStorage.setItem(guideStorageKey(contaId), JSON.stringify(p));
}
