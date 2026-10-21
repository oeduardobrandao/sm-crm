import { AlertTriangle } from 'lucide-react';
import { Cell, GroupedList } from '@mesaas/ios-kit';
import type {
  DepositDayRow,
  DepositMonthRow,
  DepositProvider,
  ProviderDeposits,
} from '../../lib/api';
import { formatMoney } from '../../lib/subscription';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ErrorState';
import {
  formatDayShort,
  formatMonth,
  monthlyReceivables,
  notConfiguredHint,
  payoutStatusBadge,
  providerName,
  rowDateLabel,
  scheduleCaption,
  waitingTotalLabel,
} from './deposits-view';
import type { DepositsViewProps } from './deposits-props';
import { DepositsToolbar } from './DepositsToolbar';

const PROVIDERS: DepositProvider[] = ['stripe', 'pagarme'];

const items = (n: number) => `${n} ${n === 1 ? 'item' : 'itens'}`;
const grossFee = (gross: number, fee: number) =>
  `bruto ${formatMoney(gross)} · taxas ${formatMoney(fee)}`;

export function DepositsPhone({
  data,
  isPending,
  isError,
  isFetching,
  refetch,
}: DepositsViewProps) {
  return (
    <div className="phone-kit">
      <div className="mb-4">
        <DepositsToolbar
          data={data}
          isError={isError}
          isFetching={isFetching}
          onRefresh={refetch}
        />
      </div>

      {isError ? (
        <GlassPanel flush className="mb-5">
          <ErrorState message="Não foi possível carregar os depósitos." onRetry={refetch} />
        </GlassPanel>
      ) : null}

      {isPending ? (
        <div className="grid grid-cols-2 gap-2.5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} data-testid="deposits-skeleton" className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <div data-testid="deposits-summary">
          <div className="mb-2.5">
            <KpiTile
              label="Próximo depósito"
              value={
                data.summary.next ? formatMoney(data.summary.next.amount_cents) : 'Sem previsão'
              }
              sub={
                data.summary.next
                  ? `${providerName(data.summary.next.provider)} · ${formatDayShort(data.summary.next.date)}`
                  : data.summary.waiting_cents > 0
                    ? 'Nada nos próximos 30 dias'
                    : 'Nada previsto'
              }
            />
          </div>
          <KpiGrid>
            <KpiTile label="Próximos 30 dias" value={formatMoney(data.summary.next_30d_cents)} />
            <KpiTile
              label={waitingTotalLabel(data)}
              value={formatMoney(data.summary.waiting_cents)}
            />
          </KpiGrid>
        </div>
      ) : null}

      {data ? <MonthlyList data={data} /> : null}

      {isPending
        ? // No data-testid: a card only becomes `deposits-card-{provider}` once its content is real.
          PROVIDERS.map((p) => (
            <GroupedList key={p} header={providerName(p)}>
              <li className="phone-cell">
                <div className="phone-cell__main">
                  <Skeleton data-testid="deposits-skeleton" className="h-5 w-2/3" />
                </div>
              </li>
            </GroupedList>
          ))
        : data
          ? PROVIDERS.map((p) => (
              <section key={p} data-testid={`deposits-card-${p}`}>
                <ProviderBlock provider={p} deposits={data[p]} onRetry={refetch} />
              </section>
            ))
          : null}
    </div>
  );
}

function MonthlyList({ data }: { data: NonNullable<DepositsViewProps['data']> }) {
  const rows = monthlyReceivables(data);
  const incomplete = data.summary.partial || PROVIDERS.some((p) => data[p].ok && data[p].truncated);
  const sum = (key: 'total_cents') => rows.reduce((acc, r) => acc + r[key], 0);
  return (
    <div data-testid="deposits-monthly">
      <GroupedList
        header="Recebíveis por mês"
        footer={
          incomplete
            ? 'Lista parcial: um provedor falhou ou a leitura foi cortada.'
            : 'Valores líquidos, pelo mês em que o depósito é esperado.'
        }
      >
        {rows.length === 0 ? (
          <Cell label="Nada previsto" />
        ) : (
          <>
            {rows.map((r) => (
              <Cell
                key={r.month}
                label={formatMonth(r.month)}
                subtitle={`Stripe ${formatMoney(r.stripe_cents)} · Pagar.me ${formatMoney(r.pagarme_cents)}`}
                value={
                  <span className="font-semibold tabular-nums">{formatMoney(r.total_cents)}</span>
                }
              />
            ))}
            <Cell
              label="Total"
              value={
                <span className="font-bold tabular-nums">{formatMoney(sum('total_cents'))}</span>
              }
            />
          </>
        )}
      </GroupedList>
    </div>
  );
}

