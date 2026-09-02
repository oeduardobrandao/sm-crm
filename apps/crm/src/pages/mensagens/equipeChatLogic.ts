import type { EquipeConversa } from '@/store';
import { stripMentionTokens } from '@/components/mentions/mentionTokens';

export type EquipeConversasSort = 'recentes' | 'antigas';

/** Active conversations sorted by recency (or oldest); empty conversations
 * always sink to the bottom, alphabetically. */
export function sortEquipeConversas(
  rows: EquipeConversa[],
  sort: EquipeConversasSort,
): EquipeConversa[] {
  const ativas = rows.filter((r) => r.last_created_at != null);
  const vazias = rows
    .filter((r) => r.last_created_at == null)
    .sort((a, b) => a.display_nome.localeCompare(b.display_nome, 'pt-BR'));
  const sorted = [...ativas].sort((a, b) => a.last_created_at!.localeCompare(b.last_created_at!));
  return [...(sort === 'antigas' ? sorted : sorted.reverse()), ...vazias];
}

/** One-line preview for a conversation row: "Autor: texto", "Autor: Anexo",
 * just the author, or the empty-conversation copy. */
export function equipeConversaPreview(c: EquipeConversa): string {
  if (c.last_created_at == null) return 'Sem mensagens ainda. Comece a conversa!';
  const autor = c.last_author_name ?? 'Equipe';
  // last_content may carry raw @[Label](tipo:id) mention tokens: this is a
  // plain-text preview row, not a rendered chip, so strip them before showing.
  const texto = stripMentionTokens(c.last_content?.trim() ?? '');
  if (texto) return `${autor}: ${texto}`;
  if (c.last_has_anexo) return `${autor}: Anexo`;
  return autor;
}
