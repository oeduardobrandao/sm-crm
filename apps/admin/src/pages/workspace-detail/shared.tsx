// Pieces both workspace-detail views render: usage tiles, the subscription rows, the Pagar.me
// notes and the active-overrides summary. Pure data in, markup out; no queries here.
import type { ReactNode } from 'react';
import {
  FEATURE_FLAG_KEYS,
  FEATURE_FLAG_LABELS,
  RATE_LIMIT_KEYS,
  RATE_LIMIT_LABELS,
  RESOURCE_LIMIT_KEYS,
  RESOURCE_LIMIT_LABELS,
  type Plan,
  type WorkspaceDetail,
} from '../../lib/api';
import {
  STATUS_BADGE_VARIANT,
  formatMoney,
  intervalLabel,
  intervalSuffix,
  statusMeta,
  type SubscriptionInfo,
} from '../../lib/subscription';
import { describeDrift, formatCard, formatLongDay } from '../workspace-subscription';
import { formatBytes, limitCaption } from '../workspace-detail-view';
import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';

export { ROLE_LABELS, roleLabel } from './roles';

export function formatJoined(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

/** "Dono: …" line under the workspace name (phone and created date). */
export function ownerLine(data: WorkspaceDetail): string {
  const created = new Date(data.workspace.created_at).toLocaleDateString('pt-BR');
  const phone = data.owner?.telefone ? ` · ${data.owner.telefone}` : '';
  return `Dono: ${data.owner?.email || '—'}${phone} · Criado em ${created}`;
}

export function subscriptionTitle(data: WorkspaceDetail): string {
  return data.subscription?.provider === 'pagarme' ? 'Assinatura Pagar.me' : 'Assinatura Stripe';
}

/** External dashboard link of the subscription (Stripe or Pagar.me), when the server sent one. */
export function dashboardLink(data: WorkspaceDetail): { href: string; label: string } | null {
  if (data.subscription?.stripe_dashboard_url)
    return { href: data.subscription.stripe_dashboard_url, label: 'Abrir no Stripe' };
  if (data.subscription?.pagarme_dashboard_url)
    return { href: data.subscription.pagarme_dashboard_url, label: 'Abrir no Pagar.me' };
  return null;
}

// ── Usage tiles ────────────────────────────────────────────────────────────

export interface UsageTileModel {
  label: string;
  value: string | number;
  caption: string;
  warn?: string;
  /** 0-100 when both the usage and a finite limit are known. */
  percent: number | null;
}

function percentOf(used: number | null | undefined, limit: number | null | undefined) {
  if (used == null || limit == null || limit <= 0) return null;
  return Math.min(100, Math.round((used / limit) * 100));
}

/** Brand-level usage: the numbers the CRM's "Uso do plano" panel shows, against this workspace's limits. */
export function usageTiles(data: WorkspaceDetail): UsageTileModel[] {
  const limits = data.resolved_limits;
  const { usage } = data;
  const igTotal = usage.instagram_account_count;
  const igActive = usage.instagram_account_count_active;
  const igNeedingReauth = igTotal != null && igActive != null ? igTotal - igActive : 0;
  return [
    {
      label: 'Clientes',
      value: usage.client_count,
      caption: limitCaption(limits?.max_clients),
      percent: percentOf(usage.client_count, limits?.max_clients),
    },
    {
      label: 'Membros',
      value: usage.member_count,
      caption: limitCaption(limits?.max_team_members),
      percent: percentOf(usage.member_count, limits?.max_team_members),
    },
    {
      label: 'Contas do Instagram',
      value: igTotal ?? '—',
      caption: limitCaption(limits?.max_instagram_accounts),
      warn:
        igNeedingReauth > 0
          ? `${igNeedingReauth} ${igNeedingReauth === 1 ? 'precisa reconectar' : 'precisam reconectar'}`
          : undefined,
      percent: percentOf(igTotal, limits?.max_instagram_accounts),
    },
    {
      label: 'Armazenamento',
      value: usage.storage_used_bytes != null ? formatBytes(usage.storage_used_bytes) : '—',
      caption: limitCaption(limits?.storage_quota_bytes, formatBytes),
      percent: percentOf(usage.storage_used_bytes, limits?.storage_quota_bytes),
    },
  ];
}

export function UsageTile({ tile, compact }: { tile: UsageTileModel; compact?: boolean }) {
  const warning = !!tile.warn || (tile.percent != null && tile.percent >= 90);
  return (
    <div
      data-testid="brand-metric"
      className={cn(
        'admin-glass min-w-0 rounded-[16px] border border-border bg-card text-card-foreground',
        compact ? 'px-3.5 py-3' : 'px-4 py-3.5',
      )}
    >
      <span className="block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {tile.label}
      </span>
      <span className="mt-1 block break-words text-[22px] font-bold leading-tight">
        {tile.value}{' '}
        <span className="text-sm font-normal text-muted-foreground">{tile.caption}</span>
      </span>
      {tile.percent != null && (
        <div
          role="progressbar"
          aria-label={tile.label}
          aria-valuenow={tile.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted-foreground/20"
        >
          <div
            className={cn('h-full', warning ? 'bg-warning' : 'bg-primary')}
            style={{ width: `${tile.percent}%` }}
          />
        </div>
      )}
      {tile.warn && <span className="mt-1 block text-xs text-warning">{tile.warn}</span>}
    </div>
  );
}

// ── Subscription ───────────────────────────────────────────────────────────

export interface InfoRow {
  label: string;
  value: ReactNode;
}

/** The provider subscription as label/value rows (the customer's real billing, even when comped). */
export function subscriptionRows(sub: SubscriptionInfo & { status: string }): InfoRow[] {
  const meta = statusMeta(sub.status);
  const interval = intervalLabel(sub.interval);
  const rows: InfoRow[] = [
    {
      label: 'Status',
      value: <Badge variant={STATUS_BADGE_VARIANT[meta.tone]}>{meta.label}</Badge>,
    },
    { label: 'Plano', value: `${sub.plan_name ?? '—'}${interval ? ` (${interval})` : ''}` },
    {
      label: 'Valor',
      value: (
        <span className="inline-flex flex-col items-end">
          <span>
            {formatMoney(sub.amount_cents, sub.currency)}
            {intervalSuffix(sub.interval)}
            {sub.installments != null && sub.installments > 1 && ` · ${sub.installments}x`}
            {sub.gross_cents != null && (
              <span className="ml-2 text-xs text-muted-foreground line-through">
                {formatMoney(sub.gross_cents, sub.currency)}
              </span>
            )}
          </span>
          {sub.discount_label && (
            <span className="text-[0.7rem] text-muted-foreground">{sub.discount_label}</span>
          )}
          {sub.amount_source === 'catalog' && (
            <span className="text-[0.7rem] text-muted-foreground">preço de tabela</span>
          )}
        </span>
      ),
    },
    {
      label: sub.cancel_at_period_end ? 'Cancela em' : 'Renova em',
      value: formatLongDay(sub.current_period_end, sub.provider === 'pagarme'),
    },
  ];
  if (sub.failed_payment_count > 0) {
    rows.push({
      label: 'Pagamentos falhos',
      value: <span className="text-warning">{sub.failed_payment_count}</span>,
    });
  }
  if (sub.provider === 'pagarme' && sub.pagarme_live) {
    rows.push(
      { label: 'Cartão', value: formatCard(sub.pagarme_live.card) },
      { label: 'Próxima cobrança', value: formatLongDay(sub.pagarme_live.next_billing_at, true) },
    );
  }
  return rows;
}

/** Drift warning + live-read failure note for a Pagar.me subscription (display only). */
export function PagarmeLiveNotes({ subscription }: { subscription: SubscriptionInfo }) {
  const lines = describeDrift(subscription.pagarme_live?.drift);
  return (
    <>
      {lines.length > 0 && (
        <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <div className="font-semibold">Espelho desatualizado</div>
          <ul className="mt-1 list-disc pl-4">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {subscription.pagarme_live_error && (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem resposta do Pagar.me, exibindo o espelho local.
        </p>
      )}
    </>
  );
}

// ── Limits and features (read-only summaries) ──────────────────────────────

export const LIMIT_KEYS = [...RESOURCE_LIMIT_KEYS, ...RATE_LIMIT_KEYS] as const;

export function limitLabel(key: string): string {
  return RESOURCE_LIMIT_LABELS[key] ?? RATE_LIMIT_LABELS[key] ?? key;
}

/** A limit value for display: bytes humanized, null as "sem limite". */
export function formatLimit(key: string, value: number | null | undefined): string {
  if (value == null) return 'sem limite';
  return key.endsWith('_bytes') ? formatBytes(value) : String(value);
}

export interface OverrideRow {
  key: string;
  label: string;
  value: string;
  planValue: string;
}

/** The workspace's active overrides, resources first, each with the plan's own value. */
export function activeOverrides(data: WorkspaceDetail, plan: Plan | undefined): OverrideRow[] {
  const rows: OverrideRow[] = [];
  const resources = data.override?.resource_overrides ?? {};
  for (const key of LIMIT_KEYS) {
    if (resources[key] === undefined) continue;
    rows.push({
      key,
      label: limitLabel(key),
      value: formatLimit(key, resources[key]),
      planValue: plan ? formatLimit(key, plan[key as keyof Plan] as number | null) : '—',
    });
  }
  const features = data.override?.feature_overrides ?? {};
  for (const key of FEATURE_FLAG_KEYS) {
    if (features[key] === undefined) continue;
    rows.push({
      key,
      label: FEATURE_FLAG_LABELS[key],
      value: features[key] ? 'Ativa' : 'Inativa',
      planValue: plan ? (plan[key as keyof Plan] ? 'ativa' : 'inativa') : '—',
    });
  }
  return rows;
}
