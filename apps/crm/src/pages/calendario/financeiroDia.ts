import type { Cliente, ClienteData, Membro } from '../../store';
import type { FinancialAccess } from '@/lib/financialAccess';
import type { DeadlineEvent } from './camadas/prazos';

export interface FinanceiroFontes {
  clientes: Cliente[];
  membros: Membro[];
  deadlineEvents: DeadlineEvent[];
  datasImportantes: ClienteData[];
  canSeeFinancials: FinancialAccess;
}

/** Everything the "Calendário" tab shows on one day. */
export interface ItensDoDia {
  incomes: Cliente[];
  expenses: Membro[];
  deadlines: DeadlineEvent[];
  birthdays: Cliente[];
  datas: ClienteData[];
}

export function diaVazio(i: ItensDoDia): boolean {
  return (
    i.incomes.length === 0 &&
    i.expenses.length === 0 &&
    i.deadlines.length === 0 &&
    i.birthdays.length === 0 &&
    i.datas.length === 0
  );
}

/**
 * Items of day `day` of `month` (0-based) / `year`: client receivables and team
 * payments by their monthly day, active-stage deadlines, client birthdays (stored as
 * MM-DD, recurring every year) and important client dates. Shared by the desktop grid,
 * its "Agendado" panel and the phone month view.
 *
 * Financial rows branch on the explicit capability, never on a nullable financial value:
 * a legitimately null retainer is indistinguishable from a masked one, and Number(null)
 * is 0, so inference would render phantom R$ 0 entries.
 */
export function itensDoDia(
  f: FinanceiroFontes,
  year: number,
  month: number,
  day: number,
): ItensDoDia {
  const financeiro = f.canSeeFinancials === true;
  return {
    incomes: financeiro
      ? f.clientes.filter((c) => c.data_pagamento === day && c.status === 'ativo')
      : [],
    expenses: financeiro ? f.membros.filter((m) => m.data_pagamento === day) : [],
    deadlines: f.deadlineEvents.filter(
      (d) =>
        d.deadlineDate.getDate() === day &&
        d.deadlineDate.getMonth() === month &&
        d.deadlineDate.getFullYear() === year,
    ),
    birthdays: f.clientes.filter((c) => {
      if (!c.data_aniversario) return false;
      const [bdMm, bdDd] = c.data_aniversario.split('-').map(Number);
      return bdMm - 1 === month && bdDd === day;
    }),
    datas: f.datasImportantes.filter((d) => {
      const dt = new Date(d.data + 'T00:00:00');
      return dt.getMonth() === month && dt.getDate() === day && dt.getFullYear() === year;
    }),
  };
}

/** `referencia_agendamento` that marks a client receivable / team payment of a month paid. */
export function refPagamento(
  tipo: 'cliente' | 'membro',
  id: number | string | null | undefined,
  year: number,
  month: number,
): string {
  return `${tipo}_${id}_${year}_${String(month + 1).padStart(2, '0')}`;
}
