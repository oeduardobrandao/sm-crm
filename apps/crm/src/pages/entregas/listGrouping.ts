import type { ListGroupBy } from './viewQuery';
import { dayDiff, dayNum, formatEtapaDeadlineDay, type DeadlineInfo } from './etapaPrazo';
import { filaBucketOf, type FilaBucket } from './minhaFila';

// "Agrupar por" da vista Lista (Entregas). Puro: sem React, sem fetch. As faixas
// de data são as mesmas da Minha fila (filaBucketOf), com "Próximos 7 dias"
// aberto em um grupo por dia da semana.

/** O que cada agrupamento lê de uma linha. */
export interface ListGroupAccessors<T> {
  /** Prazo da etapa em que a linha está. undefined = sem etapa ("Sem prazo"). */
  prazo: (row: T) => { date: Date | null; deadline: DeadlineInfo } | undefined;
  /** Data de postagem. A Lista de Fluxos não tem (um fluxo tem vários posts):
   *  sem este acessor, `postagem` agrupa por prazo. */
  postagem?: (row: T) => Date | null;
  cliente: (row: T) => { id: number | null; nome: string };
  responsavel: (row: T) => { id: number | null; nome: string };
  etapa: (row: T) => string;
}

export interface ListGroup<T> {
  /** Única entre agrupamentos ("prazo:hoje", "cliente:12"): recolher "Hoje" no
   *  prazo não recolhe "Hoje" na data de postagem. */
  key: string;
  label: string;
  /** Data de um grupo de dia da semana, ex. "2 out". */
  sub?: string;
  /** Rótulo em vermelho. Só o "Atrasado" do prazo da etapa. */
  danger: boolean;
  /** Na ordem de entrada: a ordenação da tabela vale dentro de cada grupo. */
  rows: T[];
}

type GroupDim = Exclude<ListGroupBy, 'nenhum'>;
type DateBucket = Exclude<FilaBucket, 'proximos7'>;

const WEEKDAYS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

/** Data de postagem não "estoura": só a data decide a faixa. */
const SEM_ESTOURO: DeadlineInfo = {
  diasRestantes: 0,
  horasRestantes: 0,
  estourado: false,
  urgente: false,
};

const DATE_LABELS: Record<'prazo' | 'postagem', Record<DateBucket, string>> = {
  prazo: {
    atrasado: 'Atrasado',
    hoje: 'Hoje',
    amanha: 'Amanhã',
    depois: 'Depois',
    sem_prazo: 'Sem prazo',
  },
  postagem: {
    atrasado: 'Data passada',
    hoje: 'Hoje',
    amanha: 'Amanhã',
    depois: 'Depois',
    sem_prazo: 'Sem data',
  },
};

// Posição das faixas. Os dias da semana (+2 a +7) ocupam 4..9, entre Amanhã e Depois.
const DATE_ORDER: Record<DateBucket, number> = {
  atrasado: 0,
  hoje: 1,
  amanha: 2,
  depois: 100,
  sem_prazo: 101,
};

interface Slot {
  key: string;
  label: string;
  sub?: string;
  danger: boolean;
  /** Menor primeiro; empate desempata pelo rótulo (pt-BR). */
  order: number;
}

function dateSlot(
  dim: 'prazo' | 'postagem',
  date: Date | null,
  deadline: DeadlineInfo,
  now: Date,
): Slot {
  const bucket = filaBucketOf(date, deadline, now);
  if (bucket === 'proximos7' && date) {
    return {
      key: `${dim}:dia:${dayNum(date)}`,
      label: WEEKDAYS[date.getDay()],
      sub: formatEtapaDeadlineDay(date, now),
      danger: false,
      order: 2 + dayDiff(date, now),
    };
  }
  // filaBucketOf só devolve proximos7 com data; o fallback existe para o tipo.
  const b: DateBucket = bucket === 'proximos7' ? 'sem_prazo' : bucket;
  return {
    key: `${dim}:${b}`,
    label: DATE_LABELS[dim][b],
    danger: dim === 'prazo' && b === 'atrasado',
    order: DATE_ORDER[b],
  };
}

/** Grupo por entidade: os nomeados em ordem alfabética, o "sem" por último. */
function entitySlot(dim: GroupDim, id: string | null, nome: string, semLabel: string): Slot {
  return {
    key: `${dim}:${id ?? 'none'}`,
    label: id == null ? semLabel : nome || 'Sem nome',
    danger: false,
    order: id == null ? 1 : 0,
  };
}

function slotOf<T>(row: T, dim: GroupDim, acc: ListGroupAccessors<T>, now: Date): Slot {
  switch (dim) {
    case 'prazo': {
      const p = acc.prazo(row);
      return dateSlot('prazo', p?.date ?? null, p?.deadline ?? SEM_ESTOURO, now);
    }
    case 'postagem':
      return dateSlot('postagem', acc.postagem?.(row) ?? null, SEM_ESTOURO, now);
    case 'cliente': {
      const c = acc.cliente(row);
      return entitySlot('cliente', c.id == null ? null : String(c.id), c.nome, 'Sem cliente');
    }
    case 'responsavel': {
      const r = acc.responsavel(row);
      return entitySlot(
        'responsavel',
        r.id == null ? null : String(r.id),
        r.nome,
        'Sem responsável',
      );
    }
    case 'etapa': {
      const e = acc.etapa(row);
      return entitySlot('etapa', e || null, e, 'Sem etapa');
    }
  }
}

/**
 * Divide as linhas (já ordenadas pela tabela) em grupos, na ordem de exibição.
 * Grupo vazio não existe.
 */
export function groupListRows<T>(
  rows: readonly T[],
  by: GroupDim,
  acc: ListGroupAccessors<T>,
  now: Date,
): ListGroup<T>[] {
  const dim: GroupDim = by === 'postagem' && !acc.postagem ? 'prazo' : by;
  const slots = new Map<string, { slot: Slot; rows: T[] }>();
  for (const row of rows) {
    const slot = slotOf(row, dim, acc, now);
    const hit = slots.get(slot.key);
    if (hit) hit.rows.push(row);
    else slots.set(slot.key, { slot, rows: [row] });
  }
  return [...slots.values()]
    .sort(
      (a, b) =>
        a.slot.order - b.slot.order ||
        a.slot.label.localeCompare(b.slot.label, 'pt-BR', { sensitivity: 'base' }),
    )
    .map(({ slot, rows: groupRows }) => ({
      key: slot.key,
      label: slot.label,
      sub: slot.sub,
      danger: slot.danger,
      rows: groupRows,
    }));
}

/** Contagem por responsável do painel Responsáveis. Sem responsável não entra. */
export function countByResponsavel(ids: Iterable<number | null | undefined>): Map<number, number> {
  const out = new Map<number, number>();
  for (const id of ids) if (id != null) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

/** Recolhe/expande um grupo da Lista: um Set novo, para o estado do React. */
export function toggleKey(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
