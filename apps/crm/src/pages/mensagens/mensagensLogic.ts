import { getIntlLocale, i18n } from '@mesaas/i18n';
import type { MensagemConversa, MensagemFeedItem, MensagensUnreadRow } from '@/store';

export type MensagensTipoFilter = 'todas' | 'mensagens' | 'aprovacoes' | 'sugestoes';

const TIPO_FILTER_IDS: MensagensTipoFilter[] = ['todas', 'mensagens', 'aprovacoes', 'sugestoes'];

/** Thread type filters. `label` is a getter so it follows the UI language at
 * render time instead of freezing at module load. */
export const TIPO_FILTERS: { id: MensagensTipoFilter; label: string }[] = TIPO_FILTER_IDS.map(
  (id) => ({
    id,
    get label() {
      return i18n.t(`messages:tipoFilters.${id}`);
    },
  }),
);

export function feedItemKey(i: MensagemFeedItem): string {
  return `${i.source}-${i.item_id}`;
}

export function matchesTipo(i: MensagemFeedItem, tipo: MensagensTipoFilter): boolean {
  switch (tipo) {
    case 'todas':
      return true;
    case 'mensagens':
      return i.source === 'mensagem' || (i.source === 'post_feedback' && i.action === 'mensagem');
    case 'aprovacoes':
      return (
        (i.source === 'post_feedback' && (i.action === 'aprovado' || i.action === 'correcao')) ||
        i.source === 'media_note' ||
        i.source === 'media_note_reply'
      );
    case 'sugestoes':
      return i.source === 'edit_suggestion';
  }
}

export function unreadTotal(rows: MensagensUnreadRow[]): number {
  return rows.reduce((sum, r) => sum + r.unread_count, 0);
}

export type ConversasSort = 'recentes' | 'antigas';

/** Active conversations sorted by recency (or oldest); clientes with no
 * activity yet always sink to the bottom, alphabetically. */
export function sortConversas(rows: MensagemConversa[], sort: ConversasSort): MensagemConversa[] {
  const ativas = rows.filter((r) => r.last_created_at != null);
  const vazias = rows
    .filter((r) => r.last_created_at == null)
    .sort((a, b) => a.cliente_nome.localeCompare(b.cliente_nome, 'pt-BR'));
  const sorted = [...ativas].sort((a, b) => a.last_created_at!.localeCompare(b.last_created_at!));
  return [...(sort === 'antigas' ? sorted : sorted.reverse()), ...vazias];
}

const SUGGESTION_ACTIONS = new Set(['pending', 'accepted', 'rejected', 'superseded']);

function suggestionLabel(action: string | null | undefined): string {
  const a = action ?? 'pending';
  return SUGGESTION_ACTIONS.has(a)
    ? i18n.t(`messages:events.suggestion.${a}`)
    : i18n.t('messages:events.suggestion.generic');
}

/** One-line preview for a conversation row, WhatsApp style: agency messages
 * are prefixed with the author, client events get their action label. */
export function conversaPreview(c: MensagemConversa): string {
  if (c.last_source == null) return i18n.t('messages:shared.noMessagesYet');
  if (c.last_source === 'edit_suggestion') return suggestionLabel(c.last_action);
  if (c.last_source === 'post_feedback' && c.last_action !== 'mensagem') {
    if (c.last_action === 'aprovado') {
      return c.last_content?.trim() || i18n.t('messages:events.approved');
    }
    if (c.last_action === 'correcao') {
      return c.last_content?.trim() || i18n.t('messages:events.correction');
    }
  }
  const text = c.last_content?.trim() ?? '';
  if (c.last_source === 'media_note') return i18n.t('messages:preview.mediaNote', { text });
  if (c.last_is_workspace_user) {
    return i18n.t('messages:preview.authored', {
      author: c.last_author_name ?? i18n.t('messages:shared.team'),
      text,
    });
  }
  return text;
}

/** Label shown above a media-note bubble (client note pinned to a post's media,
 * or a team reply to one); null for every other feed source. */
export function mediaNoteLabel(i: MensagemFeedItem): string | null {
  if (i.source === 'media_note') return i18n.t('messages:events.mediaNote');
  if (i.source === 'media_note_reply') return i18n.t('messages:events.mediaNoteReply');
  return null;
}

/** Centered event row inside a thread: commentless approvals/corrections and
 * edit suggestions (mirrors the Hub's rendering, from the agency's viewpoint). */
export function isEventRow(i: MensagemFeedItem): boolean {
  if (i.source === 'edit_suggestion') return true;
  return i.source === 'post_feedback' && i.action !== 'mensagem' && !i.content?.trim();
}

export function eventLabel(i: MensagemFeedItem): string {
  if (i.source === 'edit_suggestion') return suggestionLabel(i.action);
  return i.action === 'aprovado'
    ? i18n.t('messages:events.approved')
    : i18n.t('messages:events.correction');
}

/** "10 de ago., 17:35" (pt-BR) / "Aug 10, 5:35 PM" (en): day + abbreviated
 * month + time in the UI locale, used by both the conversation list row and
 * the thread's message timestamps. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(getIntlLocale(), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
