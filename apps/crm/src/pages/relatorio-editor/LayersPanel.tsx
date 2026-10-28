// Seção fixa "Camadas" do editor: árvore das seções (ícone + nome) com os blocos recuados
// dentro de cada uma, na ordem do documento (spec 2026-10-28-report-platform-sections
// §Layers panel). Arrastar reordena com as mesmas regras do canvas (blocos só dentro da
// seção, seções entre si; dnd-kit, padrões da casa: handle carrega os listeners, distance 5,
// sensor de teclado); clicar localiza no canvas (scroll + highlight); o "+" insere na seção e
// na posição. O posicionamento vive em app.css (.rb-layers-rail): painel ancorado é
// position:fixed com gate de media query, escondido em telas estreitas (regra da casa para
// UI ancorada, DESIGN_SYSTEM: sticky é inutilizado pelo overflow-x:hidden global).
import { useMemo, useState } from 'react';
import { GripVertical, PanelTop, Plus } from 'lucide-react';
import {
  DndContext,
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
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { WIDGET_CATALOG } from '@mesaas/report-blocks/catalog';
import { PlatformIcon } from '@mesaas/report-blocks/PlatformIcon';
import type {
  BlockSize,
  ReportBlock,
  ReportLayout,
  ReportSection,
} from '@mesaas/report-blocks/types';
import { toSections } from '@mesaas/report-blocks/types';
import { FALLBACK_WIDGET_ICON, WIDGET_ICONS } from './widgetIcons';
import { sectionDisplayName } from './SectionFrameHeader';
import { SECTIONS_GROUP } from './SectionFrame';
import type { InsertTarget } from './useBlockEditing';

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
  droppable: boolean;
  onLocate: (id: string) => void;
}

function LayerRow({ block, active, droppable, onLocate }: LayerRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: { draggable: false, droppable: !droppable },
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

/** Hotspot de inserção: zona fina que revela o "+" no hover ou no foco. */
function AddGap({ name, position, onAdd }: { name: string; position: number; onAdd: () => void }) {
  return (
    <div className="rb-layers-gap">
      <button
        type="button"
        className="rb-layers-add-between"
        aria-label={`Adicionar widget em ${name}, posição ${position + 1}`}
        onClick={onAdd}
      >
        <Plus className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

interface SectionLayerProps {
  section: ReportSection;
  highlightId?: string | null;
  dragGroup: string | null;
  canAdd: boolean;
  onLocate: (id: string) => void;
  onAddAt: (target: InsertTarget) => void;
}

function SectionLayer({
  section,
  highlightId,
  dragGroup,
  canAdd,
  onLocate,
  onAddAt,
}: SectionLayerProps) {
  const { marker, kind, blocks } = section;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: marker.id,
    disabled: { draggable: false, droppable: dragGroup !== null && dragGroup !== SECTIONS_GROUP },
  });
  const name = sectionDisplayName(section);
  const blocksDroppable = dragGroup === null || dragGroup === marker.id;
  const add = (position: number) => () => onAddAt({ sectionId: marker.id, position });
  return (
    <li
      ref={setNodeRef}
      className="rb-layers-section"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      {/* aria-label num <li> não é anunciado; o grupo rotulado é. */}
      <div role="group" aria-label={`Seção ${name}`}>
        <div
          className={`rb-layers-row rb-layers-section-row${marker.id === highlightId ? ' rb-layers-row-active' : ''}`}
        >
          <button
            type="button"
            className="rb-layers-handle cursor-grab touch-none"
            aria-label="Reordenar seção"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="rb-layers-label" onClick={() => onLocate(marker.id)}>
            {kind === 'general' ? (
              <PanelTop className="rb-layers-icon h-3.5 w-3.5" aria-hidden />
            ) : (
              <PlatformIcon platform={kind} size={14} className="rb-layers-icon" />
            )}
            <span className="rb-layers-label-text">{name}</span>
          </button>
        </div>
        {canAdd && <AddGap name={name} position={0} onAdd={add(0)} />}
        <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ol className="rb-layers-sublist">
            {blocks.map((block, i) => (
              <li key={block.id} className="rb-layers-item">
                <LayerRow
                  block={block}
                  active={block.id === highlightId}
                  droppable={blocksDroppable}
                  onLocate={onLocate}
                />
                {canAdd && <AddGap name={name} position={i + 1} onAdd={add(i + 1)} />}
              </li>
            ))}
          </ol>
        </SortableContext>
      </div>
    </li>
  );
}

export interface LayersPanelProps {
  layout: ReportLayout;
  /** Bloco ou seção atualmente destacado no canvas (espelha o highlight do editor). */
  highlightId?: string | null;
  /** feature_tiktok: sem ela a seção TikTok fica sem "+". Fail closed. */
  tiktokEnabled?: boolean;
  /** Reordena via ids: o pai aplica resolveDragEnd sobre o layout corrente
   * (ref), nunca sobre um closure obsoleto deste componente. */
  onReorder: (activeId: string, overId: string) => void;
  /** Id de bloco ou de marcador de seção. */
  onLocate: (id: string) => void;
  /** Abre o drawer de widgets para inserir na seção e na posição dadas. */
  onAddAt: (target: InsertTarget) => void;
}

export function LayersPanel({
  layout,
  highlightId,
  tiktokEnabled = false,
  onReorder,
  onLocate,
  onAddAt,
}: LayersPanelProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const sections = useMemo(() => toSections(layout), [layout]);
  const [dragGroup, setDragGroup] = useState<string | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setDragGroup(
      sections.some((s) => s.marker.id === id)
        ? SECTIONS_GROUP
        : (sections.find((s) => s.blocks.some((b) => b.id === id))?.marker.id ?? null),
    );
  }
  function handleDragEnd(event: DragEndEvent) {
    setDragGroup(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  }

  return (
    <aside className="rb-layers-rail" aria-label="Camadas do relatório">
      <h3 className="rb-layers-title">Camadas</h3>
      <p className="rb-layers-hint">Arraste para reordenar. Clique para localizar.</p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setDragGroup(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={sections.map((s) => s.marker.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="rb-layers-list">
            {sections.map((section) => (
              <SectionLayer
                key={section.marker.id}
                section={section}
                highlightId={highlightId}
                dragGroup={dragGroup}
                canAdd={section.kind !== 'tiktok' || tiktokEnabled}
                onLocate={onLocate}
                onAddAt={onAddAt}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </aside>
  );
}
