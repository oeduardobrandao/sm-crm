import { ArrowDown, ArrowRight, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDir, WorkspaceSortKey, WorkspaceSummary } from '../../lib/api';
import { PLAN_TEXT_CLASS, getPlanColor } from '../../lib/plan-colors';
import {
  formatMoney,
  hasSubscription,
  intervalSuffix,
  providerLabel,
  statusMeta,
  STATUS_BADGE_VARIANT,
} from '../../lib/subscription';
import { Badge } from '../../components/ui/badge';
import { RowLink } from '../../components/RowLink';
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
import { workspaceDetailPath } from '../../lib/routes';

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

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
});

export function PlanBadge({ name }: { name: string | null }) {
  if (!name) return <span className="text-dim-foreground">—</span>;
  const color = getPlanColor(name);
  return (
    <Badge
      variant="neutral"
      className={PLAN_TEXT_CLASS}
      style={{ ['--plan-color' as string]: color, backgroundColor: `${color}26` }}
    >
      {name}
    </Badge>
  );
}

function SubscriptionCell({ ws }: { ws: WorkspaceSummary }) {
  if (!hasSubscription(ws.subscription)) return <span className="text-dim-foreground">—</span>;
  const meta = statusMeta(ws.subscription.status);
  return (
    <span className="flex items-center gap-2 whitespace-nowrap">
      <Badge variant={STATUS_BADGE_VARIANT[meta.tone]}>{meta.label}</Badge>
      {/* Price over provider: the caption stacks instead of widening the row. */}
      <span className="flex flex-col leading-tight">
        <span className="text-xs text-muted-foreground">
          {formatMoney(ws.subscription.amount_cents, ws.subscription.currency)}
          {intervalSuffix(ws.subscription.interval)}
        </span>
        {ws.subscription.provider && (
          <span className="text-[0.65rem] uppercase tracking-wider text-dim-foreground">
            {providerLabel(ws.subscription.provider)}
          </span>
        )}
      </span>
    </span>
  );
}

function ActivityCell({ ws, now }: { ws: WorkspaceSummary; now: Date }) {
  const a = describeActivity(ws.last_activity_at, ws.created_at, now);
  return (
    <Tooltip>
      {/* asChild keeps a span: a <button> here would hijack the row's click. */}
      <TooltipTrigger asChild>
        <span className={cn('w-fit whitespace-nowrap text-sm', ACTIVITY_TONE_CLASS[a.tone])}>
          {a.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{a.title}</TooltipContent>
    </Tooltip>
  );
}

/** The owner's e-mail sits under the name when the "Dono" column is on, so it never needs a
 * column of its own (the Colunas menu still toggles it). */
function NameCell({ ws, showOwner }: { ws: WorkspaceSummary; showOwner: boolean }) {
  const email = ws.owner?.email;
  return (
    <div className="flex min-w-0 max-w-[12rem] flex-col">
      <span className="flex min-w-0 items-center gap-2">
        <RowLink to={workspaceDetailPath(ws.id)} className="min-w-0 truncate" title={ws.name}>
          {ws.name}
        </RowLink>
        {ws.has_overrides ? (
          <Badge variant="warning" size="sm" className="shrink-0">
            overrides
          </Badge>
        ) : null}
      </span>
      {showOwner && (
        <span className="truncate text-xs text-muted-foreground" title={email || undefined}>
          {email || '—'}
        </span>
      )}
    </div>
  );
}

function cellFor(key: WorkspaceColumnKey, ws: WorkspaceSummary, now: Date, showOwner: boolean) {
  switch (key) {
    case 'name':
      return <NameCell ws={ws} showOwner={showOwner} />;
    case 'owner':
      return null;
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
        <span className="whitespace-nowrap text-sm text-muted-foreground">
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
  const showOwner = visible.includes('owner');
  const columns = WORKSPACE_COLUMNS.filter((c) => c.key !== 'owner' && visible.includes(c.key));
  const cellPad = density === 'compacta' ? 'py-1.5 text-xs' : 'py-3';

  return (
    <Table aria-busy={busy ? 'true' : undefined} className={cn(busy && 'opacity-60')}>
      <TableHeader>
        <TableRow>
          {columns.map((col) => {
            const active = col.sortKey !== undefined && col.sortKey === sort.ord;
            const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined;
            return (
              <TableHead
                key={col.key}
                aria-sort={ariaSort}
                className={cn(
                  'whitespace-nowrap px-2 text-[0.7rem] uppercase tracking-wider',
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
          <TableHead className="w-8 pl-0 last:pr-4" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {workspaces.map((ws) => (
          <TableRow key={ws.id} onClick={() => onOpen(ws.id)} className="cursor-pointer">
            {columns.map((col) => (
              <TableCell key={col.key} className={cn(cellPad, 'px-2', col.numeric && 'text-right')}>
                {cellFor(col.key, ws, now, showOwner)}
              </TableCell>
            ))}
            <TableCell className={cn(cellPad, 'pl-0 text-muted-foreground last:pr-4')}>
              <ArrowRight size={16} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function WorkspacesTableSkeleton({
  visible,
  rows = 5,
}: {
  visible: WorkspaceColumnKey[];
  rows?: number;
}) {
  const columns = WORKSPACE_COLUMNS.filter((c) => c.key !== 'owner' && visible.includes(c.key));
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
          <TableHead className="w-8 pl-0 last:pr-4" />
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
            <TableCell className="py-3 pl-0 last:pr-4" />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
