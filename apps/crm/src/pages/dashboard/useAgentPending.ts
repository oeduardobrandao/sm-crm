import { useQuery } from '@tanstack/react-query';
import { getTarefas, type TarefaWithRelations } from '../../store';
import { useCurrentMembro } from '../../hooks/useCurrentMembro';
import { dueBadge, sortTarefas } from '../tarefas/tarefasLogic';

export const AGENT_PENDING_MAX_ROWS = 8;

/**
 * Agent dashboard data: the open tasks assigned to the logged-in user's membro (desktop
 * card and phone section). Queries are component-local on purpose: DashboardPage's
 * useQueries batch is mocked by index in its test, so nothing may be appended there.
 */
export function useAgentPending() {
  const { membro, isLoading: membroLoading } = useCurrentMembro();
  const membroId = membro?.id ?? null;

  const { data: tarefas = [], isLoading: tarefasLoading } = useQuery({
    queryKey: ['tarefas'],
    queryFn: getTarefas,
    enabled: membroId != null,
  });

  const now = new Date();
  const minhasTarefas = tarefas
    .filter((task) => task.responsavel_id === membroId && task.status !== 'concluida')
    .sort(sortTarefas)
    .slice(0, AGENT_PENDING_MAX_ROWS);
  const nothingPending = !tarefasLoading && minhasTarefas.length === 0;
  const badgeOf = (task: TarefaWithRelations) => dueBadge(task, now);

  return { membro, membroLoading, tarefasLoading, minhasTarefas, nothingPending, badgeOf };
}
