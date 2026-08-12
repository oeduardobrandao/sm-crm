import type { NicheCalendarDef } from './types';
import { medicoDef } from './medico';
import { juridicoDef } from './juridico';
import { varejoDef } from './varejo';
import { belezaEsteticaDef } from './belezaEstetica';
import { gastronomiaDef } from './gastronomia';

export const NICHE_STORAGE_KEY = 'mesaas:calendario:ultimoNicho';
export const DEFAULT_NICHE_KEY = 'medico';

export const NICHE_CALENDARS: NicheCalendarDef[] = [
  medicoDef,
  juridicoDef,
  varejoDef,
  belezaEsteticaDef,
  gastronomiaDef,
];

/** Preference is best-effort — a corrupted/stale/unknown value never breaks the page. */
export function readStoredNicheKey(validKeys: string[], fallback: string): string {
  try {
    const raw = localStorage.getItem(NICHE_STORAGE_KEY);
    if (raw && validKeys.includes(raw)) return raw;
  } catch {
    // best-effort — see writeStoredNicheKey
  }
  return fallback;
}

export function writeStoredNicheKey(key: string): void {
  try {
    localStorage.setItem(NICHE_STORAGE_KEY, key);
  } catch {
    // best-effort — quota/private mode should never break the page
  }
}
