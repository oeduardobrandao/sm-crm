// Pure formatting for the Depósitos section. No React, no fetch, so the copy rules are testable.
import type {
  DepositDayRow,
  DepositProvider,
  DepositsResponse,
  ProviderDeposits,
} from '../../lib/api';

/** Day strings carry no time; parse as UTC midnight and format in UTC so the calendar day never shifts. */
function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function formatDay(day: string): string {
  return parseDay(day).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export function formatDayShort(day: string): string {
  const d = parseDay(day);
  const weekday = d
    .toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })
    .replace('.', '');
  const dm = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  return `${weekday}, ${dm}`;
}

export function formatMonth(month: string): string {
  return parseDay(`${month}-01`).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function providerName(p: DepositProvider): string {
  return p === 'stripe' ? 'Stripe' : 'Pagar.me';
}

export const NOT_CONFIGURED_SECRET: Record<DepositProvider, string> = {
  stripe: 'STRIPE_SECRET_KEY',
  pagarme: 'PAGARME_RECIPIENT_ID',
};

const WEEKDAY_PT: Record<number, string> = {
  1: 'segunda-feira',
  2: 'terça-feira',
  3: 'quarta-feira',
  4: 'quinta-feira',
  5: 'sexta-feira',
};

const STRIPE_INTERVAL_PT: Record<string, string> = {
  daily: 'diário',
  weekly: 'semanal',
  monthly: 'mensal',
};

export function scheduleCaption(p: DepositProvider, meta: ProviderDeposits['meta']): string | null {
  if (p === 'stripe') {
    const interval = meta.schedule_interval;
    if (typeof interval !== 'string') return null;
    if (interval === 'manual') return 'Repasse manual: sem transferência automática';
    const delay = typeof meta.delay_days === 'number' ? `, D+${meta.delay_days}` : '';
    const label = STRIPE_INTERVAL_PT[interval];
    return label ? `Repasse automático ${label}${delay}` : `Repasse automático${delay}`;
  }
  if (typeof meta.transfer_enabled !== 'boolean') return null;
  if (!meta.transfer_enabled) return 'Transferência automática desligada: saque manual';
  const interval = meta.transfer_interval;
  const day = typeof meta.transfer_day === 'number' ? meta.transfer_day : null;
  let text: string;
  if (interval === 'weekly') {
    text = `Transferência automática semanal${day && WEEKDAY_PT[day] ? ` (${WEEKDAY_PT[day]})` : ''}`;
  } else if (interval === 'monthly') {
    text = `Transferência automática mensal${day ? ` (dia ${day})` : ''}`;
  } else {
    text = 'Transferência automática diária';
  }
  if (meta.anticipation_enabled === true) text += ' · antecipação automática ativa';
  return text;
}

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const STATUS_BADGE: Record<string, { label: string; variant: BadgeVariant }> = {
  paid: { label: 'Pago', variant: 'success' },
  transferred: { label: 'Pago', variant: 'success' },
  pending: { label: 'Pendente', variant: 'info' },
  pending_transfer: { label: 'Pendente', variant: 'info' },
  in_transit: { label: 'Em trânsito', variant: 'info' },
  processing: { label: 'Em trânsito', variant: 'info' },
  failed: { label: 'Falhou', variant: 'danger' },
  canceled: { label: 'Cancelado', variant: 'neutral' },
};

export function payoutStatusBadge(status: string): { label: string; variant: BadgeVariant } {
  return STATUS_BADGE[status] ?? { label: status, variant: 'neutral' };
}

export function rowDateLabel(row: DepositDayRow): string {
  const prefix = row.manual_withdrawal ? 'Disponível em' : 'Deposita em';
  return `${prefix} ${formatDayShort(row.deposit_on)}`;
}

/** "total" only when every configured provider answered; otherwise names the ones that failed. */
export function waitingTotalLabel(
  data: Pick<DepositsResponse, 'summary' | 'stripe' | 'pagarme'>,
): string {
  if (!data.summary.partial) return 'A receber (total)';
  const failed = (['stripe', 'pagarme'] as DepositProvider[])
    .filter((p) => data[p].configured && !data[p].ok)
    .map(providerName);
  const who =
    failed.length > 1 ? `${failed.join(' e ')} indisponíveis` : `${failed[0]} indisponível`;
  return `A receber (parcial: ${who})`;
}
