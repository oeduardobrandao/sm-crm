import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getTarefaEventos, getWorkspaceUsers, type Membro } from '../../../store';
import { buildTarefaTimeline, formatTimelinePrazo, type TimelineUser } from '../tarefaTimeline';
import { TarefaHistoryList } from './TarefaHistoryList';

export const tarefaEventosKey = (tarefaId: number) => ['tarefa-eventos', tarefaId] as const;

/**
 * A task's history: loads `tarefa_eventos` when mounted (the sheets mount it only in their
 * history view) plus the workspace users that name actors without a membro row, then the
 * timeline, a skeleton while loading and an error line with retry.
 * No realtime: it is only on screen while the user looks at it. `staleTime: 0` so reopening
 * the view after an edit made elsewhere (the form dialog) refetches.
 */
export function TarefaHistoryPanel({ tarefaId, membros }: { tarefaId: number; membros: Membro[] }) {
  const { t } = useTranslation('tasksForm');
  const query = useQuery({
    queryKey: tarefaEventosKey(tarefaId),
    queryFn: () => getTarefaEventos(tarefaId),
    staleTime: 0,
  });
  // Names actors with no membro row; same key and fetcher as TarefaComentarios.
  const { data: workspaceUsers = [] } = useQuery<TimelineUser[]>({
    queryKey: ['workspace-users'],
    queryFn: getWorkspaceUsers,
  });
  const nodes = useMemo(
    () =>
      query.data
        ? buildTarefaTimeline(query.data, membros, formatTimelinePrazo, workspaceUsers)
        : [],
    [query.data, membros, workspaceUsers],
  );

  if (query.isPending) {
    return (
      <div role="status" aria-label={t('historico.loading')} className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-start gap-3">
            <Skeleton className="h-6 w-6 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p style={{ color: 'var(--danger-text)' }}>{t('historico.loadError')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-0"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('historico.retry')}
        </Button>
      </div>
    );
  }

  return <TarefaHistoryList nodes={nodes} />;
}
