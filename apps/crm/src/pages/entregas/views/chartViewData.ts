import type { BoardCard } from '../hooks/useEntregasData';
import { classifyDeadline, type DeadlineStatus } from '../deadlineStatus';
import { dayNum, etapaDeadlineDate } from '../etapaPrazo';

/**
 * Pure data builders behind the "Visão geral" cockpit. No Chart.js, no DOM:
 * every function takes the already filtered BoardCards and returns plain data,
 * so the aggregation rules can be tested without a canvas.
 */

export type UpcomingTab = 'hoje' | 'semana' | 'atrasadas';

/** Most rows a stacked-bar chart shows before it is truncated. */
export const ROW_CAP = 10;

export interface StackedRow {
  /** cliente id, membro id or etapa nome. '' marks the "sem …" bucket. */
  key: string;
  label: string;
  counts: Record<DeadlineStatus, number>;
  total: number;
  /** False when the row has no id to filter the board by (the "sem …" bucket). */
  clickable: boolean;
}

function emptyCounts(): Record<DeadlineStatus, number> {
  return { em_dia: 0, urgente: 0, atrasado: 0 };
}

/** Groups cards into rows keyed by `keyOf`, counting each deadline bucket. */
function groupRows(
  cards: BoardCard[],
  keyOf: (card: BoardCard) => { key: string; label: string },
): StackedRow[] {
  const rows = new Map<string, StackedRow>();
  for (const card of cards) {
    const { key, label } = keyOf(card);
    let row = rows.get(key);
    if (!row) {
      row = { key, label, counts: emptyCounts(), total: 0, clickable: key !== '' };
      rows.set(key, row);
    }
    row.counts[classifyDeadline(card.deadline)]++;
    row.total++;
  }
  return [...rows.values()];
}

/** Riskiest first: most atrasados, then busiest, then alphabetical. */
function byRisk(a: StackedRow, b: StackedRow): number {
  if (b.counts.atrasado !== a.counts.atrasado) return b.counts.atrasado - a.counts.atrasado;
  if (b.total !== a.total) return b.total - a.total;
  return a.label.localeCompare(b.label, 'pt-BR');
}

/** Busiest first, then alphabetical. */
function byVolume(a: StackedRow, b: StackedRow): number {
  if (b.total !== a.total) return b.total - a.total;
  return a.label.localeCompare(b.label, 'pt-BR');
}

export function buildClienteRows(cards: BoardCard[]): StackedRow[] {
  const rows = groupRows(cards, (card) => ({
    key: card.cliente?.id == null ? '' : String(card.cliente.id),
    label: card.cliente?.nome ?? 'Sem cliente',
  }));
  return rows.sort(byRisk).slice(0, ROW_CAP);
}

export function buildResponsavelRows(cards: BoardCard[]): StackedRow[] {
  const rows = groupRows(cards, (card) => ({
    key: card.membro?.id == null ? '' : String(card.membro.id),
    label: card.membro?.nome ?? 'Sem responsável',
  }));
  return rows.sort(byRisk).slice(0, ROW_CAP);
}

export function buildEtapaRows(cards: BoardCard[]): StackedRow[] {
  const rows = groupRows(cards, (card) => ({
    key: card.etapa.nome,
    label: card.etapa.nome,
  }));
  return rows.sort(byVolume).slice(0, ROW_CAP);
}

export interface AgingBucket {
  label: string;
  count: number;
  /** Oldest day of the bucket, as "dias atrás". null = open-ended. */
  fromDaysAgo: number | null;
  /** Newest day of the bucket, as "dias atrás". */
  toDaysAgo: number;
}

