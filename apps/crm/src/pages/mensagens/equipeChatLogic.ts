import { format, isSameDay, isSameYear, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { EquipeChatMember, EquipeConversa, EquipeMensagem } from '@/store';
import { stripMentionTokens } from '@/components/mentions/mentionTokens';

export type EquipeConversasSort = 'recentes' | 'antigas';

/** A row of the Equipe list: a conversation, or a colleague with no DM yet, so
 * every colleague is one click away, the way every client is on the Clientes tab. */
export type EquipeListaItem =
  | { kind: 'conversa'; conversa: EquipeConversa }
  | { kind: 'colega'; colega: EquipeChatMember };

export function equipeListaItemNome(item: EquipeListaItem): string {
  return item.kind === 'conversa' ? item.conversa.display_nome : item.colega.nome;
}

/** Colleagues the user has no DM with yet (the user excluded). */
export function colegasSemDm(
  membros: EquipeChatMember[],
  conversas: EquipeConversa[],
  currentUserId: string | null,
): EquipeChatMember[] {
  const comDm = new Set(conversas.map((c) => c.dm_user_id).filter((id) => id != null));
  return membros.filter((m) => m.user_id !== currentUserId && !comDm.has(m.user_id));
}

/** Active conversations sorted by recency (or oldest); everything without
 * messages (empty conversations and colleagues with no DM) always sinks to
 * the bottom, alphabetically. */
export function sortEquipeLista(
  conversas: EquipeConversa[],
  colegas: EquipeChatMember[],
  sort: EquipeConversasSort,
): EquipeListaItem[] {
  const ativas = conversas
    .filter((c) => c.last_created_at != null)
    .sort((a, b) => a.last_created_at!.localeCompare(b.last_created_at!))
    .map((conversa): EquipeListaItem => ({ kind: 'conversa', conversa }));
  const vazias: EquipeListaItem[] = [
    ...conversas
      .filter((c) => c.last_created_at == null)
      .map((conversa): EquipeListaItem => ({ kind: 'conversa', conversa })),
    ...colegas.map((colega): EquipeListaItem => ({ kind: 'colega', colega })),
  ].sort((a, b) => equipeListaItemNome(a).localeCompare(equipeListaItemNome(b), 'pt-BR'));
  return [...(sort === 'antigas' ? ativas : ativas.reverse()), ...vazias];
}

/** Preview of a row with no messages yet: an empty conversation, or a colleague with no DM. */
export const EQUIPE_SEM_MENSAGENS = 'Sem mensagens ainda. Comece a conversa!';

/** One-line preview for a conversation row: "Autor: texto", "Autor: Anexo",
 * just the author, or the empty-conversation copy. The current user's own
 * last message reads "Você: ..." instead of their full name. */
export function equipeConversaPreview(
  c: EquipeConversa,
  currentUserId: string | null = null,
): string {
  if (c.last_created_at == null) return EQUIPE_SEM_MENSAGENS;
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
  // Relative to `now`, not the clock (isToday/isYesterday read the clock), so a
  // caller's `now` decides both labels the same way it decides the year.
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
