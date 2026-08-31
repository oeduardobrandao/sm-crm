import { Fragment, memo, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertTriangle,
  CalendarClock,
  CheckCheck,
  CircleCheck,
  CircleDashed,
  Clapperboard,
  Eye,
  GalleryHorizontalEnd,
  Image,
  Lock,
  MessageSquareWarning,
  PencilLine,
  Plus,
  Route,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { reorderBoardPosts, type ActivePost } from '@/store';
import type { BoardCard } from '../hooks/useEntregasData';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatPostDate } from '@/utils/postDate';
import { avatarColorClass } from '@/lib/avatarColor';
import { formatEtapaPrazo } from '../etapaPrazo';
import { TIPO_LABELS, LOCKED_STATUSES, LOCKED_TOOLTIPS, getPostPublishState } from '../postLabels';
import { planBoardPlacement, sortColumnPosts, type BoardColumnSort } from '../postsBoardOrder';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import type { StatusKey, StatusOption, StatusRegistry } from '../statusRegistry';
import {
  COL_PREFIX,
  buildUndoableStatusMove,
  resolvePostsKanbanDrop,
  resolvePostsKanbanHover,
  resolveUndoGuard,
  type PostsKanbanHoverSlot,
} from '../postsKanbanDrop';
import { getCustomStatusIcon } from '../statusIcons';
import { ACTIVE_POSTS_KEY, useUpdatePostStatus } from '../hooks/useUpdatePostStatus';

const TIPO_ICONS: Record<ActivePost['tipo'], typeof Image> = {
  feed: Image,
  reels: Clapperboard,
  carrossel: GalleryHorizontalEnd,
  stories: CircleDashed,
};

/* Column-header icon per canonical status; color only where the status carries
 * a semantic outcome (approved/scheduled/published/failed), muted otherwise.
 * Custom statuses keep their user-picked color dot instead. */
const STATUS_HEADER_META: Record<ActivePost['status'], { icon: typeof Image; color?: string }> = {
  rascunho: { icon: PencilLine },
  revisao_interna: { icon: Eye },
  aprovado_interno: { icon: ShieldCheck },
  enviado_cliente: { icon: Send },
  aprovado_cliente: { icon: CircleCheck, color: 'var(--success)' },
  correcao_cliente: { icon: MessageSquareWarning, color: 'var(--warning)' },
  agendado: { icon: CalendarClock, color: 'var(--primary-hover)' },
  postado: { icon: CheckCheck, color: 'var(--success)' },
  falha_publicacao: { icon: AlertTriangle, color: 'var(--danger-text)' },
};

/* Solid hex per canonical status for the pastel column treatment (same recipe
 * as the Fluxos board: header/border at 30 alpha, count pill 3d, body 0a) --
 * CSS vars can't take an alpha suffix, hence concrete deep stops. FIXED by
 * design: statuses are a fixed rail, so each keeps one color for good
 * (semantic greens/orange/gold/red where the status carries an outcome), and
 * the Fluxos etapa palette deliberately avoids all of these hues. */
const STATUS_COLUMN_TINTS: Record<ActivePost['status'], string> = {
  rascunho: '#0284c7',
  revisao_interna: '#4f46e5',
  aprovado_interno: '#7c3aed',
  enviado_cliente: '#db2777',
  aprovado_cliente: '#059669',
  correcao_cliente: '#c2410c',
  agendado: '#ca8a04',
  postado: '#047857',
  falha_publicacao: '#b91c1c',
};

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

/** Custom statuses tint with their user-picked color; anything that is not a
 *  plain 6-digit hex (alpha suffixes need one) falls back to the neutral look. */
function columnTintFor(option: StatusOption): string | null {
  const color = option.kind === 'custom' ? option.color : STATUS_COLUMN_TINTS[option.canonical];
  return color && HEX_COLOR_RE.test(color) ? color : null;
}

