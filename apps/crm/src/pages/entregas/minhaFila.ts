import type { ActivePost } from '../../store';
import { ASSIGNEE_PENDING_POST_STATUSES, compareScheduledAtAscNullsLast } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';
import type { PostEntity } from './boardEntity';
import { postStageOf, type PostStage } from './postStage';
import {
  addDays,
  dayDiff,
  dayNum,
  deadlineFromPrazoEfetivo,
  type DeadlineInfo,
} from './etapaPrazo';

// Pure logic for the "Minha fila" view and the dashboard teaser. No React, no
// fetching. Spec: docs/superpowers/specs/2026-09-23-minha-fila-design.md.

/** Seções da fila, na ordem de exibição. Tipo próprio: PrazoPreset (filtro)
 *  é serializado em URL e vistas salvas e tem faixas sobrepostas (proximos7
 *  inclui hoje e amanhã); aqui as faixas são disjuntas. */
export type FilaBucket = 'atrasado' | 'hoje' | 'amanha' | 'proximos7' | 'depois' | 'sem_prazo';

export const FILA_BUCKET_ORDER: FilaBucket[] = [
  'atrasado',
  'hoje',
  'amanha',
  'proximos7',
  'depois',
  'sem_prazo',
];

export const FILA_BUCKET_LABELS: Record<FilaBucket, string> = {
  atrasado: 'Atrasado',
  hoje: 'Hoje',
  amanha: 'Amanhã',
  proximos7: 'Próximos 7 dias',
  depois: 'Depois',
  sem_prazo: 'Sem prazo',
};

export type FilaMargem =
  | { kind: 'sem_margem' | 'dias'; dias: number }
  | { kind: 'sem_data' }
  | { kind: 'sem_prazo' };

/**
 * Bucket exclusivo de uma linha. `estourado` vem da flag (getDeadlineInfo trata
 * data_limite como fim do dia; etapaDeadlineDateOf devolve a meia-noite local
 * do mesmo campo, então comparar prazoDate < now marcaria às 00:01 uma etapa
 * que vence hoje). A comparação por dia local depois disso só existe para o
 * cache velho: deadline congelado num refetch de ontem, prazoDate de ontem.
 */
export function filaBucketOf(
  prazoDate: Date | null,
  deadline: DeadlineInfo,
  now: Date,
): FilaBucket {
  if (deadline.estourado) return 'atrasado';
  if (!prazoDate) return 'sem_prazo';
  const day = dayNum(prazoDate);
  const today = dayNum(now);
  if (day < today) return 'atrasado';
  if (day === today) return 'hoje';
  if (day === dayNum(addDays(now, 1))) return 'amanha';
  if (day <= dayNum(addDays(now, 7))) return 'proximos7';
  return 'depois';
}

/** Dias de calendário locais entre o prazo da etapa e a data de publicação. */
export function margemOf(scheduledAt: string | null, prazoDate: Date | null): FilaMargem {
  if (!prazoDate) return { kind: 'sem_prazo' };
  if (!scheduledAt) return { kind: 'sem_data' };
  const publica = new Date(scheduledAt);
  if (isNaN(publica.getTime())) return { kind: 'sem_data' };
  const dias = dayDiff(publica, prazoDate);
  return dias <= 0 ? { kind: 'sem_margem', dias } : { kind: 'dias', dias };
}

// ── Tipos ───────────────────────────────────────────────────────────────────

export interface FilaItem {
  key: `post:${number}`;
  post: ActivePost;
  /** 'etapa': a etapa ativa em que o post está é minha. 'responsavel': só o
   *  workflow_posts.responsavel_id é meu (num status pendente para a equipe). */
  origem: 'etapa' | 'responsavel';
  /** postStageOf(card, entity); undefined para avulso sem processo. */
  stage: PostStage | undefined;
  /** Card do fluxo quando o post é amarrado (cabeçalho do grupo, onFluxoClick). */
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  /** 'etapa' = prazo da etapa; 'publicacao' = fallback por scheduled_at (origem
   *  'responsavel' sem etapa com prazo); null = sem prazo nenhum. */
  prazoOrigem: 'etapa' | 'publicacao' | null;
  bucket: FilaBucket;
  margem: FilaMargem;
}

export interface FilaGroup {
  key: `fluxo:${number}` | `post:${number}`;
  kind: 'fluxo' | 'post';
  /** Só em kind 'fluxo'. */
  card?: BoardCard;
  prazoDate: Date | null;
  deadline: DeadlineInfo;
  items: FilaItem[];
}

export interface FilaSection {
  bucket: FilaBucket;
  groups: FilaGroup[];
  count: number;
}

export interface ChegandoItem {
  key: `post:${number}`;
  post: ActivePost;
  card: BoardCard | undefined;
  entity: PostEntity | undefined;
  etapaAtual: string;
  /** '' quando a etapa atual não tem responsável. */
  responsavelAtual: string;
  /** prazoDate da etapa ATUAL: quando ela vence, o post chega. */
  chegaDate: Date | null;
  proximaEtapa: string;
}

