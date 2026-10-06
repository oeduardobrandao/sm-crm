import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AGENDA_QUERY_KEY, criarEvento, formatAgendaError } from '@/store/agenda';
import { toDateOnlyString } from '../../tarefas/tarefasLogic';
import { fusoDoNavegador } from './agendaLogic';
import { montarPayload, rotuloDtstart, type EventoFormValues } from './eventoFormSchema';

/** Create from form values (quick card or full form): the browser's tz, the
 *  shared toasts, and `onCriado` once the agenda queries are invalidated. */
export function useCriarEvento({ onCriado }: { onCriado: () => void }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (valores: EventoFormValues) =>
      criarEvento({ ...montarPayload(valores), tz: fusoDoNavegador() }, valores.participantes),
    onSuccess: (res, valores) => {
      void qc.invalidateQueries({ queryKey: [AGENDA_QUERY_KEY] });
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
}
