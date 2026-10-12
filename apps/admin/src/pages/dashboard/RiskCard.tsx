import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Cell, GroupedList, SegmentedControl } from '@mesaas/ios-kit';
import type { TrialWorkspace, WorkspaceSummary } from '../../lib/api';
import { formatMoney, intervalSuffix } from '../../lib/subscription';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { ErrorState } from '../../components/ErrorState';
import { RowLink } from '../../components/RowLink';
import { GlassPanel } from '../../components/shell/GlassPanel';
import { workspaceDetailPath } from '../../lib/routes';
import {
  pendingLabel,
  selectTrialsEndingSoon,
  TRIAL_ENDING_SOON_DAYS,
  trialDeadlineLabel,
} from '../dashboard-risk';
import { describeActivity } from '../workspace-activity';

const MAX_ROWS = 5;

interface Source<T> {
  data: T | undefined;
  loading: boolean;
  error: boolean;
  retry: () => void;
}

export interface RiskCardProps {
  trials: Source<TrialWorkspace[]>;
  pending: Source<{ workspaces: WorkspaceSummary[]; total: number }>;
  now: Date;
  /** Phone layout: segmented control + inset grouped lists instead of the glass panel. */
  phone?: boolean;
  className?: string;
}

type View = 'todos' | 'testes' | 'pendentes';

const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'testes', label: 'Testes' },
  { value: 'pendentes', label: 'Pendentes' },
];

const TRIALS_HREF = '/admin/workspaces?status=teste';
const PENDING_HREF = '/admin/workspaces?status=pendente';

interface RiskRow {
  key: string;
  name: string;
  meta: string;
  right: string;
  tone: 'warning' | 'danger';
  to: string;
}

function GroupRows({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col divide-y divide-border/60">{children}</ul>;
}

function Row({
  name,
  meta,
  right,
  tone,
  to,
  onClick,
}: Omit<RiskRow, 'key'> & { onClick: () => void }) {
  return (
    <li
      onClick={onClick}
      className="flex cursor-pointer items-center justify-between gap-3 py-2 hover:bg-foreground/[0.03]"
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">
          <RowLink to={to} className="block truncate">
            {name}
          </RowLink>
        </div>
        <div className="truncate text-xs text-muted-foreground">{meta}</div>
      </div>
      <span
        className={cn('shrink-0 text-xs', tone === 'warning' ? 'text-warning' : 'text-destructive')}
      >
        {right}
      </span>
    </li>
  );
}

function GroupSkeleton() {
  return (
    <div className="flex flex-col gap-3 py-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-3 w-3/4" />
      ))}
    </div>
  );
}

