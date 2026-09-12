import { Fragment, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpDown, Check, GripVertical, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { sortCardsByPrazo } from '../etapaPrazo';
import {
  loadFluxosColumnSorts,
  persistFluxosColumnSort,
  type FluxosColumnSort,
} from '../entregasPrefs';
import { toast } from 'sonner';
import {
  hasLaterApprovalEtapa,
  revertEtapa,
  updateWorkflowPositions,
  reorderFluxosBoard,
  approvePostsInternally,
  sendPostsToCliente,
} from '../../../store';
import { completeEtapaForAdvance, notifyRearmOutcome } from '../advanceEtapa';
import { decideApprovalAdvance } from '../approvalAdvance';
import {
  buildBoardRows,
  columnKey,
  parseColumnKey,
  findCardColumn,
  isValidDropTarget,
} from '../boardRows';
import type { BoardRow, BoardColumn } from '../boardRows';
import {
  toWorkflowEntity,
  toWorkflowEntities,
  sortEntitiesByPrazo,
  sortEntitiesByPosicao,
  derivePostStepFields,
  type BoardEntity,
  type PostEntity,
} from '../boardEntity';
import {
  mergeVisibleReorder,
  insertIntoFullOrder,
  planColumnPersist,
  computeCrossColumnSlot,
  sortableIdOf,
  type BoardSortableId,
} from '../boardReorder';
import { getPostProcessErrorToast } from '../postProcessErrors';
import type { BoardCard } from '../hooks/useEntregasData';
import type { Membro, WorkflowEtapa, WorkflowTemplate } from '../../../store';
import { WorkflowCard } from '../components/WorkflowCard';
import { PostProcessCard } from '../components/PostProcessCard';
import { ExampleBoard } from '../components/ExampleBoard';
import {
  RevertConfirmDialog,
  ForwardConfirmDialog,
  ClientApprovalChoiceDialog,
} from '../components/WorkflowModals';
import {
  previousStepOf,
  nextPendingStepOf,
  forwardLabelFor,
  canConcluir,
  type ProcessTarget,
} from '../postProcessCommands';
import { usePostProcessCommands } from '../hooks/usePostProcessCommands';

interface KanbanViewBaseProps {
  /** Persistencia das prefs de ordenacao por coluna; opcional para os testes. */
  contaId?: string;
  cards: BoardCard[];
  /** Todos os cards ativos, sem o filtro da página. A ordem manual é gravada
   *  para a coluna inteira; sem esta prop, a coluna inteira é a lista visível
   *  (comportamento antigo). */
  allCards?: BoardCard[];
  onCardClick: (card: BoardCard) => void;
  onEditClick: (card: BoardCard) => void;
  onPostsClick: (card: BoardCard) => void;
  onRefresh: () => void;
  onRecurring: (workflowId: number) => void;
  /** Kebab "Excluir" do card de fluxo. Sem esta prop o item some (mesmo gate
   *  de onDeleteClick que WorkflowCard já usa). */
  onDeleteWorkflowClick?: (card: BoardCard) => void;
  /** Kebab "Excluir post" do card de post individual. */
  onDeletePostClick?: (entity: PostEntity) => void;
  /** Quick-add: opens the new-workflow wizard preloaded with the row's template. */
  onAddWorkflow?: (templateId: number | null) => void;
  /** Opens the existing "Gerenciar Templates" modal from the board's trailing "+" tab. */
  onCreateTemplate?: () => void;
  /** True when the workspace is at its plan's max_workflow_templates limit — the "+"
   *  tab renders disabled with a tooltip instead of calling onCreateTemplate. */
  createTemplateDisabled?: boolean;
  /** Quick-add: opens NewAvulsoDialog pre-linked to the row's template (spec §3
   *  "+ Novo ▾"). Only offered when the row has a template AND
   *  `postProcessesEnabled`; otherwise the trigger stays a plain button that
   *  only calls `onAddWorkflow`. */
  onAddPostIndividual?: (templateId: number) => void;
  membros: Membro[];
  templates: WorkflowTemplate[];
  postsCounts: Map<number, number>;
  approvedPostsCounts: Map<number, number>;
  clearedClienteCounts: Map<number, number>;
  revisaoInternaCounts: Map<number, number>;
  awaitingClienteCounts: Map<number, number>;
  /** Processos individuais ativos, já filtrados pela página (fase 3: só
   *  leitura; sem drag, sem botões). Ausente = quadro só de fluxos. */
  postEntities?: PostEntity[];
  /** Todos os processos ativos, sem o filtro da página (espelho de allCards):
   *  a ordem manual é gravada para a coluna INTEIRA. */
  allPostEntities?: PostEntity[];
  /** features?.feature_post_processes === true. Liga a chave de linha por
   *  assinatura (spec §4.1) e a cópia do estado vazio. */
  postProcessesEnabled?: boolean;
  onPostClick?: (entity: PostEntity) => void;
}

// Discriminated union: a caller either passes neither prop, or passes both together.
// The populated branch takes `showExample: boolean` (not the literal `true`) so callers
// can hand it a computed boolean expression while still being forced to supply
// `onDismissExample` — the example board can never render without a working dismiss.
type KanbanViewProps = KanbanViewBaseProps &
  (
    | { showExample?: false; onDismissExample?: () => void }
    | { showExample: boolean; onDismissExample: () => void }
  );

function rowCardCount(row: BoardRow): number {
  return row.columns.reduce((sum, col) => sum + col.cards.length + col.posts.length, 0);
}

// Etapas are fully user-defined, so their color is keyed to the etapa NAME
// (stable hash, same recipe as avatarColorClass): "Copy" is the same color in
// every template and across sessions, with no positional meaning. The palette
// is deliberately disjoint from the fixed status colors of the Publicações
// board (sky/indigo/violet/pink/greens/orange/gold/red) so an etapa column is
// never mistaken for a status column.
const COLUMN_TINTS = ['#0d9488', '#155e75', '#c026d3', '#4d7c0f', '#475569'];

function columnTint(stepName: string): string {
  let hash = 0;
  for (let i = 0; i < stepName.length; i++) hash = (hash * 31 + stepName.charCodeAt(i)) >>> 0;
  return COLUMN_TINTS[hash % COLUMN_TINTS.length];
}

// Ordem da coluna INTEIRA (rowKey, ordem) na ordem exibida (prazo ou position),
// incluindo cards ocultos pelo filtro da página. Sem allCards cai na lista
// visível recebida (comportamento antigo, usado pelos testes e por callers
// que não passam a prop).
export function fullColumnOrder(
  allCards: BoardCard[] | undefined,
  visibleColumnCards: BoardCard[],
  rowKey: string,
  ordem: number,
  templates: WorkflowTemplate[],
  sortMode: FluxosColumnSort,
  signatureRows = false,
): number[] {
  const source = allCards
    ? (buildBoardRows(toWorkflowEntities(allCards), templates, { signatureRows })
        .find((r) => r.key === rowKey)
        ?.columns.find((c) => c.ordem === ordem)?.cards ?? visibleColumnCards)
    : visibleColumnCards;
  const ordered = sortMode === 'prazo' ? sortCardsByPrazo(source) : source;
  return ordered.map((c) => c.workflow.id!);
}

// Mesma ideia que fullColumnOrder, mas para a coluna MISTA (fluxos + posts,
// spec §4.2): índice = posição no espaço único que reorder_fluxos_board grava.
// Sem post em lugar nenhum (nem allPosts, nem a coluna visível) é exatamente
// fullColumnOrder, byte a byte — o caminho da fase 3 nunca muda de forma.
export function fullMixedColumnOrder(
  allCards: BoardCard[] | undefined,
  allPosts: PostEntity[] | undefined,
  visibleColumnCards: BoardCard[],
  visibleColumnPosts: PostEntity[],
  rowKey: string,
  ordem: number,
  templates: WorkflowTemplate[],
  sortMode: FluxosColumnSort,
  signatureRows = false,
): BoardSortableId[] {
  const entities: BoardEntity[] = [
    ...toWorkflowEntities(allCards ?? visibleColumnCards),
    ...(allPosts ?? visibleColumnPosts),
  ];
  const column = buildBoardRows(entities, templates, { signatureRows })
    .find((r) => r.key === rowKey)
    ?.columns.find((c) => c.ordem === ordem);
  // Guarda POR COLUNA (não pelo quadro inteiro): existir post em outra
  // linha/coluna não pode empurrar esta coluna para o branch misto — o
  // desempate de sortEntitiesByPosicao (id numérico) diverge do desempate de
  // fullColumnOrder (ordem de inserção) quando duas etapas empatam em
  // position, que é o estado DEFAULT de toda coluna nunca arrastada
  // manualmente (workflows.position NOT NULL DEFAULT 0).
  if ((column?.posts.length ?? visibleColumnPosts.length) === 0) {
    return fullColumnOrder(
      allCards,
      visibleColumnCards,
      rowKey,
      ordem,
      templates,
      sortMode,
      signatureRows,
    ).map(String);
  }
  const source: BoardEntity[] = column
    ? [...toWorkflowEntities(column.cards), ...column.posts]
    : [...toWorkflowEntities(visibleColumnCards), ...visibleColumnPosts];
  const ordered =
    sortMode === 'prazo' ? sortEntitiesByPrazo(source) : sortEntitiesByPosicao(source);
  return ordered.map(sortableIdOf);
}

// Aplica os overlays otimistas (etapa e position pendentes de um drag ainda
// nao refletido pelo refetch) a um card. Compartilhada por localCards (lista
// visivel) e localAllCards (base do fullColumnOrder): sem isso, um segundo
// drag antes do primeiro onRefresh() reconstruiria a coluna inteira a partir
// dos cards sem overlay e reverteria as posicoes ja persistidas dos ocultos.
function applyOverlays(
  card: BoardCard,
  pendingEtapas: Map<number, WorkflowEtapa>,
  pendingPositions: Map<number, number>,
): BoardCard {
  let out = card;
  const pe = pendingEtapas.get(card.workflow.id!);
  if (pe && pe.id !== card.etapa.id) out = { ...out, etapa: pe, etapaIdx: pe.ordem };
  const pp = pendingPositions.get(card.workflow.id!);
  if (pp !== undefined && pp !== card.workflow.position)
    out = { ...out, workflow: { ...out.workflow, position: pp } };
  return out;
}

// Droppable column body — registers the column as a drop target so empty columns can receive drops
function DroppableColumnBody({
  id,
  tint,
  children,
}: {
  id: string;
  tint?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className="board-column-body"
      style={{ minHeight: 60, background: tint ? `${tint}0a` : undefined }}
    >
      {children}
    </div>
  );
}

// Monta o ProcessTarget que usePostProcessCommands espera a partir de um
// PostEntity do quadro (spec §12.2: drag e botão chamam o MESMO comando com o
// MESMO target). Função pura de módulo -- não depende de estado do
// componente, então tanto o render (botões) quanto handleDragEnd (drag) usam
// a mesma sem duplicar a montagem.
function targetOf(p: PostEntity): ProcessTarget {
  return {
    process: p.process,
    post: {
      id: p.process.post_id,
      titulo: p.titulo,
      status: p.process.post.status,
      cliente_id: p.process.post.cliente_id,
    },
  };
}

// Draggable card wrapper
function SortableCard({
  card,
  onCardClick,
  onPostsClick,
  onEditClick,
  membros,
  onRefresh,
  onRevertClick,
  onForwardClick,
  onDeleteClick,
  postsCount,
  approvedPostsCount,
  clearedClienteCount,
  revisaoInternaCount,
  awaitingClienteCount,
}: {
  card: BoardCard;
  onCardClick: (c: BoardCard) => void;
  onPostsClick: (c: BoardCard) => void;
  onEditClick: (c: BoardCard) => void;
  membros: Membro[];
  onRefresh: () => void;
  onRevertClick: () => void;
  onForwardClick: () => void;
  onDeleteClick?: () => void;
  postsCount: number;
  approvedPostsCount: number;
  clearedClienteCount: number;
  revisaoInternaCount: number;
  awaitingClienteCount: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(card.workflow.id),
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    position: 'relative' as const,
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <WorkflowCard
        card={card}
        onClick={() => onCardClick(card)}
        onEditClick={() => onEditClick(card)}
        onPostsClick={() => onPostsClick(card)}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
        membros={membros}
        onRefresh={onRefresh}
        onRevertClick={onRevertClick}
        onForwardClick={onForwardClick}
        onDeleteClick={onDeleteClick}
        postsCount={postsCount}
        approvedPostsCount={approvedPostsCount}
        clearedClienteCount={clearedClienteCount}
        revisaoInternaCount={revisaoInternaCount}
        awaitingClienteCount={awaitingClienteCount}
      />
    </div>
  );
}

// Post individual na coluna (fase 4): agora arrastável, mesma forma que
// SortableCard -- attributes no wrapper, listeners na alça (GripVertical).
// canRevert/forwardLabel vêm das mesmas funções puras que decidem o alvo do
// drag em handleDragEnd (spec §12.2: drag e botão dão o mesmo resultado).
function SortablePostCard({
  entity,
  onClick,
  onForwardClick,
  onRevertClick,
  onRemoveProcessClick,
  onDeleteClick,
}: {
  entity: PostEntity;
  onClick?: () => void;
  onForwardClick: () => void;
  onRevertClick?: () => void;
  onRemoveProcessClick?: () => void;
  onDeleteClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entity.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
        position: 'relative',
      }}
      {...attributes}
    >
      <PostProcessCard
        entity={entity}
        onClick={onClick}
        dragHandle={<GripVertical className="h-4 w-4" {...listeners} />}
        onForwardClick={onForwardClick}
        onRevertClick={onRevertClick}
        onRemoveProcessClick={onRemoveProcessClick}
        onDeleteClick={onDeleteClick}
        canRevert={previousStepOf(entity.process) != null}
        forwardLabel={forwardLabelFor(entity.process)}
      />
    </div>
  );
}

