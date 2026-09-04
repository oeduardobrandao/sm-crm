import type { GlobalPopup, PopupInteraction } from '../store/popups';
import type { PopupSession } from './popupSession';

/** Tabela "Semântica de já viu" da spec: once esconde com qualquer interação que não
 * seja seen; until_cta só com cta ou ack. */
export function isHiddenForever(popup: GlobalPopup, interactions: PopupInteraction[]): boolean {
  const terminal: ReadonlySet<string> =
    popup.frequency === 'until_cta' ? new Set(['cta', 'ack']) : new Set(['closed', 'cta', 'ack']);
  return interactions.some((i) => i.popup_id === popup.id && terminal.has(i.action));
}

export function pickPopup(
  popups: GlobalPopup[],
  interactions: PopupInteraction[],
  session: PopupSession,
): GlobalPopup | null {
  if (session.skipped) return null;
  const eligible = popups
    .filter((p) => !isHiddenForever(p, interactions))
    .filter((p) => !session.closedIds.has(p.id));
  if (session.shownId) {
    return eligible.find((p) => p.id === session.shownId) ?? null;
  }
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}