export interface MinhaFilaInput {
  cards: BoardCard[];
  posts: ActivePost[];
  postEntities: PostEntity[];
}

export interface MinhaFila {
  /** Lista plana na ordem final (seção -> grupo -> filho). */
  items: FilaItem[];
  /** items[0]. */
  top: FilaItem | null;
  /** Sempre as 6, na ordem de FILA_BUCKET_ORDER. */
  sections: FilaSection[];
  chegando: ChegandoItem[];
  counts: { total: number; atrasados: number };
}

/** Estável: a página passa isto enquanto a vista não é a fila. */
export const EMPTY_FILA: MinhaFila = {
  items: [],
  top: null,
  sections: FILA_BUCKET_ORDER.map((bucket) => ({ bucket, groups: [], count: 0 })),
  chegando: [],
  counts: { total: 0, atrasados: 0 },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

const PENDING_FOR_ASSIGNEE = ASSIGNEE_PENDING_POST_STATUSES as readonly string[];

/** Reexporta compareScheduledAtAscNullsLast (store/posts.ts) sob o nome que a
 *  fila usa: scheduled_at asc, nulls por último, id como desempate. Não
 *  duplicar a implementação -- uma única fonte para os dois módulos. */
export const compareScheduledAt = compareScheduledAtAscNullsLast;

/** Só scheduled_at, nulls por último; 0 quando iguais (ou ambos nulos). */
function compareScheduledOnly(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Próxima etapa depois da ativa. Fluxo: primeira com ordem maior, sem olhar
 * status (revertEtapa devolve a etapa que deixa para 'pendente', então tudo
 * depois da ativa é pendente). Processo: primeira pendente com ordem maior
 * (ignorado/herdado ficam antes da ativa; o filtro protege contra estados
 * futuros).
 */
export function nextEtapaOf(
  card: BoardCard | undefined,
  entity: PostEntity | undefined,
): { nome: string; responsavelId: number | null } | null {
  if (card) {
    const next = [...card.allEtapas]
      .sort((a, b) => a.ordem - b.ordem)
      .find((e) => e.ordem > card.etapa.ordem);
    return next ? { nome: next.nome, responsavelId: next.responsavel_id ?? null } : null;
  }
  if (entity) {
    const next = [...entity.process.steps]
      .sort((a, b) => a.ordem - b.ordem)
      .find((s) => s.ordem > entity.step.ordem && s.estado === 'pendente');
    return next ? { nome: next.nome, responsavelId: next.responsavel_id } : null;
  }
  return null;
}

export function nextEtapaResponsavel(
  card: BoardCard | undefined,
  entity: PostEntity | undefined,
): number | null {
  return nextEtapaOf(card, entity)?.responsavelId ?? null;
}

function makeItem(
  post: ActivePost,
  origem: FilaItem['origem'],
  stage: PostStage | undefined,
  card: BoardCard | undefined,
  entity: PostEntity | undefined,
  now: Date,
): FilaItem {
  let prazoDate: Date | null;
  let deadline: DeadlineInfo;
  let prazoOrigem: FilaItem['prazoOrigem'];
  if (stage && stage.prazoDate) {
    prazoDate = stage.prazoDate;
    deadline = stage.deadline;
    prazoOrigem = 'etapa';
  } else if (origem === 'responsavel' && post.scheduled_at) {
    // deadlineFromPrazoEfetivo é a única fábrica de DeadlineInfo a partir de um
    // instante; semântica de instante (publicou-deveria-ter e não publicou).
    prazoDate = new Date(post.scheduled_at);
    deadline = deadlineFromPrazoEfetivo(post.scheduled_at, null, now);
    prazoOrigem = 'publicacao';
  } else {
    prazoDate = null;
    deadline = stage ? stage.deadline : deadlineFromPrazoEfetivo(null, null, now);
    prazoOrigem = null;
  }
  const bucket = filaBucketOf(prazoDate, deadline, now);
  // Prazo = a própria publicação: margem seria zero por definição; chip omitido.
  const margem: FilaMargem =
    prazoOrigem === 'publicacao' ? { kind: 'sem_prazo' } : margemOf(post.scheduled_at, prazoDate);
  return {
    key: `post:${post.id}`,
    post,
    origem,
    stage,
    card,
    entity,
    prazoDate,
    deadline,
    prazoOrigem,
    bucket,
    margem,
  };
}

/** Um post amarrado agrupa pelo fluxo sempre que o prazo NÃO veio do fallback
 *  de publicação (mesmo sem prazo: os posts de um fluxo sem data ficam juntos
 *  em "Sem prazo"). Avulsos, com ou sem processo, ficam soltos. */
function groupKeyOf(item: FilaItem): FilaGroup['key'] {
  return item.card && item.prazoOrigem !== 'publicacao'
    ? `fluxo:${item.card.workflow.id!}`
    : `post:${item.post.id}`;
}

function groupTitle(g: FilaGroup): string {
  return g.card ? g.card.workflow.titulo : g.items[0].post.titulo;
}

/** prazo asc (null último) -> menor scheduled_at dos filhos (já ordenados) ->
 *  título. */
function compareGroups(a: FilaGroup, b: FilaGroup): number {
  const ad = a.prazoDate?.getTime() ?? Infinity;
  const bd = b.prazoDate?.getTime() ?? Infinity;
  if (ad !== bd) return ad - bd;
  const bySched = compareScheduledOnly(a.items[0].post.scheduled_at, b.items[0].post.scheduled_at);
  if (bySched !== 0) return bySched;
  return groupTitle(a).localeCompare(groupTitle(b), 'pt-BR');
}

/** scheduled_at asc (nulls last); sem publicação nos dois, chegaDate asc
 *  (nulls last); depois id. */
function compareChegando(a: ChegandoItem, b: ChegandoItem): number {
  const bySched = compareScheduledOnly(a.post.scheduled_at, b.post.scheduled_at);
  if (bySched !== 0) return bySched;
  const ad = a.chegaDate?.getTime() ?? Infinity;
  const bd = b.chegaDate?.getTime() ?? Infinity;
  if (ad !== bd) return ad - bd;
  return a.post.id - b.post.id;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Um loop sobre os posts (spec § Regras de inclusão): a etapa em que o post
 * está vem de postStageOf exatamente como filteredPosts de EntregasPage a lê
 * (card só para amarrado, entity só para avulso). agendado/postado saem antes
 * de tudo; a regra da etapa vence a do responsável; quem não entrou na fila
 * ainda pode entrar em Chegando pela próxima etapa.
 */
export function buildMinhaFila(input: MinhaFilaInput, membroId: number, now: Date): MinhaFila {
  const cardsByWorkflowId = new Map<number, BoardCard>();
  for (const c of input.cards) if (c.workflow.id != null) cardsByWorkflowId.set(c.workflow.id, c);
  const postEntityByPostId = new Map<number, PostEntity>();
  for (const e of input.postEntities) postEntityByPostId.set(e.process.post_id, e);

  const raw: FilaItem[] = [];
  const chegando: ChegandoItem[] = [];
  for (const post of input.posts) {
    if (post.status === 'agendado' || post.status === 'postado') continue;
    const card = post.workflow_id != null ? cardsByWorkflowId.get(post.workflow_id) : undefined;
    const entity = post.workflow_id == null ? postEntityByPostId.get(post.id) : undefined;
    const stage = postStageOf(card, entity);

    let origem: FilaItem['origem'] | null = null;
    if (stage && stage.responsavelId === membroId) origem = 'etapa';
    else if (post.responsavel_id === membroId && PENDING_FOR_ASSIGNEE.includes(post.status))
      origem = 'responsavel';

    if (origem) {
      raw.push(makeItem(post, origem, stage, card, entity, now));
      continue;
    }
    if (!stage) continue;
    const next = nextEtapaOf(card, entity);
    if (next && next.responsavelId === membroId) {
      chegando.push({
        key: `post:${post.id}`,
        post,
        card,
        entity,
        etapaAtual: stage.etapaNome,
        responsavelAtual: stage.responsavelNome,
        chegaDate: stage.prazoDate,
        proximaEtapa: next.nome,
      });
    }
  }

  const sections: FilaSection[] = FILA_BUCKET_ORDER.map((bucket) => {
    const groups = new Map<FilaGroup['key'], FilaGroup>();
    for (const item of raw) {
      if (item.bucket !== bucket) continue;
      const key = groupKeyOf(item);
      let group = groups.get(key);
      if (!group) {
        const isFluxo = key.startsWith('fluxo:');
        group = {
          key,
          kind: isFluxo ? 'fluxo' : 'post',
          card: isFluxo ? item.card : undefined,
          prazoDate: item.prazoDate,
          deadline: item.deadline,
          items: [],
        };
        groups.set(key, group);
      }
      group.items.push(item);
    }
    const sorted = [...groups.values()];
    for (const g of sorted) g.items.sort((a, b) => compareScheduledAt(a.post, b.post));
    sorted.sort(compareGroups);
    return { bucket, groups: sorted, count: sorted.reduce((n, g) => n + g.items.length, 0) };
  });

  const items = sections.flatMap((s) => s.groups.flatMap((g) => g.items));
  chegando.sort(compareChegando);

  return {
    items,
    top: items[0] ?? null,
    sections,
    chegando,
    counts: {
      total: items.length,
      atrasados: sections[0].count,
    },
  };
}
