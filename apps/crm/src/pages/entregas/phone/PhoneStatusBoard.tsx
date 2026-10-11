import { useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowRightLeft, ArrowUpDown, ExternalLink, Lock, MoreHorizontal } from 'lucide-react';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import { ContextMenu } from '@/components/mobile/ContextMenu';
import type { ActivePost } from '@/store';
import { COL_PREFIX } from '../postsKanbanDrop';
import {
  BOARD_COLUMN_SORTS,
  BOARD_COLUMN_SORT_LABELS,
  type BoardColumnSort,
} from '../postsBoardOrder';
import type { StatusKey, StatusOption } from '../statusRegistry';
import { PhoneDragHandle } from './PhoneBoardCards';
import './entregasPhone.css';

/** Pointer inside a target first (the drop grid's chips are small and close
 *  together), then the nearest card for same-column reorder. */
const phoneCollision: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCenter(args);
};

export interface PhoneStatusBoardProps {
  options: StatusOption[];
  postsFor: (key: StatusKey) => ActivePost[];
  sortFor: (key: StatusKey) => BoardColumnSort;
  onSortChange?: (key: string, sort: BoardColumnSort) => void;
  /** The desktop card's content (badges, destinos, prazo, avatars). */
  renderContent: (post: ActivePost) => ReactNode;
  isOpenable: (post: ActivePost) => boolean;
  onOpen: (post: ActivePost) => void;
  isLockedOption: (option: StatusOption) => boolean;
  lockedReason: (option: StatusOption) => string;
  optionOf: (post: ActivePost) => StatusOption;
  /** Same resolver as a drop: locked target toasts, approved asks first. */
  onMoveTo: (post: ActivePost, key: StatusKey) => void;
  sensors: SensorDescriptor<SensorOptions>[];
  onDragStart: (e: DragStartEvent) => void;
  onDragOver: (e: DragOverEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  activePost: ActivePost | undefined;
}

function DropTarget({
  option,
  count,
  current,
  locked,
  over,
}: {
  option: StatusOption;
  count: number;
  current: boolean;
  locked: boolean;
  over: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: `${COL_PREFIX}${option.key}` });
  return (
    <li
      ref={setNodeRef}
      className="phone-ent-drop"
      data-over={over ? 'true' : undefined}
      data-locked={locked ? 'true' : undefined}
      data-current={current ? 'true' : undefined}
    >
      {locked && <Lock aria-hidden="true" />}
      <span className="phone-ent-drop__label">{option.label}</span>
      <span className="phone-ent-drop__count">{current ? 'Atual' : count}</span>
    </li>
  );
}

function SortableStatusCard({
  post,
  reorder,
  locked,
  children,
}: {
  post: ActivePost;
  reorder: boolean;
  locked: boolean;
  children: (handle: ReactNode | undefined) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: String(post.id),
    disabled: !reorder || locked,
  });
  const handle = !reorder ? undefined : locked ? (
    <span className="phone-ent-card__icon-btn" role="img" aria-label="Status travado">
      <Lock aria-hidden="true" />
    </span>
  ) : (
    <PhoneDragHandle label="Arrastar para mover" {...attributes} {...listeners} />
  );
  return (
    <li
      ref={setNodeRef}
      className="phone-ent-board__item"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
      }}
    >
      {children(handle)}
    </li>
  );
}

/**
 * The Status board on phones (EntregasStatusDrag mockup): one status column at a
 * time behind a chip row. In Reordenar mode a card drags from its handle; on drag
 * start the chips expand into a grid of drop targets (custom statuses included,
 * since a chip row can't scroll mid-drag), locked statuses refuse the drop with the
 * desktop toast, and a drop inside the column reorders it. Without dragging, the
 * card menu's "Mover para" runs the same status change.
 */
