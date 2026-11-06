import type { EventInput } from '@fullcalendar/core';
import { addDays, addWeeks, startOfMonth, startOfWeek } from 'date-fns';
import type { AgendaOcorrencia } from '../../../../store/agenda';
import { parseDateOnly } from '../../../tarefas/tarefasLogic';
import type { CamadaItem } from '../../camadas/tipos';

/** One Agenda event or layer item as the phone lists show it. */
export interface ItemAgenda {
  id: string;
  titulo: string;
  inicio: Date;
  /** Exclusive. All-day items end at a midnight. */
  fim: Date;
  diaInteiro: boolean;
  cor: string;
  ordem: number;
  ocorrencia?: AgendaOcorrencia;
  camada?: CamadaItem;
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

function paraData(v: EventInput['start']): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string') return DATA_RE.test(v) ? parseDateOnly(v) : new Date(v);
  if (typeof v === 'number') return new Date(v);
  return null;
}

/** The FullCalendar inputs the Agenda builds (toEventInput, toCamadaEventInput) as items. */
export function paraItens(eventos: EventInput[]): ItemAgenda[] {
  const itens: ItemAgenda[] = [];
  for (const ev of eventos) {
    const props = (ev.extendedProps ?? {}) as {
      ocorrencia?: AgendaOcorrencia;
      camada?: CamadaItem;
      ordem?: number;
    };
    // The desktop quick-create draft carries neither.
    if (!props.ocorrencia && !props.camada) continue;
    const inicio = paraData(ev.start);
    if (!inicio) continue;
    const diaInteiro = ev.allDay === true;
    const fim = paraData(ev.end) ?? (diaInteiro ? addDays(inicio, 1) : inicio);
    itens.push({
      id: String(ev.id),
      titulo: ev.title ?? '',
      inicio,
      fim,
      diaInteiro,
      cor: typeof ev.borderColor === 'string' ? ev.borderColor : '#888',
      ordem: props.ordem ?? 0,
      ocorrencia: props.ocorrencia,
      camada: props.camada,
    });
  }
  return itens;
}

/** Items happening on `dia` (any time of it), in the grid's order: Agenda events, then
 *  the layers; all-day first; then by start. */
export function itensDoDia(itens: ItemAgenda[], dia: Date): ItemAgenda[] {
  const ini = new Date(dia.getFullYear(), dia.getMonth(), dia.getDate());
  const fim = addDays(ini, 1);
  return itens
    .filter((i) =>
      i.fim > i.inicio ? i.inicio < fim && i.fim > ini : i.inicio >= ini && i.inicio < fim,
    )
    .sort(
      (a, b) =>
        a.ordem - b.ordem ||
        Number(b.diaInteiro) - Number(a.diaInteiro) ||
        a.inicio.getTime() - b.inicio.getTime() ||
        a.titulo.localeCompare(b.titulo, 'pt-BR'),
    );
}

/** The range FullCalendar's month grid would load (6 Monday-first weeks), so the agenda
 *  query and the layers see the same period while the phone month is on screen. */
export function periodoDoMes(d: Date): {
  start: Date;
  end: Date;
  currentStart: Date;
  currentEnd: Date;
} {
  const currentStart = startOfMonth(d);
  const start = startOfWeek(currentStart, { weekStartsOn: 1 });
  return {
    start,
    end: addDays(start, 42),
    currentStart,
    currentEnd: new Date(d.getFullYear(), d.getMonth() + 1, 1),
  };
}

/** Monday-first week of `d` (listWeek's range). */
export function periodoDaSemana(d: Date): {
  start: Date;
  end: Date;
  currentStart: Date;
  currentEnd: Date;
} {
  const start = startOfWeek(d, { weekStartsOn: 1 });
  const end = addWeeks(start, 1);
  return { start, end, currentStart: start, currentEnd: end };
}
