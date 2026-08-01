import type { MensagemConversa, MensagemFeedItem, MensagensUnreadRow } from '@/store';

export type MensagensTipoFilter = 'todas' | 'mensagens' | 'aprovacoes' | 'sugestoes';

export const TIPO_FILTERS: { id: MensagensTipoFilter; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'mensagens', label: 'Mensagens' },
  { id: 'aprovacoes', label: 'Aprovações' },
  { id: 'sugestoes', label: 'Sugestões' },
];

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
      return i.source === 'post_feedback' && (i.action === 'aprovado' || i.action === 'correcao');
    case 'sugestoes':
      return i.source === 'edit_suggestion';
  }
}

export function unreadTotal(rows: MensagensUnreadRow[]): number {
  return rows.reduce((sum, r) => sum + r.unread_count, 0);
}

export type ConversasSort = 'recentes' | 'antigas';

export function sortConversas(rows: MensagemConversa[], sort: ConversasSort): MensagemConversa[] {
  const sorted = [...rows].sort((a, b) => a.last_created_at.localeCompare(b.last_created_at));
  return sort === 'antigas' ? sorted : sorted.reverse();
}

const SUGGESTION_PREVIEW: Record<string, string> = {
  pending: 'Sugestão de edição enviada',
  accepted: 'Sugestão de edição aceita',
  rejected: 'Sugestão de edição rejeitada',
};

/** One-line preview for a conversation row, WhatsApp style: agency messages
 * are prefixed with the author, client events get their action label. */
export function conversaPreview(c: MensagemConversa): string {
  if (c.last_source === 'edit_suggestion') {
    return SUGGESTION_PREVIEW[c.last_action ?? 'pending'] ?? 'Sugestão de edição';
  }
  if (c.last_source === 'post_feedback' && c.last_action !== 'mensagem') {
    if (c.last_action === 'aprovado') return c.last_content?.trim() || 'Aprovou o post';
    if (c.last_action === 'correcao') return c.last_content?.trim() || 'Pediu correção';
  }
  const text = c.last_content?.trim() ?? '';
  if (c.last_is_workspace_user) return `${c.last_author_name ?? 'Equipe'}: ${text}`;
  return text;
}

/** Centered event row inside a thread: commentless approvals/corrections and
 * edit suggestions (mirrors the Hub's rendering, from the agency's viewpoint). */
export function isEventRow(i: MensagemFeedItem): boolean {
  if (i.source === 'edit_suggestion') return true;
  return i.source === 'post_feedback' && i.action !== 'mensagem' && !i.content?.trim();
}

export function eventLabel(i: MensagemFeedItem): string {
  if (i.source === 'edit_suggestion') {
    return SUGGESTION_PREVIEW[i.action ?? 'pending'] ?? 'Sugestão de edição';
  }
  return i.action === 'aprovado' ? 'Aprovou o post' : 'Pediu correção';
}