export function PhoneStatusBoard({
  options,
  postsFor,
  sortFor,
  onSortChange,
  renderContent,
  isOpenable,
  onOpen,
  isLockedOption,
  lockedReason,
  optionOf,
  onMoveTo,
  sensors,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  activePost,
}: PhoneStatusBoardProps) {
  const [chosenKey, setChosenKey] = useState<StatusKey | null>(null);
  const [reorder, setReorder] = useState(false);
  const [sortSheet, setSortSheet] = useState(false);
  const [moving, setMoving] = useState<ActivePost | null>(null);
  const [overKey, setOverKey] = useState<StatusKey | null>(null);

  const firstWithPosts = options.find((o) => postsFor(o.key).length > 0) ?? options[0];
  const option = options.find((o) => o.key === chosenKey) ?? firstWithPosts;
  if (!option) return null;
  const list = postsFor(option.key);
  const sort = sortFor(option.key);
  const dragging = activePost != null;
  const overOption = overKey ? options.find((o) => o.key === overKey) : undefined;

  const enterReorder = () => {
    // Same-column order only exists in manual mode (the desktop drop no-ops
    // otherwise), so entering the mode switches this column to Manual.
    if (sort !== 'manual') onSortChange?.(option.key, 'manual');
    setReorder(true);
  };

  const handleOver = (e: DragOverEvent) => {
    const id = e.over ? String(e.over.id) : '';
    setOverKey(id.startsWith(COL_PREFIX) ? (id.slice(COL_PREFIX.length) as StatusKey) : null);
    onDragOver(e);
  };

  return (
    <div className="phone-ent-board" data-testid="phone-status-board">
      <DndContext
        sensors={sensors}
        collisionDetection={phoneCollision}
        onDragStart={onDragStart}
        onDragOver={handleOver}
        onDragEnd={(e) => {
          setOverKey(null);
          onDragEnd(e);
        }}
        onDragCancel={() => {
          setOverKey(null);
          onDragCancel();
        }}
      >
        {dragging ? (
          <div className="phone-ent-drop-grid" aria-live="polite">
            <p className="phone-ent-board__hint">
              {overOption
                ? isLockedOption(overOption)
                  ? lockedReason(overOption)
                  : overOption.key === option.key
                    ? 'Solte para mudar a ordem nesta coluna'
                    : `Solte para mover para ${overOption.label}`
                : 'Arraste até um status'}
            </p>
            <ul className="phone-ent-drop-grid__list">
              {options.map((o) => (
                <DropTarget
                  key={o.key}
                  option={o}
                  count={postsFor(o.key).length}
                  current={o.key === option.key}
                  locked={isLockedOption(o)}
                  over={o.key === overKey}
                />
              ))}
            </ul>
          </div>
        ) : (
          <ChipRow aria-label="Status" semantics="tablist" className="phone-ent-board__chips">
            {options.map((o) => (
              <Chip
                key={o.key}
                label={o.label}
                count={postsFor(o.key).length}
                selected={o.key === option.key}
                controls="phone-ent-status-col"
                onClick={() => {
                  setReorder(false);
                  setChosenKey(o.key);
                }}
              />
            ))}
          </ChipRow>
        )}

        <section
          id="phone-ent-status-col"
          role="tabpanel"
          aria-label={`${option.label}, ${list.length}`}
          className="phone-ent-board__column"
        >
          <div className="phone-ent-board__head">
            <h2 className="phone-ent-board__title">
              {option.label} <span>{list.length}</span>
            </h2>
            <div className="phone-ent-board__head-actions">
              {reorder ? (
                <button
                  type="button"
                  className="phone-ent-text-btn phone-ent-text-btn--strong"
                  onClick={() => setReorder(false)}
                >
                  OK
                </button>
              ) : (
                <>
                  {list.length > 0 && (
                    <button type="button" className="phone-ent-text-btn" onClick={enterReorder}>
                      Reordenar
                    </button>
                  )}
                  <button
                    type="button"
                    className="phone-ent-text-btn"
                    aria-label={`Ordenar coluna ${option.label}: ${BOARD_COLUMN_SORT_LABELS[sort]}`}
                    onClick={() => setSortSheet(true)}
                  >
                    <ArrowUpDown aria-hidden="true" />
                    {BOARD_COLUMN_SORT_LABELS[sort]}
                  </button>
                </>
              )}
            </div>
          </div>
          {reorder && !dragging && (
            <p className="phone-ent-board__hint" role="status">
              Arraste pela alça até outro status, ou dentro da coluna para mudar a ordem.
            </p>
          )}

          <SortableContext
            items={list.map((p) => String(p.id))}
            strategy={verticalListSortingStrategy}
          >
            {list.length === 0 ? (
              <p className="phone-ent-board__empty">Nenhum post</p>
            ) : (
              <ul className="phone-ent-board__list">
                {list.map((post) => {
                  const own = optionOf(post);
                  const locked = isLockedOption(own);
                  const openable = isOpenable(post);
                  const title = post.titulo || 'Post sem título';
                  return (
                    <SortableStatusCard key={post.id} post={post} reorder={reorder} locked={locked}>
                      {(handle) => (
                        <ContextMenu
                          label="Ações do post"
                          disabled={reorder}
                          sections={[
                            openable
                              ? [
                                  {
                                    label: 'Abrir',
                                    icon: <ExternalLink aria-hidden="true" />,
                                    onSelect: () => onOpen(post),
                                  },
                                ]
                              : [],
                            [
                              {
                                label: locked ? lockedReason(own) : 'Mover para…',
                                icon: <ArrowRightLeft aria-hidden="true" />,
                                disabled: locked,
                                onSelect: () => setMoving(post),
                              },
                            ],
                          ].filter((s) => s.length > 0)}
                        >
                          {({ triggerProps }) => (
                            <article
                              className="scheduled-item board-post-card phone-ent-status-card"
                              aria-label={title}
                              data-testid="phone-status-card"
                              onClick={openable && !reorder ? () => onOpen(post) : undefined}
                            >
                              {renderContent(post)}
                              <div className="phone-ent-status-card__actions">
                                {handle ?? (
                                  <button
                                    {...triggerProps}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      triggerProps.onClick();
                                    }}
                                    className="phone-ent-card__icon-btn"
                                    aria-label={`Mais ações de ${title}`}
                                  >
                                    <MoreHorizontal aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            </article>
                          )}
                        </ContextMenu>
                      )}
                    </SortableStatusCard>
                  );
                })}
              </ul>
            )}
          </SortableContext>
        </section>
        <DragOverlay>
          {activePost && (
            <div className="scheduled-item board-post-card board-post-card--overlay phone-ent-status-card">
              {renderContent(activePost)}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <ActionSheet
        open={sortSheet}
        onOpenChange={setSortSheet}
        title={`Ordenar coluna ${option.label}`}
        actions={BOARD_COLUMN_SORTS.map((mode) => ({
          label: `${sort === mode ? '✓ ' : ''}${BOARD_COLUMN_SORT_LABELS[mode]}`,
          onSelect: () => onSortChange?.(option.key, mode),
        }))}
      />
      <ActionSheet
        open={moving != null}
        onOpenChange={(open) => {
          if (!open) setMoving(null);
        }}
        title="Mover para"
        message={moving ? moving.titulo || 'Post sem título' : undefined}
        actions={
          moving
            ? options
                .filter((o) => o.key !== optionOf(moving).key)
                .map((o) => {
                  const locked = isLockedOption(o);
                  return {
                    label: locked ? `${o.label} (automático)` : o.label,
                    disabled: locked,
                    onSelect: () => onMoveTo(moving, o.key),
                  };
                })
            : []
        }
      />
    </div>
  );
}
