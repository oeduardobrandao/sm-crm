import { useState, type ReactNode } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  FileText,
  ReceiptText,
  Wallet,
  CheckCircle2,
  Clock,
  Percent,
  TrendingUp,
  Users,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  getClienteVersoes,
  getContratos,
  getRentabilidade,
  getTransacoes,
  formatDate,
  type Cliente,
  type ClienteVersao,
  type Contrato,
  type Transacao,
} from '@/store';
import { formatFinancialBRL } from '@/lib/financialAccess';
import { ClienteFinanceEmptyState } from '../ClienteFinanceEmptyState';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useFinanceiroV2 } from '@/hooks/useFinanceiroV2';
import { abaixoDaMeta, formatMargem } from '../../financeiro/v2/format';
import { EquipeNoClienteCard } from './EquipeNoClienteCard';
import { ClienteMensalidadeDialog, type MensalidadeInicial } from './ClienteMensalidadeDialog';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import '../phone/clienteDetalhePhone.css';

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  ativo: 'success',
  vigente: 'success',
  pago: 'success',
  pausado: 'warning',
  a_assinar: 'warning',
  encerrado: 'danger',
  agendado: 'neutral',
};

function PhoneStatusChip({ status }: { status: string }) {
  const { t: tc } = useTranslation();
  return (
    <span className="phone-cli-chip" data-tone={STATUS_TONE[status] ?? 'neutral'}>
      {tc(`status.${status}`, { defaultValue: status })}
    </span>
  );
}

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

/** The version in force at `inicio`: the one with the greatest `vale_desde` not after it. */
function versaoEfetiva(versoes: ClienteVersao[], inicio: string): ClienteVersao | undefined {
  return versoes
    .filter((v) => v.vale_desde <= inicio)
    .reduce<
      ClienteVersao | undefined
    >((best, v) => (!best || v.vale_desde > best.vale_desde ? v : best), undefined);
}

/**
 * Financeiro v2 replacement for the KPI strip: this client's entry of the current
 * period's rentabilidade (mensalidade, team cost, profit, margin) plus the team card and the
 * mensalidade dialog. Before the workspace is seeded it renders `legacy` (today's cards).
 */
