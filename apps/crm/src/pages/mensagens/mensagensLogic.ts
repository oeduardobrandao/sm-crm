import type { MensagemFeedItem, MensagensUnreadRow } from '@/store';

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