const AGING_BUCKETS: {
  label: string;
  max: number;
  fromDaysAgo: number | null;
  toDaysAgo: number;
}[] = [
  // '1 dia' reaches back to today because a card can be estourada by hours and
  // still be due today; its drill-down range has to contain that day too.
  { label: '1 dia', max: 1, fromDaysAgo: 1, toDaysAgo: 0 },
  { label: '2 a 3', max: 3, fromDaysAgo: 3, toDaysAgo: 2 },
  { label: '4 a 7', max: 7, fromDaysAgo: 7, toDaysAgo: 4 },
  { label: '8 a 14', max: 14, fromDaysAgo: 14, toDaysAgo: 8 },
  { label: '15+', max: Infinity, fromDaysAgo: null, toDaysAgo: 15 },
];

/**
 * Whole local calendar days between two dates. Both ends are normalised to
 * midnight first, so a 23h or 25h DST day still counts as one day.
 */
function calendarDaysBetween(later: Date, earlier: Date): number {
  const a = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  const b = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

/**
 * How long the atrasadas have been overdue. Always returns all five buckets so
 * the chart keeps a stable x axis; cards that are not estouradas are ignored.
 *
 * The age is measured in CALENDAR days between today and the etapa's deadline
 * date, the same unit the drill-down uses: clicking a bucket filters by
 * atrasado + the date range its fromDaysAgo/toDaysAgo describe, so every card
 * counted in a bucket has to fall inside that bucket's range. Measuring the age
 * off deadline.diasRestantes instead would drift on the boundaries, because
 * that number is derived from hours.
 */
export function buildAgingBuckets(cards: BoardCard[], now: Date = new Date()): AgingBucket[] {
  const buckets: AgingBucket[] = AGING_BUCKETS.map((b) => ({
    label: b.label,
    count: 0,
    fromDaysAgo: b.fromDaysAgo,
    toDaysAgo: b.toDaysAgo,
  }));
  for (const card of cards) {
    if (!card.deadline.estourado) continue;
    const deadline = etapaDeadlineDate(card);
    // An estourada card with no computable date still belongs somewhere: park
    // it in the freshest bucket rather than dropping it from the chart.
    const ageDays = deadline ? Math.max(0, calendarDaysBetween(now, deadline)) : 1;
    const idx = AGING_BUCKETS.findIndex((b) => ageDays <= b.max);
    buckets[idx === -1 ? buckets.length - 1 : idx].count++;
  }
  return buckets;
}

/**
 * The cards behind the "Próximos vencimentos" tabs. 'hoje' and 'semana' need a
 * calendar date, so cards whose etapa has no deadline yet are left out; they
 * come back sorted by deadline. 'atrasadas' works off the estourado flag and
 * comes back most overdue first.
 */
export function selectUpcoming(
  cards: BoardCard[],
  tab: UpcomingTab,
  now: Date = new Date(),
): BoardCard[] {
  if (tab === 'atrasadas') {
    return cards
      .filter((card) => card.deadline.estourado)
      .sort((a, b) => a.deadline.diasRestantes - b.deadline.diasRestantes);
  }

  const today = dayNum(now);
  const limit = new Date(now);
  limit.setDate(limit.getDate() + 6);
  const lastDay = tab === 'hoje' ? today : dayNum(limit);

  return cards
    .filter((card) => !card.deadline.estourado)
    .map((card) => ({ card, date: etapaDeadlineDate(card) }))
    .filter(
      (entry): entry is { card: BoardCard; date: Date } =>
        entry.date != null && dayNum(entry.date) >= today && dayNum(entry.date) <= lastDay,
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((entry) => entry.card);
}

function isAguardandoCliente(card: BoardCard): boolean {
  return card.etapa.tipo === 'aprovacao_cliente';
}

/** Fluxos parked on the cliente's approval right now. */
export function aguardandoClienteCount(cards: BoardCard[]): number {
  return cards.filter(isAguardandoCliente).length;
}

/** Distinct etapa names of those fluxos, in first-seen order. */
export function aguardandoClienteEtapaNames(cards: BoardCard[]): string[] {
  const names: string[] = [];
  for (const card of cards) {
    if (!isAguardandoCliente(card)) continue;
    if (!names.includes(card.etapa.nome)) names.push(card.etapa.nome);
  }
  return names;
}
