import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  UserPlus,
  UserCheck,
  UserMinus,
  Mail,
  MailCheck,
  MailX,
  Link,
  Send,
  Clock,
  AlertTriangle,
  Shield,
  Key,
  KeyRound,
  Plug,
  Unplug,
  Upload,
  Undo2,
  Activity,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { listWorkspaceEvents } from '../lib/api';
import { eventMeta, eventDescription, FILTERABLE_TYPES } from './workspace-events';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Skeleton } from '../components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';

const ICON_MAP: Record<string, LucideIcon> = {
  UserPlus,
  UserCheck,
  UserMinus,
  Mail,
  MailCheck,
  MailX,
  Link,
  Send,
  Clock,
  AlertTriangle,
  Shield,
  Key,
  KeyRound,
  Plug,
  Unplug,
  Upload,
  Undo2,
  Activity,
};

const PAGE_SIZE = 15;

/** Radix Select rejects '' as an item value; this sentinel stands for "Todos os eventos". */
const ALL = '__all__';
const HEAD_CLASS = 'text-[0.7rem] uppercase tracking-wider';

export default function WorkspaceEventsCard({ workspaceId }: { workspaceId: string }) {
  const [page, setPage] = useState(0);
  const [filterType, setFilterType] = useState('');

  const offset = page * PAGE_SIZE;
  const eventTypes = filterType ? [filterType] : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'workspace', workspaceId, 'events', { offset, filterType }],
    queryFn: () =>
      listWorkspaceEvents({
        workspace_id: workspaceId,
        offset,
        limit: PAGE_SIZE,
        event_types: eventTypes,
      }),
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const rows = events.map((evt) => ({
    evt,
    meta: eventMeta(evt.action),
    desc: eventDescription(evt),
    timeAgo: formatDistanceToNow(new Date(evt.created_at), { addSuffix: true, locale: ptBR }),
  }));

  return (
    <Card className="mt-6 min-w-0">
      <CardHeader>
        <CardTitle>Histórico de eventos ({total})</CardTitle>
        <Select
          value={filterType === '' ? ALL : filterType}
          onValueChange={(v) => {
            setFilterType(v === ALL ? '' : v);
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="Tipo de evento" className="h-8 w-auto gap-2 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos os eventos</SelectItem>
            {FILTERABLE_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>

      {isLoading ? (
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-4 w-72" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-60" />
        </CardContent>
      ) : events.length === 0 ? (
        <EmptyState icon={Activity} title="Nenhum evento encontrado" />
      ) : (
        <>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead className={HEAD_CLASS}>Quando</TableHead>
                <TableHead className={HEAD_CLASS}>Evento</TableHead>
                <TableHead className={HEAD_CLASS}>Autor</TableHead>
                <TableHead className={HEAD_CLASS}>Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ evt, meta, desc, timeAgo }) => {
                const Icon = ICON_MAP[meta.icon] ?? Activity;
                return (
                  <TableRow key={evt.id}>
                    <TableCell
                      className="text-sm text-muted-foreground"
                      title={new Date(evt.created_at).toLocaleString('pt-BR')}
                    >
                      {timeAgo}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon size={14} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">{meta.label}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {evt.actor_name ?? evt.actor_email ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-dim-foreground">{desc || '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <ul className="flex flex-col md:hidden">
            {rows.map(({ evt, meta, desc, timeAgo }) => {
              const Icon = ICON_MAP[meta.icon] ?? Activity;
              return (
                <li
                  key={evt.id}
                  className="flex items-start gap-3 border-b border-border/50 px-5 py-2.5 last:border-0"
                >
                  <Icon size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{meta.label}</span>
                      <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                        {timeAgo}
                      </span>
                    </div>
                    {(evt.actor_name || evt.actor_email) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {evt.actor_name ?? evt.actor_email}
                      </p>
                    )}
                    {desc && <p className="truncate text-xs text-dim-foreground">{desc}</p>}
                  </div>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-5 py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                <ChevronLeft />
                Anterior
              </Button>
              <span className="text-xs text-muted-foreground">
                {page + 1} de {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Próximo
                <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
