/**
 * O quadro de exemplo (e o tour que ele ancora) só faz sentido num quadro de
 * Fluxos sem NENHUMA entidade ativa. `activeBoardCount` conta as entidades
 * ativas do quadro: hoje só fluxos ativos (um fluxo sem etapas conta e não
 * renderiza card, comportamento herdado). A feature de posts individuais soma
 * os processos ativos em `activeBoardCount`, em `EntregasPage`, e em nenhum
 * outro lugar.
 */
export function shouldShowExample(i: {
  activeBoardCount: number;
  tourDone: boolean;
  replayActive: boolean;
}): boolean {
  return i.activeBoardCount === 0 && (!i.tourDone || i.replayActive);
}
