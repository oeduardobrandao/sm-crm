// Canvas de edição do relatório de blocos, por seção (spec 2026-10-28-report-platform-sections
// §Editor): um frame por seção (SectionFrame), cada um com o próprio grid do pacote e células
// sortable (dnd-kit). Uma lista sortable de seções por fora (arraste pela barra da seção) e
// uma por seção por dentro; o fim do arraste passa por resolveDragEnd, que só reordena
// blocos dentro da seção e seções entre si. O BlockRenderer do pacote fica para view/print.
import type { CSSProperties, ReactNode } from 'react';
import { Fragment, useMemo, useState } from 'react';
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
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { PanelTop } from 'lucide-react';
import { BLOCK_COMPONENTS } from '@mesaas/report-blocks/BlockRenderer';
import { PlatformIcon } from '@mesaas/report-blocks/PlatformIcon';
import { ReportFonts } from '@mesaas/report-blocks/ReportFonts';
import { resolveReportTheme } from '@mesaas/report-blocks/theme';
import { layoutPlatforms, type ReportPlatform } from '@mesaas/report-blocks/platform';
import type {
  ReportBlock,
  ReportDocSnapshot,
  ReportLayout,
  SectionKind,
} from '@mesaas/report-blocks/types';
import { isSectionMarker, toSections } from '@mesaas/report-blocks/types';
import {
  moveSection,
  removeBlock,
  removeSection,
  resizeBlock,
  resolveDragEnd,
  setBlockSize,
  updateSectionConfig,
} from './layoutOps';
import type { ImageEditorContext } from './ImageBlockEditor';
import type { InsertTarget } from './useBlockEditing';
import { AddSectionMenu } from './AddSectionMenu';
import { SECTIONS_GROUP, SectionFrame, type CellEditing } from './SectionFrame';
import { sectionDisplayName } from './SectionFrameHeader';

export interface EditorCanvasProps {
  /** Layout canônico (as páginas rodam sectionizeLayout ao abrir). */
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
  /** Habilita o editor do bloco Imagem; ausente = bloco renderiza como na view. */
  imageContext?: ImageEditorContext;
  /** feature_tiktok do workspace: sem ela, nada de TikTok entra (a seção que
   * já existe renderiza e sai, mas sem "Adicionar widget"). Fail closed. */
  tiktokEnabled?: boolean;
  /** Plataformas com dados: "all" no modelo; relatório = documentPlatforms(snapshot). */
  availablePlatforms?: ReportPlatform[] | 'all';
  /** "Adicionar widget" no rodapé da seção; ausente = sem o botão. */
  onAddWidget?: (target: InsertTarget) => void;
  /** "Adicionar seção" depois de `afterSectionId` (null = layout vazio); ausente = sem menu. */
  onAddSection?: (kind: SectionKind, afterSectionId: string | null) => void;
  /** Ausente = onChange com a seção removida. Presente = o chamador assume (desfazer). */
  onRemoveSection?: (id: string) => void;
  /** Título da seção (o chamador agrupa a digitação no histórico). Ausente = onChange. */
  onSectionConfigChange?: (id: string, patch: { title: string }) => void;
}

