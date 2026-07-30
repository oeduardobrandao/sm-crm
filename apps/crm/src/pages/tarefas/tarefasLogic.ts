import type { TarefaStatus, TarefaWithRelations } from '../../store';

// Pure logic for the Tarefas page — no React, unit-tested in __tests__/tarefasLogic.test.ts.

// ---- Date helpers ------------------------------------------------------------
// data_limite is a bare 'YYYY-MM-DD'. `new Date('YYYY-MM-DD')` parses as UTC
// midnight, which shifts the day in Brazilian timezones — always append
// T00:00:00 (formatDate convention in store/core.ts).

export function parseDateOnly(d: string): Date {
  return new Date(d + 'T00:00:00');
}

export function toDateOnlyString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Sunday that closes the current Mon-Sun week of `now`. */
function endOfCurrentWeek(now: Date): Date {
  const today = startOfLocalDay(now);
  const dow = today.getDay(); // 0 = Sunday
  const daysUntilSunday = dow === 0 ? 0 : 7 - dow;
  const sunday = new Date(today);
  sunday.setDate(sunday.getDate() + daysUntilSunday);
  return sunday;
}

// ---- Sorting -----------------------------------------------------------------

/** data_limite asc with nulls last, then created_at asc. */
export function sortTarefas(a: TarefaWithRelations, b: TarefaWithRelations): number {
  if (a.data_limite && b.data_limite && a.data_limite !== b.data_limite) {
    return a.data_limite < b.data_limite ? -1 : 1;
  }
  if (a.data_limite && !b.data_limite) return -1;
  if (!a.data_limite && b.data_limite) return 1;
  return (a.created_at ?? '') < (b.created_at ?? '') ? -1 : 1;
}

// ---- Due buckets (list view) -------------------------------------------------

export type DueBucket = 'atrasadas' | 'hoje' | 'estaSemana' | 'depois' | 'semData';

export const DUE_BUCKETS: { id: DueBucket; label: string }[] = [
  { id: 'atrasadas', label: 'Atrasadas' },
  { id: 'hoje', label: 'Hoje' },
  { id: 'estaSemana', label: 'Esta semana' },
  { id: 'depois', label: 'Depois' },
  { id: 'semData', label: 'Sem data' },
];

/** Groups OPEN tasks (status != concluida) into due buckets, each sorted. */
export function groupByDueBucket(
  tarefas: TarefaWithRelations[],
  now: Date,
): Record<DueBucket, TarefaWithRelations[]> {
  const today = startOfLocalDay(now);
  const weekEnd = endOfCurrentWeek(now);
  const buckets: Record<DueBucket, TarefaWithRelations[]> = {
    atrasadas: [],
    hoje: [],
    estaSemana: [],
    depois: [],
    semData: [],
  };
  for (const t of tarefas) {
    if (t.status === 'concluida') continue;
    if (!t.data_limite) {
      buckets.semData.push(t);
      continue;
    }
    const due = parseDateOnly(t.data_limite);
    if (due < today) buckets.atrasadas.push(t);
    else if (isSameLocalDay(due, today)) buckets.hoje.push(t);
    else if (due <= weekEnd) buckets.estaSemana.push(t);
    else buckets.depois.push(t);
  }
  for (const key of Object.keys(buckets) as DueBucket[]) buckets[key].sort(sortTarefas);
  return buckets;
}

// ---- Header stats ------------------------------------------------------------

export interface TarefasHeaderStats {
  abertas: number;
  vencemHoje: number;
  atrasadas: number;
  concluidasHoje: number;
}

export function computeHeaderStats(tarefas: TarefaWithRelations[], now: Date): TarefasHeaderStats {
  const today = startOfLocalDay(now);
  let abertas = 0;
  let vencemHoje = 0;
  let atrasadas = 0;
  let concluidasHoje = 0;
  for (const t of tarefas) {
    if (t.status === 'concluida') {
      if (t.concluida_em && isSameLocalDay(new Date(t.concluida_em), now)) concluidasHoje++;
      continue;
    }
    abertas++;
    if (t.data_limite) {
      const due = parseDateOnly(t.data_limite);
      if (due < today) atrasadas++;
      else if (isSameLocalDay(due, today)) vencemHoje++;
    }
  }
  return { abertas, vencemHoje, atrasadas, concluidasHoje };
}

// ---- Filters -----------------------------------------------------------------

