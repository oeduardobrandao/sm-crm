import type { ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/** dnd-kit sortable id prefix for section blocks (questions use raw uuids). */
export const SECTION_PREFIX = 'section:';

/**
 * Sortable wrapper around a single briefing question card. The drag handle is a
 * focusable button carrying the dnd attributes/listeners, so the existing
 * Editar/Trash buttons keep their own click behavior and keyboard drag works.
 */
export function SortableQuestion({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2">
      <button
        type="button"
        className="mt-3 shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-30"
        aria-label="Reordenar pergunta"
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * Sortable wrapper around a named-section block. `header` (the collapse toggle) is
 * rendered next to a drag handle so dragging the section never triggers collapse;
 * `children` is the section body (its questions).
 */
export function SortableSection({
  id,
  header,
  children,
}: {
  id: string;
  header: ReactNode;
  children?: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-6">
      <div className="mb-2 flex items-center gap-1">
        <button
          type="button"
          className="shrink-0 cursor-grab touch-none text-muted-foreground hover:text-foreground"
          aria-label="Reordenar seção"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        {header}
      </div>
      {children}
    </div>
  );
}
