// Um frame por seção no canvas do editor (spec 2026-10-28-report-platform-sections §Editor):
// barra do topo (SectionFrameHeader), o grid da seção com as células sortable (o MESMO
// grid/widgets do pacote, rb-mode-edit: as células nunca colapsam) e "Adicionar widget" no
// rodapé. O frame é o item sortable da lista de seções; a alça fica no cabeçalho.
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { GripVertical, Minus, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { SortableContext, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { BLOCK_COMPONENTS, SIZE_CLASS } from '@mesaas/report-blocks/BlockRenderer';
import { WIDGET_CATALOG } from '@mesaas/report-blocks/catalog';
import { blockHasData } from '@mesaas/report-blocks/data-presence';
import type { ReportPlatform } from '@mesaas/report-blocks/platform';
import type {
  BlockSize,
  BlockType,
  ReportBlock,
  ReportDocSnapshot,
  ReportSection,
} from '@mesaas/report-blocks/types';
import { TEXT_BLOCK_TYPES } from '@mesaas/report-blocks/types';
import { CoverEditor } from './CoverEditor';
import { SectionHeaderEditor } from './SectionHeaderEditor';
import { SectionFrameHeader, sectionDisplayName } from './SectionFrameHeader';
import {
  IMAGE_SETTINGS_TOGGLE_ATTR,
  ImageBlockEditor,
  type ImageEditorContext,
} from './ImageBlockEditor';

/** Grupo do arraste em curso: "sections" (uma seção) ou o id do marcador da
 * seção do bloco arrastado. Só os droppables do mesmo grupo ficam ativos, então
 * nem o ponteiro nem o teclado miram fora dele. */
export const SECTIONS_GROUP = '__sections__';

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

/** O que cada célula precisa para editar um bloco (repassado pelo canvas). */
export interface CellEditing {
  snapshot: ReportDocSnapshot;
  /** Plataformas do layout (capa: kicker e handle), calculadas uma vez no canvas. */
  platforms: ReportPlatform[];
  highlightId?: string | null;
  onResize: (id: string, delta: 1 | -1) => void;
  onRemove: (id: string) => void;
  onSizeChange: (id: string, size: BlockSize) => void;
  renderTextBlock?: (block: ReportBlock) => ReactNode;
  onConfigChange?: (id: string, patch: Record<string, unknown>) => void;
  imageContext?: ImageEditorContext;
}

function SortableCell({
  block,
  editing,
  droppable,
}: {
  block: ReportBlock;
  editing: CellEditing;
  droppable: boolean;
}) {
  const { snapshot, platforms, renderTextBlock, onConfigChange, imageContext } = editing;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: { draggable: false, droppable: !droppable },
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
  const [imgSettingsOpen, setImgSettingsOpen] = useState(false);
  // Sem contexto (ou sem onConfigChange) o bloco Imagem renderiza como na view.
  const imageEditing =
    block.type === 'image' && onConfigChange && imageContext
      ? { onConfigChange, context: imageContext }
      : null;
  const body =
    isText && renderTextBlock ? (
      renderTextBlock(block)
    ) : block.type === 'cover' && onConfigChange ? (
      <CoverEditor
        block={block}
        snapshot={snapshot}
        onConfigChange={onConfigChange}
        layoutPlatforms={platforms}
      />
    ) : imageEditing ? (
      <ImageBlockEditor
        block={block}
        snapshot={snapshot}
        context={imageEditing.context}
        onConfigChange={imageEditing.onConfigChange}
        onSizeChange={(size) => editing.onSizeChange(block.id, size)}
        settingsOpen={imgSettingsOpen}
        onSettingsOpenChange={setImgSettingsOpen}
      />
    ) : block.type === 'section_header' && onConfigChange ? (
      <SectionHeaderEditor block={block} onConfigChange={onConfigChange} />
    ) : Component && !blockHasData(block, snapshot) ? (
      <NoDataPlaceholder type={block.type} />
    ) : Component ? (
      <Component block={block} snapshot={snapshot} layoutPlatforms={platforms} />
    ) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-block-id={block.id}
      className={`${block.type === 'cover' ? 'rb-full' : (SIZE_CLASS[block.size] ?? 'rb-full')} rb-edit-cell${block.id === editing.highlightId ? ' rb-edit-highlight' : ''}`}
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
        {block.type !== 'cover' && (
          <>
            <button
              type="button"
              className="rb-edit-btn"
              aria-label="Diminuir largura"
              onClick={() => editing.onResize(block.id, -1)}
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rb-edit-btn"
              aria-label="Aumentar largura"
              onClick={() => editing.onResize(block.id, 1)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            {imageEditing && (
              <button
                type="button"
                className="rb-edit-btn"
                aria-label="Ajustes da imagem"
                aria-pressed={imgSettingsOpen}
                {...{ [IMAGE_SETTINGS_TOGGLE_ATTR]: block.id }}
                onClick={() => setImgSettingsOpen((v) => !v)}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="rb-edit-btn rb-edit-btn-danger"
          aria-label="Excluir bloco"
          onClick={() => editing.onRemove(block.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="rb-edit-body">{body}</div>
    </div>
  );
}

export interface SectionFrameProps {
  section: ReportSection;
  index: number;
  count: number;
  editing: CellEditing;
  /** Grupo do arraste em curso (null = nenhum). */
  dragGroup: string | null;
  /** Ausente = sem "Adicionar widget" (ex.: TikTok sem feature_tiktok). */
  onAddWidget?: () => void;
  onTitleChange: (title: string) => void;
  onMove: (delta: 1 | -1) => void;
  onToggleHideHeader: () => void;
  onRemove: () => void;
}

export function SectionFrame({
  section,
  index,
  count,
  editing,
  dragGroup,
  onAddWidget,
  onTitleChange,
  onMove,
  onToggleHideHeader,
  onRemove,
}: SectionFrameProps) {
  const { marker, kind, blocks } = section;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: marker.id,
    disabled: { draggable: false, droppable: dragGroup !== null && dragGroup !== SECTIONS_GROUP },
  });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const name = sectionDisplayName(section);
  const { snapshot } = editing;
  // TikTok sem dado no snapshot fica sem @ (nunca o do Instagram).
  const handle =
    kind === 'tiktok'
      ? snapshot.tiktok?.account.handle
      : kind === 'instagram'
        ? snapshot.account.handle
        : null;
  const cellsDroppable = dragGroup === null || dragGroup === marker.id;

  return (
    <section
      ref={setNodeRef}
      style={style}
      data-section-id={marker.id}
      aria-label={`Seção ${name}`}
      className={`rb-section-frame${marker.id === editing.highlightId ? ' rb-edit-highlight' : ''}`}
    >
      <SectionFrameHeader
        section={section}
        index={index}
        count={count}
        handle={handle}
        dragHandleProps={{ ...attributes, ...listeners }}
        onTitleChange={onTitleChange}
        onMove={onMove}
        onToggleHideHeader={onToggleHideHeader}
        onRemove={onRemove}
      />
      <div className="rb-section-frame-body">
        <SortableContext items={blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
          <div className="rb-grid rb-mode-edit">
            {blocks.map((block) => (
              <SortableCell
                key={block.id}
                block={block}
                editing={editing}
                droppable={cellsDroppable}
              />
            ))}
          </div>
        </SortableContext>
        {onAddWidget && (
          <button
            type="button"
            className="rb-section-frame-add"
            aria-label={`Adicionar widget na seção ${name}`}
            onClick={onAddWidget}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar widget
          </button>
        )}
      </div>
    </section>
  );
}
