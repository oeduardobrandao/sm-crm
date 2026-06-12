/**
 * Stripe-subscription view models + pure formatting helpers shared by the admin
 * Workspaces list and Workspace detail. Kept UI-light and side-effect free so the
 * formatting logic can be unit-tested.
 */

/** Compact summary shown in the workspaces list (mirror + the amount the customer pays). */
export interface SubscriptionSummary {
  status: string | null;
  plan_name: string | null;
  billing_interval: string | null;
  amount_cents: number | null;
  currency: string | null;
  interval: string | null;
  discount_label: string | null;
}

/** Full subscription view shown on the workspace detail (mirror + live Stripe amount). */
export interface SubscriptionInfo {
  status: string | null;
  plan_id: string | null;
  plan_name: string | null;
  billing_interval: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  failed_payment_count: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  amount_cents: number | null;
  /** Pre-discount amount, present only when a discount makes it differ from amount_cents. */
  gross_cents: number | null;
  currency: string | null;
  interval: string | null;
  discount_label: string | null;
  amount_source: 'stripe' | 'catalog' | null;
  stripe_dashboard_url: string | null;
}

export type StatusTone = 'success' | 'warning' | 'danger' | 'muted';
export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

const STATUS_META: Record<string, StatusMeta> = {
  active: { label: 'Ativo', tone: 'success' },
  trialing: { label: 'Teste', tone: 'success' },
  past_due: { label: 'Pagamento pendente', tone: 'warning' },
  unpaid: { label: 'Não pago', tone: 'danger' },
  canceled: { label: 'Cancelado', tone: 'muted' },
  incomplete: { label: 'Incompleto', tone: 'warning' },
  incomplete_expired: { label: 'Expirado', tone: 'muted' },
  paused: { label: 'Pausado', tone: 'muted' },
};

export function statusMeta(status: string | null | undefined): StatusMeta {
  if (!status) return { label: '—', tone: 'muted' };
  return STATUS_META[status] ?? { label: status, tone: 'muted' };
}

/**
 * A mirror row with a status is a real subscription; a bare customer row (no status)
 * is not. Generic so it narrows away null while preserving the input's other fields.
 */
export function hasSubscription<T extends { status?: string | null }>(
  sub: T | null | undefined,
): sub is T & { status: string } {
  return !!sub && !!sub.status;
}

const INTERVAL_LABELS: Record<string, string> = { month: 'mensal', year: 'anual' };
export function intervalLabel(interval: string | null | undefined): string | null {
  if (!interval) return null;
  return INTERVAL_LABELS[interval] ?? interval;
}

const INTERVAL_SUFFIX: Record<string, string> = { month: '/mês', year: '/ano' };
export function intervalSuffix(interval: string | null | undefined): string {
  if (!interval) return '';
  return INTERVAL_SUFFIX[interval] ?? '';
}

/** centavos → "R$ 1.234,56". Returns "—" for null. currency defaults to BRL. */
export function formatMoney(cents: number | null | undefined, currency?: string | null): string {
  if (cents == null) return '—';
  const cur = (currency ?? 'brl').toUpperCase();
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: cur });
}

/** Tailwind classes for a status pill, by tone. */
export function toneBadgeClass(tone: StatusTone): string {
  switch (tone) {
    case 'success':
      return 'text-success bg-success/10';
    case 'warning':
      return 'text-warning bg-warning/10';
    case 'danger':
      return 'text-destructive bg-destructive/10';
    default:
      return 'text-muted-foreground bg-muted-foreground/10';
  }
}
