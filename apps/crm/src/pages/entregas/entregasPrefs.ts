import type { EntregasMode } from './components/ModeToggle';

const storageKey = (contaId: string) => `entregas_last_mode_${contaId}`;

/** Last mode the user left Entregas in (Fluxos vs Publicações), per conta.
 *  Falls back to 'entregas' on a missing key or any storage failure. */
export function loadLastMode(contaId: string): EntregasMode {
  try {
    return localStorage.getItem(storageKey(contaId)) === 'publicacoes' ? 'publicacoes' : 'entregas';
  } catch {
    return 'entregas';
  }
}

export function persistLastMode(contaId: string, mode: EntregasMode): void {
  try {
    localStorage.setItem(storageKey(contaId), mode);
  } catch {
    // Private browsing / storage full -- the preference just doesn't survive a reload.
  }
}
