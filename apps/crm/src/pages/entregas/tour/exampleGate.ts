/**
 * O quadro de exemplo (e o tour que ele ancora) só faz sentido num quadro de
 * Fluxos sem NENHUM card ativo. `activeBoardCount` conta todo tipo de card que
 * o quadro renderiza: hoje só fluxos; a feature de posts individuais soma os
 * processos ativos aqui, e em nenhum outro lugar.
 */
export function shouldShowExample(i: {
  activeBoardCount: number;
  tourDone: boolean;
  replayActive: boolean;
}): boolean {
  return i.activeBoardCount === 0 && (!i.tourDone || i.replayActive);
}
