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

/** True when the move changes the occurrence's start date in the series tz
 *  (all-day: the start date; resizing only the end keeps it). */
function mudouODia(o: AgendaOcorrencia, payload: MovePayload): boolean {
  const diaAtual = o.dia_inteiro
    ? o.data_inicio_local
    : paredeNoFuso(new Date(o.inicio), o.tz).slice(0, 10);
  return payload.inicio_local.slice(0, 10) !== diaAtual;
}

/** Drag-to-move for the Agenda grid. A single event saves at once with a
 *  "Desfazer" toast; a recurring one asks the scope first through `dialog`,
 *  which the tab renders, unless the drag changes the day: that only applies
 *  to this occurrence (the server rejects a date move for the whole series
 *  without a rule). Cancel or failure calls FullCalendar's revert(). */
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
        if (!mudouODia(o, payload)) {
          setPendente({ o, payload, revert });
          return;
        }
        editarEvento(o.ocorrencia_id, 'esta', payload, null)
          .then(() => {
            void invalidar();
            toast('Evento movido. Para mudar o dia de todos, edite o evento.');
          })
          .catch((err: unknown) => {
            revert();
            void invalidar();
            toast.error(formatAgendaError(err));
          });
        return;
      }
      editarEvento(o.ocorrencia_id, 'todas', payload, null)
        .then((novoId) => {
          void invalidar();
          // null: the move pushed the event past the materialization horizon,
          // so there is no occurrence to undo on.
          if (typeof novoId !== 'number') {
            toast('Evento movido');
            return;
          }
          toast('Evento movido', {
            action: {
              label: 'Desfazer',
              onClick: () => {
                // The RPC may regenerate the row on a date move: undo the id it returned.
                editarEvento(novoId, 'todas', payloadOriginal(o), null)
                  .then(() => invalidar())
                  .catch((err: unknown) => {
                    void invalidar();
                    toast.error(formatAgendaError(err));
                  });
              },
            },
          });
        })
        .catch((err: unknown) => {
          revert();
          // The row may be stale or gone: refetch whatever the error was.
          void invalidar();
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
        void invalidar();
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
