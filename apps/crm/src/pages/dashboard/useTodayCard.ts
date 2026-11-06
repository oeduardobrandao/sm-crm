import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { useDateFnsLocale } from '@mesaas/i18n';
import { updateTarefa, type TarefaStatus, type TarefaWithRelations } from '../../store';
import { useTodayAgenda } from './useTodayAgenda';
import type { AgendaBucket } from './todayAgenda';

export const TODAY_MAX_ROWS = 8;
export const TODAY_PAGE_ROWS = 20;

interface CompleteVars {
  id: number;
  previousStatus: TarefaStatus;
}

/**
 * State behind the dashboard "Hoje" card, shared by the desktop card and the phone
 * screen: the agenda buckets, which buckets are shown, the per-bucket row limits, the
 * summary line and the inline "concluir tarefa" mutation with its undo toast.
 */
export function useTodayCard() {
  const { t } = useTranslation('dashboard');
  const dateLocale = useDateFnsLocale();
  const queryClient = useQueryClient();
  const { status, scope, buckets, now, membroId } = useTodayAgenda();
  const [visible, setVisible] = useState<Set<AgendaBucket>>(
    () => new Set<AgendaBucket>(['atrasado', 'hoje']),
  );
  // Rows shown per bucket beyond the initial cap; expands in place, never navigates.
  const [limits, setLimits] = useState<Record<AgendaBucket, number>>({
    atrasado: TODAY_MAX_ROWS,
    hoje: TODAY_MAX_ROWS,
    proximos: TODAY_MAX_ROWS,
  });
  const showMore = (b: AgendaBucket) =>
    setLimits((prev) => ({ ...prev, [b]: prev[b] + TODAY_PAGE_ROWS }));
  const showLess = (b: AgendaBucket) => setLimits((prev) => ({ ...prev, [b]: TODAY_MAX_ROWS }));

  const undo = useMutation({
    mutationFn: ({ id, status }: { id: number; status: TarefaStatus }) =>
      updateTarefa(id, { status }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas'] });
    },
  });

  const complete = useMutation({
    mutationFn: ({ id }: CompleteVars) => updateTarefa(id, { status: 'concluida' }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: ['tarefas'] });
      const previous = queryClient.getQueryData<TarefaWithRelations[]>(['tarefas']);
      queryClient.setQueryData<TarefaWithRelations[]>(['tarefas'], (old) =>
        (old ?? []).map((task) => (task.id === id ? { ...task, status: 'concluida' } : task)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(['tarefas'], ctx.previous);
      toast.error(t('today.taskDoneError', 'Não foi possível concluir a tarefa.'));
    },
    onSuccess: (_data, { id, previousStatus }) => {
      toast.success(t('today.taskDone', 'Tarefa concluída'), {
        action: {
          label: t('today.taskDoneUndo', 'Desfazer'),
          onClick: () => undo.mutate({ id, status: previousStatus }),
        },
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tarefas'] });
    },
  });

  const toggle = (b: AgendaBucket) =>
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });

  const counts = {
    atrasado: buckets.atrasado.length,
    hoje: buckets.hoje.length,
    proximos: buckets.proximos.length,
  };
  const total = counts.atrasado + counts.hoje + counts.proximos;

  const dateLabel = format(now, t('dateFormat.weekdayDayMonth'), { locale: dateLocale });
  const summary = [
    dateLabel.charAt(0).toUpperCase() + dateLabel.slice(1),
    t('today.summary', { overdue: counts.atrasado, today: counts.hoje }),
    scope === 'mine' ? t('today.mine', 'atribuídos a você') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    t,
    status,
    scope,
    membroId,
    now,
    buckets,
    counts,
    total,
    summary,
    visible,
    toggle,
    limits,
    showMore,
    showLess,
    complete,
  };
}