interface PostsKanbanViewProps {
  posts: ActivePost[];
  isLoading: boolean;
  openableWorkflowIds: Set<number>;
  onPostClick: (post: ActivePost) => void;
  /** Unfiltered board cards keyed by workflow id — source of the workflow's
   *  cliente (avatar/cor), current etapa, its responsible and its deadline. */
  cardsByWorkflowId: Map<number, BoardCard>;
  /** True while any Publicações filter (busca, cliente, etc.) narrows `posts` --
   *  the empty state only offers "Criar post avulso" once it's genuinely empty. */
  filtersActive: boolean;
  /** Opens NewAvulsoDialog from the unfiltered empty state's CTA. */
  onCreateAvulso: () => void;
  /** Per-column sort mode; a column absent from the map (or the whole prop
   *  omitted) defaults to 'manual'. Wired by the column header menu in a
   *  later task -- this view only consumes it. */
  columnSorts?: Partial<Record<StatusKey, BoardColumnSort>>;
}

/** A post avulso (no workflow) is always openable -- only a wired post depends
 *  on its workflow still being an active, loaded card. */
function isPostOpenable(post: ActivePost, openableWorkflowIds: Set<number>): boolean {
  return post.workflow_id == null || openableWorkflowIds.has(post.workflow_id);
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/** Card guts shared by the real card and its DragOverlay clone. */
function PostBoardCardContent({
  post,
  registry,
  card,
}: {
  post: ActivePost;
  registry: StatusRegistry;
  card: BoardCard | undefined;
}) {
  const opt = registry.resolve(post);
  const locked = LOCKED_STATUSES.has(opt.canonical);
  const membro = card?.membro;
  const prazo = card ? formatEtapaPrazo(card.deadline) : null;
  const TipoIcon = TIPO_ICONS[post.tipo];

  return (
    <>
      <div className="item-top">
        <span className="board-post-tipo">
          <TipoIcon size={13} aria-hidden="true" style={{ flexShrink: 0 }} />
          {TIPO_LABELS[post.tipo]}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          {getPostPublishState(post) === 'publicando' && (
            <span className="board-post-prazo-pill board-post-publicando">Publicando…</span>
          )}
          {prazo && (
            <span
              className="board-post-prazo-pill"
              style={
                prazo.color.startsWith('#')
                  ? { color: prazo.color, background: `${prazo.color}1f` }
                  : { color: prazo.color }
              }
            >
              {prazo.shortLabel}
            </span>
          )}
          {locked && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock
                    className="h-3 w-3"
                    style={{ color: 'var(--text-light)' }}
                    aria-hidden="true"
                  />
                </TooltipTrigger>
                <TooltipContent>{LOCKED_TOOLTIPS[opt.canonical]}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </span>
      </div>
      <div className="item-title">{post.titulo || 'Post sem título'}</div>
      {card ? (
        <span className="post-fluxo-tag post-fluxo-tag--static">
          <Route size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
          {card.etapa.nome}
        </span>
      ) : post.workflow_id === null ? (
        <span className="post-fluxo-tag post-fluxo-tag--avulso">
          <CircleDashed size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
          Avulso
        </span>
      ) : null}
      <div className="item-meta board-post-footer">
        <span className="board-post-footer-left">
          <span className="board-post-avatar-pair">
            {post.cliente_id != null && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {card?.clienteAvatarUrl ? (
                      <img
                        src={card.clienteAvatarUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="board-post-cliente-avatar"
                      />
                    ) : (
                      <span
                        className="board-post-cliente-avatar board-post-cliente-avatar--initials"
                        style={{
                          background: card?.cliente?.cor || 'var(--surface-hover)',
                        }}
                      >
                        {getInitials(post.cliente_nome || '?')}
                      </span>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>{post.cliente_nome || '—'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {membro && (
              <span
                className={`avatar board-post-assignee-avatar ${avatarColorClass(membro.id ?? membro.nome)}`}
              >
                {getInitials(membro.nome)}
              </span>
            )}
          </span>
          {card && membro && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="board-post-assignee">{membro.nome.split(' ')[0]}</span>
                </TooltipTrigger>
                <TooltipContent>
                  {`${card.etapa.nome}: ${membro.nome}${prazo ? ` · ${prazo.label}` : ''}`}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </span>
        <span className="board-post-date">
          {post.scheduled_at ? formatPostDate(post.scheduled_at) : 'Sem data'}
        </span>
      </div>
    </>
  );
}

/** Draggable card wrapper: click still opens the drawer (openable posts only,
 *  regardless of drag lock); dragging is disabled only for a locked source. */
/* memo: when the slot column re-renders on every slot move, its cards (74+ in
 * Rascunho) bail out here instead of re-rendering tooltips and avatars. */
const PostBoardCard = memo(function PostBoardCard({
  post,
  registry,
  card,
  openable,
  onPostClick,
}: {
  post: ActivePost;
  registry: StatusRegistry;
  card: BoardCard | undefined;
  openable: boolean;
  onPostClick: (post: ActivePost) => void;
}) {
  const opt = registry.resolve(post);
  const locked = LOCKED_STATUSES.has(opt.canonical);
  // Attributes (role/aria/tabIndex) are deliberately omitted, same call as
  // CalendarGrid's PostPill: this card owns its own click semantics, and
  // dnd-kit's activation-constraint click-swallow only engages once an actual
  // drag crosses the distance/delay threshold, so a plain click still reaches
  // onClick untouched.
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(post.id),
    disabled: locked,
  });

  return (
    <div
      ref={setNodeRef}
      className="scheduled-item board-post-card"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        cursor: locked ? (openable ? 'pointer' : 'default') : 'grab',
        opacity: isDragging ? 0.4 : 1,
      }}
      onClick={openable ? () => onPostClick(post) : undefined}
      {...listeners}
    >
      <PostBoardCardContent post={post} registry={registry} card={card} />
    </div>
  );
});

/** Column: droppable body, dimmed while a drag is active if its canonical
 *  status is system-driven (an invalid drop target — the drop still fires, so
 *  the drag-end handler can toast the reason, but never writes). */
/* memo: a drag start/slot move re-renders the parent on every state change;
 * without memo all nine columns (hundreds of cards) re-render, which is the
 * click-to-move delay and mid-drag jank the board used to have. Only the
 * column whose props actually changed (dragInvalid flip, slot enter/leave)
 * re-renders now. */
const PostBoardColumn = memo(function PostBoardColumn({
  option,
  posts,
  registry,
  openableWorkflowIds,
  onPostClick,
  cardsByWorkflowId,
  dragInvalid,
  dropSlot,
  dragHeight,
}: {
  option: StatusOption;
  posts: ActivePost[];
  registry: StatusRegistry;
  openableWorkflowIds: Set<number>;
  onPostClick: (post: ActivePost) => void;
  cardsByWorkflowId: Map<number, BoardCard>;
  /** True only while a drag is active AND this column is a locked target --
   *  computed by the parent so unlocked columns keep a stable prop across a
   *  drag start and skip re-rendering entirely. */
  dragInvalid: boolean;
  /** Slot for THIS column only; null when the drag hovers elsewhere. */
  dropSlot: PostsKanbanHoverSlot | null;
  dragHeight: number;
}) {
  const { setNodeRef } = useDroppable({ id: `${COL_PREFIX}${option.key}` });
  const tint = columnTintFor(option);

  return (
    <div
      className={`board-column${dragInvalid ? ' board-column--drag-invalid' : ''}`}
      style={tint ? { borderColor: `${tint}30` } : undefined}
    >
      <div
        className="board-column-header"
        style={tint ? { background: `${tint}30`, borderBottomColor: `${tint}30` } : undefined}
      >
        <span className="board-column-title" style={tint ? { color: tint } : undefined}>
          {option.kind === 'custom'
            ? (() => {
                const CustomIcon = getCustomStatusIcon(option.icone);
                return CustomIcon ? (
                  <CustomIcon
                    size={13}
                    aria-hidden="true"
                    style={{ color: option.color, flexShrink: 0 }}
                  />
                ) : (
                  <span
                    aria-hidden
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: option.color,
                      flexShrink: 0,
                    }}
                  />
                );
              })()
            : (() => {
                const meta = STATUS_HEADER_META[option.canonical];
                const HeaderIcon = meta.icon;
                return (
                  <HeaderIcon
                    size={13}
                    aria-hidden="true"
                    style={{ color: tint ?? meta.color ?? 'var(--text-light)', flexShrink: 0 }}
                  />
                );
              })()}
          {option.label}
        </span>
        <span
          className="board-column-count"
          style={
            tint ? { background: `${tint}3d`, color: tint, borderColor: 'transparent' } : undefined
          }
        >
          {posts.length}
        </span>
      </div>
      <div
        ref={setNodeRef}
        className="board-column-body"
        style={tint ? { background: `${tint}0a` } : undefined}
      >
        <SortableContext
          items={posts.map((p) => String(p.id))}
          strategy={verticalListSortingStrategy}
        >
          {posts.length === 0 && dropSlot == null ? (
            <div className="board-empty">Nenhum post</div>
          ) : (
            <>
              {posts.map((p, idx) => (
                <Fragment key={p.id}>
                  {dropSlot != null && dropSlot.index === idx && (
                    <div
                      className="board-drop-slot"
                      style={{ height: dragHeight }}
                      aria-hidden="true"
                    />
                  )}
                  <PostBoardCard
                    post={p}
                    registry={registry}
                    card={p.workflow_id != null ? cardsByWorkflowId.get(p.workflow_id) : undefined}
                    openable={isPostOpenable(p, openableWorkflowIds)}
                    onPostClick={onPostClick}
                  />
                </Fragment>
              ))}
              {dropSlot != null && dropSlot.index >= posts.length && (
                <div
                  className="board-drop-slot"
                  style={{ height: dragHeight }}
                  aria-hidden="true"
                />
              )}
            </>
          )}
        </SortableContext>
      </div>
    </div>
  );
});

/**
 * Draggable kanban of every post across active workflows, one column per post
 * status in pipeline order. Dragging a card writes its status (system-driven
 * columns and cards are locked); clicking a post still opens its workflow
 * drawer focused on it.
 */
export function PostsKanbanView({
  posts,
  isLoading,
  openableWorkflowIds,
  onPostClick,
  cardsByWorkflowId,
  filtersActive,
  onCreateAvulso,
  columnSorts,
}: PostsKanbanViewProps) {
  const registry = useStatusRegistry();
  const updateStatus = useUpdatePostStatus();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [dropSlot, setDropSlot] = useState<PostsKanbanHoverSlot | null>(null);
  const [dragHeight, setDragHeight] = useState(120);
  const [pendingConfirm, setPendingConfirm] = useState<{
    post: ActivePost;
    key: StatusKey;
    /** Cross-column placement to persist once the (possibly dialog-gated)
     *  status write is confirmed -- undefined for a plain confirm with no
     *  captured drop slot. */
    place?: () => void;
  } | null>(null);

  /** Column header menu (a later task) will drive this; every column defaults
   *  to 'manual' until then. */
  const columnSortFor = (key: StatusKey): BoardColumnSort => columnSorts?.[key] ?? 'manual';

  const byStatus = useMemo(() => {
    const map = new Map<StatusKey, ActivePost[]>(registry.options.map((o) => [o.key, []]));
    // Input arrives ordered scheduled_at asc nulls-last from the query.
    // resolve() falls back to the canonical column while defs load, so posts
    // never vanish from the board.
    for (const p of posts) map.get(registry.resolve(p).key)?.push(p);
    return map;
  }, [posts, registry]);

  /** Each column's rendered order, per its own sort mode -- what the
   *  SortableContexts above and the drag handlers below both treat as ground
   *  truth for "where is this post right now". */
  const sortedByStatus = useMemo(() => {
    const map = new Map<StatusKey, ActivePost[]>();
    for (const [key, list] of byStatus) map.set(key, sortColumnPosts(list, columnSortFor(key)));
    return map;
    // columnSortFor only reads columnSorts (a plain prop), so it's covered by
    // the columnSorts dependency without needing to be listed itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byStatus, columnSorts]);

  /** Reverse index for the drag handlers: which column (in the SORTED view)
   *  a given post id currently renders in. */
  const columnKeyByPostId = useMemo(() => {
    const map = new Map<number, StatusKey>();
    for (const [key, list] of sortedByStatus) for (const p of list) map.set(p.id, key);
    return map;
  }, [sortedByStatus]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const activePost = activeId != null ? posts.find((p) => p.id === activeId) : undefined;

  /** Persists a manual-column placement: applies it to the cache the board
   *  reads from immediately (otimista), then fires the RPC in the background.
   *  A failure toasts and re-syncs from the server rather than rolling back
   *  in place -- the batch RPC is all-or-nothing, so there is nothing partial
   *  to unwind. `board_ordem: null` clears a post's rank (the undo restore
   *  path below uses that to put an unranked post back to unranked). */
  const persistPlacement = (updates: { id: number; board_ordem: number | null }[]) => {
    if (updates.length === 0) return;
    qc.setQueryData<ActivePost[]>(ACTIVE_POSTS_KEY, (old) => {
      if (!old) return old;
      const byId = new Map(updates.map((u) => [u.id, u.board_ordem]));
      return old.map((p) => (byId.has(p.id) ? { ...p, board_ordem: byId.get(p.id)! } : p));
    });
    reorderBoardPosts(updates).catch(() => {
      toast.error('Erro ao salvar a ordem');
      qc.invalidateQueries({ queryKey: ACTIVE_POSTS_KEY });
    });
  };

  /** Drag-initiated status change with a temporary undo. The backward mutate
   *  deliberately skips the drop resolver: restoring an approved status must
   *  not re-open the confirm dialog. Before writing it, resolveUndoGuard checks
   *  the LIVE cache: if the post moved again after the drag (another agent,
   *  the client Hub, auto-scheduling) between the drag and the Desfazer click,
   *  the backward write would clobber that newer change, so it no-ops instead.
   *  `place`, when given, persists the cross-column manual placement captured
   *  at drop time -- run after the forward write so both land together. */
  const applyStatusChange = (post: ActivePost, key: StatusKey, place?: () => void) => {
    const move = buildUndoableStatusMove({ post, key, registry });
    if (!move) return;
    updateStatus.mutate(move.forward);
    toast(`Post movido para "${move.targetLabel}".`, {
      duration: 6000,
      action: {
        label: 'Desfazer',
        onClick: () => {
          const guard = resolveUndoGuard(
            qc.getQueryData<ActivePost[]>(ACTIVE_POSTS_KEY),
            move,
            registry,
          );
          if (guard === 'stale') {
            toast.info('O post já mudou de novo. Nada foi desfeito.');
            return;
          }
          updateStatus.mutate(move.backward);
          // The forward move may also have placed the post in the target
          // column's manual order -- Desfazer restores the rank it had
          // before the drag, not just the status.
          persistPlacement([{ id: move.forward.id, board_ordem: move.previousBoardOrdem }]);
        },
      },
    });
    place?.();
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(Number(event.active.id));
    setDragHeight(event.active.rect.current?.initial?.height ?? 120);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    const draggedId = Number(active.id);
    const dragged = posts.find((p) => p.id === draggedId);
    const overId = over ? String(over.id) : undefined;
    if (!dragged || !overId) {
      setDropSlot(null);
      return;
    }
    const sourceKey = columnKeyByPostId.get(draggedId);
    const targetKey = overId.startsWith(COL_PREFIX)
      ? (overId.slice(COL_PREFIX.length) as StatusKey)
      : columnKeyByPostId.get(Number(overId));
    if (!targetKey || targetKey === sourceKey) {
      setDropSlot(null);
      return;
    }

    // Same-column preview is dnd-kit's own sortable transform; a live slot is
    // only meaningful for a cross-column hover.
    let pointer: { index: number } | undefined;
    if (columnSortFor(targetKey) === 'manual') {
      // The dragged post never actually renders in the target column, so it
      // must be excluded before computing an over-card's index there.
      const targetList = (sortedByStatus.get(targetKey) ?? []).filter((p) => p.id !== draggedId);
      let index = targetList.length;
      if (!overId.startsWith(COL_PREFIX)) {
        const overIdx = targetList.findIndex((p) => String(p.id) === overId);
        if (overIdx !== -1) {
          const activeRect = active.rect.current?.translated;
          const overRect = over?.rect;
          const after =
            activeRect != null &&
            overRect != null &&
            activeRect.top > overRect.top + overRect.height / 2;
          index = after ? overIdx + 1 : overIdx;
        }
      }
      pointer = { index };
    }
    // Auto-sorted targets omit `pointer`: the slot opens at the true landing
    // index instead, so it never jumps once the optimistic move settles.

    const slot = resolvePostsKanbanHover({
      post: dragged,
      posts,
      overId,
      registry,
      columnOf: (id) => columnKeyByPostId.get(id),
      pointer,
    });
    // Identity-stable update so hovering in place never re-renders the board.
    setDropSlot((prev) =>
      prev && slot && prev.key === slot.key && prev.index === slot.index ? prev : slot,
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const slotAtDrop = dropSlot;
    setActiveId(null);
    setDropSlot(null);
    const { active, over } = event;
    const draggedId = Number(active.id);
    const dragged = posts.find((p) => p.id === draggedId);
    if (!dragged || !over) return;
    const overId = String(over.id);
    const sourceKey = columnKeyByPostId.get(draggedId);
    const targetKey = overId.startsWith(COL_PREFIX)
      ? (overId.slice(COL_PREFIX.length) as StatusKey)
      : columnKeyByPostId.get(Number(overId));
    if (!targetKey || !sourceKey) return;

    // Same-column drop: pure manual reorder, no status change, no undo toast.
    if (targetKey === sourceKey) {
      if (columnSortFor(sourceKey) !== 'manual') return;
      const list = sortedByStatus.get(sourceKey) ?? [];
      const from = list.findIndex((p) => p.id === draggedId);
      const to = overId.startsWith(COL_PREFIX)
        ? list.length - 1
        : list.findIndex((p) => String(p.id) === overId);
      if (from === -1 || to === -1 || from === to) return;
      // `to` is the drop target's index in the FULL list (dragged post
      // included); inserting at that same index into the list WITHOUT the
      // dragged post reproduces dnd-kit's arrayMove landing spot regardless
      // of drag direction.
      const without = list.filter((p) => p.id !== draggedId);
      persistPlacement(planBoardPlacement(without, to, draggedId));
      return;
    }

    // Cross-column: existing status-change flow, then placement if the
    // target column is manually sorted.
    const result = resolvePostsKanbanDrop({
      post: dragged,
      overId: `${COL_PREFIX}${targetKey}`,
      registry,
    });
    const placeAfter = () => {
      if (columnSortFor(targetKey) !== 'manual') return;
      const targetList = (sortedByStatus.get(targetKey) ?? []).filter((p) => p.id !== draggedId);
      const index = slotAtDrop?.key === targetKey ? slotAtDrop.index : targetList.length;
      persistPlacement(planBoardPlacement(targetList, index, draggedId));
    };

    switch (result.kind) {
      case 'noop':
      case 'invalid':
        return;
      case 'locked-column':
        toast.error(result.message);
        return;
      case 'confirm':
        setPendingConfirm({ post: dragged, key: result.key, place: placeAfter });
        return;
      case 'write':
        applyStatusChange(dragged, result.key, placeAfter);
        return;
    }
  };

  const handleConfirmStatusChange = () => {
    if (!pendingConfirm) return;
    const { post, key, place } = pendingConfirm;
    setPendingConfirm(null);
    applyStatusChange(post, key, place);
  };

  if (isLoading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}
      >
        <Spinner size="lg" />
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div
        className="card animate-up"
        style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}
      >
        {filtersActive ? (
          <p>Nenhum post encontrado. Ajuste os filtros.</p>
        ) : (
          <>
            <p>Nenhum post por aqui ainda.</p>
            <Button type="button" onClick={onCreateAvulso} style={{ marginTop: '1rem' }}>
              <Plus className="h-4 w-4" />
              Criar post avulso
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setDropSlot(null);
        }}
      >
        <div className="board-rows-wrapper animate-up">
          <div className="board-container">
            {registry.options.map((option) => (
              <PostBoardColumn
                key={option.key}
                option={option}
                posts={sortedByStatus.get(option.key) ?? []}
                registry={registry}
                openableWorkflowIds={openableWorkflowIds}
                onPostClick={onPostClick}
                cardsByWorkflowId={cardsByWorkflowId}
                dragInvalid={activeId != null && LOCKED_STATUSES.has(option.canonical)}
                dropSlot={dropSlot?.key === option.key ? dropSlot : null}
                dragHeight={dragHeight}
              />
            ))}
          </div>
        </div>
        <DragOverlay>
          {activePost && (
            <div className="scheduled-item board-post-card board-post-card--overlay">
              <PostBoardCardContent
                post={activePost}
                registry={registry}
                card={
                  activePost.workflow_id != null
                    ? cardsByWorkflowId.get(activePost.workflow_id)
                    : undefined
                }
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
      <AlertDialog
        open={!!pendingConfirm}
        onOpenChange={(open) => {
          if (!open) setPendingConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Post aprovado</AlertDialogTitle>
            <AlertDialogDescription>
              Este post foi aprovado. Alterar o status vai invalidar a aprovação. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingConfirm(null)}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmStatusChange}>Confirmar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
