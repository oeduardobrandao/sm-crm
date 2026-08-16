import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, ReceiptText, Wallet, CheckCircle2, Clock } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { getContratos, getTransacoes, formatDate, type Contrato, type Transacao } from '@/store';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { ClienteFinanceEmptyState } from '../ClienteFinanceEmptyState';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

function StatusBadge({ status }: { status: string }) {
  const { t: tc } = useTranslation();
  const map: Record<string, string> = {
    ativo: 'badge-success',
    pausado: 'badge-warning',
    encerrado: 'badge-danger',
    vigente: 'badge-success',
    a_assinar: 'badge-warning',
    pago: 'badge-success',
    agendado: 'badge-neutral',
  };
  return (
    <span className={`badge ${map[status] ?? 'badge-neutral'}`}>
      {tc(`status.${status}`, { defaultValue: status })}
    </span>
  );
}

/**
 * "Financeiro" tab: the three finance KPI cards plus the contratos and
 * transações tables, ported from the pre-split ClienteDetalhePage (see git
 * history at d30adeea).
 *
 * This is the most security-sensitive tab in the split. Access is enforced
 * in TWO independent layers, deliberately redundant:
 *
 *  1. Route-level: ClienteDetalhePage.tsx resolves `financeiroTabGuardOutcome`
 *     BEFORE rendering the `<Outlet>`, so this component is only ever
 *     mounted once `canSeeFinancials === true`. This tab does not
 *     re-implement that three-state check or add its own top-level
 *     `canSeeFinancials !== true` bail-out — doing so would be a THIRD
 *     layer, beyond what the plan calls for, and RelatoriosTab (gated the
 *     same all-or-nothing way at the route) sets the precedent of trusting
 *     the route guard for "should this render at all".
 *  2. Query-level, inside this component: `enabled: canSeeFinancials ===
 *     true` on both queries below, AND a read-time ternary on the data those
 *     queries return. Neither alone is sufficient — `enabled: false` only
 *     stops a NEW fetch, it does not clear data already cached under the
 *     same query key by an unrelated component (e.g. FinanceiroPage and
 *     ContratosPage, which fetch the same `['transacoes']`/`['contratos']`
 *     keys via plain `useQuery`, with no `enabled` gate). The read-time
 *     ternary is what stops that cached data from
 *     ever reaching the JSX. This redundancy is intentional, not
 *     simplifiable.
 *
 * Every rendered money value goes through `formatFinancialBRL`, never a raw
 * number — belt-and-suspenders with the two guards above, since
 * `formatFinancialBRL` independently masks unless `canSeeFinancials` is
 * literally `true`.
 *
 * `contratos`/`transacoes` are page-wide queries (there is no per-client
 * filtered endpoint), filtered client-side to this client's rows — existing
 * behavior, unchanged by this extraction.
 *
 * Query isolation: this tab fires only `['contratos']` and `['transacoes']`
 * — nothing from Entregas/Instagram/Hub/dates/addresses.
 */
export default function FinanceiroTab() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const { canSeeFinancials } = useAuth();
  const { t } = useTranslation('clients');

  const { data: transacoes } = useQuery({
    queryKey: ['transacoes'],
    queryFn: getTransacoes,
    enabled: canSeeFinancials === true,
  });
  const { data: contratos } = useQuery({
    queryKey: ['contratos'],
    queryFn: getContratos,
    enabled: canSeeFinancials === true,
  });

  // Guard the read too, not just the query: `enabled: false` only stops a new
  // fetch — a query with the same key already populated elsewhere (matches
  // GlobalSearchTrigger's pattern) can still leave cached data on this hook.
  const contratosCliente: Contrato[] =
    canSeeFinancials === true ? (contratos ?? []).filter((c) => c.cliente_id === clienteId) : [];
  const transacoesCliente: Transacao[] =
    canSeeFinancials === true ? (transacoes ?? []).filter((t) => t.cliente_id === clienteId) : [];

  const receitaTotal = transacoesCliente
    .filter((t) => t.tipo === 'entrada' && t.status === 'pago')
    .reduce((s, t) => s + Number(t.valor), 0);
  const pendente = transacoesCliente
    .filter((t) => t.tipo === 'entrada' && t.status === 'agendado')
    .reduce((s, t) => s + Number(t.valor), 0);

  return (
    <>
      <StatCardGrid
        id="sec-financeiro"
        className="cliente-finance-kpis"
        style={{ marginBottom: '1.5rem' }}
      >
        <StatCard
          label={t('detail.monthlyValue')}
          value={formatFinancialBRL(cliente.valor_mensal, canSeeFinancials)}
          icon={Wallet}
          tone="blue"
          compactValue
        />
        <StatCard
          label={t('detail.totalReceived')}
          value={formatFinancialBRL(receitaTotal, canSeeFinancials)}
          icon={CheckCircle2}
          tone="green"
          compactValue
        />
        <StatCard
          label={t('detail.pending')}
          value={formatFinancialBRL(pendente, canSeeFinancials)}
          valueColor="var(--warning)"
          icon={Clock}
          tone="amber"
          compactValue
        />
      </StatCardGrid>

      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
          {t('detail.contracts')}
        </h3>
        {contratosCliente.length === 0 ? (
          <ClienteFinanceEmptyState
            icon={FileText}
            title={t('detail.noContracts')}
            description={t('detail.noContractsDescription')}
            actionLabel={t('detail.manageContracts')}
            actionHref="/contratos"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.contractTitle')}</TableHead>
                <TableHead>{t('detail.contractPeriod')}</TableHead>
                <TableHead>{t('detail.contractValue')}</TableHead>
                <TableHead>{t('detail.contractStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contratosCliente.map((r) => (
                <TableRow key={r.id ?? Math.random()}>
                  <TableCell data-label={t('detail.contractTitle')}>{r.titulo}</TableCell>
                  <TableCell data-label={t('detail.contractPeriod')}>
                    {formatDate(r.data_inicio)} – {formatDate(r.data_fim)}
                  </TableCell>
                  <TableCell data-label={t('detail.contractValue')}>
                    {formatFinancialBRL(r.valor_total, canSeeFinancials)}
                  </TableCell>
                  <TableCell data-label={t('detail.contractStatus')}>
                    <StatusBadge status={r.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
          {t('detail.transactions')}
        </h3>
        {transacoesCliente.length === 0 ? (
          <ClienteFinanceEmptyState
            icon={ReceiptText}
            title={t('detail.noTransactions')}
            description={t('detail.noTransactionsDescription')}
            actionLabel={t('detail.viewFinancial')}
            actionHref="/financeiro"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.txDescription')}</TableHead>
                <TableHead>{t('detail.txDate')}</TableHead>
                <TableHead>{t('detail.txValue')}</TableHead>
                <TableHead>{t('detail.txStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transacoesCliente.map((r) => (
                <TableRow key={r.id ?? Math.random()}>
                  <TableCell data-label={t('detail.txDescription')}>{r.descricao}</TableCell>
                  <TableCell data-label={t('detail.txDate')}>{formatDate(r.data)}</TableCell>
                  <TableCell data-label={t('detail.txValue')}>
                    <span
                      style={{
                        color: r.tipo === 'entrada' ? 'var(--success)' : 'var(--danger)',
                        fontWeight: 600,
                      }}
                    >
                      {r.tipo === 'entrada' ? '+' : '-'}
                      {formatFinancialBRL(r.valor, canSeeFinancials)}
                    </span>
                  </TableCell>
                  <TableCell data-label={t('detail.txStatus')}>
                    <StatusBadge status={r.status ?? 'pago'} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