// Column droppable ID prefix — distinguishes column IDs from card IDs in handleDragEnd
const COL_PREFIX = 'col:';

// Stable empty array identity so `posts ?? EMPTY_POST_ENTITIES` never triggers
// a useMemo re-run just because the caller passed no postEntities prop.
const EMPTY_POST_ENTITIES: PostEntity[] = [];

export function KanbanView({
  cards,
  allCards,
  onCardClick,
  onEditClick,
  onPostsClick,
  onRefresh,
  onRecurring,
  onAddWorkflow,
  onCreateTemplate,
  createTemplateDisabled,
  onAddPostIndividual,
  onDeleteWorkflowClick,
  onDeletePostClick,
  membros,
  templates,
  postsCounts,
  approvedPostsCounts,
  clearedClienteCounts,
  revisaoInternaCounts,
  awaitingClienteCounts,
  postEntities,
  allPostEntities,
  postProcessesEnabled,
  onPostClick,
  showExample,
  onDismissExample,
  contaId,
}: KanbanViewProps) {
  // Server data is canonical: the board always re-derives from the cards prop,
  // so any edit (título, responsável, prazo…) shows as soon as the refetch
  // lands — no reload needed. Optimistic changes (dnd moves and reorders) live
  // in overlay maps applied on top, and self-clean once the server reflects
  // them, so drags feel instant while persistence runs in the background.
  const [pendingEtapas, setPendingEtapas] = useState<Map<number, WorkflowEtapa>>(new Map());
  const [pendingPositions, setPendingPositions] = useState<Map<number, number>>(new Map());
  // Mesma ideia de pendingPositions, chaveado por process id: posicao otimista
  // de um post reordenado (board_position) até o refetch refletir.
  const [pendingPostPositions, setPendingPostPositions] = useState<Map<number, number>>(new Map());
  // Etapa otimista de um post (process id -> ordem) entre o clique/drag e o
  // refetch que reflete a transição (fase 4). Alimentado por
  // usePostProcessCommands({ onOptimisticStep }); liberado no mesmo efeito de
  // catch-up de pendingEtapas/pendingPositions abaixo.
  const [pendingPostSteps, setPendingPostSteps] = useState<Map<number, number>>(new Map());
  // Ordenacao por coluna: 'prazo' (padrao, atrasados primeiro) ou 'manual'.
  // Um drag dentro da coluna materializa a ordem visual em positions e troca a
  // coluna para 'manual'; o menu do header volta para 'prazo' quando quiser.
  const [columnSorts, setColumnSorts] = useState<Partial<Record<string, FluxosColumnSort>>>(() =>
    loadFluxosColumnSorts(contaId ?? 'unknown'),
  );
  const sortModeFor = useCallback(
    (colKey: string): FluxosColumnSort => columnSorts[colKey] ?? 'prazo',
    [columnSorts],
  );
  const setColumnSort = useCallback(
    (colKey: string, sort: FluxosColumnSort) => {
      setColumnSorts((prev) => ({ ...prev, [colKey]: sort }));
      persistFluxosColumnSort(contaId ?? 'unknown', colKey, sort);
    },
    [contaId],
  );
  /** Cards da coluna na ordem EXIBIDA (prazo ou manual). */
  const displayCards = useCallback(
    (rowKey: string, ordem: number, cards: BoardCard[]): BoardCard[] =>
      sortModeFor(columnKey(rowKey, ordem)) === 'prazo' ? sortCardsByPrazo(cards) : cards,
    [sortModeFor],
  );
  /** Lista EXIBIDA da coluna mista (spec §4.2). Sem posts é exatamente
   *  displayCards(...) convertido, na mesma ordem de sempre. */
  const displayMixed = useCallback(
    (rowKey: string, ordem: number, column: BoardColumn): BoardEntity[] => {
      const stepCards = displayCards(rowKey, ordem, column.cards);
      if (column.posts.length === 0) return toWorkflowEntities(stepCards);
      const all = [...toWorkflowEntities(stepCards), ...column.posts];
      return sortModeFor(columnKey(rowKey, ordem)) === 'prazo'
        ? sortEntitiesByPrazo(all)
        : sortEntitiesByPosicao(all);
    },
    [displayCards, sortModeFor],
  );
  // Entidade sob o DragOverlay: fluxo ou post (fase 4), nunca um BoardCard
  // sintético -- o overlay lê a entidade real (WorkflowEntity | PostEntity) e
  // decide o componente a renderizar pelo `kind`.
  const [activeEntity, setActiveEntity] = useState<BoardEntity | null>(null);
  // Valid adjacent column currently hovered during a drag ("rowKey::ordem"),
  // plus the dragged card's height so the slot opens exactly its size.
  const [dropSlot, setDropSlot] = useState<{ colKey: string; index: number } | null>(null);
  const [dragHeight, setDragHeight] = useState(120);
  // Cross-column drop position, captured at drag end and applied after the
  // (possibly dialog-gated) advance/revert persists. Keyed pelo sortable id
  // (fluxo ou post, fase 4) so a cancelled drag can never leak its position
  // into a button-initiated move.
  const pendingInsertRef = useRef<{
    movedId: BoardSortableId;
    ids: BoardSortableId[];
    optimisticPos: number;
  } | null>(null);
  const [revertTarget, setRevertTarget] = useState<{ workflowId: number; title: string } | null>(
    null,
  );
  const [approvalChoice, setApprovalChoice] = useState<{
    card: BoardCard;
    willRearm: boolean;
  } | null>(null);
  const [forwardTarget, setForwardTarget] = useState<BoardCard | null>(null);
  const [activeRowKey, setActiveRowKey] = useState<string | null>(null);
  // Comandos de um processo individual (Task 7), compartilhados pelos botões
  // Avançar/Voltar do card e pelo drag entre colunas (spec §12.2: o MESMO
  // comando/target dos dois gestos). onOptimisticStep alimenta o overlay
  // pendingPostSteps; ordem === null é rollback e também limpa uma posição de
  // drag ainda pendente para este processo -- um comando disparado por botão
  // nunca deve herdar a posição de um drag cancelado de OUTRO post.
  const commands = usePostProcessCommands({
    onRefresh,
    onOptimisticStep: (processId, ordem) => {
      if (ordem == null && pendingInsertRef.current?.movedId === `post:${processId}`) {
        pendingInsertRef.current = null;
      }
      setPendingPostSteps((prev) => {
        const next = new Map(prev);
        if (ordem == null) next.delete(processId);
        else next.set(processId, ordem);
        return next;
      });
    },
    // Um drag entre colunas abre um destes diálogos (avancar/voltar) através
    // do hook e seta pendingInsertRef ANTES de abrir. Cancelar sem confirmar
    // não passa por onOptimisticStep (que só roda em run/decideThenRun) --
    // sem isto, o ref fica preso e o próximo comando do MESMO post disparado
    // por BOTÃO (não-drag) herda a posição capturada pelo drag abandonado
    // quando o catch-up effect casar o movedId (Task 8, achado da revisão).
    onDismiss: () => {
      pendingInsertRef.current = null;
    },
  });

  // Grava a ordem completa (índice = posição): sem post na coluna é o
  // reorder_workflow_positions de sempre; com post, a RPC mista
  // reorder_fluxos_board grava os dois tipos no mesmo espaço (spec §4.2).
  // Declarado ANTES do efeito de catch-up abaixo (que agora também persiste a
  // posição de um post arrastado, fase 4) -- TS2448/2454 bloqueiam uma
  // closure referenciando um `const` de módulo declarado mais abaixo no MESMO
  // escopo de função, mesmo quando só roda depois (efeito assíncrono).
  const persistColumnOrder = useCallback(async (orderedIds: BoardSortableId[]) => {
    const plan = planColumnPersist(orderedIds);
    if (plan.kind === 'workflows') {
      await updateWorkflowPositions(plan.updates);
    } else {
      await reorderFluxosBoard(plan.args);
    }
  }, []);

  // Drop overlay entries the server already reflects. A cross-column insert
  // stores a FRACTIONAL position (e.g. 0.5) that the persisted integer will
  // never equal, so those are released together with the workflow's etapa
  // overlay: the refetch that reflects the move also carries the renumbered
  // positions.
  useEffect(() => {
    if (
      pendingEtapas.size === 0 &&
      pendingPositions.size === 0 &&
      pendingPostPositions.size === 0 &&
      pendingPostSteps.size === 0
    )
      return;
    const movedCaughtUp = new Set<number>();
    for (const c of allCards ?? cards) {
      const pe = pendingEtapas.get(c.workflow.id!);
      if (pe && pe.id === c.etapa.id) movedCaughtUp.add(c.workflow.id!);
    }
    const currentPosts = allPostEntities ?? postEntities ?? EMPTY_POST_ENTITIES;
    // Um post "pega" a etapa otimista quando o servidor já reflete a mesma
    // ordem, OU quando o processo some da lista (concluído/removido): os dois
    // casos liberam o overlay do mesmo jeito.
    const postStepsCaughtUp = new Set<number>();
    for (const [processId, ordem] of pendingPostSteps) {
      const p = currentPosts.find((x) => x.process.id === processId);
      if (!p || p.process.etapa_atual === ordem) postStepsCaughtUp.add(processId);
    }
    setPendingEtapas((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const id of movedCaughtUp) next.delete(id);
      return next.size === prev.size ? prev : next;
    });
    setPendingPositions((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const c of allCards ?? cards) {
        const pp = next.get(c.workflow.id!);
        if (pp !== undefined && (c.workflow.position === pp || movedCaughtUp.has(c.workflow.id!)))
          next.delete(c.workflow.id!);
      }
      return next.size === prev.size ? prev : next;
    });
    setPendingPostPositions((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const p of currentPosts) {
        const pp = next.get(p.process.id);
        if (pp !== undefined && p.posicao === pp) next.delete(p.process.id);
      }
      return next.size === prev.size ? prev : next;
    });
    setPendingPostSteps((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const id of postStepsCaughtUp) next.delete(id);
      return next.size === prev.size ? prev : next;
    });
    // A posição de um post solto entre colunas (fase 4) só é persistida depois
    // que o comando (avancar/voltar) confirma -- aqui, quando pendingPostSteps
    // libera o processo. Mesmo best-effort/console.warn do caminho de fluxo:
    // a etapa já mudou, a posição é cosmética.
    for (const id of postStepsCaughtUp) {
      const movedId = `post:${id}`;
      if (pendingInsertRef.current?.movedId === movedId) {
        const insert = pendingInsertRef.current;
        pendingInsertRef.current = null;
        persistColumnOrder(insert.ids).catch((err) => {
          console.warn('[entregas] falha ao gravar posição após mover etapa', err);
        });
      }
    }
  }, [
    cards,
    allCards,
    postEntities,
    allPostEntities,
    pendingEtapas,
    pendingPositions,
    pendingPostPositions,
    pendingPostSteps,
    persistColumnOrder,
  ]);

  const localCards = useMemo(() => {
    if (pendingEtapas.size === 0 && pendingPositions.size === 0) return cards;
    return cards.map((c) => applyOverlays(c, pendingEtapas, pendingPositions));
  }, [cards, pendingEtapas, pendingPositions]);

  // Mesmo overlay otimista aplicado a allCards (a coluna INTEIRA, sem o filtro
  // da pagina): fullColumnOrder precisa enxergar as posicoes ja persistidas
  // por um drag anterior, nao so os cards visiveis em localCards.
  const localAllCards = useMemo(() => {
    if (!allCards) return undefined;
    if (pendingEtapas.size === 0 && pendingPositions.size === 0) return allCards;
    return allCards.map((c) => applyOverlays(c, pendingEtapas, pendingPositions));
  }, [allCards, pendingEtapas, pendingPositions]);

  // Overlay otimista de post_processes.board_position, na mesma linha de
  // applyOverlays acima mas para posts: aplicado tanto na lista visível
  // quanto na coluna INTEIRA (allPosts), espelhando localCards/localAllCards.
  // Fase 4 estende para a etapa otimista (pendingPostSteps): o post muda de
  // coluna assim que o botão/drag dispara o comando, sem esperar o refetch.
  const applyPostOverlay = useCallback(
    (list: PostEntity[]): PostEntity[] => {
      if (pendingPostPositions.size === 0 && pendingPostSteps.size === 0) return list;
      return list.map((p) => {
        let out = p;
        const pp = pendingPostPositions.get(p.process.id);
        if (pp !== undefined && pp !== out.posicao) out = { ...out, posicao: pp };
        const ordem = pendingPostSteps.get(p.process.id);
        if (ordem !== undefined && ordem !== out.etapaOrdem) {
          // Etapa completa de process.steps (não a StageStep enxuta de out.steps):
          // só ela carrega tipo_prazo/prazo_dias/responsavel_id/prazo_efetivo, o
          // que deadline/tipo_prazo/responsável do card precisam para não ficar
          // presos na etapa anterior até o refetch (achado de review, fase 4 final).
          const fullStep = out.process.steps.find((st) => st.ordem === ordem);
          if (fullStep) out = { ...out, ...derivePostStepFields(fullStep, membros) };
        }
        return out;
      });
    },
    [pendingPostPositions, pendingPostSteps, membros],
  );
  const posts = useMemo(
    () => applyPostOverlay(postEntities ?? EMPTY_POST_ENTITIES),
    [postEntities, applyPostOverlay],
  );
  const allPosts = useMemo(
    () => (allPostEntities ? applyPostOverlay(allPostEntities) : undefined),
    [allPostEntities, applyPostOverlay],
  );
  const signatureRows = postProcessesEnabled === true;
  // A lista mista que o agrupador recebe: fluxos com overlays otimistas + posts
  // (que nunca têm overlay: fase 3 não os move).
  const localEntities: BoardEntity[] = useMemo(
    () =>
      posts.length === 0
        ? toWorkflowEntities(localCards)
        : [...toWorkflowEntities(localCards), ...posts],
    [localCards, posts],
  );
  const boardRows = buildBoardRows(localEntities, templates, { signatureRows });

  // Overlay otimista dos dois tipos de acordo com o mesmo plano, aplicado
  // antes da persistência para o drag parecer instantâneo.
  const applyOptimisticOrder = useCallback((orderedIds: BoardSortableId[]) => {
    const plan = planColumnPersist(orderedIds);
    if (plan.kind === 'workflows') {
      setPendingPositions((prev) => {
        const next = new Map(prev);
        plan.updates.forEach((u) => next.set(u.id, u.position));
        return next;
      });
      return;
    }
    setPendingPositions((prev) => {
      const next = new Map(prev);
      plan.args.workflowIds.forEach((id, i) => next.set(id, plan.args.workflowPositions[i]));
      return next;
    });
    setPendingPostPositions((prev) => {
      const next = new Map(prev);
      plan.args.processIds.forEach((id, i) => next.set(id, plan.args.processPositions[i]));
      return next;
    });
  }, []);
  const rollbackOptimisticOrder = useCallback((orderedIds: BoardSortableId[]) => {
    const plan = planColumnPersist(orderedIds);
    const wfIds = plan.kind === 'workflows' ? plan.updates.map((u) => u.id) : plan.args.workflowIds;
    setPendingPositions((prev) => {
      const next = new Map(prev);
      wfIds.forEach((id) => next.delete(id));
      return next;
    });
    if (plan.kind === 'mixed')
      setPendingPostPositions((prev) => {
        const next = new Map(prev);
        plan.args.processIds.forEach((id) => next.delete(id));
        return next;
      });
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const findCard = (id: string) => localCards.find((c) => String(c.workflow.id) === id);
  const findPost = (id: string) => posts.find((p) => p.id === id);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = String(event.active.id);
      const card = findCard(id);
      const post = card ? undefined : findPost(id);
      setActiveEntity(card ? toWorkflowEntity(card) : (post ?? null));
      setDragHeight(event.active.rect.current?.initial?.height ?? 120);
    },
    [localCards, posts],
  );

  // Opens a slot in the hovered column when the drop would be accepted there:
  // same template row, adjacent etapa (forward or backward).
  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;
      const activeId = String(active.id);
      const draggedCard = findCard(activeId);
      const draggedPost = draggedCard ? undefined : findPost(activeId);
      if (!over || (!draggedCard && !draggedPost)) {
        setDropSlot(null);
        return;
      }
      const draggedSteps = draggedCard ? draggedCard.allEtapas : draggedPost!.steps;
      const draggedOrdem = draggedCard ? draggedCard.etapa.ordem : draggedPost!.etapaOrdem;
      const overId = String(over.id);
      const rows = buildBoardRows(localEntities, templates, { signatureRows });
      const activeLocation = findCardColumn(activeId, rows);

      let targetRow: BoardRow | undefined;
      let targetColumn: BoardColumn | undefined;
      if (overId.startsWith(COL_PREFIX)) {
        const parsed = parseColumnKey(overId.slice(COL_PREFIX.length));
        targetRow = parsed ? rows.find((r) => r.key === parsed.rowKey) : undefined;
        targetColumn = parsed
          ? targetRow?.columns.find((c) => c.ordem === parsed.ordem)
          : undefined;
      } else {
        const overLocation = findCardColumn(overId, rows);
        targetRow = overLocation?.row;
        targetColumn = overLocation?.column;
      }

      if (
        !targetRow ||
        !targetColumn ||
        !activeLocation ||
        targetRow.key !== activeLocation.row.key ||
        targetColumn.ordem === activeLocation.column.ordem
      ) {
        setDropSlot(null);
        return;
      }
      // Fluxo: adjacência por ordem (como hoje). Post: o MESMO alvo dos
      // botões (spec §12.2: drag e botão dão o mesmo resultado) -- avançar
      // vai para a próxima etapa PENDENTE, voltar para a anterior por ordem,
      // qualquer estado. (draggedSteps/draggedOrdem só valem no ramo fluxo.)
      const valid = draggedCard
        ? isValidDropTarget(draggedSteps, draggedOrdem, targetColumn.ordem)
        : nextPendingStepOf(draggedPost!.process)?.ordem === targetColumn.ordem ||
          previousStepOf(draggedPost!.process)?.ordem === targetColumn.ordem;
      if (!valid) {
        setDropSlot(null);
        return;
      }

      // Slot index: over a card, before or after it by vertical midpoint;
      // over the column body, at the end. Indices sao sobre a lista EXIBIDA
      // (modo prazo reordena a coluna), incluindo posts.
      const targetMixed = displayMixed(targetRow.key, targetColumn.ordem, targetColumn);
      let index = targetMixed.length;
      if (!overId.startsWith(COL_PREFIX)) {
        const overIdx = targetMixed.findIndex((e) => sortableIdOf(e) === overId);
        if (overIdx !== -1) {
          const activeRect = active.rect.current?.translated;
          const after = activeRect && activeRect.top > over.rect.top + over.rect.height / 2;
          index = after ? overIdx + 1 : overIdx;
        }
      }
      const colKey = columnKey(targetRow.key, targetColumn.ordem);
      setDropSlot((prev) =>
        prev && prev.colKey === colKey && prev.index === index ? prev : { colKey, index },
      );
    },
    [localCards, posts, localEntities, signatureRows, templates, displayMixed],
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveEntity(null);
      setDropSlot(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeId = String(active.id);
      const overId = String(over.id);
      const draggedCard = findCard(activeId);
      const draggedPost = draggedCard ? undefined : findPost(activeId);
      if (!draggedCard && !draggedPost) return;

      const rows = buildBoardRows(localEntities, templates, { signatureRows });
      const activeLocation = findCardColumn(activeId, rows);
      if (!activeLocation) return;

      // Resolve target column: either from a card hover or a column droppable
      let targetColumn: BoardColumn;
      let targetRow: BoardRow;
      if (overId.startsWith(COL_PREFIX)) {
        // Dropped onto a column droppable (e.g. empty column)
        const parsed = parseColumnKey(overId.slice(COL_PREFIX.length));
        const row = parsed ? rows.find((r) => r.key === parsed.rowKey) : undefined;
        const col = parsed ? row?.columns.find((c) => c.ordem === parsed.ordem) : undefined;
        if (!row || !col) return;
        targetRow = row;
        targetColumn = col;
      } else {
        // Dropped onto a card
        const overLocation = findCardColumn(overId, rows);
        if (!overLocation) return;
        targetRow = overLocation.row;
        targetColumn = overLocation.column;
      }

      if (
        targetColumn.ordem === activeLocation.column.ordem &&
        targetRow.key === activeLocation.row.key
      ) {
        // Within-column reorder — sobre a lista EXIBIDA mista (fluxos + posts):
        // no modo prazo o drop materializa a ordem visual em positions e a
        // coluna vira 'manual'.
        const colKeyStr = columnKey(activeLocation.row.key, activeLocation.column.ordem);
        const col = displayMixed(
          activeLocation.row.key,
          activeLocation.column.ordem,
          activeLocation.column,
        );
        const colIds = col.map(sortableIdOf);
        const oldIdx = colIds.indexOf(activeId);
        const newIdx = overId.startsWith(COL_PREFIX) ? colIds.length - 1 : colIds.indexOf(overId);
        if (oldIdx === -1 || newIdx === -1 || oldIdx === newIdx) return;

        const reordered = arrayMove(colIds, oldIdx, newIdx);

        // A ordem manual é gravada para a coluna INTEIRA, incluindo cards e
        // posts ocultos pelo filtro da página: mescla o gesto sobre a lista
        // visível na ordem completa antes de persistir.
        const full = fullMixedColumnOrder(
          localAllCards,
          allPosts,
          activeLocation.column.cards,
          activeLocation.column.posts,
          activeLocation.row.key,
          activeLocation.column.ordem,
          templates,
          sortModeFor(colKeyStr),
          signatureRows,
        );
        const merged = mergeVisibleReorder(full, reordered);

        // Optimistic reorder overlay (fluxos e posts); rolled back if
        // persistence fails.
        applyOptimisticOrder(merged);
        if (sortModeFor(colKeyStr) === 'prazo') setColumnSort(colKeyStr, 'manual');

        try {
          await persistColumnOrder(merged);
          onRefresh();
        } catch (err) {
          rollbackOptimisticOrder(merged);
          toast.error(getPostProcessErrorToast(err, 'Erro ao salvar ordem dos cartões'));
        }
      } else {
        // Between-column move: a coluna alvo precisa existir na sequência de
        // etapas do PRÓPRIO fluxo arrastado (linhas por template aceitam
        // fluxos com listas divergentes; ver isValidDropTarget). Post: o
        // MESMO alvo dos botões (spec §12.2) -- avançar vai para a próxima
        // etapa PENDENTE, voltar para a anterior por ordem, qualquer estado,
        // então um herdado/ignorado/concluído entre as duas colunas nunca
        // manda o comando errado.
        if (targetRow.key !== activeLocation.row.key) return; // troca de linha por drag fica bloqueada (spec §4.2)
        const valid = draggedCard
          ? isValidDropTarget(draggedCard.allEtapas, draggedCard.etapa.ordem, targetColumn.ordem)
          : nextPendingStepOf(draggedPost!.process)?.ordem === targetColumn.ordem ||
            previousStepOf(draggedPost!.process)?.ordem === targetColumn.ordem;
        if (!valid) {
          toast.error('Só é possível mover para a etapa adjacente');
          return;
        }

        // Capture where in the target column the card was dropped, so the
        // advance/revert (possibly behind a confirm dialog) can land it there
        // instead of at the bottom. Indices e vizinhos sobre a lista EXIBIDA
        // mista (dropSlot.index veio do handleDragOver, tambem sobre ela).
        const targetMixed = displayMixed(targetRow.key, targetColumn.ordem, targetColumn);
        const colKey = columnKey(targetRow.key, targetColumn.ordem);
        const slotIndex =
          dropSlot && dropSlot.colKey === colKey
            ? Math.min(dropSlot.index, targetMixed.length)
            : targetMixed.length;
        const { optimisticPos } = computeCrossColumnSlot(
          targetMixed.map((e) => ({ id: sortableIdOf(e), posicao: e.posicao })),
          slotIndex,
        );
        const targetFull = fullMixedColumnOrder(
          localAllCards,
          allPosts,
          targetColumn.cards,
          targetColumn.posts,
          targetRow.key,
          targetColumn.ordem,
          templates,
          sortModeFor(colKey),
          signatureRows,
        );
        pendingInsertRef.current = {
          movedId: activeId,
          ids: insertIntoFullOrder(targetFull, targetMixed.map(sortableIdOf), slotIndex, activeId),
          optimisticPos,
        };

        if (draggedPost) {
          const t = targetOf(draggedPost);
          const forward = nextPendingStepOf(draggedPost.process)?.ordem === targetColumn.ordem;
          if (forward) commands.avancar(t);
          else commands.voltar(t);
          return;
        }

        const diff = targetColumn.ordem - draggedCard!.etapa.ordem;
        if (diff === 1) {
          handleForwardCard(draggedCard!);
        } else {
          // Backward — show confirm dialog
          setRevertTarget({
            workflowId: draggedCard!.workflow.id!,
            title: draggedCard!.workflow.titulo,
          });
        }
      }
    },
    [
      localCards,
      posts,
      localAllCards,
      localEntities,
      allPosts,
      signatureRows,
      dropSlot,
      onRefresh,
      onRecurring,
      templates,
      displayMixed,
      sortModeFor,
      setColumnSort,
      persistColumnOrder,
      applyOptimisticOrder,
      rollbackOptimisticOrder,
      commands,
    ],
  );

  const handleForwardCard = useCallback((card: BoardCard) => {
    setForwardTarget(card);
  }, []);

  // opts.rearm === false keeps the plain completeEtapa (post statuses untouched) — used by
  // "Avançar etapa sem alterar posts", whose literal contract is to leave posts alone.
  const advanceEtapa = useCallback(
    async (card: BoardCard, successMessage: string, opts?: { rearm?: boolean }) => {
      const wfId = card.workflow.id!;
      // Slide the card into the next column immediately; the backend persists
      // in the background. On the last etapa there is no next column — the
      // card leaves the board when the refetch lands.
      const nextEtapa = card.allEtapas.find((e) => e.ordem === card.etapa.ordem + 1);
      if (nextEtapa) setPendingEtapas((prev) => new Map(prev).set(wfId, nextEtapa));
      const insert =
        pendingInsertRef.current?.movedId === String(wfId) ? pendingInsertRef.current : null;
      if (insert && nextEtapa)
        setPendingPositions((prev) => new Map(prev).set(wfId, insert.optimisticPos));
      try {
        const result = await completeEtapaForAdvance(card.workflow.id!, card.etapa.id!, opts);
        if (result.workflow.status === 'concluido' && card.workflow.recorrente) {
          onRecurring(card.workflow.id!);
        } else {
          toast.success(successMessage);
        }
        notifyRearmOutcome(result);
        if (insert) {
          pendingInsertRef.current = null;
          try {
            await persistColumnOrder(insert.ids);
          } catch (err) {
            // A etapa já avançou/voltou; a posição é best-effort. Sem a RPC em prod
            // (migration não aplicada) isto é o único sinal.
            console.warn('[entregas] falha ao gravar posição após mover etapa', err);
          }
        }
        onRefresh();
      } catch (err: unknown) {
        pendingInsertRef.current = null;
        if (nextEtapa)
          setPendingEtapas((prev) => {
            const next = new Map(prev);
            next.delete(wfId);
            return next;
          });
        toast.error((err as Error).message || 'Erro ao avançar etapa');
      }
    },
    [onRefresh, onRecurring, persistColumnOrder],
  );

  const executeForward = useCallback(
    (card: BoardCard) => {
      const wfId = card.workflow.id!;
      const decision = decideApprovalAdvance({
        tipo: card.etapa.tipo,
        total: postsCounts.get(wfId) ?? 0,
        // "Cleared" (approved / scheduled / posted / publish-failed), not just
        // aprovado_cliente — otherwise a workflow whose approved posts are already
        // scheduled would wrongly prompt the approval dialog on advance.
        cleared: clearedClienteCounts.get(wfId) ?? 0,
        temAprovacaoAdiante: hasLaterApprovalEtapa(card.allEtapas, card.etapa.id!),
      });
      if (decision.kind === 'choose') setApprovalChoice({ card, willRearm: decision.willRearm });
      else advanceEtapa(card, 'Etapa concluída!');
    },
    [advanceEtapa, postsCounts, clearedClienteCounts],
  );

  const handleForwardConfirm = () => {
    if (!forwardTarget) return;
    const card = forwardTarget;
    setForwardTarget(null);
    executeForward(card);
  };

  const handleApproveInternally = async () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    setApprovalChoice(null);
    try {
      await approvePostsInternally(card.workflow.id!);
    } catch (err: unknown) {
      // The advance never runs, so the drag's captured drop position must not
      // survive to reorder a later, unrelated advance of this workflow.
      pendingInsertRef.current = null;
      toast.error((err as Error).message || 'Erro ao aprovar internamente');
      return;
    }
    await advanceEtapa(card, 'Posts aprovados internamente — etapa concluída!');
  };

  const handleSendToPortal = async () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    setApprovalChoice(null);
    // Send-only: the workflow does not move, so the drag's captured drop
    // position is dead the moment this choice is made.
    pendingInsertRef.current = null;
    try {
      await sendPostsToCliente(card.workflow.id!);
      toast.success('Posts enviados ao portal do cliente!');
      onRefresh();
    } catch (err: unknown) {
      toast.error((err as Error).message || 'Erro ao enviar ao portal');
    }
  };

  const handleAdvanceWithoutApproval = () => {
    if (!approvalChoice) return;
    const card = approvalChoice.card;
    setApprovalChoice(null);
    advanceEtapa(card, 'Etapa avançada — status dos posts mantidos.', { rearm: false });
  };

  const handleRevertConfirm = async () => {
    if (!revertTarget) return;
    const card = localCards.find((c) => c.workflow.id === revertTarget.workflowId);
    const prevEtapa = card?.allEtapas.find((e) => e.ordem === card.etapa.ordem - 1);
    if (card && prevEtapa)
      setPendingEtapas((prev) => new Map(prev).set(revertTarget.workflowId, prevEtapa));
    const insert =
      pendingInsertRef.current?.movedId === String(revertTarget.workflowId)
        ? pendingInsertRef.current
        : null;
    if (insert && card && prevEtapa)
      setPendingPositions((prev) =>
        new Map(prev).set(revertTarget.workflowId, insert.optimisticPos),
      );
    try {
      await revertEtapa(revertTarget.workflowId);
      toast.success('Etapa revertida!');
      if (insert) {
        pendingInsertRef.current = null;
        try {
          await persistColumnOrder(insert.ids);
        } catch (err) {
          // A etapa já avançou/voltou; a posição é best-effort. Sem a RPC em prod
          // (migration não aplicada) isto é o único sinal.
          console.warn('[entregas] falha ao gravar posição após mover etapa', err);
        }
      }
      onRefresh();
    } catch (err: unknown) {
      pendingInsertRef.current = null;
      setPendingEtapas((prev) => {
        const next = new Map(prev);
        next.delete(revertTarget.workflowId);
        return next;
      });
      toast.error((err as Error).message || 'Erro ao reverter etapa');
    }
    setRevertTarget(null);
  };

  if (localCards.length === 0 && posts.length === 0) {
    if (showExample && onDismissExample) {
      return <ExampleBoard onDismiss={onDismissExample} />;
    }
    return (
      <div
        className="card animate-up"
        style={{
          textAlign: 'center',
          padding: '4rem 3rem',
          color: 'var(--text-muted)',
          borderRadius: '12px',
        }}
      >
        <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem', opacity: 0.3 }}>▣</div>
        <p style={{ fontSize: '0.82rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
          {postProcessesEnabled
            ? 'Nenhum fluxo ou post individual encontrado. Ajuste os filtros ou crie um novo fluxo.'
            : 'Nenhuma entrega encontrada. Ajuste os filtros ou crie um novo fluxo.'}
        </p>
      </div>
    );
  }

  const renderRowBoard = (row: BoardRow) => (
    <div className="board-container">
      {row.columns.map((column, colIdx) => {
        const stepName = column.nome;
        const tint = columnTint(stepName);
        const colKeyStr = columnKey(row.key, column.ordem);
        const stepCards = displayCards(row.key, column.ordem, column.cards);
        const sortMode = sortModeFor(colKeyStr);
        const stepPosts = column.posts;
        // Ordem exibida da coluna mista (spec §4.2): prazo por uma única função,
        // manual por posicao/board_position. Sem posts a lista é exatamente
        // stepCards, na mesma ordem de hoje.
        const mixed: BoardEntity[] = displayMixed(row.key, column.ordem, column);
        const countLabel =
          stepCards.length > 0 && stepPosts.length > 0
            ? `${stepCards.length} ${stepCards.length === 1 ? 'fluxo' : 'fluxos'} · ${stepPosts.length} ${stepPosts.length === 1 ? 'post' : 'posts'}`
            : String(stepCards.length + stepPosts.length);
        return (
          <div key={column.ordem} className="board-column" style={{ borderColor: `${tint}30` }}>
            <div
              className="board-column-header"
              style={{ background: `${tint}30`, borderBottomColor: `${tint}30` }}
              {...(column.tipo === 'aprovacao_cliente' ? { 'data-tour': 'wf-col-aprovacao' } : {})}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.15rem',
                  minWidth: 0,
                }}
              >
                <span className="board-column-title" style={{ color: tint }}>
                  {stepName}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Ordenar coluna ${stepName}`}
                      className="board-column-sort"
                      style={{ color: tint }}
                    >
                      <ArrowUpDown size={12} aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-[150px]">
                    {(
                      [
                        ['prazo', 'Prazo'],
                        ['manual', 'Manual'],
                      ] as const
                    ).map(([mode, label]) => (
                      <DropdownMenuItem
                        key={mode}
                        className="gap-2 text-xs"
                        onSelect={() => setColumnSort(colKeyStr, mode)}
                      >
                        <Check
                          className="h-3.5 w-3.5"
                          style={{ visibility: sortMode === mode ? 'visible' : 'hidden' }}
                        />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
              <span
                className="board-column-count"
                style={{ background: `${tint}3d`, color: tint, borderColor: 'transparent' }}
              >
                {countLabel}
              </span>
            </div>
            <DroppableColumnBody tint={tint} id={`${COL_PREFIX}${colKeyStr}`}>
              {colIdx === 0 &&
                onAddWorkflow &&
                (row.templateId != null && postProcessesEnabled && onAddPostIndividual ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" className="board-add-card">
                        <Plus className="h-3.5 w-3.5" /> Novo ▾
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[150px]">
                      <DropdownMenuItem onSelect={() => onAddWorkflow(row.templateId)}>
                        Fluxo
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onSelect={() => onAddPostIndividual(row.templateId as number)}
                      >
                        Post individual
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <button
                    type="button"
                    className="board-add-card"
                    onClick={() => onAddWorkflow(row.templateId)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Novo fluxo
                  </button>
                ))}
              <SortableContext
                items={mixed.map(sortableIdOf)}
                strategy={verticalListSortingStrategy}
              >
                {mixed.length === 0 && colKeyStr !== dropSlot?.colKey ? (
                  <div className="board-empty">Nenhuma entrega</div>
                ) : (
                  mixed.map((entity, idx) => {
                    const slot = colKeyStr === dropSlot?.colKey && dropSlot.index === idx && (
                      <div
                        className="board-drop-slot"
                        style={{ height: dragHeight }}
                        aria-hidden="true"
                      />
                    );
                    if (entity.kind === 'post') {
                      return (
                        <Fragment key={entity.id}>
                          {slot}
                          <SortablePostCard
                            entity={entity}
                            onClick={onPostClick ? () => onPostClick(entity) : undefined}
                            onForwardClick={() =>
                              canConcluir(entity.process)
                                ? commands.concluir(targetOf(entity))
                                : commands.avancar(targetOf(entity))
                            }
                            onRevertClick={() => commands.voltar(targetOf(entity))}
                            onRemoveProcessClick={() => commands.remover(targetOf(entity))}
                            onDeleteClick={
                              onDeletePostClick ? () => onDeletePostClick(entity) : undefined
                            }
                          />
                        </Fragment>
                      );
                    }
                    const card = entity.card;
                    return (
                      <Fragment key={card.workflow.id}>
                        {slot}
                        <SortableCard
                          card={card}
                          onCardClick={onCardClick}
                          onEditClick={onEditClick}
                          onPostsClick={onPostsClick}
                          membros={membros}
                          onRefresh={onRefresh}
                          onRevertClick={() =>
                            setRevertTarget({
                              workflowId: card.workflow.id!,
                              title: card.workflow.titulo,
                            })
                          }
                          onForwardClick={() => handleForwardCard(card)}
                          onDeleteClick={
                            onDeleteWorkflowClick ? () => onDeleteWorkflowClick(card) : undefined
                          }
                          postsCount={postsCounts.get(card.workflow.id!) ?? 0}
                          approvedPostsCount={approvedPostsCounts.get(card.workflow.id!) ?? 0}
                          clearedClienteCount={clearedClienteCounts.get(card.workflow.id!) ?? 0}
                          revisaoInternaCount={revisaoInternaCounts.get(card.workflow.id!) ?? 0}
                          awaitingClienteCount={awaitingClienteCounts.get(card.workflow.id!) ?? 0}
                        />
                      </Fragment>
                    );
                  })
                )}
                {colKeyStr === dropSlot?.colKey && dropSlot.index >= mixed.length && (
                  <div
                    className="board-drop-slot"
                    style={{ height: dragHeight }}
                    aria-hidden="true"
                  />
                )}
              </SortableContext>
            </DroppableColumnBody>
          </div>
        );
      })}
    </div>
  );

  // The tab strip is always on: with one template it's a single tab plus the trailing
  // "+", which is how a second template gets created.
  const useTabs = boardRows.length >= 1;
  const activeRow = boardRows.find((r) => r.key === activeRowKey) ?? boardRows[0];

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={() => {
          setActiveEntity(null);
          setDropSlot(null);
          pendingInsertRef.current = null;
        }}
        onDragEnd={handleDragEnd}
      >
        <div className="board-rows-wrapper animate-up">
          {useTabs && activeRow && (
            <div>
              <div className="board-tabs no-scrollbar" role="tablist">
                {boardRows.map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    role="tab"
                    aria-selected={row.key === activeRow.key}
                    className={`board-tab${row.key === activeRow.key ? ' active' : ''}`}
                    onClick={() => setActiveRowKey(row.key)}
                  >
                    {row.label}
                    <span className="board-tab-count">{rowCardCount(row)}</span>
                  </button>
                ))}
                {onCreateTemplate && (
                  <button
                    type="button"
                    className="board-tab board-tab-add"
                    aria-label="Novo template"
                    title={createTemplateDisabled ? 'Limite do plano atingido' : 'Novo template'}
                    disabled={createTemplateDisabled}
                    onClick={onCreateTemplate}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              {renderRowBoard(activeRow)}
            </div>
          )}
        </div>
        <DragOverlay>
          {activeEntity?.kind === 'workflow' && (
            <WorkflowCard
              card={activeEntity.card}
              isDragOverlay
              postsCount={postsCounts.get(activeEntity.card.workflow.id!) ?? 0}
              approvedPostsCount={approvedPostsCounts.get(activeEntity.card.workflow.id!) ?? 0}
              clearedClienteCount={clearedClienteCounts.get(activeEntity.card.workflow.id!) ?? 0}
              revisaoInternaCount={revisaoInternaCounts.get(activeEntity.card.workflow.id!) ?? 0}
              awaitingClienteCount={awaitingClienteCounts.get(activeEntity.card.workflow.id!) ?? 0}
            />
          )}
          {activeEntity?.kind === 'post' && <PostProcessCard entity={activeEntity} isDragOverlay />}
        </DragOverlay>
      </DndContext>
      <ForwardConfirmDialog
        open={!!forwardTarget}
        entityTitle={forwardTarget?.workflow.titulo || ''}
        nextEtapaName={
          forwardTarget
            ? ([...forwardTarget.allEtapas]
                .sort((a, b) => a.ordem - b.ordem)
                .find((e) => e.ordem > forwardTarget.etapa.ordem)?.nome ?? '')
            : ''
        }
        onConfirm={handleForwardConfirm}
        onCancel={() => {
          pendingInsertRef.current = null;
          setForwardTarget(null);
        }}
      />
      <RevertConfirmDialog
        open={!!revertTarget}
        entityTitle={revertTarget?.title || ''}
        onConfirm={handleRevertConfirm}
        onCancel={() => {
          pendingInsertRef.current = null;
          setRevertTarget(null);
        }}
      />
      <ClientApprovalChoiceDialog
        open={!!approvalChoice}
        entityTitle={approvalChoice?.card.workflow.titulo || ''}
        willRearm={approvalChoice?.willRearm ?? false}
        onApproveInternally={handleApproveInternally}
        onSendToPortal={handleSendToPortal}
        onAdvanceWithoutChanges={handleAdvanceWithoutApproval}
        onCancel={() => {
          pendingInsertRef.current = null;
          setApprovalChoice(null);
        }}
      />
      {commands.dialogs}
    </>
  );
}
