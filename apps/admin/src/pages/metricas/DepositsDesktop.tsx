import { AlertTriangle, Banknote } from 'lucide-react';
import type { ReactNode } from 'react';
import type {
  DepositDayRow,
  DepositMonthRow,
  DepositProvider,
  DepositsResponse,
  ProviderDeposits,
} from '../../lib/api';
import { formatMoney } from '../../lib/subscription';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { KpiGrid, KpiTile } from '../../components/shell/KpiTile';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { EmptyState } from '../../components/EmptyState';
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

export function DepositsDesktop({
  data,
  isPending,
  isError,
  isFetching,
  refetch,
}: DepositsViewProps) {
  return (
    <div>
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
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} data-testid="deposits-skeleton" className="h-24 rounded-[18px]" />
          ))}
        </div>
      ) : data ? (
        <div data-testid="deposits-summary">
          <KpiGrid min={240}>
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
            <KpiTile label="Próximos 30 dias" value={formatMoney(data.summary.next_30d_cents)} />
            <KpiTile
              label={waitingTotalLabel(data)}
              value={formatMoney(data.summary.waiting_cents)}
            />
          </KpiGrid>
        </div>
      ) : null}

      {data ? <MonthlyTable data={data} /> : null}

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {isPending
          ? // No data-testid here: the card only becomes `deposits-card-{provider}` once its
            // content is real, so `findByTestId` in tests can't resolve against this stale
            // skeleton shell before the query settles.
            PROVIDERS.map((p) => (
              <GlassPanel key={p} title={providerName(p)}>
                <div className="flex flex-col gap-3">
                  <Skeleton data-testid="deposits-skeleton" className="h-5 w-2/3" />
                  <Skeleton data-testid="deposits-skeleton" className="h-5 w-1/2" />
                  <Skeleton data-testid="deposits-skeleton" className="h-24 w-full" />
                </div>
              </GlassPanel>
            ))
          : data
            ? PROVIDERS.map((p) => (
                <div key={p} data-testid={`deposits-card-${p}`}>
                  <GlassPanel title={providerName(p)} flush>
                    <ProviderBody provider={p} deposits={data[p]} onRetry={refetch} />
                  </GlassPanel>
                </div>
              ))
            : null}
      </div>
    </div>
  );
}

const MONTH_HEAD_CLASS = 'text-xs uppercase tracking-wider text-muted-foreground';

