import type { BoardCard } from './hooks/useEntregasData';
import type { PostEntity } from './boardEntity';
import { etapaDeadlineDate, type DeadlineInfo } from './etapaPrazo';

/**
 * Onde um post da aba Publicações está AGORA: a etapa atual do fluxo para um
 * post amarrado, a etapa ativa do processo individual para um avulso que tenha
 * um (spec §4.4). Um avulso sem processo não está em etapa nenhuma.
 *
 * Projeção ÚNICA de propósito: a barra de filtros de Publicações e as células
 * da Lista precisam concordar. Uma coluna que mostra "Mídia · Nathalie · 3d
 * atrasado" enquanto o filtro de responsável ou o de prazo esconde a mesma
 * linha é a inconsistência que esta função existe para impedir.
 */
export interface PostStage {
  etapaNome: string;
  responsavelId: number | null;
  responsavelNome: string;
  deadline: DeadlineInfo;
  /** Data do prazo da etapa, ou null quando a etapa não tem prazo resolvido. */
  prazoDate: Date | null;
  /** false quando a etapa não tem prazo efetivo. `deadline` vem com um fallback
   *  zerado nesse caso (spec §7) e NÃO deve ser lido como "vence em 0h" -- mesma
   *  distinção que ListView faz com hasDeadline. Um card de fluxo sempre tem
   *  prazo (getDeadlineInfo resolve algum), então lá é sempre true. */
  hasPrazo: boolean;
}

/**
 * `card` (fluxo) tem precedência sobre `entity` (processo individual) porque um
 * post amarrado é lido pelo fluxo mesmo que carregue um processo antigo; quem
 * chama passa `entity` só para avulso, do mesmo jeito que a Lista já fazia com
 * a etapa. Devolve undefined quando nenhum dos dois existe -- inclusive para um
 * post amarrado cujo fluxo ainda não foi carregado, que é o comportamento que
 * as células e os filtros já tinham.
 */
export function postStageOf(
  card: BoardCard | undefined,
  entity: PostEntity | undefined,
): PostStage | undefined {
  if (card)
    return {
      etapaNome: card.etapa.nome,
      responsavelId: card.etapa.responsavel_id ?? null,
      responsavelNome: card.membro?.nome ?? '',
      deadline: card.deadline,
      prazoDate: etapaDeadlineDate(card),
      hasPrazo: true,
    };
  if (entity)
    return {
      etapaNome: entity.etapaNome,
      responsavelId: entity.step.responsavel_id ?? null,
      responsavelNome: entity.responsavel?.nome ?? '',
      deadline: entity.deadline,
      prazoDate: entity.prazoEfetivo,
      hasPrazo: entity.prazoEfetivo != null,
    };
  return undefined;
}
