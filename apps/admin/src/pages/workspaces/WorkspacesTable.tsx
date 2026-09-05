import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDir, WorkspaceSortKey, WorkspaceSummary } from '../../lib/api';
import { getPlanColor } from '../../lib/plan-colors';
import {
  formatMoney,
  hasSubscription,
  intervalSuffix,
  providerLabel,
  statusMeta,
} from '../../lib/subscription';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { ACTIVITY_TONE_CLASS, describeActivity } from '../workspace-activity';
import { WORKSPACE_COLUMNS, type Density, type WorkspaceColumnKey } from '../workspaces-columns';
import { cn } from '../../lib/utils';

interface WorkspacesTableProps {
  workspaces: WorkspaceSummary[];
  visible: WorkspaceColumnKey[];
  density: Density;
  sort: { ord: WorkspaceSortKey; dir: SortDir };
  onSort: (key: WorkspaceSortKey) => void;
  onOpen: (id: string) => void;
  /** Injected so activity labels are deterministic in tests. */
  now: Date;
  /** True while a refetch is in flight; dims the previous rows instead of unmounting them. */
  busy?: boolean;
}

const STATUS_VARIANT = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  muted: 'neutral',
} as const;

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'short',
  year: '2-digit',
});

function PlanBadge({ name }: { name: string | null }) {
  if (!name) return <span className="text-dim-foreground">—</span>;
  const color = getPlanColor(name);
  return (
    <Badge variant="neutral" style={{ color, backgroundColor: `${color}26` }}>
      {name}
    </Badge>
  );
}

function SubscriptionCell({ ws }: { ws: WorkspaceSummary }) {
  if (!hasSubscription(ws.subscription)) return <span className="text-dim-foreground">—</span>;
  const meta = statusMeta(ws.subscription.status);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Badge variant={STATUS_VARIANT[meta.tone]}>{meta.label}</Badge>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        {formatMoney(ws.subscription.amount_cents, ws.subscription.currency)}
        {intervalSuffix(ws.subscription.interval)}
      </span>
      {ws.subscription.provider && (
        <span className="whitespace-nowrap text-[0.65rem] uppercase tracking-wider text-dim-foreground">
          {providerLabel(ws.subscription.provider)}
        </span>
      )}
    </span>
  );
}

function ActivityCell({ ws, now }: { ws: WorkspaceSummary; now: Date }) {
  const a = describeActivity(ws.last_activity_at, ws.created_at, now);
  return (
    <Tooltip>
      {/* asChild keeps a span: a <button> here would hijack the row's click. */}
      <TooltipTrigger asChild>
        <span className={cn('w-fit text-sm', ACTIVITY_TONE_CLASS[a.tone])}>{a.label}</span>
      </TooltipTrigger>
      <TooltipContent>{a.title}</TooltipContent>
    </Tooltip>
  );
}

function cellFor(key: WorkspaceColumnKey, ws: WorkspaceSummary, now: Date) {
  switch (key) {
    case 'name':
      return (
        <span className="flex items-center gap-2">
          <span className="font-medium text-foreground">{ws.name}</span>
          {ws.has_overrides ? (
            <Badge variant="warning" size="sm">
              overrides
            </Badge>
          ) : null}
        </span>
      );
    case 'owner':
      return (
        <span className="truncate text-sm text-muted-foreground">{ws.owner?.email || '—'}</span>
      );
    case 'plan':
      return <PlanBadge name={ws.plan_name} />;
    case 'subscription':
      return <SubscriptionCell ws={ws} />;
    case 'client_count':
      return <span className="tabular-nums">{ws.client_count}</span>;
    case 'member_count':
      return <span className="tabular-nums">{ws.member_count}</span>;
    case 'created_at':
      return (
        <span className="text-sm text-muted-foreground">
          {DATE_FMT.format(new Date(ws.created_at))}
        </span>
      );
    case 'last_activity_at':
      return <ActivityCell ws={ws} now={now} />;
    default:
      return null;
  }
}

