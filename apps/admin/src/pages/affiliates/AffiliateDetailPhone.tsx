import { Cell, GroupedList, SegmentedControl } from '@mesaas/ios-kit';
import { affiliatesPath, workspaceDetailPath } from '../../lib/routes';
import { formatMoney } from '../../lib/subscription';
import { formatRateBps, STRIPE_STATE_LABEL, stripeConnectState } from '../../lib/affiliates';
import { AdminNavBar } from '../../components/shell/AdminNavBar';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
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
} from './affiliate-view';
import type { AffiliateDetailViewProps } from './AffiliateDetailDesktop';

export function AffiliateDetailPhone({
  data,
  tab,
  onTabChange,
  onToggleStatus,
  statusPending,
}: AffiliateDetailViewProps) {
  const { affiliate: a, summary } = data;
  const stripeState = stripeConnectState(a);
  const suspending = a.status === 'active';

  return (
    <div>
      <AdminNavBar
        back={{ to: affiliatesPath(), label: 'Afiliados' }}
        trailing={
          <button
            type="button"
            className="phone-text-button"
            style={suspending ? { color: 'var(--phone-destructive)' } : undefined}
            disabled={statusPending}
            onClick={onToggleStatus}
          >
            {suspending ? 'Suspender' : 'Reativar'}
          </button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <AffiliateAvatar name={a.nome} size={56} />
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 font-sf text-[22px] font-bold leading-tight">
            {a.nome}
            <AccountStatus status={a.status} />
          </h1>
          <p className="mt-0.5 break-words text-sm text-muted-foreground">
            {a.email}
            {a.telefone ? ` · ${a.telefone}` : ''} · código{' '}
            <span className="font-mono">{a.code}</span>
            <br />
            desde {formatDate(a.created_at)}
          </p>
        </div>
      </div>

      <KpiGrid min={150}>
        <KpiTile label="Indicações" value={summary.referrals_count} />
        <KpiTile label="Em teste" value={summary.trialing_count} />
        <KpiTile label="Assinantes" value={summary.paying_count} />
        <KpiTile label="Pendente" value={formatMoney(summary.pending_cents)} />
        <KpiTile label="Disponível" value={formatMoney(summary.available_cents)} />
        <KpiTile label="Já pago" value={formatMoney(summary.paid_out_cents)} />
      </KpiGrid>

      <GroupedList
        header="Repasse (Stripe Connect)"
        footer="O saldo disponível é transferido todo dia 5, se a conta estiver apta e o valor passar do mínimo."
      >
        <Cell
          label={
            a.stripe_account_id ? (
              <span className="font-mono">{a.stripe_account_id}</span>
            ) : (
              'Sem conta Stripe'
            )
          }
          subtitle={
            a.stripe_status_checked_at
              ? `conferido em ${formatDate(a.stripe_status_checked_at)}`
              : undefined
          }
          value={a.stripe_account_id ? STRIPE_STATE_LABEL[stripeState] : undefined}
        />
      </GroupedList>

      <SegmentedControl
        aria-label="Histórico do afiliado"
        semantics="tablist"
        className="mb-3"
        value={tab}
        onChange={onTabChange}
        options={HISTORY_TABS.map((t) => ({
          ...t,
          id: tabId(t.value),
          controls: panelId(t.value),
        }))}
      />

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === 'indicacoes' && (
          <GroupedList aria-label="Indicações">
            {data.referrals.length === 0 && <Cell label="Nenhuma indicação." />}
            {data.referrals.map((r) => (
              <Cell
                key={r.workspace_id}
                to={workspaceDetailPath(r.workspace_id)}
                label={r.workspace_name ?? r.workspace_id}
                subtitle={`Cadastro ${formatDate(r.created_at)} · ${r.plan_id ?? 'Sem plano'}`}
                accessory={<ReferralStatus r={r} />}
              />
            ))}
          </GroupedList>
        )}

        {tab === 'comissoes' && (
          <GroupedList aria-label="Comissões">
            {data.commissions.length === 0 && <Cell label="Nenhuma comissão." />}
            {data.commissions.map((c) => (
              <Cell
                key={c.id}
                label={c.workspace_name ?? 'Sem workspace'}
                subtitle={
                  <>
                    <span className="block">
                      {formatDate(c.paid_at)} · {c.plan_id ?? 'Sem plano'}{' '}
                      {formatRateBps(c.rate_bps)} ·{' '}
                      {c.covered_months > 0 ? `${c.covered_months} mês(es) da janela` : 'ajuste'}
                    </span>
                    <span className="block">
                      Fatura {formatMoney(c.invoice_amount_cents)}
                      {c.net_cents !== c.commission_cents
                        ? ` · de ${formatMoney(c.commission_cents)}`
                        : ''}
                      {' · libera '}
                      {formatDate(c.available_at)}
                    </span>
                    <span className="mt-1 block">
                      <CommissionStatus c={c} />
                    </span>
                  </>
                }
                value={formatMoney(c.net_cents)}
              />
            ))}
          </GroupedList>
        )}

        {tab === 'repasses' && (
          <GroupedList aria-label="Repasses">
            {data.payouts.length === 0 && <Cell label="Nenhum repasse registrado." />}
            {data.payouts.map((p) => (
              <Cell
                key={p.id}
                label={formatMoney(p.amount_cents)}
                subtitle={
                  <>
                    <span className="block">{formatDate(p.paid_at ?? p.created_at)}</span>
                    {p.failure_code && (
                      <span className="block font-mono text-xs">{p.failure_code}</span>
                    )}
                    {p.stripe_transfer_id && (
                      <span className="block break-all font-mono text-xs">
                        {p.stripe_transfer_id}
                      </span>
                    )}
                  </>
                }
                accessory={<PayoutStatus p={p} />}
              />
            ))}
          </GroupedList>
        )}
      </div>
    </div>
  );
}
