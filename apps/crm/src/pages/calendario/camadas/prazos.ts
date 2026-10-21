import type { Cliente, Workflow, WorkflowEtapa } from '../../../store';

/** Deadline of the active stage of an active workflow (the "Calendário" tab's
 *  pills and the Agenda's "Prazos de entrega" layer). */
export interface DeadlineEvent {
  workflowId: number;
  workflowTitle: string;
  etapaNome: string;
  clienteId: number | null;
  clienteNome: string;
  clienteCor: string;
  deadlineDate: Date;
  diasRestantes: number;
  estourado: boolean;
}

const DIA_MS = 1000 * 60 * 60 * 24;

/** `iniciado_em` plus `prazo_dias`, counting only Monday-Friday for `uteis`. */
export function calcularDataLimite(
  etapa: Pick<WorkflowEtapa, 'iniciado_em' | 'prazo_dias' | 'tipo_prazo'>,
): Date {
  const deadlineDate = new Date(etapa.iniciado_em!);
  if (etapa.tipo_prazo === 'uteis') {
    let added = 0;
    while (added < etapa.prazo_dias) {
      deadlineDate.setDate(deadlineDate.getDate() + 1);
      const dow = deadlineDate.getDay();
      if (dow !== 0 && dow !== 6) added++;
    }
  } else {
    deadlineDate.setDate(deadlineDate.getDate() + etapa.prazo_dias);
  }
  return deadlineDate;
}

/** Whole days from `agora` to the deadline, rounded up (negative = overdue). */
export function diasAte(deadlineDate: Date, agora: Date): number {
  return Math.ceil((deadlineDate.getTime() - agora.getTime()) / DIA_MS);
}

/**
 * One deadline per active workflow whose active stage has started. Same result
 * the "Calendário" tab computed inline before; `agora` is the render time, so the
 * remaining days never freeze at fetch time.
 */
export function calcularPrazos(
  workflows: Workflow[],
  etapasPorWorkflow: Map<number, WorkflowEtapa[]>,
  clientes: Cliente[],
  agora: Date = new Date(),
): DeadlineEvent[] {
  const events: DeadlineEvent[] = [];
  workflows
    .filter((w) => w.status === 'ativo')
    .forEach((w) => {
      const etapas = etapasPorWorkflow.get(w.id!) ?? [];
      const activeEtapa = etapas.find((e) => e.status === 'ativo');
      if (!activeEtapa || !activeEtapa.iniciado_em) return;
      const cliente = clientes.find((c) => c.id === w.cliente_id);
      const deadlineDate = calcularDataLimite(activeEtapa);
      const diasRestantes = diasAte(deadlineDate, agora);
      events.push({
        workflowId: w.id!,
        workflowTitle: w.titulo,
        etapaNome: activeEtapa.nome,
        clienteId: cliente?.id ?? null,
        clienteNome: cliente?.nome || '—',
        clienteCor: cliente?.cor || '#888',
        deadlineDate,
        diasRestantes,
        estourado: diasRestantes < 0,
      });
    });
  return events;
}

/** Ids of the workflows whose stages the deadline query must load. */
export function workflowsAtivosIds(workflows: Workflow[]): number[] {
  return workflows.filter((w) => w.status === 'ativo').map((w) => w.id!);
}
