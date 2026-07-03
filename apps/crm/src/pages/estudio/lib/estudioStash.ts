// localStorage stash for the autosave protocol (design §6.2): before local state is discarded
// (rev conflict) or possibly lost (tab unload while dirty), the current doc is stashed keyed by
// postId so no more than one debounce-window of work can silently vanish. Write-side only in
// PR 2.D — a recovery UI can read `readEstudioStash` later without a schema change.
//
// localStorage can throw (quota, private mode) — a stash is defense-in-depth, never worth
// crashing a save/unload path over, so every operation here swallows storage errors.
import type { DesignDoc } from '../types';

const STASH_PREFIX = 'estudio-stash-';

export interface EstudioStash {
  doc: DesignDoc;
  rev: number;
  stashedAt: string;
}

export function stashKey(postId: number): string {
  return `${STASH_PREFIX}${postId}`;
}

export function writeEstudioStash(postId: number, doc: DesignDoc, rev: number): void {
  try {
    const stash: EstudioStash = { doc, rev, stashedAt: new Date().toISOString() };
    localStorage.setItem(stashKey(postId), JSON.stringify(stash));
  } catch {
    // best-effort — see header comment
  }
}

export function readEstudioStash(postId: number): EstudioStash | null {
  try {
    const raw = localStorage.getItem(stashKey(postId));
    if (!raw) return null;
    return JSON.parse(raw) as EstudioStash;
  } catch {
    return null;
  }
}

export function clearEstudioStash(postId: number): void {
  try {
    localStorage.removeItem(stashKey(postId));
  } catch {
    // best-effort — see header comment
  }
}
