// T7.4 LayerListPanel (docs/estudio-design.md §6.1 Layers/ — "z-order, lock"). A right-rail list
// of the active page's layers, TOPMOST-FIRST (the reverse of the doc's paint order, so the row at
// the top is the layer painted last / on top — the mental model every layers panel uses).
//
// Scope (plan §15 acceptance 21): reorder (dnd-kit) + lock toggle + click-to-select ONLY. There is
// deliberately NO hide/visibility toggle — the schema has no `hidden` field and slice 7 must not
// add one. Lock is enforced at hit-testing (layerGeometry.hitTestLayers skips locked layers) and in
// InteractionOverlay (a locked layer selected here shows no transform handles).
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Type, Image as ImageIcon, Square, Lock, LockOpen } from 'lucide-react';
import type { NormalizedLayer } from '../../types';

export interface LayerListPanelProps {
  /** The active page's layers in DOC order (index 0 = bottom / painted first). */
  layers: NormalizedLayer[];
  /** Currently-selected layer ids (single-select in this PR, but the field stays an array). */
  selection: string[];
  onSelect: (ids: string[]) => void;
  /** Reorders `layerId` to the given ABSOLUTE array index (0 = bottom). */
  onReorder: (layerId: string, toIndex: number) => void;
  onToggleLock: (layerId: string, locked: boolean) => void;
}

function TypeIcon({ type }: { type: NormalizedLayer['type'] }) {
  if (type === 'text') return <Type size={14} />;
  if (type === 'image') return <ImageIcon size={14} />;
  return <Square size={14} />;
}

export function LayerListPanel({
  layers,
  selection,
  onSelect,
  onReorder,
  onToggleLock,
}: LayerListPanelProps) {
  const { t } = useTranslation('estudio');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Topmost-first for display; the doc array stays bottom-first.
  const display = [...layers].reverse();
  const n = layers.length;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const toDisplay = display.findIndex((l) => l.id === over.id);
    if (toDisplay < 0) return;
    // Display slot d ↔ array index n-1-d. Move the dragged layer into the array slot the drop
    // target occupies (reorderLayer clamps and no-ops if it lands where it already is).
    onReorder(String(active.id), n - 1 - toDisplay);
  }

  return (
    <aside
      data-testid="layer-list-panel"
      style={{
        width: 220,
        flexShrink: 0,
        borderLeft: '1px solid var(--border-color)',
        background: 'var(--card-bg)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          padding: '0.75rem 1rem',
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        {t('layers.title')}
      </div>

      {display.length === 0 ? (
        <p style={{ padding: '1rem', fontSize: '0.8rem', color: 'var(--text-light)' }}>
          {t('layers.empty')}
        </p>
      ) : (
        <div style={{ overflowY: 'auto', minHeight: 0, padding: '0.5rem' }}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={display.map((l) => l.id)}
              strategy={verticalListSortingStrategy}
            >
              {display.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  selected={selection.includes(layer.id)}
                  onSelect={() => onSelect([layer.id])}
                  onToggleLock={() => onToggleLock(layer.id, !layer.locked)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </aside>
  );
}

interface LayerRowProps {
  layer: NormalizedLayer;
  selected: boolean;
  onSelect: () => void;
  onToggleLock: () => void;
}

function LayerRow({ layer, selected, onSelect, onToggleLock }: LayerRowProps) {
  const { t } = useTranslation('estudio');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: layer.id,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '0.4rem 0.5rem',
    borderRadius: 8,
    marginBottom: 2,
    background: selected ? 'var(--surface-hover)' : 'transparent',
    border: selected ? '1px solid var(--primary-color)' : '1px solid transparent',
    boxSizing: 'border-box',
    cursor: 'pointer',
  };

  return (
    <div ref={setNodeRef} style={style} data-testid={`layer-row-${layer.id}`}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={t('layers.dragHandle')}
        title={t('layers.dragHandle')}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...iconButtonStyle,
          cursor: 'grab',
          touchAction: 'none',
          color: 'var(--text-light)',
        }}
      >
        <GripVertical size={14} />
      </button>

      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: 'var(--text-main)',
          textAlign: 'left',
        }}
      >
        <span style={{ color: 'var(--text-muted)', display: 'flex', flexShrink: 0 }}>
          <TypeIcon type={layer.type} />
        </span>
        <span
          style={{
            fontSize: '0.8rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {layer.name}
        </span>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        aria-label={layer.locked ? t('layers.unlock') : t('layers.lock')}
        aria-pressed={layer.locked}
        title={layer.locked ? t('layers.unlock') : t('layers.lock')}
        style={{
          ...iconButtonStyle,
          color: layer.locked ? 'var(--primary-color)' : 'var(--text-light)',
        }}
      >
        {layer.locked ? <Lock size={14} /> : <LockOpen size={14} />}
      </button>
    </div>
  );
}

const iconButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  padding: 0,
  flexShrink: 0,
  cursor: 'pointer',
};
