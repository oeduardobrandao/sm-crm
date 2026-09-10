/**
 * Ordem manual de uma coluna do quadro de Fluxos.
 *
 * O usuário arrasta sobre a lista VISÍVEL (a página filtra os cards antes de
 * entregá-los ao Kanban), mas `workflows.position` é gravada para a coluna
 * INTEIRA. Estas funções traduzem um gesto sobre a lista visível numa ordem
 * completa que não pisa nos cards ocultos pelo filtro.
 */

export function mergeVisibleReorder(fullOrder: number[], visibleReordered: number[]): number[] {
  const full = new Set(fullOrder);
  const visible = visibleReordered.filter((id) => full.has(id));
  const visibleSet = new Set(visible);
  let next = 0;
  return fullOrder.map((id) => (visibleSet.has(id) ? visible[next++] : id));
}

export function insertIntoFullOrder(
  fullOrder: number[],
  visibleOrder: number[],
  slotIndex: number,
  movedId: number,
): number[] {
  const base = fullOrder.filter((id) => id !== movedId);
  const anchor = visibleOrder.filter((id) => id !== movedId)[slotIndex];
  const at = anchor === undefined ? base.length : base.indexOf(anchor);
  const out = [...base];
  out.splice(at === -1 ? base.length : at, 0, movedId);
  return out;
}
