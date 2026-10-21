import type { BoardEntity } from './boardEntity';
import type { ReorderFluxosBoardArgs } from '../../store';

/**
 * Ordem manual de uma coluna do quadro de Fluxos.
 *
 * O usuário arrasta sobre a lista VISÍVEL (a página filtra os cards antes de
 * entregá-los ao Kanban), mas `workflows.position` (ou `post_processes.
 * board_position`, mesmo espaço) é gravada para a coluna INTEIRA. Estas
 * funções traduzem um gesto sobre a lista visível numa ordem completa que não
 * pisa nos cards ocultos pelo filtro. Genéricas em `T` porque a coluna pode
 * misturar ids de fluxo (`string` numérica) e de post (`post:<id>`) —
 * ver `BoardSortableId`.
 */

export function mergeVisibleReorder<T>(fullOrder: T[], visibleReordered: T[]): T[] {
  const full = new Set(fullOrder);
  const visible = visibleReordered.filter((id) => full.has(id));
  const visibleSet = new Set(visible);
  let next = 0;
  return fullOrder.map((id) => (visibleSet.has(id) ? visible[next++] : id));
}

export function insertIntoFullOrder<T>(
  fullOrder: T[],
  visibleOrder: T[],
  slotIndex: number,
  movedId: T,
): T[] {
  const base = fullOrder.filter((id) => id !== movedId);
  // Quando o slot cai depois do ultimo card visivel, anchor fica undefined e o
  // card movido vai para o FIM da coluna INTEIRA — depois de quaisquer cards
  // ocultos que porventura fechem a lista, nao so depois do ultimo visivel.
  const anchor = visibleOrder.filter((id) => id !== movedId)[slotIndex];
  const at = anchor === undefined ? base.length : base.indexOf(anchor);
  const out = [...base];
  out.splice(at === -1 ? base.length : at, 0, movedId);
  return out;
}

/** Id que o dnd-kit usa na coluna: fluxo = `String(workflow.id)` (inalterado
 *  desde antes da fase 3), post = o id da entidade (`post:<processId>`). */
export type BoardSortableId = string;

export function sortableIdOf(e: BoardEntity): BoardSortableId {
  return e.kind === 'workflow' ? String(e.card.workflow.id) : e.id;
}

const POST_PREFIX = 'post:';

/**
 * Como persistir a ordem completa de uma coluna (índice = posição). Sem post
 * na coluna, é o caminho que já existia (reorder_workflow_positions); com
 * post, a RPC mista reorder_fluxos_board grava os dois tipos no mesmo espaço
 * (spec §4.2).
 */
export function planColumnPersist(
  orderedIds: BoardSortableId[],
):
  | { kind: 'workflows'; updates: { id: number; position: number }[] }
  | { kind: 'mixed'; args: ReorderFluxosBoardArgs } {
  if (!orderedIds.some((id) => id.startsWith(POST_PREFIX))) {
    return {
      kind: 'workflows',
      updates: orderedIds.map((id, i) => ({ id: Number(id), position: i })),
    };
  }
  const args: ReorderFluxosBoardArgs = {
    workflowIds: [],
    workflowPositions: [],
    processIds: [],
    processPositions: [],
  };
  orderedIds.forEach((id, i) => {
    if (id.startsWith(POST_PREFIX)) {
      args.processIds.push(Number(id.slice(POST_PREFIX.length)));
      args.processPositions.push(i);
    } else {
      args.workflowIds.push(Number(id));
      args.workflowPositions.push(i);
    }
  });
  return { kind: 'mixed', args };
}

/** Posição otimista de um card solto no slot `slotIndex` da lista exibida. */
export function computeCrossColumnSlot(
  targetDisplay: { id: BoardSortableId; posicao: number }[],
  slotIndex: number,
): { beforePos?: number; afterPos?: number; optimisticPos: number } {
  const beforePos = targetDisplay[slotIndex - 1]?.posicao;
  const afterPos = targetDisplay[slotIndex]?.posicao;
  const optimisticPos =
    beforePos != null && afterPos != null
      ? (beforePos + afterPos) / 2
      : afterPos != null
        ? afterPos - 1
        : beforePos != null
          ? beforePos + 1
          : 0;
  return { beforePos, afterPos, optimisticPos };
}
