import { useCallback, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  deleteTarefaComentario,
  enviarTarefaComentario,
  getTarefaComentarios,
  updateTarefaComentario,
  type TarefaComentario,
} from '@/store';

/** Realtime topic suffix, unique across every mount (see useDiscussao.ts: realtime-js hands a
 *  still-leaving channel back for a reused topic, and its subscribe() is then a no-op). */
let channelSeq = 0;

export const tarefaComentariosKey = (tarefaId: number) => ['tarefa-comentarios', tarefaId] as const;
const TAREFAS_KEY = ['tarefas'] as const;

export interface UseTarefaComentariosResult {
  comentarios: TarefaComentario[];
  isLoading: boolean;
  /** Rejects when the send fails; the composer keeps the draft. */
  send: (conteudo: string) => Promise<void>;
  sending: boolean;
  update: (id: number, conteudo: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

/**
 * A task's comment thread: the list query, the three mutations (each refreshes the thread and
 * the tasks list, whose cards show the count), a realtime subscription for the open task and a
 * refetch on window focus. DELETEs by others carry no `tarefa_id` under the default replica
 * identity, so they only show up through that focus refetch.
 */
export function useTarefaComentarios(tarefaId: number): UseTarefaComentariosResult {
  const qc = useQueryClient();
  const key = tarefaComentariosKey(tarefaId);

  const query = useQuery({
    queryKey: key,
    queryFn: () => getTarefaComentarios(tarefaId),
  });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: tarefaComentariosKey(tarefaId) });
    void qc.invalidateQueries({ queryKey: TAREFAS_KEY });
  }, [qc, tarefaId]);

  useEffect(() => {
    channelSeq += 1;
    const channel = supabase.channel(`tarefa-comentarios-${tarefaId}-${channelSeq}`).on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'tarefa_comentarios',
        filter: `tarefa_id=eq.${tarefaId}`,
      },
      refresh,
    );
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tarefaId, refresh]);

  // The global staleTime (30 s) keeps refetchOnWindowFocus from refetching, so invalidate.
  useEffect(() => {
    const onFocus = () => {
      void qc.invalidateQueries({ queryKey: tarefaComentariosKey(tarefaId) });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [qc, tarefaId]);

  const sendMutation = useMutation({
    mutationFn: (conteudo: string) => enviarTarefaComentario(tarefaId, conteudo),
    onSuccess: refresh,
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, conteudo }: { id: number; conteudo: string }) =>
      updateTarefaComentario(id, conteudo),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: (id: number) => deleteTarefaComentario(id),
    onSuccess: refresh,
  });

  const { mutateAsync: sendAsync } = sendMutation;
  const { mutateAsync: updateAsync } = updateMutation;
  const { mutateAsync: removeAsync } = removeMutation;

  return {
    comentarios: query.data ?? [],
    isLoading: query.isLoading,
    send: useCallback(
      async (conteudo: string) => {
        await sendAsync(conteudo);
      },
      [sendAsync],
    ),
    sending: sendMutation.isPending,
    update: useCallback(
      async (id: number, conteudo: string) => {
        await updateAsync({ id, conteudo });
      },
      [updateAsync],
    ),
    remove: useCallback(
      async (id: number) => {
        await removeAsync(id);
      },
      [removeAsync],
    ),
  };
}
