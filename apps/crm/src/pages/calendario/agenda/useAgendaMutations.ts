import { createElement, useCallback, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, format } from 'date-fns';
import { toast } from 'sonner';
import {
  AGENDA_QUERY_KEY,
  editarEvento,
  formatAgendaError,
  type AgendaEscopo,
  type AgendaEventoPayload,
  type AgendaOcorrencia,
} from '@/store/agenda';
import { paredeNoFuso } from './agendaLogic';
import { EscopoEventoDialog } from './EscopoEventoDialog';

/** Drag and resize only ever send the new wall-clock range; every other key
 *  keeps its stored value on the RPC side (payload merge rule). */
type MovePayload = Pick<AgendaEventoPayload, 'inicio_local' | 'fim_local'>;

interface MovimentoPendente {
  o: AgendaOcorrencia;
  payload: MovePayload;
  revert: () => void;
}

const dataLocal = (d: Date) => `${format(d, 'yyyy-MM-dd')}T00:00:00`;

/** New range from FullCalendar. Timed: the instants as wall clock in the
 *  series tz. All-day: FC's dates as they are (the end is already exclusive),
 *  never an instant-to-tz conversion; a drop without an end keeps one day. */
function payloadDoMovimento(o: AgendaOcorrencia, novoInicio: Date, novoFim: Date): MovePayload {
  if (o.dia_inteiro) {
    const fim = novoFim > novoInicio ? novoFim : addDays(novoInicio, 1);
    return { inicio_local: dataLocal(novoInicio), fim_local: dataLocal(fim) };
  }
  return {
    inicio_local: paredeNoFuso(novoInicio, o.tz),
    fim_local: paredeNoFuso(novoFim, o.tz),
  };
}

/** The range the occurrence had before the move (for Desfazer). */
function payloadOriginal(o: AgendaOcorrencia): MovePayload {
  if (o.dia_inteiro) {
    return {
      inicio_local: `${o.data_inicio_local}T00:00:00`,
      fim_local: `${o.data_fim_local}T00:00:00`,
    };
  }
  return {
    inicio_local: paredeNoFuso(new Date(o.inicio), o.tz),
    fim_local: paredeNoFuso(new Date(o.fim), o.tz),
  };
}

/** Drag-to-move for the Agenda grid. A single event saves at once with a
 *  "Desfazer" toast; a recurring one asks the scope first through `dialog`,
 *  which the tab renders. Cancel or failure calls FullCalendar's revert(). */
export function useAgendaMutations(): {
  mover: (o: AgendaOcorrencia, novoInicio: Date, novoFim: Date, revert: () => void) => void;
  dialog: ReactNode;
} {
  const qc = useQueryClient();
  const [pendente, setPendente] = useState<MovimentoPendente | null>(null);
  const [salvando, setSalvando] = useState(false);

  const invalidar = useCallback(() => qc.invalidateQueries({ queryKey: [AGENDA_QUERY_KEY] }), [qc]);

  const mover = useCallback(
    (o: AgendaOcorrencia, novoInicio: Date, novoFim: Date, revert: () => void) => {
      const payload = payloadDoMovimento(o, novoInicio, novoFim);
      if (o.recorrente) {
        setPendente({ o, payload, revert });
        return;
      }
      editarEvento(o.ocorrencia_id, 'todas', payload, null)
        .then((novoId) => {
          void invalidar();
          toast('Evento movido', {
            action: {
              label: 'Desfazer',
              onClick: () => {
                // The RPC may regenerate the row on a date move: undo the id it returned.
                editarEvento(novoId, 'todas', payloadOriginal(o), null)
                  .then(() => invalidar())
                  .catch((err: unknown) => toast.error(formatAgendaError(err)));
              },
            },
          });
        })
        .catch((err: unknown) => {
          revert();
          toast.error(formatAgendaError(err));
        });
    },
    [invalidar],
  );

  const confirmar = (escopo: AgendaEscopo) => {
    if (!pendente) return;
    const { o, payload, revert } = pendente;
    setSalvando(true);
    editarEvento(o.ocorrencia_id, escopo, payload, null)
      .then(() => {
        void invalidar();
        toast('Evento movido');
      })
      .catch((err: unknown) => {
        revert();
        toast.error(formatAgendaError(err));
      })
      .finally(() => {
        setSalvando(false);
        setPendente(null);
      });
  };

  const cancelar = () => {
    if (!pendente || salvando) return;
    pendente.revert();
    setPendente(null);
  };

  const dialog = pendente
    ? createElement(EscopoEventoDialog, {
        open: true,
        acao: 'editar',
        // A time move is not a series-level change, so "Este evento" is allowed.
        esteDesabilitado: false,
        pendente: salvando,
        onCancel: cancelar,
        onConfirm: confirmar,
      })
    : null;

  return { mover, dialog };
}
