import {
  importSavedViews,
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_QUERY_MAX,
  type EntregasSavedView,
} from '@/store/savedViews';

/**
 * Saved Entregas views used to live in localStorage, one list per workspace on
 * each browser. They now live on the server (store/savedViews.ts); this module
 * only reads the old list so it can be imported once per workspace per browser.
 * The old key is kept as it was (never deleted), so going back to an older
 * build still finds it.
 */
export interface LegacySavedView {
  name: string;
  /** Serialized viewQuery string, the same payload the URL carries. */
  query: string;
}

/** EntregasPage's contaId while the profile is still loading. */
export const UNKNOWN_CONTA = 'unknown';

const legacyKey = (contaId: string) => `entregas_saved_views_${contaId}`;
const importedKey = (contaId: string) => `entregas_saved_views_imported_${contaId}`;

export function loadLegacySavedViews(contaId: string): LegacySavedView[] {
  try {
    const raw = localStorage.getItem(legacyKey(contaId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is LegacySavedView => typeof v?.name === 'string' && typeof v?.query === 'string',
        )
      : [];
  } catch {
    return [];
  }
}

function hasImported(contaId: string): boolean {
  try {
    return localStorage.getItem(importedKey(contaId)) != null;
  } catch {
    // Storage unavailable: there is nothing to import either.
    return true;
  }
}

function markImported(contaId: string) {
  try {
    localStorage.setItem(importedKey(contaId), new Date().toISOString());
  } catch {
    // Without storage the import just runs again next time; ignoreDuplicates
    // keeps that harmless.
  }
}

/**
 * Trims names, cuts them to the column limit, drops entries the CHECK
 * constraints would reject (one bad row fails the whole bulk insert, and the
 * marker would then never be written) and keeps the first entry per name.
 */
function sanitize(views: LegacySavedView[]): LegacySavedView[] {
  const seen = new Set<string>();
  const out: LegacySavedView[] = [];
  for (const v of views) {
    const name = v.name.trim().slice(0, SAVED_VIEW_NAME_MAX).trim();
    if (!name || v.query.length > SAVED_VIEW_QUERY_MAX || seen.has(name)) continue;
    seen.add(name);
    out.push({ name, query: v.query });
  }
  return out;
}

/**
 * One-time import of this browser's localStorage views for the ACTIVE
 * workspace only. Skipped while contaId is the 'unknown' fallback and once the
 * per-workspace marker exists. Names already on the server are skipped
 * (ON CONFLICT DO NOTHING), so two tabs or two devices importing at once end
 * up with one row per name. The marker is written only after the insert
 * succeeds; a failure leaves it unset so the next load retries.
 *
 * `existing` are the rows already on the server: imported views are appended
 * after them. Returns true when rows were sent (the caller should re-list).
 */
export async function importLegacySavedViews(
  contaId: string,
  existing: EntregasSavedView[],
): Promise<boolean> {
  if (!contaId || contaId === UNKNOWN_CONTA) return false;
  if (hasImported(contaId)) return false;

  const views = sanitize(loadLegacySavedViews(contaId));
  if (views.length === 0) {
    markImported(contaId);
    return false;
  }
  const base = existing.reduce((max, v) => Math.max(max, v.position + 1), 0);
  await importSavedViews(
    contaId,
    views.map((v, i) => ({ name: v.name, query: v.query, position: base + i })),
  );
  markImported(contaId);
  return true;
}
