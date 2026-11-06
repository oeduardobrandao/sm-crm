import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cell, GroupedList, SegmentedControl } from '@mesaas/ios-kit';
import type { ChurnedSummary, EndedKind } from '../../lib/api';
import { formatMoney } from '../../lib/subscription';
import { workspaceDetailPath } from '../../lib/routes';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ErrorState';
import { RowLink } from '../../components/RowLink';
import { GlassPanel } from '../../components/shell/GlassPanel';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ENDED_KIND_HINT, ENDED_KIND_LABEL, filterEnded, type ChurnView } from '../dashboard-churn';
import { relativeCreated } from './shared';

export interface ChurnCardProps {
  data: ChurnedSummary | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
  now: Date;
  phone?: boolean;
  className?: string;
}

const MAX_ROWS = 8;
const ALL_HREF = '/admin/workspaces?status=cancelado';

const KIND_VARIANT: Record<EndedKind, 'danger' | 'warning' | 'neutral'> = {
  churn: 'danger',
  trial_expired: 'warning',
  unknown: 'neutral',
};

function KindBadge({ kind }: { kind: EndedKind }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="w-fit">
          <Badge variant={KIND_VARIANT[kind]} className="whitespace-nowrap">
            {ENDED_KIND_LABEL[kind]}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{ENDED_KIND_HINT[kind]}</TooltipContent>
    </Tooltip>
  );
}

export function ChurnCard({ data, loading, error, retry, now, phone, className }: ChurnCardProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<ChurnView>('todos');
  const all = data?.workspaces ?? [];
  const rows = filterEnded(all, view);
  const shown = rows.slice(0, MAX_ROWS);
  const more = rows.length - shown.length;
  const count = (n: number | undefined) => (loading || error ? '…' : (n ?? 0));

  const title = 'Cancelados';
  const subtitle = data
    ? `${data.churn_count} ${data.churn_count === 1 ? 'cancelou' : 'cancelaram'} · ${formatMoney(data.lost_mrr_cents, data.currency)}/mês perdidos · ${data.trial_expired_count} ${data.trial_expired_count === 1 ? 'teste encerrado' : 'testes encerrados'} · ${data.window_days} dias`
    : null;
  const emptyText =
    view === 'churn'
      ? 'Nenhum cancelamento de pagante no período.'
      : view === 'trial_expired'
        ? 'Nenhum teste encerrado sem assinatura no período.'
        : 'Nenhum workspace encerrou a assinatura no período.';
  const errorText = 'Não foi possível carregar os cancelamentos.';

  const filter = (
    <SegmentedControl
      options={[
        { value: 'todos', label: 'Todos' },
        { value: 'churn', label: phone ? `Cancelou · ${count(data?.churn_count)}` : 'Cancelou' },
        {
          value: 'trial_expired',
          label: phone ? `Teste · ${count(data?.trial_expired_count)}` : 'Fim do teste',
        },
      ]}
      value={view}
      onChange={setView}
      aria-label="Filtro de cancelados"
      semantics="tablist"
    />
  );

  const meta = (r: (typeof all)[number]) =>
    r.kind === 'churn' && r.monthly_cents != null
      ? `${r.plan_name ?? 'Sem plano'} · ${formatMoney(r.monthly_cents, data?.currency)}/mês`
      : (r.plan_name ?? 'Sem plano');

  if (phone) {
    return (
      <div data-testid="churn-card" className="mb-2">
        <div className="phone-kit">
          <h2 className="phone-group__header">{title}</h2>
        </div>
        <div className="mb-4">{filter}</div>
        {loading || error || shown.length === 0 ? (
          <section className="phone-kit phone-group">
            <div className="phone-group__list">
              <div className="px-4 py-1">
                {loading ? (
                  <Skeleton className="my-3 h-3 w-3/4" />
                ) : error ? (
                  <ErrorState message={errorText} onRetry={retry} />
                ) : (
                  <p className="py-3 text-[15px] text-muted-foreground">{emptyText}</p>
                )}
              </div>
            </div>
          </section>
        ) : (
          <GroupedList header={subtitle ?? undefined} headerAs="h3">
            {shown.map((r) => (
              <Cell
                key={r.workspace_id}
                label={r.name}
                subtitle={`${ENDED_KIND_LABEL[r.kind]} · ${meta(r)}`}
                value={relativeCreated(r.ended_at, now)}
                to={workspaceDetailPath(r.workspace_id)}
              />
            ))}
            {more > 0 ? <Cell label={`+${more} workspaces`} to={ALL_HREF} /> : null}
          </GroupedList>
        )}
      </div>
    );
  }

  return (
    <div data-testid="churn-card" className={cn('min-w-0', className)}>
      <GlassPanel title={title} actions={filter} flush>
        {subtitle && !loading && !error ? (
          <p className="px-[18px] pb-3 text-xs text-muted-foreground">{subtitle}</p>
        ) : null}
        {loading ? (
          <div className="flex flex-col gap-3 px-[18px] pb-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-3 w-3/4" />
            ))}
          </div>
        ) : error ? (
          <div className="px-[18px] pb-4">
            <ErrorState message={errorText} onRetry={retry} />
          </div>
        ) : shown.length === 0 ? (
          <p className="px-[18px] pb-4 text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead className="text-right">Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((r) => (
                  <TableRow
                    key={r.workspace_id}
                    onClick={() => navigate(workspaceDetailPath(r.workspace_id))}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      <div className="min-w-0 max-w-[13rem]">
                        <RowLink
                          to={workspaceDetailPath(r.workspace_id)}
                          className="block truncate text-sm"
                          title={r.name}
                        >
                          {r.name}
                        </RowLink>
                        <div className="truncate text-xs text-muted-foreground">{meta(r)}</div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <KindBadge kind={r.kind} />
                        <span
                          className="whitespace-nowrap text-xs text-muted-foreground"
                          title={new Date(r.ended_at).toLocaleDateString('pt-BR')}
                        >
                          {relativeCreated(r.ended_at, now)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between px-[18px] py-3 text-xs text-muted-foreground">
              <span>{more > 0 ? `+${more} workspaces` : ''}</span>
              <Link to={ALL_HREF} className="text-dim-foreground hover:text-foreground">
                ver todos os cancelados →
              </Link>
            </div>
          </>
        )}
      </GlassPanel>
    </div>
  );
}
