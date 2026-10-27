import { format } from 'date-fns';
import { i18n } from '@mesaas/i18n';
import type {
  TarefaSerieFreq,
  TarefaSerieModo,
  TarefaSerieRegra,
  TarefaSerieResumo,
} from '../../store';
import { parseDateOnly, toDateOnlyString } from './tarefasLogic';
import type { RecorrenciaFormValues } from './components/tarefaFormSchema';

// Pure helpers for tarefas recorrentes. No next-date computation on the
// client: the database owns the date math (tarefa_next_date).

export type RepetirValor = 'never' | TarefaSerieFreq;

/** A label map whose values resolve through i18n on every read (enumerable getters). */
function lazyMap<K extends string>(
  keys: readonly K[],
  keyFor: (k: K) => string,
): Record<K, string> {
  const o = {} as Record<K, string>;
  for (const k of keys)
    Object.defineProperty(o, k, { enumerable: true, get: () => i18n.t(keyFor(k)) });
  return o;
}

/** A fixed-length list whose items resolve through i18n on every read (index getters), so
 *  `LIST[i]`, `.map` and spreading all follow the current UI language. */
function lazyList(length: number, keyFor: (i: number) => string): readonly string[] {
  const arr: string[] = new Array<string>(length);
  for (let i = 0; i < length; i++) {
    Object.defineProperty(arr, i, { enumerable: true, get: () => i18n.t(keyFor(i)) });
  }
  return Object.freeze(arr);
}

export const REPETIR_LABELS: Record<RepetirValor, string> = lazyMap(
  ['never', 'daily', 'weekly', 'monthly', 'yearly'] as const,
  (k) => `tasks:shared.repetir.${k}`,
);

/** Chip letters indexed by dias_semana value (0 = domingo). */
export const WEEKDAY_CHIPS = lazyList(7, (d) => `tasks:shared.weekdayChip.${d}`);
/** Weekday names indexed by dias_semana value (0 = domingo); lowercase in Portuguese. */
export const WEEKDAY_NAMES = lazyList(7, (d) => `tasks:shared.weekdayName.${d}`);

export function unidadeIntervalo(freq: TarefaSerieFreq, n: number): string {
  return i18n.t(`tasks:shared.unit.${freq}.${n !== 1 ? 'plural' : 'singular'}`);
}

/** Distinct days in Mon..Sun order (Sunday last), matching the DB's date_trunc('week') weeks. */
function sortWeekdays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

function joinNomes(days: number[]): string {
  const names = sortWeekdays(days).map((d) => WEEKDAY_NAMES[d]);
  if (names.length <= 1) return names.join('');
  return i18n.t('tasks:shared.recorrencia.joinLast', {
    rest: names.slice(0, -1).join(', '),
    last: names[names.length - 1],
  });
}

function fmtDia(dia_mes: number): string {
  return i18n.t(
    dia_mes > 28 ? 'tasks:shared.recorrencia.dayOrLast' : 'tasks:shared.recorrencia.day',
    {
      day: dia_mes,
    },
  );
}

function fmtData(d: string): string {
  return format(parseDateOnly(d), i18n.t('tasks:shared.dateNumeric'));
}

export function describeRecorrencia(regra: TarefaSerieRegra): string {
  const n = regra.intervalo;
  let base: string;
  switch (regra.freq) {
    case 'daily':
      base =
        n === 1
          ? i18n.t('tasks:shared.recorrencia.daily')
          : i18n.t('tasks:shared.recorrencia.dailyN', { n });
      break;
    case 'weekly': {
      const dias = sortWeekdays(regra.dias_semana ?? []);
      const days = joinNomes(dias);
      // domingo (0) and sábado (6) are masculine; the article follows the first listed day.
      const masc = dias[0] === 0 || dias[0] === 6;
      const g = masc ? 'Masc' : 'Fem';
      base =
        n === 1
          ? i18n.t(`tasks:shared.recorrencia.weekly${g}`, { days })
          : i18n.t(`tasks:shared.recorrencia.weeklyN${g}`, { n, days });
      break;
    }
    case 'monthly': {
      const day = fmtDia(regra.dia_mes ?? 1);
      base =
        n === 1
          ? i18n.t('tasks:shared.recorrencia.monthly', { day })
          : i18n.t('tasks:shared.recorrencia.monthlyN', { n, day });
      break;
    }
    case 'yearly': {
      const dia = regra.dia_mes ?? 1;
      const mes = regra.mes ?? 1;
      const date = i18n.t('tasks:shared.recorrencia.yearlyDate', {
        dd: String(dia).padStart(2, '0'),
        mm: String(mes).padStart(2, '0'),
        day: dia,
        month: i18n.t(`common:months.${mes - 1}`),
      });
      base =
        n === 1
          ? i18n.t('tasks:shared.recorrencia.yearly', { date })
          : i18n.t('tasks:shared.recorrencia.yearlyN', { n, date });
      break;
    }
  }
  return regra.fim
    ? i18n.t('tasks:shared.recorrencia.until', { base, date: fmtData(regra.fim) })
    : base;
}

