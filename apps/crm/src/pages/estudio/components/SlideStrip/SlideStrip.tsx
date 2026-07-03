// T2.10 SlideStrip (docs/estudio-design.md §6.1/§6.4): horizontal, dnd-kit-reorderable strip of
// page thumbnails. Add/duplicate/delete/reorder are enabled only for `format === 'carrossel'` —
// `feed`/`reel_cover` are schema-locked to exactly 1 page (design-doc.ts Stage 1 rule: `format
// !== 'carrossel' => pages.length === 1`), so those formats render a single static, non-
// interactive thumbnail with no buttons/drag affordance.
//
// Narrow intent-callback props (setActivePage/onAddPage/onDuplicatePage/onRemovePage/
// onReorderPages), not a raw dispatch — matches CanvasStage.tsx's existing style. The
// integration agent wires these to `useDesignDocState`'s dispatch in EstudioPage.tsx.
//
// This component is a thin, mostly-stateless view over `doc.pages` — it holds no local copy of
// page order; drag-end just computes from/to indices and calls `onReorderPages`, and the actual
// array move happens in the reducer (`page/reorder`), same as PostMediaGallery.tsx's pattern
// (apps/crm/src/pages/entregas/components/PostMediaGallery.tsx) except we don't optimistically
// reorder a local array first, to avoid ever desyncing from the `doc.pages` prop.
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Copy, Trash2 } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { usePageThumbnails } from '../../hooks/usePageThumbnails';
import { SatoriPreview } from '../Canvas/SatoriPreview';
import type { DesignDoc, NormalizedPage } from '../../types';

// Schema cap (design-doc.ts: `z.array(Page).min(1).max(10)`) — mirrored here so the UI can
// disable "add page" before a doomed dispatch, not because the reducer needs this guard (it
// doesn't enforce the cap itself; validation happens on save).
const MAX_PAGES = 10;

export interface SlideStripProps {
  doc: DesignDoc;
  activePageId: string;
  setActivePage: (pageId: string) => void;
  onAddPage: () => void;
  onDuplicatePage: (pageId: string) => void;
  onRemovePage: (pageId: string) => void;
  onReorderPages: (fromIndex: number, toIndex: number) => void;
}

