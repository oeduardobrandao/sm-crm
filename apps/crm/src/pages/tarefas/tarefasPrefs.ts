export type TarefasCalendarioModo = 'mes' | 'board';

const calendarioModoKey = (contaId: string) => `tarefas_calendario_modo_${contaId}`;

/** Last Mês/Board mode the user left the Tarefas Calendário tab in, per
 *  conta. Falls back to 'board' on a missing key or any storage failure. */
export function loadTarefasCalendarioModo(contaId: string): TarefasCalendarioModo {
  try {
    return localStorage.getItem(calendarioModoKey(contaId)) === 'mes' ? 'mes' : 'board';
  } catch {
    return 'board';
  }
}

export function persistTarefasCalendarioModo(contaId: string, modo: TarefasCalendarioModo): void {
  try {
    localStorage.setItem(calendarioModoKey(contaId), modo);
  } catch {
    // Private browsing / storage full -- the preference just doesn't survive a reload.
  }
}
