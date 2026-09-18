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

export type TarefasEscopo = 'minhas' | 'todas';

const escopoKey = (contaId: string, userId: string) => `tarefas_escopo_${contaId}_${userId}`;

/** Last Minhas/Todas scope the user left the Tarefas list filtered to, per
 *  conta + user. Falls back to 'todas' (unfiltered) on a missing key or any
 *  storage failure -- the safer default, since it matches pre-toggle behaviour. */
export function loadTarefasEscopo(contaId: string, userId: string): TarefasEscopo {
  try {
    return localStorage.getItem(escopoKey(contaId, userId)) === 'minhas' ? 'minhas' : 'todas';
  } catch {
    return 'todas';
  }
}

export function persistTarefasEscopo(contaId: string, userId: string, escopo: TarefasEscopo): void {
  try {
    localStorage.setItem(escopoKey(contaId, userId), escopo);
  } catch {
    // Private browsing / storage full -- the preference just doesn't survive a reload.
  }
}
