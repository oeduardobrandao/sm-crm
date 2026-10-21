import { format } from 'date-fns';
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

export const REPETIR_LABELS: Record<RepetirValor, string> = {
  never: 'Não repete',
  daily: 'Diariamente',
  weekly: 'Semanalmente',
  monthly: 'Mensalmente',
  yearly: 'Anualmente',
};

/** Chip letters indexed by dias_semana value (0 = domingo). */
export const WEEKDAY_CHIPS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;
export const WEEKDAY_NAMES = [
  'domingo',
  'segunda',
  'terça',
  'quarta',
  'quinta',
  'sexta',
  'sábado',
] as const;

export function unidadeIntervalo(freq: TarefaSerieFreq, n: number): string {
  const plural = n !== 1;
  switch (freq) {
    case 'daily':
      return plural ? 'dias' : 'dia';
    case 'weekly':
      return plural ? 'semanas' : 'semana';
    case 'monthly':
      return plural ? 'meses' : 'mês';
    case 'yearly':
      return plural ? 'anos' : 'ano';
  }
}

/** Distinct days in Mon..Sun order (Sunday last), matching the DB's date_trunc('week') weeks. */
function sortWeekdays(days: number[]): number[] {
  return [...new Set(days)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

function joinNomes(days: number[]): string {
  const names = sortWeekdays(days).map((d) => WEEKDAY_NAMES[d]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function fmtDia(dia_mes: number): string {
  return dia_mes > 28 ? `dia ${dia_mes} (ou último dia)` : `dia ${dia_mes}`;
}

export function describeRecorrencia(regra: TarefaSerieRegra): string {
  const n = regra.intervalo;
  let base: string;
  switch (regra.freq) {
    case 'daily':
      base = n === 1 ? 'Todo dia' : `A cada ${n} dias`;
      break;
    case 'weekly': {
      const dias = sortWeekdays(regra.dias_semana ?? []);
      const nomes = joinNomes(dias);
      // domingo (0) and sábado (6) are masculine; the article follows the first listed day.
      const masc = dias[0] === 0 || dias[0] === 6;
      base =
        n === 1
          ? `${masc ? 'Todo' : 'Toda'} ${nomes}`
          : `A cada ${n} semanas, ${masc ? 'no' : 'na'} ${nomes}`;
      break;
    }
    case 'monthly': {
      const dia = fmtDia(regra.dia_mes ?? 1);
      base = n === 1 ? `Todo ${dia}` : `A cada ${n} meses, no ${dia}`;
      break;
    }
    case 'yearly': {
      const dm = `${String(regra.dia_mes ?? 1).padStart(2, '0')}/${String(regra.mes ?? 1).padStart(2, '0')}`;
      base = n === 1 ? `Todo ano em ${dm}` : `A cada ${n} anos, em ${dm}`;
      break;
    }
  }
  return regra.fim ? `${base} até ${format(parseDateOnly(regra.fim), 'dd/MM/yyyy')}` : base;
}

export function modoLabel(modo: TarefaSerieModo): string {
  return modo === 'ao_concluir' ? 'cria a próxima ao concluir' : 'cria em toda data da regra';
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
      return 'Encerrada';
    case 'pausada':
      return 'Pausada';
    case 'concluida':
      return 'Concluída';
    case 'ativa':
      return serie.fim ? `Termina em ${format(parseDateOnly(serie.fim), 'dd/MM/yyyy')}` : null;
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
