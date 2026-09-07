import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { TrialWorkspace, WorkspaceSummary } from '../../lib/api';
import { formatMoney, intervalSuffix } from '../../lib/subscription';
import { cn } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Skeleton } from '../../components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { ErrorState } from '../../components/ErrorState';
import { RowLink } from '../../components/RowLink';
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

interface RiskCardProps {
  trials: Source<TrialWorkspace[]>;
  pending: Source<{ workspaces: WorkspaceSummary[]; total: number }>;
  now: Date;
}

type View = 'todos' | 'testes' | 'pendentes';

function GroupRows({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col divide-y divide-border/60">{children}</ul>;
}

function Row({
  name,
  meta,
  right,
  tone,
  to,
  onClick,
}: {
  name: string;
  meta: string;
  right: string;
  tone: 'warning' | 'danger';
  to: string;
  onClick: () => void;
}) {
  return (
    <li
      onClick={onClick}
      className="flex cursor-pointer items-center justify-between gap-3 py-2 hover:bg-secondary/30"
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

export function RiskCard({ trials, pending, now }: RiskCardProps) {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('todos');

  const endingSoon = trials.data ? selectTrialsEndingSoon(trials.data, now) : [];
  const pendingRows = pending.data?.workspaces ?? [];
  const pendingTotal = pending.data?.total ?? 0;

  const bothLoaded = !trials.loading && !pending.loading && !trials.error && !pending.error;
  const allClear = bothLoaded && endingSoon.length === 0 && pendingTotal === 0;

  // A settled-looking "0" next to a skeleton (or an error) reads as an answer. Until the
  // group's own source resolves, the badge says nothing.
  const trialsCount = trials.loading || trials.error ? '…' : endingSoon.length;
  const pendingCount = pending.loading || pending.error ? '…' : pendingTotal;

  const showTrials = view !== 'pendentes';
  const showPending = view !== 'testes';

  return (
    <Card className="mb-8" data-testid="risk-card">
      <CardHeader>
        <CardTitle>Atenção</CardTitle>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-8">
            <TabsTrigger value="todos" className="text-xs">
              Todos
            </TabsTrigger>
            <TabsTrigger value="testes" className="text-xs">
              Testes
            </TabsTrigger>
            <TabsTrigger value="pendentes" className="text-xs">
              Pendentes
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      {allClear ? (
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Tudo em ordem: nenhum teste vencendo nem pagamento pendente.
          </p>
        </CardContent>
      ) : (
        <div
          className={cn(
            'grid',
            showTrials && showPending && 'md:grid-cols-2 md:divide-x md:divide-border',
          )}
        >
          {showTrials ? (
            <section className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Badge variant="warning">{trialsCount}</Badge>
                Testes terminando em até {TRIAL_ENDING_SOON_DAYS} dias
                <Link
                  to="/admin/workspaces?status=teste"
                  className="ml-auto font-normal text-dim-foreground hover:text-foreground"
                >
                  ver todos os testes →
                </Link>
              </h3>
              {trials.loading ? (
                <GroupSkeleton />
              ) : trials.error ? (
                <ErrorState message="Não foi possível carregar os testes." onRetry={trials.retry} />
              ) : endingSoon.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">
                  Nenhum teste vence nos próximos {TRIAL_ENDING_SOON_DAYS} dias.
                </p>
              ) : (
                <GroupRows>
                  {endingSoon.slice(0, MAX_ROWS).map((t) => (
                    <Row
                      key={t.workspace_id}
                      name={t.name}
                      meta={`${t.plan_name ?? 'Sem plano'} · ${formatMoney(t.monthly_cents)}/mês · ${describeActivity(t.last_activity_at, t.created_at ?? now.toISOString(), now).label}`}
                      right={trialDeadlineLabel(t.trial_ends_at!, now)}
                      tone="warning"
                      to={workspaceDetailPath(t.workspace_id)}
                      onClick={() => navigate(workspaceDetailPath(t.workspace_id))}
                    />
                  ))}
                  {endingSoon.length > MAX_ROWS ? (
                    <li className="py-2 text-xs text-muted-foreground">
                      +{endingSoon.length - MAX_ROWS} workspaces
                    </li>
                  ) : null}
                </GroupRows>
              )}
            </section>
          ) : null}

          {showPending ? (
            <section className="p-5">
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold">
                <Badge variant="danger">{pendingCount}</Badge>
                Pagamento pendente
                <Link
                  to="/admin/workspaces?status=pendente"
                  className="ml-auto font-normal text-dim-foreground hover:text-foreground"
                >
                  ver todos →
                </Link>
              </h3>
              {pending.loading ? (
                <GroupSkeleton />
              ) : pending.error ? (
                <ErrorState
                  message="Não foi possível carregar os pagamentos pendentes."
                  onRetry={pending.retry}
                />
              ) : pendingRows.length === 0 ? (
                <p className="py-2 text-xs text-muted-foreground">Nenhum pagamento pendente.</p>
              ) : (
                <GroupRows>
                  {pendingRows.slice(0, MAX_ROWS).map((ws) => (
                    <Row
                      key={ws.id}
                      name={ws.name}
                      meta={`${ws.plan_name ?? 'Sem plano'} · ${formatMoney(ws.subscription?.amount_cents, ws.subscription?.currency)}${intervalSuffix(ws.subscription?.interval)} · ${describeActivity(ws.last_activity_at, ws.created_at, now).label}`}
                      right={pendingLabel(ws.subscription, now)}
                      tone="danger"
                      to={workspaceDetailPath(ws.id)}
                      onClick={() => navigate(workspaceDetailPath(ws.id))}
                    />
                  ))}
                  {pendingTotal > pendingRows.length ? (
                    <li className="py-2 text-xs text-muted-foreground">
                      +{pendingTotal - pendingRows.length} workspaces
                    </li>
                  ) : null}
                </GroupRows>
              )}
            </section>
          ) : null}
        </div>
      )}
    </Card>
  );
}
