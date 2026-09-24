import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  getDeposits,
  type DepositDayRow,
  type DepositMonthRow,
  type DepositProvider,
  type ProviderDeposits,
} from '../../lib/api';
import { formatMoney } from '../../lib/subscription';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import {
  NOT_CONFIGURED_SECRET,
  formatDayShort,
  formatMonth,
  payoutStatusBadge,
  providerName,
  rowDateLabel,
  scheduleCaption,
  waitingTotalLabel,
} from './deposits-view';

const PROVIDERS: DepositProvider[] = ['stripe', 'pagarme'];
const STALE_MS = 5 * 60 * 1000;

/**
 * Depósitos: when and how much each provider will deposit to the bank. Live read, nothing
 * persisted. Each provider card owns its state so a Pagar.me outage never hides Stripe.
 */
export function DepositsSection() {
  const query = useQuery({
    queryKey: ['admin', 'deposits'],
    queryFn: getDeposits,
    staleTime: STALE_MS,
  });
  const { data, isPending, isError, refetch, isFetching } = query;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Valores líquidos, já descontadas as taxas dos provedores.
          {data
            ? ` Atualizado ${new Date(data.generated_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`
            : ''}
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : undefined} />
          Atualizar
        </Button>
      </div>

      {isError ? (
        <Card>
          <ErrorState message="Não foi possível carregar os depósitos." onRetry={() => refetch()} />
        </Card>
      ) : null}

      {isPending ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} data-testid="deposits-skeleton" className="h-24 rounded-2xl" />
          ))}
        </div>
      ) : data ? (
        <div data-testid="deposits-summary" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile
            label="Próximo depósito"
            value={data.summary.next ? formatMoney(data.summary.next.amount_cents) : '—'}
            sub={
              data.summary.next
                ? `${providerName(data.summary.next.provider)} · ${formatDayShort(data.summary.next.date)}`
                : 'Nada previsto'
            }
          />
          <StatTile label="Próximos 30 dias" value={formatMoney(data.summary.next_30d_cents)} />
          <StatTile
            label={waitingTotalLabel(data)}
            value={formatMoney(data.summary.waiting_cents)}
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        {isPending
          ? // No data-testid here: the card only becomes `deposits-card-{provider}` once its
            // content is real, so `findByTestId` in tests can't resolve against this stale
            // skeleton shell before the query settles.
            PROVIDERS.map((p) => (
              <Card key={p}>
                <CardHeader>
                  <CardTitle>{providerName(p)}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Skeleton data-testid="deposits-skeleton" className="h-5 w-2/3" />
                  <Skeleton data-testid="deposits-skeleton" className="h-5 w-1/2" />
                  <Skeleton data-testid="deposits-skeleton" className="h-24 w-full" />
                </CardContent>
              </Card>
            ))
          : data
            ? PROVIDERS.map((p) => (
                <Card key={p} data-testid={`deposits-card-${p}`}>
                  <CardHeader>
                    <CardTitle>{providerName(p)}</CardTitle>
                    <ProviderCaption provider={p} deposits={data[p]} />
                  </CardHeader>
                  <ProviderBody provider={p} deposits={data[p]} onRetry={() => refetch()} />
                </Card>
              ))
            : null}
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="glass-surface bg-card border border-border rounded-2xl p-5 min-w-0">
      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <p className="text-2xl font-bold font-sf break-words">{value}</p>
      {sub ? <p className="text-xs text-muted-foreground mt-1">{sub}</p> : null}
    </div>
  );
}

function ProviderCaption({
  provider,
  deposits,
}: {
  provider: DepositProvider;
  deposits: ProviderDeposits;
}) {
  if (!deposits.ok) return null;
  const caption = scheduleCaption(provider, deposits.meta);
  return caption ? <p className="text-xs text-muted-foreground">{caption}</p> : null;
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
        description={`Defina a secret ${NOT_CONFIGURED_SECRET[provider]} na function platform-admin para ler este provedor.`}
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

  return (
    <CardContent className="flex flex-col gap-5">
      {truncated ? (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Lista parcial: há mais recebíveis do que o painel lê de uma vez. Os totais abaixo estão
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
    </CardContent>
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
        <span className="capitalize">{formatMonth(row.month)}</span>
        <span className="text-xs text-muted-foreground">
          {row.count} {row.count === 1 ? 'item' : 'itens'}
        </span>
      </span>
      <NetAmount net={row.net_cents} gross={row.gross_cents} fee={row.fee_cents} />
    </li>
  );
}

/** Net in the row; gross and fee behind a tooltip, and in the accessible name so screen readers get it too. */
function NetAmount({ net, gross, fee }: { net: number; gross: number; fee: number }) {
  const detail = `Bruto ${formatMoney(gross)}, taxas ${formatMoney(fee)}`;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span aria-label={detail} className="font-medium tabular-nums cursor-help">
            {formatMoney(net)}
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
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
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
  return <p className="text-sm text-muted-foreground py-2">{children}</p>;
}
