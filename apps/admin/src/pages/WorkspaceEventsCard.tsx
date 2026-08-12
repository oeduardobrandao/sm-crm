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

  return (
    <div className="min-w-0 bg-card border border-border rounded-2xl p-5 mt-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-semibold">Event History ({total})</h2>
        <select
          value={filterType}
          onChange={(e) => {
            setFilterType(e.target.value);
            setPage(0);
          }}
          className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
        >
          <option value="">All events</option>
          {FILTERABLE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-dim-foreground py-4">Loading...</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-dim-foreground py-4">No events found.</p>
      ) : (
        <>
          {/* Desktop header */}
          <div className="hidden md:grid grid-cols-[1fr_1.4fr_1.2fr_1.4fr] gap-2 text-[0.7rem] text-muted-foreground uppercase tracking-wider pb-3 border-b border-border">
            <span>When</span>
            <span>Event</span>
            <span>Actor</span>
            <span>Details</span>
          </div>

          {events.map((evt) => {
            const meta = eventMeta(evt.action);
            const Icon = ICON_MAP[meta.icon] ?? Activity;
            const desc = eventDescription(evt);
            const timeAgo = formatDistanceToNow(new Date(evt.created_at), {
              addSuffix: true,
              locale: ptBR,
            });

            return (
              <div key={evt.id} className="border-b border-border/50 py-2.5">
                {/* Mobile card */}
                <div className="flex items-start gap-3 md:hidden">
                  <Icon size={16} className="shrink-0 mt-0.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{meta.label}</span>
                      <span className="shrink-0 text-[0.7rem] text-muted-foreground">
                        {timeAgo}
                      </span>
                    </div>
                    {(evt.actor_name || evt.actor_email) && (
                      <p className="text-xs text-muted-foreground truncate">
                        {evt.actor_name ?? evt.actor_email}
                      </p>
                    )}
                    {desc && <p className="text-xs text-dim-foreground truncate">{desc}</p>}
                  </div>
                </div>

                {/* Desktop row */}
                <div className="hidden md:grid grid-cols-[1fr_1.4fr_1.2fr_1.4fr] gap-2 items-center">
                  <span
                    className="text-sm text-muted-foreground truncate"
                    title={new Date(evt.created_at).toLocaleString('pt-BR')}
                  >
                    {timeAgo}
                  </span>
                  <span className="flex items-center gap-2 text-sm min-w-0">
                    <Icon size={14} className="shrink-0 text-muted-foreground" />
                    <span className="truncate">{meta.label}</span>
                  </span>
                  <span className="text-sm text-muted-foreground truncate">
                    {evt.actor_name ?? evt.actor_email ?? '—'}
                  </span>
                  <span className="text-sm text-dim-foreground truncate">{desc || '—'}</span>
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-xs text-muted-foreground">
                {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
