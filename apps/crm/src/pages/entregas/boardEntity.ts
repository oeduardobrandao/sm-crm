import type { BoardCard } from './hooks/useEntregasData';
import type { Cliente, Membro, PostMedia, PostProcessStep, PostProcessWithPost } from '../../store';
import {
  deadlineFromPrazoEfetivo,
  etapaDeadlineDate,
  etapaDeadlineDateOf,
  type DeadlineInfo,
} from './etapaPrazo';

/**
 * A entidade do quadro de Fluxos (spec §8.3): união discriminada entre um card
 * de fluxo (a forma que já existia, BoardCard) e um processo individual de
 * post. Nunca preencher um Workflow falso para renderizar um post: o Kanban, a
 * Lista, o agrupamento em linhas e a ordenação mista leem só a projeção comum
 * abaixo; o que é específico fica em `card` ou em `process`/`step`.
 */
export interface StageStep {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
}

interface BoardEntityBase {
  templateId: number | null;
  /** Sequência completa de etapas, ordenada por `ordem`. */
  steps: StageStep[];
  etapaOrdem: number;
  etapaNome: string;
  responsavel: Membro | undefined;
  /** Prazo da etapa ativa pela única função de prazo (etapaDeadlineDateOf). */
  prazoEfetivo: Date | null;
  /** workflows.position ou post_processes.board_position (mesmo espaço). */
  posicao: number;
  deadline: DeadlineInfo;
  cliente: Cliente | undefined;
  titulo: string;
}

export interface WorkflowEntity extends BoardEntityBase {
  kind: 'workflow';
  id: `workflow:${number}`;
  card: BoardCard;
}

export interface PostEntity extends BoardEntityBase {
  kind: 'post';
  id: `post:${number}`;
  process: PostProcessWithPost;
  /** Etapa ativa do processo. */
  step: PostProcessStep;
  clienteAvatarUrl?: string;
  cover?: PostMedia;
}

export type BoardEntity = WorkflowEntity | PostEntity;

export const isWorkflowEntity = (e: BoardEntity): e is WorkflowEntity => e.kind === 'workflow';
export const isPostEntity = (e: BoardEntity): e is PostEntity => e.kind === 'post';

export function entityNumericId(e: BoardEntity): number {
  return e.kind === 'workflow' ? e.card.workflow.id! : e.process.id;
}

/** Assinatura ordenada das etapas (ordem, nome, tipo) para a identidade de
 *  linha (spec §4.1). Separadores imprimíveis: vive em chaves de coluna, ids
 *  de droppable e localStorage. Não é o formato de post_processes.assinatura. */
export function stageSignature(steps: readonly StageStep[]): string {
  return [...steps]
    .sort((a, b) => a.ordem - b.ordem)
    .map((s) => `${s.ordem}|${s.nome}|${s.tipo}`)
    .join(';');
}

export function toWorkflowEntity(card: BoardCard): WorkflowEntity {
  const steps: StageStep[] = [...card.allEtapas]
    .sort((a, b) => a.ordem - b.ordem)
    .map((e) => ({ ordem: e.ordem, nome: e.nome, tipo: e.tipo ?? 'padrao' }));
  return {
    kind: 'workflow',
    id: `workflow:${card.workflow.id!}`,
    card,
    templateId: card.workflow.template_id ?? null,
    steps,
    etapaOrdem: card.etapa.ordem,
    etapaNome: card.etapa.nome,
    responsavel: card.membro,
    prazoEfetivo: etapaDeadlineDate(card),
    posicao: card.workflow.position ?? 0,
    deadline: card.deadline,
    cliente: card.cliente,
    titulo: card.workflow.titulo,
  };
}

export function toWorkflowEntities(cards: BoardCard[]): WorkflowEntity[] {
  return cards.map(toWorkflowEntity);
}

export interface PostEntityContext {
  clientes: Cliente[];
  membros: Membro[];
  clienteAvatars?: Map<number, string>;
  covers?: Map<number, PostMedia>;
}

export function toPostEntity(
  process: PostProcessWithPost,
  ctx: PostEntityContext,
): PostEntity | null {
  const steps = [...process.steps].sort((a, b) => a.ordem - b.ordem);
  const step =
    steps.find((s) => s.estado === 'ativo') ?? steps.find((s) => s.ordem === process.etapa_atual);
  if (!step) return null;
  const clienteId = process.post.cliente_id;
  return {
    kind: 'post',
    id: `post:${process.id}`,
    process,
    step,
    templateId: process.template_id,
    steps: steps.map((s) => ({ ordem: s.ordem, nome: s.nome, tipo: s.tipo })),
    etapaOrdem: step.ordem,
    etapaNome: step.nome,
    responsavel:
      step.responsavel_id != null
        ? ctx.membros.find((m) => m.id === step.responsavel_id)
        : undefined,
    prazoEfetivo: etapaDeadlineDateOf({
      prazo_efetivo: step.prazo_efetivo,
      data_limite: null,
      iniciado_em: step.iniciado_em,
      prazo_dias: step.prazo_dias,
      tipo_prazo: step.tipo_prazo,
    }),
    posicao: process.board_position,
    deadline: deadlineFromPrazoEfetivo(step.prazo_efetivo, step.prazo_dias),
    cliente: clienteId != null ? ctx.clientes.find((c) => c.id === clienteId) : undefined,
    titulo: process.post.titulo,
    clienteAvatarUrl: clienteId != null ? ctx.clienteAvatars?.get(clienteId) : undefined,
    cover: ctx.covers?.get(process.post_id),
  };
}

/** Prazo mais curto primeiro, sem prazo por último; empate mantém a ordem
 *  manual (posicao). Para entrada só de fluxos dá o mesmo que sortCardsByPrazo. */
export function sortEntitiesByPrazo(entities: BoardEntity[]): BoardEntity[] {
  return [...entities].sort((a, b) => {
    const ad = a.prazoEfetivo?.getTime() ?? Infinity;
    const bd = b.prazoEfetivo?.getTime() ?? Infinity;
    if (ad !== bd) return ad - bd;
    return a.posicao - b.posicao;
  });
}

/** Ordem manual mista (spec §4.2): valor numérico dos dois campos, desempate por id. */
export function sortEntitiesByPosicao(entities: BoardEntity[]): BoardEntity[] {
  return [...entities].sort(
    (a, b) => a.posicao - b.posicao || entityNumericId(a) - entityNumericId(b),
  );
}
