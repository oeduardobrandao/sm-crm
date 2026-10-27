import type { HubLinhaItem } from '../../types';

const MS_DAY = 86_400_000;
const MONTHS_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/**
 * A week of the plan. `inicio` and `fim` are days of the month; `mesInicio` and `mes` are the
 * 0-based months of `inicio` and `fim` (they differ only for a week that crosses months).
 */
export interface LinhaWeek {
  inicio: number;
  fim: number;
  mesInicio: number;
  mes: number;
  semData: boolean;
}

export interface LinhaWeekGroup {
  label: string;
  semData: boolean;
  itens: HubLinhaItem[];
}

function utcDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function formatWeekLabelPt(w: LinhaWeek): string {
  if (w.semData) return 'Sem data';
  if (w.mesInicio !== w.mes) {
    return `Semana de ${w.inicio} de ${MONTHS_PT[w.mesInicio]} a ${w.fim} de ${MONTHS_PT[w.mes]}`;
  }
  return `Semana de ${w.inicio} a ${w.fim} de ${MONTHS_PT[w.mes]}`;
}

/**
 * Groups a linha's items by calendar week (Sunday to Saturday). A week whose items all fall in
 * the `periodo` month is clipped to it, so the first and last weeks read "1 a 7" and "29 a 30"
 * rather than spilling into the neighbouring month. Rows may be dated outside the month
 * (20261031000004); a week holding one of those keeps its real days, across months if need be.
 * Items keep their input order inside a week (the endpoint sends them by date, then `ordem`);
 * undated items close the list under "Sem data".
 */
export function groupByWeek(
  itens: HubLinhaItem[],
  periodo: string,
  formatLabel: (week: LinhaWeek) => string = formatWeekLabelPt,
): LinhaWeekGroup[] {
  const first = utcDay(`${periodo.slice(0, 7)}-01`);
  const firstDate = new Date(first);
  const monthStart = firstDate.getUTCMonth();
  const lastDay = new Date(Date.UTC(firstDate.getUTCFullYear(), monthStart + 1, 0)).getTime();

  const byWeek = new Map<number, HubLinhaItem[]>();
  const undated: HubLinhaItem[] = [];
  for (const item of itens) {
    if (!item.data) {
      undated.push(item);
      continue;
    }
    const day = utcDay(item.data);
    const weekStart = day - new Date(day).getUTCDay() * MS_DAY;
    const bucket = byWeek.get(weekStart);
    if (bucket) bucket.push(item);
    else byWeek.set(weekStart, [item]);
  }

  const groups: LinhaWeekGroup[] = [...byWeek.entries()]
    .sort(([a], [b]) => a - b)
    .map(([weekStart, bucket]) => {
      const noMes = bucket.every((i) => {
        const day = utcDay(i.data as string);
        return day >= first && day <= lastDay;
      });
      const start = noMes ? Math.max(weekStart, first) : weekStart;
      const end = noMes ? Math.min(weekStart + 6 * MS_DAY, lastDay) : weekStart + 6 * MS_DAY;
      const week: LinhaWeek = {
        inicio: new Date(start).getUTCDate(),
        fim: new Date(end).getUTCDate(),
        mesInicio: new Date(start).getUTCMonth(),
        mes: new Date(end).getUTCMonth(),
        semData: false,
      };
      return { label: formatLabel(week), semData: false, itens: bucket };
    });

  if (undated.length > 0) {
    groups.push({
      label: formatLabel({
        inicio: 0,
        fim: 0,
        mesInicio: monthStart,
        mes: monthStart,
        semData: true,
      }),
      semData: true,
      itens: undated,
    });
  }
  return groups;
}

/** First day of the current month in São Paulo (the edge runtime and tests run in UTC). */
export function currentPeriodo(now: Date = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(now);
  return `${ymd.slice(0, 7)}-01`;
}