/** Every dropdown is multi-select: an empty array means "no filter" (show all). */
export interface TarefaFilterState {
  filterSearch: string;
  filterMembros: number[];
  filterClientes: number[];
  filterTags: number[];
  filterStatus: TarefaStatus[];
}

export const EMPTY_TAREFA_FILTERS: TarefaFilterState = {
  filterSearch: '',
  filterMembros: [],
  filterClientes: [],
  filterTags: [],
  filterStatus: [],
};

export function applyTarefaFilters(
  tarefas: TarefaWithRelations[],
  filters: TarefaFilterState,
): TarefaWithRelations[] {
  let out = tarefas;
  if (filters.filterSearch) {
    const q = filters.filterSearch.toLowerCase();
    out = out.filter(
      (t) =>
        t.titulo.toLowerCase().includes(q) || (t.cliente_nome ?? '').toLowerCase().includes(q),
    );
  }
  if (filters.filterMembros.length) {
    out = out.filter(
      (t) => t.responsavel_id != null && filters.filterMembros.includes(t.responsavel_id),
    );
  }
  if (filters.filterClientes.length) {
    out = out.filter((t) => t.cliente_id != null && filters.filterClientes.includes(t.cliente_id));
  }
  if (filters.filterTags.length) {
    out = out.filter((t) => t.tags.some((tag) => tag.id != null && filters.filterTags.includes(tag.id)));
  }
  if (filters.filterStatus.length) {
    out = out.filter((t) => filters.filterStatus.includes(t.status));
  }
  return out;
}

// ---- Drag-and-drop ids -------------------------------------------------------

export type DropTarget =
  | { kind: 'status'; status: TarefaStatus }
  | { kind: 'membro'; membroId: number | null }
  | { kind: 'day'; date: string | null };

export function buildDropId(target: DropTarget): string {
  if (target.kind === 'status') return `status:${target.status}`;
  if (target.kind === 'membro') return `membro:${target.membroId ?? 'none'}`;
  return `day:${target.date ?? 'none'}`;
}

export function parseDropId(id: string): DropTarget | null {
  const sep = id.indexOf(':');
  if (sep === -1) return null;
  const kind = id.slice(0, sep);
  const rest = id.slice(sep + 1);
  if (kind === 'status') {
    if (rest === 'pendente' || rest === 'em_andamento' || rest === 'concluida') {
      return { kind: 'status', status: rest };
    }
    return null;
  }
  if (kind === 'membro') {
    if (rest === 'none') return { kind: 'membro', membroId: null };
    const parsed = parseInt(rest, 10);
    return isNaN(parsed) ? null : { kind: 'membro', membroId: parsed };
  }
  if (kind === 'day') {
    if (rest === 'none') return { kind: 'day', date: null };
    return /^\d{4}-\d{2}-\d{2}$/.test(rest) ? { kind: 'day', date: rest } : null;
  }
  return null;
}

// ---- Due badge ---------------------------------------------------------------

export type DeadlineClass = 'deadline-ok' | 'deadline-caution' | 'deadline-warning' | 'deadline-overdue';

export interface DueBadge {
  label: string;
  className: DeadlineClass;
}

/** Maps a task's due date to the global deadline chip classes. Null when undated
 * or already concluded (a done task has no urgency to signal). */
export function dueBadge(t: TarefaWithRelations, now: Date): DueBadge | null {
  if (!t.data_limite || t.status === 'concluida') return null;
  const today = startOfLocalDay(now);
  const due = parseDateOnly(t.data_limite);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (diffDays < 0) {
    const d = Math.abs(diffDays);
    return { label: d === 1 ? '1 dia de atraso' : `${d} dias de atraso`, className: 'deadline-overdue' };
  }
  if (diffDays === 0) return { label: 'Hoje', className: 'deadline-warning' };
  if (diffDays === 1) return { label: 'Amanhã', className: 'deadline-caution' };
  if (diffDays <= 3) return { label: `${diffDays} dias`, className: 'deadline-caution' };
  return { label: parseDateOnly(t.data_limite).toLocaleDateString('pt-BR'), className: 'deadline-ok' };
}

export const STATUS_LABELS: Record<TarefaStatus, string> = {
  pendente: 'A fazer',
  em_andamento: 'Em andamento',
  concluida: 'Concluída',
};

export const STATUS_ORDER: TarefaStatus[] = ['pendente', 'em_andamento', 'concluida'];
