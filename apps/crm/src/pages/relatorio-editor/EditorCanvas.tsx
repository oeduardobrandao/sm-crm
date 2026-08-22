// Canvas de edição do relatório de blocos: o MESMO grid/widgets do pacote, com
// células sortable (dnd-kit) e toolbar de chrome por bloco. O BlockRenderer do
// pacote fica para view/print; aqui as células nunca colapsam (rb-mode-edit).
import type { ReactNode } from 'react';
import { useState } from 'react';
import { GripVertical, Minus, Plus, Trash2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BLOCK_COMPONENTS,
  SIZE_CLASS,
  resolveLayoutAccent,
} from '@mesaas/report-blocks/BlockRenderer';
import type { ReportBlock, ReportDocSnapshot, ReportLayout } from '@mesaas/report-blocks/types';
import { TEXT_BLOCK_TYPES } from '@mesaas/report-blocks/types';
import { moveBlock, removeBlock, resizeBlock } from './layoutOps';

interface SortableCellProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  highlighted: boolean;
  onResize: (delta: 1 | -1) => void;
  onRemove: () => void;
  renderTextBlock?: (block: ReportBlock) => ReactNode;
}

function SortableCell({
  block,
  snapshot,
  highlighted,
  onResize,
  onRemove,
  renderTextBlock,
}: SortableCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  // hasOwnProperty (não Object.hasOwn: fora do lib target ES2021 do
  // tsconfig) evita que um block.type tipo "__proto__" ou "constructor"
  // resolva para um valor herdado de Object.prototype (truthy, mas não um
  // componente) e derrube o React ao renderizar.
  const Component = Object.prototype.hasOwnProperty.call(BLOCK_COMPONENTS, block.type)
    ? BLOCK_COMPONENTS[block.type]
    : undefined;
  const isText = TEXT_BLOCK_TYPES.includes(block.type);
  const body =
    isText && renderTextBlock ? (
      renderTextBlock(block)
    ) : Component ? (
      <Component block={block} snapshot={snapshot} />
    ) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-block-id={block.id}
      className={`${SIZE_CLASS[block.size] ?? 'rb-full'} rb-edit-cell${highlighted ? ' rb-edit-highlight' : ''}`}
    >
      <div className="rb-edit-toolbar">
        <button
          type="button"
          className="rb-edit-btn cursor-grab touch-none"
          aria-label="Reordenar bloco"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rb-edit-btn"
          aria-label="Diminuir largura"
          onClick={() => onResize(-1)}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rb-edit-btn"
          aria-label="Aumentar largura"
          onClick={() => onResize(1)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rb-edit-btn rb-edit-btn-danger"
          aria-label="Excluir bloco"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="rb-edit-body">{body}</div>
    </div>
  );
}

export interface EditorCanvasProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  onChange: (next: ReportLayout) => void;
  highlightId?: string | null;
  renderTextBlock?: (block: ReportBlock) => ReactNode;
  // Ausente = comportamento atual (onChange com o bloco removido). Presente =
  // o chamador assume a exclusão inteira (ex.: undo via toast na página).
  onRemoveBlock?: (id: string) => void;
}

export function EditorCanvas({
  layout,
  snapshot,
  onChange,
  highlightId,
  renderTextBlock,
  onRemoveBlock,
}: EditorCanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const { acc, accFg } = resolveLayoutAccent(layout, snapshot);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = moveBlock(layout, String(active.id), String(over.id));
    if (next !== layout) onChange(next);
  }

  const activeBlock = activeId ? layout.blocks.find((b) => b.id === activeId) : null;
  const ActiveComponent =
    activeBlock && Object.prototype.hasOwnProperty.call(BLOCK_COMPONENTS, activeBlock.type)
      ? BLOCK_COMPONENTS[activeBlock.type]
      : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={layout.blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div
          className="rb-grid rb-mode-edit"
          style={{ ['--rb-accent' as string]: acc, ['--rb-accent-fg' as string]: accFg }}
        >
          {layout.blocks.map((block) => (
            <SortableCell
              key={block.id}
              block={block}
              snapshot={snapshot}
              highlighted={block.id === highlightId}
              onResize={(delta) => {
                const next = resizeBlock(layout, block.id, delta);
                if (next !== layout) onChange(next);
              }}
              onRemove={() =>
                onRemoveBlock ? onRemoveBlock(block.id) : onChange(removeBlock(layout, block.id))
              }
              renderTextBlock={renderTextBlock}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeBlock && ActiveComponent && (
          <div className="rb-edit-overlay">
            <ActiveComponent block={activeBlock} snapshot={snapshot} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
