/**
 * Estado de sessão dos popups (spec 2026-09-04, Parte 3): sessionStorage, por aba.
 * Tudo em try/catch: modo privado ou storage bloqueado nunca pode quebrar o shell.
 */
export interface PopupSession {
  shownId: string | null;
  closedIds: Set<string>;
  skipped: boolean;
}

const SHOWN = 'mesaas_popup_shown';
const SKIPPED = 'mesaas_popup_skipped';
const CLOSED_PREFIX = 'mesaas_popup_closed:';

export function readPopupSession(): PopupSession {
  const s: PopupSession = { shownId: null, closedIds: new Set(), skipped: false };
  try {
    s.shownId = sessionStorage.getItem(SHOWN);
    s.skipped = sessionStorage.getItem(SKIPPED) === '1';
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CLOSED_PREFIX)) keys.push(k);
    }
    for (const k of keys) s.closedIds.add(k.slice(CLOSED_PREFIX.length));
  } catch {
    /* storage indisponível: sessão vazia */
  }
  return s;
}

function set(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* ignora */
  }
}

export const markPopupShown = (id: string) => set(SHOWN, id);
export const markPopupClosed = (id: string) => set(CLOSED_PREFIX + id, '1');
export const markPopupsSkipped = () => set(SKIPPED, '1');