export function SlideStrip({
  doc,
  activePageId,
  setActivePage,
  onAddPage,
  onDuplicatePage,
  onRemovePage,
  onReorderPages,
}: SlideStripProps) {
  const { t } = useTranslation('estudio');
  const { thumbnails } = usePageThumbnails(doc);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const interactive = doc.format === 'carrossel';
  const atMaxPages = doc.pages.length >= MAX_PAGES;
  const atMinPages = doc.pages.length <= 1;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!interactive || !over || active.id === over.id) return;
    const fromIndex = doc.pages.findIndex((p) => p.id === active.id);
    const toIndex = doc.pages.findIndex((p) => p.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    onReorderPages(fromIndex, toIndex);
  }

  return (
    <div
      data-testid="slide-strip"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.75rem clamp(1.25rem, 3vw, 2.5rem)',
        borderTop: '1px solid var(--border-color)',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={doc.pages.map((p) => p.id)}
          strategy={horizontalListSortingStrategy}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {doc.pages.map((page, index) => (
              <SlideTile
                key={page.id}
                page={page}
                index={index}
                svg={thumbnails.get(page.id)}
                canvasWidth={doc.canvas.width}
                canvasHeight={doc.canvas.height}
                isActive={page.id === activePageId}
                interactive={interactive}
                deleteDisabled={atMinPages}
                onSelect={() => setActivePage(page.id)}
                onDuplicate={() => onDuplicatePage(page.id)}
                onRemove={() => onRemovePage(page.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {interactive && (
        <button
          type="button"
          onClick={onAddPage}
          disabled={atMaxPages}
          title={
            atMaxPages
              ? t('slideStrip.maxPagesReached', { max: MAX_PAGES })
              : t('slideStrip.addPage')
          }
          aria-label={t('slideStrip.addPage')}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: 8,
            border: '1px dashed var(--border-color)',
            backgroundColor: 'transparent',
            color: atMaxPages ? 'var(--text-light)' : 'var(--text-muted)',
            cursor: atMaxPages ? 'not-allowed' : 'pointer',
            flexShrink: 0,
          }}
        >
          <Plus size={16} />
        </button>
      )}
    </div>
  );
}

interface SlideTileProps {
  page: NormalizedPage;
  index: number;
  svg: string | undefined;
  canvasWidth: number;
  canvasHeight: number;
  isActive: boolean;
  interactive: boolean;
  deleteDisabled: boolean;
  onSelect: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

const TILE_WIDTH = 64;

function SlideTile({
  page,
  index,
  svg,
  canvasWidth,
  canvasHeight,
  isActive,
  interactive,
  deleteDisabled,
  onSelect,
  onDuplicate,
  onRemove,
}: SlideTileProps) {
  const { t } = useTranslation('estudio');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled: !interactive,
  });
  const tileHeight = TILE_WIDTH * (canvasHeight / canvasWidth);
  const bgColor = page.background.type === 'solid' ? page.background.color : 'var(--surface-hover)';

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
    >
      <div
        {...(interactive ? attributes : {})}
        {...(interactive ? listeners : {})}
        // A feed/reel_cover doc's single page has nowhere else to navigate TO (design-doc.ts locks
        // it to exactly 1 page) — exposing this tile as a focusable/clickable "button" here would be
        // misleading (invites tabbing/keyboard interaction that can never do anything meaningful) and
        // contradicts this codebase's own convention of a real non-interactive state rather than a
        // half-gated affordance (see apps/crm/src/pages/cliente-detalhe/BriefingReorder.tsx's actual
        // `disabled` prop). Gated the same way the drag attrs/listeners above already are.
        {...(interactive
          ? {
              onClick: onSelect,
              role: 'button',
              tabIndex: 0,
              'aria-pressed': isActive,
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect();
                }
              },
            }
          : {})}
        aria-label={t('slideStrip.pageLabel', { number: index + 1 })}
        className="group"
        style={{
          position: 'relative',
          width: TILE_WIDTH,
          height: tileHeight,
          borderRadius: 6,
          overflow: 'hidden',
          cursor: interactive ? 'grab' : 'default',
          touchAction: 'none',
          border: isActive ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
          boxSizing: 'border-box',
          backgroundColor: bgColor,
          flexShrink: 0,
        }}
      >
        {svg ? (
          <div
            data-testid="slide-tile-thumbnail"
            style={{ position: 'relative', width: '100%', height: '100%' }}
          >
            <SatoriPreview svg={svg} />
          </div>
        ) : (
          <div data-testid="slide-tile-placeholder" style={{ width: '100%', height: '100%' }} />
        )}

        {interactive && (
          <div
            style={{
              position: 'absolute',
              top: 2,
              right: 2,
              display: 'flex',
              gap: 2,
            }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDuplicate();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              title={t('slideStrip.duplicatePage')}
              aria-label={t('slideStrip.duplicatePage')}
              style={iconButtonStyle}
            >
              <Copy size={10} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!deleteDisabled) onRemove();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={deleteDisabled}
              title={
                deleteDisabled ? t('slideStrip.cannotRemoveLastPage') : t('slideStrip.removePage')
              }
              aria-label={t('slideStrip.removePage')}
              style={{
                ...iconButtonStyle,
                opacity: deleteDisabled ? 0.4 : 1,
                cursor: deleteDisabled ? 'not-allowed' : 'pointer',
              }}
            >
              <Trash2 size={10} />
            </button>
          </div>
        )}
      </div>
      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{index + 1}</span>
    </div>
  );
}

const iconButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  borderRadius: 4,
  border: 'none',
  backgroundColor: 'rgba(18, 21, 26, 0.75)',
  color: '#fff',
  cursor: 'pointer',
  padding: 0,
};
