import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getTarefas,
  getTarefaTags,
  getMembros,
  getClientes,
  type TarefaWithRelations,
  type TarefaTag,
  type Membro,
  type Cliente,
} from '../../../store';

export interface TarefasData {
  tarefas: TarefaWithRelations[];
  tags: TarefaTag[];
  membros: Membro[];
  clientes: Cliente[];
  isLoading: boolean;
  refresh: () => void;
}

/** All queries the Tarefas page needs, plus a single refresh() that
 * invalidates every tarefa-related key (useEntregasData pattern). */
export function useTarefasData(): TarefasData {
  const queryClient = useQueryClient();

  const tarefasQuery = useQuery({ queryKey: ['tarefas'], queryFn: getTarefas });
  const tagsQuery = useQuery({ queryKey: ['tarefa-tags'], queryFn: getTarefaTags });
  const membrosQuery = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const clientesQuery = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['tarefas'] });
    queryClient.invalidateQueries({ queryKey: ['tarefa-tags'] });
  }, [queryClient]);

  return {
    tarefas: tarefasQuery.data ?? [],
    tags: tagsQuery.data ?? [],
    membros: membrosQuery.data ?? [],
    clientes: clientesQuery.data ?? [],
    isLoading: tarefasQuery.isLoading || membrosQuery.isLoading,
    refresh,
  };
}