export function EditorCanvas({
  layout,
  snapshot,
  onChange,
  highlightId,
  renderTextBlock,
  onRemoveBlock,
  onConfigChange,
  imageContext,
  tiktokEnabled = false,
  availablePlatforms = 'all',
  onAddWidget,
  onAddSection,
  onRemoveSection,
  onSectionConfigChange,
}: EditorCanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const theme = resolveReportTheme(layout, snapshot);
  const platforms = layoutPlatforms(layout);
  // Memo por layout: num layout legado (só testes; as páginas seccionam ao
  // abrir) os marcadores sintetizados ganham ids novos a cada toSections.
  const sections = useMemo(() => toSections(layout), [layout]);
  const kinds = sections.map((s) => s.kind);

  const activeBlock = activeId ? layout.blocks.find((b) => b.id === activeId) : undefined;
  // Grupo do arraste: seções entre si, ou blocos da mesma seção.
  const dragGroup = !activeBlock
    ? null
    : isSectionMarker(activeBlock)
      ? SECTIONS_GROUP
      : (sections.find((s) => s.blocks.some((b) => b.id === activeBlock.id))?.marker.id ?? null);

  function apply(next: ReportLayout) {
    if (next !== layout) onChange(next);
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    apply(resolveDragEnd(layout, String(active.id), String(over.id)));
  }

  const editing: CellEditing = {
    snapshot,
    platforms,
    highlightId,
    onResize: (id, delta) => apply(resizeBlock(layout, id, delta)),
    onRemove: (id) => (onRemoveBlock ? onRemoveBlock(id) : apply(removeBlock(layout, id))),
    onSizeChange: (id, size) => apply(setBlockSize(layout, id, size)),
    renderTextBlock,
    onConfigChange,
    imageContext,
  };

  const overlayBlock = activeBlock && !isSectionMarker(activeBlock) ? activeBlock : null;
  // Arrastando uma seção: o frame fica no lugar (e desliza para a vaga nova) e
  // uma etiqueta compacta (ícone + nome) segue o ponteiro; um frame alto inteiro
  // sob o cursor tapa as vagas.
  const overlaySection =
    activeBlock && isSectionMarker(activeBlock)
      ? sections.find((s) => s.marker.id === activeBlock.id)
      : undefined;
  const OverlayComponent =
    overlayBlock && Object.prototype.hasOwnProperty.call(BLOCK_COMPONENTS, overlayBlock.type)
      ? BLOCK_COMPONENTS[overlayBlock.type]
      : null;

  const addSectionMenu = (afterSectionId: string | null) =>
    onAddSection ? (
      <AddSectionMenu
        existing={kinds}
        tiktokEnabled={tiktokEnabled}
        availablePlatforms={availablePlatforms}
        onAdd={(kind) => onAddSection(kind, afterSectionId)}
      />
    ) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <ReportFonts layout={layout} snapshot={snapshot} />
      <div
        className={`rb-edit-doc${theme.themeClass ? ` ${theme.themeClass}` : ''}`}
        style={theme.vars as CSSProperties}
      >
        <SortableContext
          items={sections.map((s) => s.marker.id)}
          strategy={verticalListSortingStrategy}
        >
          {sections.map((section, i) => (
            <Fragment key={section.marker.id}>
              <SectionFrame
                section={section}
                index={i}
                count={sections.length}
                editing={editing}
                dragGroup={dragGroup}
                onAddWidget={
                  onAddWidget && (section.kind !== 'tiktok' || tiktokEnabled)
                    ? () => onAddWidget({ sectionId: section.marker.id })
                    : undefined
                }
                onTitleChange={(title) =>
                  onSectionConfigChange
                    ? onSectionConfigChange(section.marker.id, { title })
                    : apply(updateSectionConfig(layout, section.marker.id, { title }))
                }
                onMove={(delta) => apply(moveSection(layout, section.marker.id, delta))}
                onToggleHideHeader={() =>
                  apply(
                    updateSectionConfig(layout, section.marker.id, {
                      hideHeader: section.marker.config?.hideHeader !== true,
                    }),
                  )
                }
                onRemove={() =>
                  onRemoveSection
                    ? onRemoveSection(section.marker.id)
                    : apply(removeSection(layout, section.marker.id))
                }
              />
              {addSectionMenu(section.marker.id)}
            </Fragment>
          ))}
        </SortableContext>
        {sections.length === 0 && addSectionMenu(null)}
      </div>
      <DragOverlay>
        {overlayBlock && OverlayComponent && (
          <div className="rb-edit-overlay" data-drag-overlay={overlayBlock.id}>
            <OverlayComponent
              block={overlayBlock}
              snapshot={snapshot}
              layoutPlatforms={platforms}
            />
          </div>
        )}
        {overlaySection && (
          <div
            className="rb-edit-overlay rb-section-overlay"
            data-drag-overlay={overlaySection.marker.id}
          >
            {overlaySection.kind === 'general' ? (
              <PanelTop className="h-4 w-4" aria-hidden />
            ) : (
              <PlatformIcon platform={overlaySection.kind} size={18} />
            )}
            <span>{sectionDisplayName(overlaySection)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