function ProviderBlock({
  provider,
  deposits,
  onRetry,
}: {
  provider: DepositProvider;
  deposits: ProviderDeposits;
  onRetry: () => void;
}) {
  const name = providerName(provider);
  if (!deposits.configured) {
    return (
      <GroupedList header={name}>
        <Cell label="Não configurado" subtitle={notConfiguredHint(provider)} />
      </GroupedList>
    );
  }
  if (!deposits.ok) {
    return (
      <>
        <h2 className="phone-group__header">{name}</h2>
        <GlassPanel flush className="mb-5">
          <ErrorState message={`Não foi possível ler ${name} agora.`} onRetry={onRetry} />
        </GlassPanel>
      </>
    );
  }
  const { balance, upcoming, in_transit, recent, truncated } = deposits;
  const nothingUpcoming = upcoming.next30.length === 0 && upcoming.byMonth.length === 0;
  const caption = scheduleCaption(provider, deposits.meta);

  return (
    <>
      <GroupedList header={name} footer={caption ?? undefined}>
        {balance ? (
          <>
            <Cell label="Disponível" value={formatMoney(balance.available_cents)} />
            <Cell label="A compensar" value={formatMoney(balance.pending_cents)} />
          </>
        ) : (
          <Cell label="Saldo indisponível" />
        )}
      </GroupedList>
      {truncated ? (
        <p
          role="status"
          className="mb-5 flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Lista parcial: há mais lançamentos do que o painel lê de uma vez. Os totais abaixo estão
            subestimados.
          </span>
        </p>
      ) : null}

      <GroupedList header="Próximos 30 dias" headerAs="h3">
        {upcoming.next30.length === 0 ? (
          <Cell label={nothingUpcoming ? 'Nada previsto' : 'Nada nos próximos 30 dias'} />
        ) : (
          upcoming.next30.map((row) => <DayCell key={`${row.kind}-${row.date}`} row={row} />)
        )}
      </GroupedList>

      {upcoming.byMonth.length > 0 ? (
        <GroupedList header="Meses seguintes" headerAs="h3">
          {upcoming.byMonth.map((m) => (
            <MonthCell key={m.month} row={m} />
          ))}
        </GroupedList>
      ) : null}

      {in_transit.length > 0 ? (
        <GroupedList header="Transferências em andamento" headerAs="h3">
          {in_transit.map((t) => {
            const badge = payoutStatusBadge(t.status);
            return (
              <Cell
                key={t.id}
                label={t.expected_on ? `Previsto ${formatDayShort(t.expected_on)}` : 'Sem previsão'}
                accessory={
                  <Badge variant={badge.variant} size="sm">
                    {badge.label}
                  </Badge>
                }
                value={
                  <span className="font-semibold tabular-nums">{formatMoney(t.amount_cents)}</span>
                }
              />
            );
          })}
        </GroupedList>
      ) : null}

      {recent.length > 0 ? (
        <GroupedList header="Recentes" headerAs="h3">
          {recent.map((r) => {
            const badge = payoutStatusBadge(r.status);
            return (
              <Cell
                key={r.id}
                label={formatDayShort(r.date)}
                accessory={
                  <Badge variant={badge.variant} size="sm">
                    {badge.label}
                  </Badge>
                }
                value={
                  <span className="font-semibold tabular-nums">{formatMoney(r.amount_cents)}</span>
                }
              />
            );
          })}
        </GroupedList>
      ) : null}
    </>
  );
}

function DayCell({ row }: { row: DepositDayRow }) {
  return (
    <Cell
      label={rowDateLabel(row)}
      subtitle={
        row.kind === 'payout'
          ? 'Repasse já criado'
          : `${items(row.count)} · ${grossFee(row.gross_cents, row.fee_cents)}`
      }
      value={<span className="font-semibold tabular-nums">{formatMoney(row.net_cents)}</span>}
    />
  );
}

function MonthCell({ row }: { row: DepositMonthRow }) {
  return (
    <Cell
      label={formatMonth(row.month)}
      subtitle={`${items(row.count)} · ${grossFee(row.gross_cents, row.fee_cents)}`}
      value={<span className="font-semibold tabular-nums">{formatMoney(row.net_cents)}</span>}
    />
  );
}
