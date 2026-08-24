// Canvas de edição do relatório de blocos: o MESMO grid/widgets do pacote, com
// células sortable (dnd-kit) e toolbar de chrome por bloco. O BlockRenderer do
// pacote fica para view/print; aqui as células nunca colapsam (rb-mode-edit).
import type { CSSProperties, ReactNode } from 'react';
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
import { BLOCK_COMPONENTS, SIZE_CLASS } from '@mesaas/report-blocks/BlockRenderer';
import { ReportFonts } from '@mesaas/report-blocks/ReportFonts';
import { resolveReportTheme } from '@mesaas/report-blocks/theme';
import { WIDGET_CATALOG } from '@mesaas/report-blocks/catalog';
import { blockHasData } from '@mesaas/report-blocks/data-presence';
import type {
  BlockType,
  ReportBlock,
  ReportDocSnapshot,
  ReportLayout,
} from '@mesaas/report-blocks/types';
import { TEXT_BLOCK_TYPES } from '@mesaas/report-blocks/types';
import { moveBlock, removeBlock, resizeBlock } from './layoutOps';
import { SectionHeaderEditor } from './SectionHeaderEditor';

// Placeholder do modo edição para widget sem dado no snapshot: a view/print
// omite o bloco (guard de cada widget), mas no editor uma célula vazia parece
// bug e esconde o próprio widget que o usuário acabou de adicionar.
function NoDataPlaceholder({ type }: { type: BlockType }) {
  const label = WIDGET_CATALOG.find((w) => w.type === type)?.label ?? type;
  return (
    <div className="rb-edit-nodata">
      <p className="rb-edit-nodata-title">{label}</p>
      <p className="rb-edit-nodata-hint">
        Sem dados neste período. Este widget não aparece na visão do cliente; use Atualizar dados se
        a conta tiver sincronizado depois da geração.
      </p>
    </div>
  );
}

interface SortableCellProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  highlighted: boolean;
  onResize: (delta: 1 | -1) => void;
  onRemove: () => void;
  renderTextBlock?: (block: ReportBlock) => ReactNode;
  onConfigChange?: (id: string, patch: Record<string, unknown>) => void;
}

function SortableCell({
  block,
  snapshot,
  highlighted,
  onResize,
  onRemove,
  renderTextBlock,
  onConfigChange,
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
    ) : block.type === 'section_header' && onConfigChange ? (
      <SectionHeaderEditor block={block} onConfigChange={onConfigChange} />
    ) : Component && !blockHasData(block, snapshot) ? (
      <NoDataPlaceholder type={block.type} />
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
  /** Habilita a edição inline de config (cabeçalho de seção). */
  onConfigChange?: (id: string, patch: Record<string, unknown>) => void;
}

export function EditorCanvas({
  layout,
  snapshot,
  onChange,
  highlightId,
  renderTextBlock,
  onRemoveBlock,
  onConfigChange,
}: EditorCanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const theme = resolveReportTheme(layout, snapshot);

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
      <ReportFonts layout={layout} snapshot={snapshot} />
      <SortableContext items={layout.blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div
          className={`rb-grid rb-mode-edit${theme.themeClass ? ` ${theme.themeClass}` : ''}`}
          style={theme.vars as CSSProperties}
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
              onConfigChange={onConfigChange}
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