export function RiskCard({ trials, pending, now, phone = false, className }: RiskCardProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('todos');

  const endingSoon = trials.data ? selectTrialsEndingSoon(trials.data, now) : [];
  const pendingRows = pending.data?.workspaces ?? [];
  const pendingTotal = pending.data?.total ?? 0;

  const bothLoaded = !trials.loading && !pending.loading && !trials.error && !pending.error;
  const allClear = bothLoaded && endingSoon.length === 0 && pendingTotal === 0;

  // A settled-looking "0" next to a skeleton (or an error) reads as an answer. Until the
  // group's own source resolves, the count says nothing.
  const trialsCount = trials.loading || trials.error ? '…' : endingSoon.length;
  const pendingCount = pending.loading || pending.error ? '…' : pendingTotal;

  const showTrials = view !== 'pendentes';
  const showPending = view !== 'testes';

  const trialItems: RiskRow[] = endingSoon.slice(0, MAX_ROWS).map((t) => ({
    key: t.workspace_id,
    name: t.name,
    meta: `${t.plan_name ?? 'Sem plano'} · ${formatMoney(t.monthly_cents)}/mês · ${describeActivity(t.last_activity_at, t.created_at ?? now.toISOString(), now).label}`,
    right: trialDeadlineLabel(t.trial_ends_at!, now),
    tone: 'warning',
    to: workspaceDetailPath(t.workspace_id),
  }));
  const trialsMore = endingSoon.length - MAX_ROWS;

  const pendingItems: RiskRow[] = pendingRows.slice(0, MAX_ROWS).map((ws) => ({
    key: ws.id,
    name: ws.name,
    meta: `${ws.plan_name ?? 'Sem plano'} · ${formatMoney(ws.subscription?.amount_cents, ws.subscription?.currency)}${intervalSuffix(ws.subscription?.interval)} · ${describeActivity(ws.last_activity_at, ws.created_at, now).label}`,
    right: pendingLabel(ws.subscription, now),
    tone: 'danger',
    to: workspaceDetailPath(ws.id),
  }));
  const pendingMore = pendingTotal - pendingRows.length;

  const filter = (
    <SegmentedControl
      options={
        phone
          ? [
              VIEW_OPTIONS[0],
              { value: 'testes', label: `Testes · ${trialsCount}` },
              { value: 'pendentes', label: `Pendentes · ${pendingCount}` },
            ]
          : VIEW_OPTIONS
      }
      value={view}
      onChange={setView}
      aria-label="Filtro de risco"
      semantics="tablist"
    />
  );

  const trialsTitle = `Testes terminando em até ${TRIAL_ENDING_SOON_DAYS} dias`;
  const trialsError = 'Não foi possível carregar os testes.';
  const pendingError = 'Não foi possível carregar os pagamentos pendentes.';
  const trialsEmpty = `Nenhum teste vence nos próximos ${TRIAL_ENDING_SOON_DAYS} dias.`;
  const pendingEmpty = 'Nenhum pagamento pendente.';
  const allClearText = 'Tudo em ordem: nenhum teste vencendo nem pagamento pendente.';

  if (phone) {
    const group = (
      title: string,
      count: string | number,
      source: { loading: boolean; error: boolean; retry: () => void },
      items: RiskRow[],
      more: number,
      moreHref: string,
      errorText: string,
      emptyText: string,
    ) => {
      const header = `${title} · ${count}`;
      if (source.loading || source.error || items.length === 0) {
        return (
          <section className="phone-kit phone-group">
            <h3 className="phone-group__header">{header}</h3>
            <div className="phone-group__list px-4 py-1">
              {source.loading ? (
                <GroupSkeleton />
              ) : source.error ? (
                <ErrorState message={errorText} onRetry={source.retry} />
              ) : (
                <p className="py-3 text-[15px] text-muted-foreground">{emptyText}</p>
              )}
            </div>
          </section>
        );
      }
      return (
        <GroupedList header={header} headerAs="h3">
          {items.map((r) => (
            <Cell
              key={r.key}
              label={r.name}
              subtitle={r.meta}
              value={
                <span className={r.tone === 'warning' ? 'text-warning' : 'text-destructive'}>
                  {r.right}
                </span>
              }
              to={r.to}
            />
          ))}
          {more > 0 ? <Cell label={`+${more} workspaces`} to={moreHref} /> : null}
        </GroupedList>
      );
    };

    return (
      <div data-testid="risk-card" className="mb-2">
        <div className="phone-kit">
          <h2 className="phone-group__header">Atenção</h2>
        </div>
        <div className="mb-4">{filter}</div>
        {allClear ? (
          <GroupedList aria-label="Atenção">
            <Cell label={allClearText} />
          </GroupedList>
        ) : (
          <>
            {showTrials
              ? group(
                  trialsTitle,
                  trialsCount,
                  trials,
                  trialItems,
                  trialsMore,
                  TRIALS_HREF,
                  trialsError,
                  trialsEmpty,
                )
              : null}
            {showPending
              ? group(
                  'Pagamento pendente',
                  pendingCount,
                  pending,
                  pendingItems,
                  pendingMore,
                  PENDING_HREF,
                  pendingError,
                  pendingEmpty,
                )
              : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div data-testid="risk-card" className={cn('min-w-0', className)}>
      <GlassPanel title="Atenção" actions={filter} flush>
        {allClear ? (
          <p className="px-[18px] pb-4 text-sm text-muted-foreground">{allClearText}</p>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {showTrials ? (
              <section className="px-[18px] pb-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <Badge variant="warning">{trialsCount}</Badge>
                  {trialsTitle}
                  <Link
                    to={TRIALS_HREF}
                    className="ml-auto font-normal normal-case tracking-normal text-dim-foreground hover:text-foreground"
                  >
                    ver todos os testes →
                  </Link>
                </h3>
                {trials.loading ? (
                  <GroupSkeleton />
                ) : trials.error ? (
                  <ErrorState message={trialsError} onRetry={trials.retry} />
                ) : trialItems.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">{trialsEmpty}</p>
                ) : (
                  <GroupRows>
                    {trialItems.map(({ key, ...r }) => (
                      <Row key={key} {...r} onClick={() => navigate(r.to)} />
                    ))}
                    {trialsMore > 0 ? (
                      <li className="py-2 text-xs text-muted-foreground">
                        +{trialsMore} workspaces
                      </li>
                    ) : null}
                  </GroupRows>
                )}
              </section>
            ) : null}

            {showPending ? (
              <section className="px-[18px] pb-4">
                <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
                  <Badge variant="danger">{pendingCount}</Badge>
                  Pagamento pendente
                  <Link
                    to={PENDING_HREF}
                    className="ml-auto font-normal normal-case tracking-normal text-dim-foreground hover:text-foreground"
                  >
                    ver todos →
                  </Link>
                </h3>
                {pending.loading ? (
                  <GroupSkeleton />
                ) : pending.error ? (
                  <ErrorState message={pendingError} onRetry={pending.retry} />
                ) : pendingItems.length === 0 ? (
                  <p className="py-2 text-xs text-muted-foreground">{pendingEmpty}</p>
                ) : (
                  <GroupRows>
                    {pendingItems.map(({ key, ...r }) => (
                      <Row key={key} {...r} onClick={() => navigate(r.to)} />
                    ))}
                    {pendingMore > 0 ? (
                      <li className="py-2 text-xs text-muted-foreground">
                        +{pendingMore} workspaces
                      </li>
                    ) : null}
                  </GroupRows>
                )}
              </section>
            ) : null}
          </div>
        )}
      </GlassPanel>
    </div>
  );
}
