import { SegmentedControl } from '@mesaas/ios-kit';
import type { AffiliateDetail } from '../../lib/api';
import { affiliatesPath, workspaceDetailPath } from '../../lib/routes';
import { formatMoney } from '../../lib/subscription';
import { formatRateBps, STRIPE_STATE_LABEL, stripeConnectState } from '../../lib/affiliates';
import { PageHeader } from '../../components/PageHeader';
import { RowLink } from '../../components/RowLink';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import {
  AccountStatus,
  AffiliateAvatar,
  CommissionStatus,
  formatDate,
  HISTORY_TABS,
  panelId,
  PayoutStatus,
  ReferralStatus,
  tabId,
  type HistoryTab,
} from './affiliate-view';

const HEAD = 'text-[0.7rem] uppercase tracking-wider';

export interface AffiliateDetailViewProps {
  data: AffiliateDetail;
  tab: HistoryTab;
  onTabChange: (tab: HistoryTab) => void;
  onToggleStatus: () => void;
  statusPending: boolean;
}

function Empty({ children }: { children: string }) {
  return <p className="px-[18px] pb-5 text-sm text-muted-foreground">{children}</p>;
}

export function AffiliateDetailDesktop({
  data,
  tab,
  onTabChange,
  onToggleStatus,
  statusPending,
}: AffiliateDetailViewProps) {
  const { affiliate: a, summary } = data;
  const stripeState = stripeConnectState(a);
  const conversion =
    summary.referrals_count > 0
      ? `${Math.round((summary.paying_count / summary.referrals_count) * 100)}% de conversão`
      : undefined;

  return (
    <div>
      <PageHeader
        back={{ to: affiliatesPath(), label: 'Afiliados' }}
        title={a.nome}
        leading={<AffiliateAvatar name={a.nome} size={56} />}
        titleAddon={<AccountStatus status={a.status} />}
        description={
          <>
            {a.email}
            {a.telefone ? ` · ${a.telefone}` : ''} · código{' '}
            <span className="font-mono">{a.code}</span> · desde {formatDate(a.created_at)}
          </>
        }
        actions={
          <Button
            variant={a.status === 'active' ? 'destructive' : 'outline'}
            disabled={statusPending}
            onClick={onToggleStatus}
          >
            {a.status === 'active' ? 'Suspender' : 'Reativar'}
          </Button>
        }
      />

      <KpiGrid min={160}>
        <KpiTile
          label="Indicações"
          value={summary.referrals_count}
          sub={`${summary.trialing_count} em teste`}
        />
        <KpiTile label="Assinantes (Stripe)" value={summary.paying_count} sub={conversion} />
        <KpiTile label="Pendente" value={formatMoney(summary.pending_cents)} />
        <KpiTile label="Disponível" value={formatMoney(summary.available_cents)} />
        <KpiTile label="Já pago" value={formatMoney(summary.paid_out_cents)} />
      </KpiGrid>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <GlassPanel flush>
          <div className="px-[18px] py-3.5">
            <SegmentedControl
              aria-label="Histórico do afiliado"
              semantics="tablist"
              value={tab}
              onChange={onTabChange}
              options={HISTORY_TABS.map((t) => ({
                ...t,
                id: tabId(t.value),
                controls: panelId(t.value),
              }))}
            />
          </div>
          <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
            {tab === 'indicacoes' &&
              (data.referrals.length === 0 ? (
                <Empty>Nenhuma indicação.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={HEAD}>Workspace</TableHead>
                      <TableHead className={HEAD}>Cadastro</TableHead>
                      <TableHead className={HEAD}>Plano</TableHead>
                      <TableHead className={HEAD}>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.referrals.map((r) => (
                      <TableRow key={r.workspace_id}>
                        <TableCell>
                          <RowLink to={workspaceDetailPath(r.workspace_id)} className="text-sm">
                            {r.workspace_name ?? r.workspace_id}
                          </RowLink>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(r.created_at)}
                        </TableCell>
                        <TableCell className="text-sm">{r.plan_id ?? 'Sem plano'}</TableCell>
                        <TableCell>
                          <ReferralStatus r={r} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}

            {tab === 'comissoes' &&
              (data.commissions.length === 0 ? (
                <Empty>Nenhuma comissão.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={HEAD}>Pagamento</TableHead>
                      <TableHead className={HEAD}>Workspace</TableHead>
                      <TableHead className={HEAD}>Fatura</TableHead>
                      <TableHead className={HEAD}>Plano</TableHead>
                      <TableHead className={HEAD}>Comissão</TableHead>
                      <TableHead className={HEAD}>Libera em</TableHead>
                      <TableHead className={HEAD}>Situação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.commissions.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-sm">{formatDate(c.paid_at)}</TableCell>
                        <TableCell className="text-sm">
                          {c.workspace_name ?? 'Sem workspace'}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatMoney(c.invoice_amount_cents)}
                          <span className="block font-mono text-xs text-muted-foreground">
                            {c.stripe_invoice_id}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm">
                          {c.plan_id ?? 'Sem plano'} · {formatRateBps(c.rate_bps)}
                          <span className="block text-xs text-muted-foreground">
                            {c.covered_months > 0
                              ? `${c.covered_months} mês(es) da janela`
                              : 'ajuste'}
                          </span>
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatMoney(c.net_cents)}
                          {c.net_cents !== c.commission_cents && (
                            <span className="block text-xs text-muted-foreground">
                              de {formatMoney(c.commission_cents)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(c.available_at)}
                        </TableCell>
                        <TableCell>
                          <CommissionStatus c={c} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}

            {tab === 'repasses' &&
              (data.payouts.length === 0 ? (
                <Empty>Nenhum repasse registrado.</Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={HEAD}>Data</TableHead>
                      <TableHead className={HEAD}>Valor</TableHead>
                      <TableHead className={HEAD}>Situação</TableHead>
                      <TableHead className={HEAD}>Transfer</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payouts.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm">
                          {formatDate(p.paid_at ?? p.created_at)}
                        </TableCell>
                        <TableCell className="text-sm font-medium">
                          {formatMoney(p.amount_cents)}
                        </TableCell>
                        <TableCell>
                          <PayoutStatus p={p} />
                          {p.failure_code && (
                            <span className="block font-mono text-xs text-muted-foreground">
                              {p.failure_code}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {p.stripe_transfer_id ?? '·'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ))}
          </div>
        </GlassPanel>

        <GlassPanel title="Repasse (Stripe Connect)" titleId="affiliate-connect-title">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={stripeState === 'ready' ? 'success' : 'warning'}>
              {STRIPE_STATE_LABEL[stripeState]}
            </Badge>
            {a.stripe_account_id && (
              <span className="font-mono text-xs text-muted-foreground">{a.stripe_account_id}</span>
            )}
            {a.stripe_status_checked_at && (
              <span className="text-xs text-muted-foreground">
                · conferido em {formatDate(a.stripe_status_checked_at)}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            O saldo disponível é transferido todo dia 5 pelo affiliate-payout-cron, se a conta
            estiver apta e o valor passar do mínimo.
          </p>
        </GlassPanel>
      </div>
    </div>
  );
}