function FinanceiroV2Section({ cliente, legacy }: { cliente: Cliente; legacy: ReactNode }) {
  const clienteId = cliente.id!;
  const { canSeeFinancials, can } = useAuth();
  const canEdit = can('financeiro', 'editar') === true;
  const [dialogOpen, setDialogOpen] = useState(false);

  const rent = useQuery({
    queryKey: ['financeiro-v2', 'rentabilidade', 'atual'],
    queryFn: () => getRentabilidade(),
  });
  const versoes = useQuery({
    queryKey: ['financeiro-v2', 'cliente', clienteId],
    queryFn: () => getClienteVersoes(clienteId),
  });

  if (rent.isError || versoes.isError) {
    return (
      <p role="alert" className="mb-6 text-sm text-destructive">
        Não foi possível carregar o financeiro deste cliente.
      </p>
    );
  }
  if (!rent.isSuccess || !versoes.isSuccess) return <Spinner className="mx-auto mb-6" />;
  if (!rent.data.seeded) return <>{legacy}</>;

  const { periodo, funcoes, membros, meta_margem } = rent.data;
  const entry = rent.data.clientes.find((c) => c.cliente_id === clienteId);
  const versao = versaoEfetiva(versoes.data, periodo.inicio);
  const dia = versao ? versao.dia_pagamento : (cliente.data_pagamento ?? null);
  const inicial: MensalidadeInicial = versao
    ? {
        valor_mensal: versao.valor_mensal,
        dia_pagamento: versao.dia_pagamento,
        status: versao.status,
      }
    : { valor_mensal: cliente.valor_mensal ?? 0, dia_pagamento: dia, status: 'ativo' };

  const money = (v: number) => formatFinancialBRL(v, canSeeFinancials);
  const pausado = entry?.status === 'pausado';
  const pessoas = new Set(entry?.pessoas.map((p) => p.membro_id)).size;

  return (
    <>
      <StatCardGrid
        id="sec-financeiro"
        className="cliente-finance-kpis"
        style={{ marginBottom: '1.5rem' }}
      >
        <StatCard
          label="Mensalidade"
          value={entry ? money(entry.receita) : '-'}
          sub={dia ? `Vence todo dia ${dia}` : undefined}
          footNote={
            canEdit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(true)}
                aria-label="Editar mensalidade"
              >
                Editar
              </Button>
            ) : undefined
          }
          icon={Wallet}
          tone="blue"
          compactValue
        />
        <StatCard
          label="Custo da equipe"
          value={entry ? money(entry.custo) : '-'}
          sub={
            entry ? `${pessoas} ${pessoas === 1 ? 'pessoa atende' : 'pessoas atendem'}` : undefined
          }
          icon={Users}
          tone="violet"
          compactValue
        />
        <StatCard
          label="Lucro mensal"
          value={entry ? money(entry.lucro) : '-'}
          sub={entry ? `LL anual ${money(entry.lucro * 12)}` : undefined}
          icon={TrendingUp}
          tone="green"
          compactValue
        />
        <StatCard
          label="Margem"
          value={entry && !pausado ? formatMargem(entry.margem) : '-'}
          valueColor={
            entry && !pausado && abaixoDaMeta(entry.margem, meta_margem)
              ? 'var(--danger-text)'
              : undefined
          }
          sub={
            entry ? (
              <>
                Meta da agência: {meta_margem}%{' '}
                {pausado && (
                  <Badge variant="warning" size="sm">
                    Pausado
                  </Badge>
                )}
              </>
            ) : undefined
          }
          icon={Percent}
          tone="amber"
          compactValue
        />
      </StatCardGrid>
      {!entry && (
        <p className="mb-6 text-sm text-muted-foreground">
          Este cliente não entra no período atual.
        </p>
      )}
      {entry && (
        <EquipeNoClienteCard
          cliente={entry}
          funcoes={funcoes}
          membros={membros}
          periodoInicio={periodo.inicio}
        />
      )}
      {canEdit && (
        <ClienteMensalidadeDialog
          clienteId={clienteId}
          inicial={inicial}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </>
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
 *     the route guard for "should this render at all" — that specific
 *     precedent still holds even though RelatoriosTab has since grown a
 *     narrower, field-level role check of its own (the send_report_email
 *     switch, disabled for non-owner/admin as defense-in-depth); that check
 *     only ever disables one field, it never bails out of rendering the tab.
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
  const isPhone = !useIsDesktop(768);
  const { ativo: v2Ativo } = useFinanceiroV2();
  // Financeiro v2 needs the same visibility as the legacy cards; otherwise nothing changes.
  const v2 = v2Ativo && canSeeFinancials === true;

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

  const kpis = (
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
  );

  const header = v2 ? <FinanceiroV2Section cliente={cliente} legacy={kpis} /> : kpis;

  if (isPhone) {
    return (
      <>
        {header}
        {contratosCliente.length === 0 ? (
          <section className="phone-cli-finance-empty" aria-label={t('detail.contracts')}>
            <h2 className="phone-group__header">{t('detail.contracts')}</h2>
            <ClienteFinanceEmptyState
              icon={FileText}
              title={t('detail.noContracts')}
              description={t('detail.noContractsDescription')}
              actionLabel={t('detail.manageContracts')}
              actionHref="/contratos"
            />
          </section>
        ) : (
          <GroupedList header={t('detail.contracts')} className="phone-cli-wrap">
            {contratosCliente.map((r) => (
              <Cell
                key={r.id ?? `${r.titulo}-${r.data_inicio}`}
                label={r.titulo}
                subtitle={`${formatDate(r.data_inicio)} a ${formatDate(r.data_fim)} · ${formatFinancialBRL(r.valor_total, canSeeFinancials)}`}
                accessory={<PhoneStatusChip status={r.status} />}
              />
            ))}
          </GroupedList>
        )}
        {transacoesCliente.length === 0 ? (
          <section className="phone-cli-finance-empty" aria-label={t('detail.transactions')}>
            <h2 className="phone-group__header">{t('detail.transactions')}</h2>
            <ClienteFinanceEmptyState
              icon={ReceiptText}
              title={t('detail.noTransactions')}
              description={t('detail.noTransactionsDescription')}
              actionLabel={t('detail.viewFinancial')}
              actionHref="/financeiro"
            />
          </section>
        ) : (
          <GroupedList header={t('detail.transactions')} className="phone-cli-wrap">
            {transacoesCliente.map((r) => (
              <Cell
                key={r.id ?? `${r.descricao}-${r.data}`}
                label={r.descricao}
                subtitle={formatDate(r.data)}
                value={
                  <span
                    className="phone-cli-amount"
                    data-tone={r.tipo === 'entrada' ? 'in' : 'out'}
                  >
                    {r.tipo === 'entrada' ? '+' : '-'}
                    {formatFinancialBRL(r.valor, canSeeFinancials)}
                  </span>
                }
                accessory={<PhoneStatusChip status={r.status ?? 'pago'} />}
              />
            ))}
          </GroupedList>
        )}
      </>
    );
  }

  return (
    <>
      {header}

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
