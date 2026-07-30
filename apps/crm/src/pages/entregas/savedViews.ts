export interface SavedView {
  name: string;
  /** Serialized viewQuery string — same payload the URL carries. */
  query: string;
}

const storageKey = (contaId: string) => `entregas_saved_views_${contaId}`;

export function loadSavedViews(contaId: string): SavedView[] {
  try {
    const raw = localStorage.getItem(storageKey(contaId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is SavedView => typeof v?.name === 'string' && typeof v?.query === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

export function persistSavedViews(contaId: string, views: SavedView[]) {
  localStorage.setItem(storageKey(contaId), JSON.stringify(views));
}