export function WorkspacesTable({
  workspaces,
  visible,
  density,
  sort,
  onSort,
  onOpen,
  now,
  busy,
}: WorkspacesTableProps) {
  const columns = WORKSPACE_COLUMNS.filter((c) => visible.includes(c.key));
  const cellPad = density === 'compacta' ? 'py-1.5 text-xs' : 'py-3';

  return (
    <>
      {/* Desktop: real table. */}
      <Table
        aria-busy={busy ? 'true' : undefined}
        className={cn('hidden md:table', busy && 'opacity-60')}
      >
        <TableHeader>
          <TableRow>
            {columns.map((col) => {
              const active = col.sortKey !== undefined && col.sortKey === sort.ord;
              const ariaSort = active
                ? sort.dir === 'asc'
                  ? 'ascending'
                  : 'descending'
                : undefined;
              return (
                <TableHead
                  key={col.key}
                  aria-sort={ariaSort}
                  className={cn(
                    'text-[0.7rem] uppercase tracking-wider',
                    col.numeric && 'text-right',
                  )}
                >
                  {col.sortKey ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.sortKey!)}
                      className={cn(
                        'group inline-flex items-center gap-1 hover:text-foreground',
                        active ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {col.label}
                      {active ? (
                        sort.dir === 'asc' ? (
                          <ArrowUp size={12} />
                        ) : (
                          <ArrowDown size={12} />
                        )
                      ) : (
                        <ArrowUpDown size={12} className="opacity-0 group-hover:opacity-60" />
                      )}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{col.label}</span>
                  )}
                </TableHead>
              );
            })}
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {workspaces.map((ws) => (
            <TableRow key={ws.id} onClick={() => onOpen(ws.id)} className="cursor-pointer">
              {columns.map((col) => (
                <TableCell key={col.key} className={cn(cellPad, col.numeric && 'text-right')}>
                  {cellFor(col.key, ws, now)}
                </TableCell>
              ))}
              <TableCell className={cn(cellPad, 'text-muted-foreground')}>
                <ArrowRight size={16} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Mobile: one card per row. Ignores column prefs on purpose -- the mobile card
          always shows the same secondary fields regardless of `visible`/density. */}
      <ul className={cn('flex flex-col md:hidden', busy && 'opacity-60')}>
        {workspaces.map((ws) => (
          <li
            key={ws.id}
            onClick={() => onOpen(ws.id)}
            className="cursor-pointer border-b border-border/50 px-5 py-3 last:border-0 hover:bg-secondary/30"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-foreground">{ws.name}</span>
              {ws.has_overrides ? (
                <Badge variant="warning" size="sm">
                  overrides
                </Badge>
              ) : null}
              <ArrowRight size={14} className="ml-auto text-muted-foreground" />
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="max-w-[180px] truncate">{ws.owner?.email || '—'}</span>
              <PlanBadge name={ws.plan_name} />
              <SubscriptionCell ws={ws} />
              <span>{ws.client_count} clientes</span>
              <span>{ws.member_count} membros</span>
              <ActivityCell ws={ws} now={now} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function WorkspacesTableSkeleton({
  visible,
  rows = 5,
}: {
  visible: WorkspaceColumnKey[];
  rows?: number;
}) {
  const columns = WORKSPACE_COLUMNS.filter((c) => visible.includes(c.key));
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.key}
              className="text-[0.7rem] uppercase tracking-wider text-muted-foreground"
            >
              {col.label}
            </TableHead>
          ))}
          {/* Mirrors the loaded table's trailing chevron column, so the columns do not
              shift sideways the moment the data lands. */}
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }, (_, i) => (
          <TableRow key={i}>
            {columns.map((col) => (
              <TableCell key={col.key} className="py-3">
                <Skeleton className={cn('h-3', col.key === 'name' ? 'w-36' : 'w-20')} />
              </TableCell>
            ))}
            <TableCell className="py-3" />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
