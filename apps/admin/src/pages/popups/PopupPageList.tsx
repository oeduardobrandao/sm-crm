import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, X } from 'lucide-react';
import type { PageForm, PopupFormErrors } from '../popup-form';
import { MAX_PAGES } from '../popup-form';
import { cn } from '../../lib/utils';

export interface PopupPageListProps {
  pages: PageForm[];
  pageIndex: number;
  errors: PopupFormErrors | null;
  /** `vertical` = coluna de páginas do desktop; `horizontal` = pílulas do iPhone. */
  orientation: 'vertical' | 'horizontal';
  onSelect: (index: number) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onDragEnd: (e: DragEndEvent) => void;
}

/** Abas das páginas do popup, reordenáveis com dnd-kit (alça com `data-dnd-handle`). */
export function PopupPageList({
  pages,
  pageIndex,
  errors,
  orientation,
  onSelect,
  onRemove,
  onAdd,
  onDragEnd,
}: PopupPageListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const vertical = orientation === 'vertical';
  const canAdd = pages.length < MAX_PAGES;

  return (
    <div className={vertical ? undefined : 'flex items-center gap-2'}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={pages.map((p) => p.key)}
          strategy={vertical ? verticalListSortingStrategy : horizontalListSortingStrategy}
        >
          <div
            role="tablist"
            aria-label="Páginas do popup"
            aria-orientation={orientation}
            className={
              vertical
                ? 'flex flex-col gap-0.5'
                : '-my-1.5 flex min-w-0 flex-1 gap-2 overflow-x-auto py-1.5'
            }
          >
            {pages.map((p, i) => (
              <PageTab
                key={p.key}
                page={p}
                index={i}
                vertical={vertical}
                active={i === pageIndex}
                hasError={Boolean(errors?.pages[i])}
                canRemove={pages.length > 1}
                onSelect={() => onSelect(i)}
                onRemove={() => onRemove(i)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {canAdd &&
        (vertical ? (
          <button
            type="button"
            onClick={onAdd}
            className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            + Página
          </button>
        ) : (
          <button
            type="button"
            onClick={onAdd}
            aria-label="Nova página"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-foreground/[0.12] text-foreground"
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        ))}
    </div>
  );
}

function PageTab({
  page,
  index,
  vertical,
  active,
  hasError,
  canRemove,
  onSelect,
  onRemove,
}: {
  page: PageForm;
  index: number;
  vertical: boolean;
  active: boolean;
  hasError: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.key,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  // Full title, cut by CSS with an ellipsis (a fixed slice cut mid-word with no marker).
  const label = page.title.trim() || 'Sem título';
  const ring = hasError ? 'ring-1 ring-destructive' : '';

  const handle = (
    <span
      {...attributes}
      {...listeners}
      data-dnd-handle=""
      className={cn(
        'flex shrink-0 cursor-grab items-center',
        // iPhone: alvo de ~44pt em volta do ícone, sem crescer a pílula de 34px.
        !vertical && '-my-[5px] -ml-2 h-11 w-10 justify-center',
        vertical || !active ? 'text-muted-foreground' : 'text-background/60',
      )}
      aria-label={`Reordenar página ${index + 1}`}
    >
      <GripVertical size={vertical ? 14 : 13} aria-hidden="true" />
    </span>
  );
  const remove = canRemove && (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remover página ${index + 1}`}
      className={cn(
        'flex shrink-0 items-center hover:text-destructive',
        vertical || !active ? 'text-muted-foreground' : 'text-background/60',
      )}
    >
      <X size={vertical ? 14 : 13} aria-hidden="true" />
    </button>
  );

  if (vertical) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={cn(
          'group flex h-10 items-center gap-1.5 rounded-[10px] pl-1.5 pr-2 text-sm',
          active ? 'bg-foreground/[0.12] font-semibold' : 'hover:bg-foreground/[0.06]',
          ring,
        )}
      >
        {handle}
        <button
          type="button"
          role="tab"
          aria-selected={active}
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-foreground/[0.12] text-xs font-normal"
          >
            {index + 1}
          </span>
          <span className="truncate">
            <span className="sr-only">{index + 1} · </span>
            {label}
          </span>
        </button>
        {remove}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex h-[34px] shrink-0 items-center gap-1.5 rounded-full pl-2 pr-2.5 text-[15px]',
        active ? 'bg-foreground font-semibold text-background' : 'bg-foreground/[0.12]',
        ring,
      )}
    >
      {handle}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={onSelect}
        title={label}
        className="min-w-0 max-w-[9.5rem] truncate"
      >
        {index + 1} · {label}
      </button>
      {remove}
    </div>
  );
}
