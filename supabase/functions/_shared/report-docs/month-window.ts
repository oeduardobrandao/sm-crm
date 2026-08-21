// Janela de mês própria do report-docs (não depende do monthWindow interno do
// gerador v2). Labels pt-BR fixos: determinismo independente de ICU.

export interface MonthWindow {
  month: string;            // "YYYY-MM"
  start: string;            // ISO timestamp inclusivo
  endExclusive: string;     // ISO timestamp exclusivo
  startDate: string;        // "YYYY-MM-01"
  endDateExclusive: string; // primeiro dia do mês seguinte
  label: string;            // "Julho de 2026"
}

const MONTHS_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function parseMonth(month: string): { y: number; m: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw new Error(`invalid month: ${month}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  if (m < 1 || m > 12) throw new Error(`invalid month: ${month}`);
  return { y, m };
}

const pad = (n: number) => String(n).padStart(2, "0");

export function monthWindow(month: string): MonthWindow {
  const { y, m } = parseMonth(month);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const startDate = `${y}-${pad(m)}-01`;
  const endDateExclusive = `${nextY}-${pad(nextM)}-01`;
  return {
    month,
    start: `${startDate}T00:00:00.000Z`,
    endExclusive: `${endDateExclusive}T00:00:00.000Z`,
    startDate,
    endDateExclusive,
    label: `${MONTHS_PT[m - 1]} de ${y}`,
  };
}

export function prevMonthOf(month: string): string {
  const { y, m } = parseMonth(month);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}