/** Net receivables per month of expected deposit, one column per provider plus the total. */
function MonthlyTable({ data }: { data: DepositsResponse }) {
  const rows = monthlyReceivables(data);
  const incomplete = data.summary.partial || PROVIDERS.some((p) => data[p].ok && data[p].truncated);
  const sum = (key: 'stripe_cents' | 'pagarme_cents' | 'total_cents') =>
    rows.reduce((acc, r) => acc + r[key], 0);
  return (
    <div data-testid="deposits-monthly" className="mb-5">
      <GlassPanel title="Recebíveis por mês" flush>
        <p className="-mt-2 px-[18px] pb-3 text-xs text-muted-foreground">
          Valores líquidos, pelo mês em que o depósito é esperado.
          {incomplete ? ' Lista parcial: um provedor falhou ou a leitura foi cortada.' : ''}
        </p>
        {rows.length === 0 ? (
          <div className="px-[18px] pb-4">
            <Muted>Nada previsto</Muted>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={MONTH_HEAD_CLASS}>Mês</TableHead>
                  <TableHead className={`${MONTH_HEAD_CLASS} text-right`}>Stripe</TableHead>
                  <TableHead className={`${MONTH_HEAD_CLASS} text-right`}>Pagar.me</TableHead>
                  <TableHead className={`${MONTH_HEAD_CLASS} text-right`}>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.month}>
                    <TableCell className="text-sm">{formatMonth(r.month)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatMoney(r.stripe_cents)}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatMoney(r.pagarme_cents)}
                    </TableCell>
                    <TableCell className="text-right text-sm font-medium tabular-nums">
                      {formatMoney(r.total_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="text-sm font-semibold">Total</TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {formatMoney(sum('stripe_cents'))}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {formatMoney(sum('pagarme_cents'))}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {formatMoney(sum('total_cents'))}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </GlassPanel>
    </div>
  );
}

function ProviderBody({
  provider,
  deposits,
  onRetry,
}: {
  provider: DepositProvider;
  deposits: ProviderDeposits;
  onRetry: () => void;
}) {
  if (!deposits.configured) {
    return (
      <EmptyState
        icon={Banknote}
        title="Não configurado"
        description={notConfiguredHint(provider)}
      />
    );
  }
  if (!deposits.ok) {
    return (
      <ErrorState
        message={`Não foi possível ler ${providerName(provider)} agora.`}
        onRetry={onRetry}
      />
    );
  }
  const { balance, upcoming, in_transit, recent, truncated } = deposits;
  const nothingUpcoming = upcoming.next30.length === 0 && upcoming.byMonth.length === 0;
  const caption = scheduleCaption(provider, deposits.meta);

  return (
    <div className="flex flex-col gap-5 px-[18px] pb-4">
      {caption ? <p className="-mt-2 text-xs text-muted-foreground">{caption}</p> : null}
      {truncated ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Lista parcial: há mais lançamentos do que o painel lê de uma vez. Os totais abaixo estão
            subestimados.
          </span>
        </p>
      ) : null}
      {balance ? (
        <dl className="grid grid-cols-2 gap-3">
          <Field label="Disponível" value={formatMoney(balance.available_cents)} />
          <Field label="A compensar" value={formatMoney(balance.pending_cents)} />
        </dl>
      ) : null}

      <Block title="Próximos 30 dias">
        {upcoming.next30.length === 0 ? (
          <Muted>{nothingUpcoming ? 'Nada previsto' : 'Nada nos próximos 30 dias'}</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {upcoming.next30.map((row) => (
              // date is unique per kind after groupByDay on both sources
              <DayRowItem key={`${row.kind}-${row.date}`} row={row} />
            ))}
          </ul>
        )}
      </Block>

      {upcoming.byMonth.length > 0 ? (
        <Block title="Meses seguintes">
          <ul className="divide-y divide-border">
            {upcoming.byMonth.map((m) => (
              <MonthRowItem key={m.month} row={m} />
            ))}
          </ul>
        </Block>
      ) : null}

      {in_transit.length > 0 ? (
        <Block title="Transferências em andamento">
          <ul className="divide-y divide-border">
            {in_transit.map((t) => {
              const badge = payoutStatusBadge(t.status);
              return (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {t.expected_on ? `Previsto ${formatDayShort(t.expected_on)}` : 'Sem previsão'}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                    <span className="font-medium tabular-nums">{formatMoney(t.amount_cents)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}

      {recent.length > 0 ? (
        <Block title="Recentes">
          <ul className="divide-y divide-border">
            {recent.map((r) => {
              const badge = payoutStatusBadge(r.status);
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-muted-foreground">{formatDayShort(r.date)}</span>
                  <span className="flex items-center gap-2">
                    <Badge variant={badge.variant} size="sm">
                      {badge.label}
                    </Badge>
                    <span className="font-medium tabular-nums">{formatMoney(r.amount_cents)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      ) : null}
    </div>
  );
}

function DayRowItem({ row }: { row: DepositDayRow }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex flex-col">
        <span>{rowDateLabel(row)}</span>
        <span className="text-xs text-muted-foreground">
          {row.kind === 'payout'
            ? 'Repasse já criado'
            : `${row.count} ${row.count === 1 ? 'item' : 'itens'}`}
        </span>
      </span>
      <NetAmount net={row.net_cents} gross={row.gross_cents} fee={row.fee_cents} />
    </li>
  );
}

function MonthRowItem({ row }: { row: DepositMonthRow }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span className="flex flex-col">
        <span>{formatMonth(row.month)}</span>
        <span className="text-xs text-muted-foreground">
          {row.count} {row.count === 1 ? 'item' : 'itens'}
        </span>
      </span>
      <NetAmount net={row.net_cents} gross={row.gross_cents} fee={row.fee_cents} />
    </li>
  );
}

/** Net in the row; gross and fee behind a tooltip, and in visually hidden text so screen readers
 *  get it too (an aria-label on a plain, non-interactive span is ignored by most screen readers). */
function NetAmount({ net, gross, fee }: { net: number; gross: number; fee: number }) {
  const detail = `Bruto ${formatMoney(gross)}, taxas ${formatMoney(fee)}`;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help font-medium tabular-nums">
            {formatMoney(net)}
            <span className="sr-only">, {detail}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>{detail}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}
