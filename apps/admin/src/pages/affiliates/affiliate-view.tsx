import { Badge } from '../../components/ui/badge';
import { cn } from '../../lib/utils';
import type { AffiliateDetail, AffiliateListItem } from '../../lib/api';
import { STRIPE_STATE_LABEL, stripeConnectState } from '../../lib/affiliates';

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export const PAYOUT_LABEL: Record<AffiliateDetail['payouts'][number]['status'], string> = {
  pending: 'Processando',
  paid: 'Enviado',
  failed: 'Falhou',
};

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1][0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Round gold-tinted tile with the affiliate's initials. */
export function AffiliateAvatar({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/20 font-semibold text-foreground"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}

export function ReferralStatus({ r }: { r: AffiliateDetail['referrals'][number] }) {
  if (!r.status) return <Badge>Cadastrado</Badge>;
  if (r.provider && r.provider !== 'stripe') {
    return <Badge variant="warning">Pagar.me · {r.status}</Badge>;
  }
  if (r.status === 'active' || r.status === 'past_due') {
    return <Badge variant="success">{r.status === 'active' ? 'Assinante' : 'Inadimplente'}</Badge>;
  }
  if (r.status === 'trialing') return <Badge variant="info">Teste</Badge>;
  return <Badge>{r.status}</Badge>;
}

export function CommissionStatus({ c }: { c: AffiliateDetail['commissions'][number] }) {
  if (c.disputed) return <Badge variant="danger">Contestada</Badge>;
  if (c.net_cents <= 0) return <Badge variant="danger">Estornada</Badge>;
  if (Date.parse(c.available_at) > Date.now()) return <Badge variant="warning">Pendente</Badge>;
  return <Badge variant="success">Liberada</Badge>;
}

export function PayoutStatus({ p }: { p: AffiliateDetail['payouts'][number] }) {
  return (
    <Badge variant={p.status === 'paid' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'}>
      {PAYOUT_LABEL[p.status]}
    </Badge>
  );
}

export function AccountStatus({ status }: { status: 'active' | 'suspended' }) {
  return status === 'suspended' ? (
    <Badge variant="danger">Suspenso</Badge>
  ) : (
    <Badge variant="success">Ativo</Badge>
  );
}

/** "Repasse" column of the list: Suspenso (when it is) plus the Stripe Connect state. */
export function PayoutBadges({ a, className }: { a: AffiliateListItem; className?: string }) {
  const state = stripeConnectState(a);
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {a.status === 'suspended' && <Badge variant="danger">Suspenso</Badge>}
      <Badge variant={state === 'ready' ? 'info' : 'warning'}>{STRIPE_STATE_LABEL[state]}</Badge>
    </div>
  );
}

export type HistoryTab = 'indicacoes' | 'comissoes' | 'repasses';

export const HISTORY_TABS: { value: HistoryTab; label: string }[] = [
  { value: 'indicacoes', label: 'Indicações' },
  { value: 'comissoes', label: 'Comissões' },
  { value: 'repasses', label: 'Repasses' },
];

export const tabId = (t: HistoryTab) => `affiliate-tab-${t}`;
export const panelId = (t: HistoryTab) => `affiliate-panel-${t}`;