export function modoLabel(modo: TarefaSerieModo): string {
  return modo === 'ao_concluir'
    ? i18n.t('tasks:shared.modo.aoConcluir')
    : i18n.t('tasks:shared.modo.calendario');
}

export type SerieEstado = 'ativa' | 'pausada' | 'encerrada' | 'concluida';

/** Derived state, spec "Series states" table. The ONLY place this is derived;
 *  the card and the sheet call it. Mutually exclusive by precedence:
 *  Encerrada > Concluída > Pausada > Ativa (a paused-but-exhausted series is
 *  Concluída, not Pausada). */
export function serieEstado(serie: TarefaSerieResumo, today: Date): SerieEstado {
  if (serie.encerrada_em) return 'encerrada';
  const hoje = toDateOnlyString(today);
  const concluida =
    (serie.fim !== null && serie.fim < hoje) ||
    (serie.modo === 'calendario' && serie.proxima_data === null);
  if (concluida) return 'concluida';
  if (serie.pausada) return 'pausada';
  return 'ativa';
}

/** Pill text: null when the series is simply active with no end. */
export function serieEstadoLabel(serie: TarefaSerieResumo, today: Date): string | null {
  switch (serieEstado(serie, today)) {
    case 'encerrada':
      return i18n.t('tasks:shared.serieEstado.encerrada');
    case 'pausada':
      return i18n.t('tasks:shared.serieEstado.pausada');
    case 'concluida':
      return i18n.t('tasks:shared.serieEstado.concluida');
    case 'ativa':
      return serie.fim
        ? i18n.t('tasks:shared.serieEstado.terminaEm', { date: fmtData(serie.fim) })
        : null;
  }
}

/** Builds the RPC rule from the form. `landing` is the series' stored
 *  dia_mes/mes when editing an occurrence (Prazo never moves them); null for a
 *  new series or a promotion, where they derive from the due date. */
export function regraFromForm(
  values: RecorrenciaFormValues,
  dataLimite: Date,
  landing: { dia_mes: number | null; mes: number | null } | null,
): TarefaSerieRegra | null {
  if (values.repetir === 'never') return null;
  const freq = values.repetir;
  const fromDate = { dia_mes: dataLimite.getDate(), mes: dataLimite.getMonth() + 1 };
  const land = landing ?? fromDate;
  return {
    freq,
    intervalo: parseInt(values.intervalo, 10),
    dias_semana: freq === 'weekly' ? sortWeekdays(values.dias_semana) : null,
    dia_mes: freq === 'monthly' || freq === 'yearly' ? (land.dia_mes ?? fromDate.dia_mes) : null,
    mes: freq === 'yearly' ? (land.mes ?? fromDate.mes) : null,
    modo: values.modo,
    fim: values.fim ? toDateOnlyString(values.fim) : null,
  };
}

export function regraIgual(a: TarefaSerieRegra, b: TarefaSerieRegra): boolean {
  const days = (r: TarefaSerieRegra) =>
    r.dias_semana ? sortWeekdays(r.dias_semana).join(',') : '';
  return (
    a.freq === b.freq &&
    a.intervalo === b.intervalo &&
    days(a) === days(b) &&
    a.dia_mes === b.dia_mes &&
    a.mes === b.mes &&
    a.modo === b.modo &&
    a.fim === b.fim
  );
}
