import type { GlobalPopup, PopupInteraction } from '../store/popups';
import type { PopupSession } from './popupSession';

/** Dia-calendário LOCAL do browser: é como se lê "uma vez por dia". Quem viu às 18h
 * vê de novo às 9h do dia seguinte; uma janela de 24h esperaria até as 18h. */
export function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Tabela "Semântica de já viu" da spec: once esconde com qualquer interação que não
 * seja seen; until_cta só com cta ou ack; daily nunca esconde para sempre. */
export function isHiddenForever(popup: GlobalPopup, interactions: PopupInteraction[]): boolean {
  if (popup.frequency === 'daily') return false;
  const terminal: ReadonlySet<string> =
    popup.frequency === 'until_cta' ? new Set(['cta', 'ack']) : new Set(['closed', 'cta', 'ack']);
  return interactions.some((i) => i.popup_id === popup.id && terminal.has(i.action));
}

/** daily: já abriu hoje. A chave é o seen (gravado na abertura), então um popup aberto
 * e abandonado sem interação também conta como visto hoje. */
export function isHiddenToday(
  popup: GlobalPopup,
  interactions: PopupInteraction[],
  now: Date,
): boolean {
  if (popup.frequency !== 'daily') return false;
  return interactions.some(
    (i) =>
      i.popup_id === popup.id && i.action === 'seen' && sameLocalDay(new Date(i.created_at), now),
  );
}

export function pickPopup(
  popups: GlobalPopup[],
  interactions: PopupInteraction[],
  session: PopupSession,
  now: Date = new Date(),
): GlobalPopup | null {
  if (session.skipped) return null;
  const eligible = popups
    .filter((p) => !isHiddenForever(p, interactions))
    .filter((p) => !isHiddenToday(p, interactions, now))
    .filter((p) => !session.closedIds.has(p.id));
  if (session.shownId) {
    return eligible.find((p) => p.id === session.shownId) ?? null;
  }
  if (eligible.length === 0) return null;
  // Popup com gatilho é contextual: vence o comum. Empate por mais recente, como antes.
  return [...eligible].sort(
    (a, b) =>
      Number(Boolean(b.trigger)) - Number(Boolean(a.trigger)) ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
}
