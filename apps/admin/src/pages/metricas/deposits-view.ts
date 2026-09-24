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

/** "Outubro de 2026": only the month name is capitalised (CSS `capitalize` would also
 *  uppercase the "de"). */
export function formatMonth(month: string): string {
  const label = parseDay(`${month}-01`).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function providerName(p: DepositProvider): string {
  return p === 'stripe' ? 'Stripe' : 'Pagar.me';
}

export const NOT_CONFIGURED_SECRET: Record<DepositProvider, string> = {
  stripe: 'STRIPE_SECRET_KEY',
  pagarme: 'PAGARME_RECIPIENT_ID e PAGARME_SECRET_KEY',
};

/** The handler marks Pagar.me unconfigured when EITHER PAGARME_RECIPIENT_ID or
 *  PAGARME_SECRET_KEY is missing, so the copy always names both; Stripe only ever has one. The
 *  sentence keeps "a secret"/"as secrets" in agreement with how many are named. */
export function notConfiguredHint(p: DepositProvider): string {
  const article = p === 'stripe' ? 'a secret' : 'as secrets';
  return `Defina ${article} ${NOT_CONFIGURED_SECRET[p]} na function platform-admin para ler este provedor.`;
}

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

const TRUNCATED_PHRASE: Record<DepositProvider, string> = {
  stripe: 'lista da Stripe incompleta',
  pagarme: 'lista do Pagar.me incompleta',
};

/** "total" only when every configured provider answered in full; otherwise names the ones that
 *  failed (backend `partial`, still meaning "a configured provider failed") and/or the ones whose
 *  list is truncated (a provider can be `ok` and `truncated` at once, so this checks it
 *  independently of `partial` -- the two reasons combine, joined by "; ", when both apply). */
export function waitingTotalLabel(
  data: Pick<DepositsResponse, 'summary' | 'stripe' | 'pagarme'>,
): string {
  const failed = (['stripe', 'pagarme'] as DepositProvider[])
    .filter((p) => data[p].configured && !data[p].ok)
    .map(providerName);
  const truncated = (['stripe', 'pagarme'] as DepositProvider[]).filter(
    (p) => data[p].ok && data[p].truncated,
  );
  if (failed.length === 0 && truncated.length === 0) return 'A receber (total)';
  const reasons: string[] = [];
  if (failed.length > 0) {
    reasons.push(
      failed.length > 1 ? `${failed.join(' e ')} indisponíveis` : `${failed[0]} indisponível`,
    );
  }
  if (truncated.length > 0) {
    reasons.push(truncated.map((p) => TRUNCATED_PHRASE[p]).join('; '));
  }
  return `A receber (parcial: ${reasons.join('; ')})`;
}

export interface MonthlyReceivableRow {
  /** YYYY-MM of the expected deposit (or availability, for manual withdrawal) */
  month: string;
  stripe_cents: number;
  pagarme_cents: number;
  total_cents: number;
}

/**
 * Net receivables per calendar month across both providers, keyed by the month of the
 * expected deposit day (`deposit_on` for the next 30 days, the month rows after that).
 * Only providers that answered contribute; in-flight transfers without a landing day have
 * no month and are left out (they still count in the summary's "A receber").
 */
export function monthlyReceivables(
  data: Pick<DepositsResponse, 'stripe' | 'pagarme'>,
): MonthlyReceivableRow[] {
  const byMonth = new Map<string, MonthlyReceivableRow>();
  const add = (provider: DepositProvider, month: string, cents: number) => {
    const row = byMonth.get(month) ?? {
      month,
      stripe_cents: 0,
      pagarme_cents: 0,
      total_cents: 0,
    };
    if (provider === 'stripe') row.stripe_cents += cents;
    else row.pagarme_cents += cents;
    row.total_cents += cents;
    byMonth.set(month, row);
  };
  for (const provider of ['stripe', 'pagarme'] as DepositProvider[]) {
    const p = data[provider];
    if (!p.ok) continue;
    for (const r of p.upcoming.next30) add(provider, r.deposit_on.slice(0, 7), r.net_cents);
    for (const m of p.upcoming.byMonth) add(provider, m.month, m.net_cents);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}
