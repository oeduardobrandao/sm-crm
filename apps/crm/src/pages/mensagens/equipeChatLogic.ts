import { format, isSameDay, isSameYear, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { EquipeConversa, EquipeMensagem } from '@/store';
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
 * just the author, or the empty-conversation copy. The current user's own
 * last message reads "Você: ..." instead of their full name. */
export function equipeConversaPreview(
  c: EquipeConversa,
  currentUserId: string | null = null,
): string {
  if (c.last_created_at == null) return 'Sem mensagens ainda. Comece a conversa!';
  const minha = currentUserId != null && c.last_author_id === currentUserId;
  const autor = minha ? 'Você' : (c.last_author_name ?? 'Equipe');
  // last_content may carry raw @[Label](tipo:id) mention tokens: this is a
  // plain-text preview row, not a rendered chip, so strip them before showing.
  const texto = stripMentionTokens(c.last_content?.trim() ?? '');
  if (texto) return `${autor}: ${texto}`;
  if (c.last_has_anexo) return `${autor}: Anexo`;
  return autor;
}

/** Time of a message ("11:57"); its day is in the divider above it. */
export function horaMensagem(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

/** Longest pause between two messages of one author that still stacks them. */
const PAUSA_MAX_MS = 5 * 60_000;

export type EquipeThreadRow =
  | { kind: 'dia'; key: string; label: string }
  | {
      kind: 'msg';
      mensagem: EquipeMensagem;
      /** First of a run: shows the author's name. */
      inicio: boolean;
      /** Last of a run: shows the avatar and the time. */
      fim: boolean;
    };

/** "Hoje", "Ontem", "Segunda-feira, 19 de outubro", or with the year when it isn't this one. */
export function rotuloDia(d: Date, now: Date = new Date()): string {
  if (isSameDay(d, now)) return 'Hoje';
  if (isSameDay(d, subDays(now, 1))) return 'Ontem';
  const texto = isSameYear(d, now)
    ? format(d, "EEEE, d 'de' MMMM", { locale: ptBR })
    : format(d, "d 'de' MMMM 'de' yyyy", { locale: ptBR });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Thread rows for messages in chronological order: a divider opening each day, and
 * messages stacked into runs (same author, same day, at most 5 minutes apart).
 */
export function agruparEquipeMensagens(
  itens: EquipeMensagem[],
  now: Date = new Date(),
): EquipeThreadRow[] {
  const rows: EquipeThreadRow[] = [];
  let anterior: {
    m: EquipeMensagem;
    d: Date;
    row: Extract<EquipeThreadRow, { kind: 'msg' }>;
  } | null = null;
  for (const m of itens) {
    const d = new Date(m.created_at);
    const mesmoDia = anterior != null && isSameDay(anterior.d, d);
    if (!mesmoDia) {
      rows.push({ kind: 'dia', key: `dia-${format(d, 'yyyy-MM-dd')}`, label: rotuloDia(d, now) });
    }
    const continua: boolean =
      anterior != null &&
      mesmoDia &&
      anterior.m.author_user_id === m.author_user_id &&
      d.getTime() - anterior.d.getTime() <= PAUSA_MAX_MS;
    if (continua) anterior!.row.fim = false;
    const row: Extract<EquipeThreadRow, { kind: 'msg' }> = {
      kind: 'msg',
      mensagem: m,
      inicio: !continua,
      fim: true,
    };
    rows.push(row);
    anterior = { m, d, row };
  }
  return rows;
}
