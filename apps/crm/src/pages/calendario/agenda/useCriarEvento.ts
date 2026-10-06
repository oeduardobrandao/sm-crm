import { useCallback, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AGENDA_QUERY_KEY, criarEvento, formatAgendaError } from '@/store/agenda';
import { toDateOnlyString } from '../../tarefas/tarefasLogic';
import { fusoDoNavegador } from './agendaLogic';
import { montarPayload, rotuloDtstart, type EventoFormValues } from './eventoFormSchema';

/** Create from form values (quick card or full form): the browser's tz, the
 *  shared toasts, and `onCriado` once the agenda queries are invalidated.
 *  `criar` ignores calls while one is in flight (a second Enter would otherwise
 *  create the event twice: `isPending` lags a render behind). */
export function useCriarEvento({ onCriado }: { onCriado: () => void }) {
  const qc = useQueryClient();
  const emVoo = useRef(false);
  const mutation = useMutation({
    mutationFn: (valores: EventoFormValues) =>
      criarEvento({ ...montarPayload(valores), tz: fusoDoNavegador() }, valores.participantes),
    // Awaited so the caller closes once the new event is on the grid (the quick
    // card's draft chip would otherwise leave the slot empty for a moment).
    onSuccess: async (res, valores) => {
      await qc.invalidateQueries({ queryKey: [AGENDA_QUERY_KEY] });
      toast.success('Evento criado');
      // ocorrencia_id may be null (one-off beyond the horizon); dtstart is always there.
      const dtstart = res?.dtstart ?? null;
      if (dtstart && dtstart.slice(0, 10) !== toDateOnlyString(valores.data_inicio)) {
        toast(`A série começa em ${rotuloDtstart(dtstart)}.`);
      }
      onCriado();
    },
    onError: (err) => toast.error(formatAgendaError(err)),
  });
  const { mutate } = mutation;
  const criar = useCallback(
    (valores: EventoFormValues) => {
      if (emVoo.current) return;
      emVoo.current = true;
      mutate(valores, {
        onSettled: () => {
          emVoo.current = false;
        },
      });
    },
    [mutate],
  );
  return { criar, isPending: mutation.isPending };
}
