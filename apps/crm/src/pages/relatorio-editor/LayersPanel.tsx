// Seção fixa "Camadas" do editor: lista os blocos na ordem do documento, com
// arrastar para reordenar (dnd-kit, padrões da casa: handle carrega os
// listeners, distance 5, sensor de teclado) e clicar para localizar no canvas
// (scroll + highlight). O posicionamento vive em style.css (.rb-layers-rail):
// painel ancorado é position:fixed com gate de media query, escondido em telas
// estreitas — regra da casa para UI ancorada (DESIGN_SYSTEM, sticky é
// inutilizado pelo overflow-x:hidden global).
import { GripVertical, Plus } from 'lucide-react';
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { WIDGET_CATALOG } from '@mesaas/report-blocks/catalog';
import type { BlockSize, ReportBlock, ReportLayout } from '@mesaas/report-blocks/types';
import { FALLBACK_WIDGET_ICON, WIDGET_ICONS } from './widgetIcons';

const SIZE_LABEL: Record<BlockSize, string> = { third: '1/3', half: '1/2', full: '1/1' };

/** Nome legível da camada: label do catálogo; cabeçalho de seção anexa o
 * título configurado; tipo desconhecido cai no próprio type (tolerante). */
export function layerLabel(block: ReportBlock): string {
  const entry = WIDGET_CATALOG.find((w) => w.type === block.type);
  const base = entry?.label ?? block.type;
  if (block.type === 'section_header') {
    const title = typeof block.config?.title === 'string' ? block.config.title.trim() : '';
    return title ? `${base} · ${title}` : base;
  }
  return base;
}

interface LayerRowProps {
  block: ReportBlock;
  active: boolean;
  onLocate: (id: string) => void;
}

function LayerRow({ block, active, onLocate }: LayerRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  // Lookup direto no mapa (padrão StatCard): a regra static-components
  // reconhece member access em constante de módulo, não chamada de função.
  const TypeIcon = WIDGET_ICONS[block.type] ?? FALLBACK_WIDGET_ICON;
  return (
    <div
      ref={setNodeRef}
      className={`rb-layers-row${active ? ' rb-layers-row-active' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <button
        type="button"
        className="rb-layers-handle cursor-grab touch-none"
        aria-label="Reordenar camada"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button type="button" className="rb-layers-label" onClick={() => onLocate(block.id)}>
        <TypeIcon className="rb-layers-icon h-3.5 w-3.5" aria-hidden />
        <span className="rb-layers-label-text">{layerLabel(block)}</span>
      </button>
      <span className="rb-layers-size">{SIZE_LABEL[block.size] ?? block.size}</span>
    </div>
  );
}

export interface LayersPanelProps {
  layout: ReportLayout;
  /** Bloco atualmente destacado no canvas (espelha o highlight do editor). */
  highlightId?: string | null;
  /** Reordena via ids: o pai aplica moveBlock sobre o layout corrente (ref),
   * nunca sobre um closure obsoleto deste componente. */
  onReorder: (activeId: string, overId: string) => void;
  onLocate: (id: string) => void;
  /** Abre o drawer de widgets para inserir na POSIÇÃO dada do array de blocos
   * (hotspot entre a camada index-1 e a camada index). */
  onAddAt: (index: number) => void;
  /** Abre o drawer de widgets para inserir no fim do documento. */
  onAddEnd: () => void;
}

export function LayersPanel({
  layout,
  highlightId,
  onReorder,
  onLocate,
  onAddAt,
  onAddEnd,
}: LayersPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  }

  return (
    <aside className="rb-layers-rail" aria-label="Camadas do relatório">
      <h3 className="rb-layers-title">Camadas</h3>
      <p className="rb-layers-hint">Arraste para reordenar. Clique para localizar.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={layout.blocks.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="rb-layers-list">
            {layout.blocks.map((block, i) => (
              <li key={block.id} className="rb-layers-item">
                <LayerRow block={block} active={block.id === highlightId} onLocate={onLocate} />
                {i < layout.blocks.length - 1 && (
                  <div className="rb-layers-gap">
                    <button
                      type="button"
                      className="rb-layers-add-between"
                      aria-label={`Adicionar widget na posição ${i + 2}`}
                      onClick={() => onAddAt(i + 1)}
                    >
                      <Plus className="h-3 w-3" aria-hidden />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        className="rb-layers-add-end"
        aria-label="Adicionar widget no fim do relatório"
        onClick={onAddEnd}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar widget
      </button>
    </aside>
  );
}
