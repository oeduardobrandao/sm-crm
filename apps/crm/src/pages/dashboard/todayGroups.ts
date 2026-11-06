import { dayNum } from '../entregas/etapaPrazo';
import { dayDiff, startOfLocalDay, type AgendaItem } from './todayAgenda';

// Pure grouping for the Vidro dashboard's "Prazos" list: one bucket's items folded by client,
// by responsible or by day. No React, no i18n: the caller names the catch-all groups.

export type AgendaGroupMode = 'cliente' | 'responsavel' | 'dia';

export interface AgendaGroup {
  key: string;
  /** Client or member name; empty for a day group (the caller formats `day`). */
  label: string;
  /** The catch-all group (no client, no responsible, no date): always listed last. */
  rest: boolean;
  items: AgendaItem[];
  clienteId: number | null;
  /** Day groups only: local midnight of the day, null for the undated group. */
  day: Date | null;
}

export interface AgendaGroupLabels {
  semCliente: string;
  semResponsavel: string;
}

const firstWhen = (items: AgendaItem[]): number =>
  items.reduce((min, i) => (i.when ? Math.min(min, i.when.getTime()) : min), Infinity);

/**
 * Folds `items` (already sorted by buildTodayAgenda) into groups. Client and responsible groups
 * run biggest first, then earliest deadline, then name; day groups run by date. Each group
 * keeps its items in the incoming order.
 */
export function groupAgendaItems(
  items: AgendaItem[],
  mode: AgendaGroupMode,
  labels: AgendaGroupLabels,
): AgendaGroup[] {
  const byKey = new Map<string, AgendaGroup>();
  for (const item of items) {
    let key: string;
    let label = '';
    let rest = false;
    let clienteId: number | null = null;
    let day: Date | null = null;
    if (mode === 'cliente') {
      const nome = item.cliente?.nome?.trim();
      rest = !nome;
      key = rest ? 'rest' : `c:${nome!.toLocaleLowerCase('pt-BR')}`;
      label = rest ? labels.semCliente : nome!;
      clienteId = item.cliente?.id ?? null;
    } else if (mode === 'responsavel') {
      rest = !item.responsavel;
      key = rest ? 'rest' : `r:${item.responsavel!.id}`;
      label = rest ? labels.semResponsavel : item.responsavel!.nome;
    } else {
      rest = !item.when;
      day = item.when ? startOfLocalDay(item.when) : null;
      key = day ? `d:${dayNum(day)}` : 'rest';
    }
    const group = byKey.get(key);
    if (group) {
      group.items.push(item);
      if (group.clienteId == null && clienteId != null) group.clienteId = clienteId;
    } else {
      byKey.set(key, { key, label, rest, items: [item], clienteId, day });
    }
  }

  const groups = [...byKey.values()];
  groups.sort((a, b) => {
    if (a.rest !== b.rest) return a.rest ? 1 : -1;
    if (mode === 'dia') return (a.day?.getTime() ?? 0) - (b.day?.getTime() ?? 0);
    return (
      b.items.length - a.items.length ||
      firstWhen(a.items) - firstWhen(b.items) ||
      a.label.localeCompare(b.label, 'pt-BR')
    );
  });
  return groups;
}

/** Days since the oldest dated item fell due (0 when none is dated or overdue). */
export function oldestOverdueDays(items: AgendaItem[], now: Date): number {
  const oldest = firstWhen(items);
  if (!Number.isFinite(oldest)) return 0;
  return Math.max(0, -dayDiff(new Date(oldest), now));
}

/** Items per day for the next `days` days (day 1 = tomorrow), for the "Próximos" tile bars. */
export function countPerDay(items: AgendaItem[], now: Date, days: number): number[] {
  const counts = new Array<number>(days).fill(0);
  for (const item of items) {
    if (!item.when) continue;
    const d = dayDiff(item.when, now);
    if (d >= 1 && d <= days) counts[d - 1] += 1;
  }
  return counts;
}
