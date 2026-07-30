import { useEffect, useState } from 'react';
import type { TarefaWithRelations } from '../../../store';

/**
 * Optimistic per-task field overrides for drag-and-drop. Overrides apply on top
 * of the incoming list and are wiped whenever fresh data arrives (each refetch
 * produces a new array identity), so server truth always wins in the end.
 * On a failed mutation the caller clears the override immediately (rollback).
 */
export function useOptimisticTarefas(tarefas: TarefaWithRelations[]) {
  const [overrides, setOverrides] = useState<Map<number, Partial<TarefaWithRelations>>>(new Map());

  useEffect(() => {
    setOverrides(new Map());
  }, [tarefas]);

  const merged =
    overrides.size === 0
      ? tarefas
      : tarefas.map((t) => {
          const o = t.id != null ? overrides.get(t.id) : undefined;
          return o ? { ...t, ...o } : t;
        });

  const applyOverride = (id: number, patch: Partial<TarefaWithRelations>) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id), ...patch });
      return next;
    });
  };

  const clearOverride = (id: number) => {
    setOverrides((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  return { merged, applyOverride, clearOverride };
}
