// T2.9 (docs/estudio-plan.md lines 141-158): the editor's vertical left-rail icon dock.
// Owns its own `useImageInsert` instance so it's a working, self-contained drop target on
// its own — a later integration pass may additionally wire a canvas-wide drop zone, but
// this component never depends on that.
//
// Slice 3 (T3.6) added the Brand affordance as a SLOT (`brandPanel`) rather than dock-owned
// logic — the dock stays a self-contained rail with no brand/query knowledge; EstudioPage
// passes the connected <BrandPanel/>. Still out of scope: the AI-generation button (slice 6).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Type, Square, Circle, Upload, FolderOpen, Shapes, Palette, Sparkles } from 'lucide-react';
import rawManifest from '@mesaas/fonts/manifest.json';
import type { FontManifest } from '@mesaas/fonts/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { FilePickerModal } from '@/pages/arquivos/components/FilePickerModal';
import { useImageInsert } from '../../hooks/useImageInsert';
import { generateDesignId } from '../../types';
import type { NormalizedLayer, NormalizedImageLayer } from '../../types';
import type { UploadedEstudioImage } from '../../lib/uploadEstudioImage';

const FONT_MANIFEST = rawManifest as unknown as FontManifest;

// Mirrors EstudioPage.tsx's own pre-measurement fallback formula (font_size * line_height).
const DEFAULT_TEXT_FONT_SIZE = 64;
const DEFAULT_TEXT_LINE_HEIGHT = 1.2;
// 60% of the constant 1080 canvas width.
const DEFAULT_TEXT_WIDTH = 648;

const DEFAULT_SHAPE_SIZE = 300;

// Longer side of an inserted image is capped at this many px (with a floor, see below) so a
// huge source photo doesn't land as an oversized layer that swallows the whole canvas.
const MAX_INSERTED_IMAGE_SIDE = 648;
const MIN_INSERTED_IMAGE_SIDE = 100;
// Cascade offset applied to each subsequent layer in a multi-file insert batch so they don't
// land perfectly stacked (and thus look like a single image).
const INSERT_CASCADE_OFFSET = 20;

export interface LeftToolDockProps {
  canvasWidth: number;
  canvasHeight: number;
  onAddLayer: (layer: NormalizedLayer) => void;
  /** Whether the window-level paste-to-insert listener should be active. Defaults to `true`;
   * pass `false` while some other part of the editor (e.g. a text layer being edited) owns
   * paste. */
  pasteEnabled?: boolean;
  /** Connected BrandPanel content (T3.6). When present, the dock shows a "Marca" button whose
   * popover renders this node. */
  brandPanel?: React.ReactNode;
  /** Connected GerarImagemPanel content (T6.4). When present (feature-gated by the caller), the
   * dock shows an AI button whose popover renders this node. */
  aiPanel?: React.ReactNode;
}

function buildTextLayer(canvasWidth: number, canvasHeight: number, text: string): NormalizedLayer {
  const w = DEFAULT_TEXT_WIDTH;
  const approxHeight = DEFAULT_TEXT_FONT_SIZE * DEFAULT_TEXT_LINE_HEIGHT;
  return {
    id: generateDesignId('layer'),
    name: 'Texto',
    type: 'text',
    w,
    x: (canvasWidth - w) / 2,
    y: (canvasHeight - approxHeight) / 2,
    rotation: 0,
    opacity: 1,
    locked: false,
    text,
    font_key: FONT_MANIFEST.fallbackKey,
    font_weight: 400,
    font_size: DEFAULT_TEXT_FONT_SIZE,
    line_height: DEFAULT_TEXT_LINE_HEIGHT,
    letter_spacing: 0,
    color: '#12151a',
    align: 'left',
  };
}

function buildShapeLayer(
  canvasWidth: number,
  canvasHeight: number,
  shape: 'rect' | 'ellipse',
): NormalizedLayer {
  const size = DEFAULT_SHAPE_SIZE;
  return {
    id: generateDesignId('layer'),
    name: 'Forma',
    type: 'shape',
    shape,
    w: size,
    h: size,
    x: (canvasWidth - size) / 2,
    y: (canvasHeight - size) / 2,
    rotation: 0,
    opacity: 1,
    locked: false,
    fill: { type: 'solid', color: '#eab308' },
  };
}

/** Scales `{width,height}` so the longer side is at most MAX_INSERTED_IMAGE_SIDE (floored at
 * MIN_INSERTED_IMAGE_SIDE to avoid a degenerate near-zero layer on odd metadata), preserving
 * the source aspect ratio. */
function fitInsertedImageSize(width: number, height: number): { w: number; h: number } {
  const longer = Math.max(width, height, 1);
  const scale = Math.min(1, MAX_INSERTED_IMAGE_SIDE / longer);
  const w = Math.max(MIN_INSERTED_IMAGE_SIDE, Math.round(width * scale));
  const h = Math.max(MIN_INSERTED_IMAGE_SIDE, Math.round(height * scale));
  return { w, h };
}

function buildImageLayers(
  canvasWidth: number,
  canvasHeight: number,
  files: UploadedEstudioImage[],
): NormalizedImageLayer[] {
  return files.map((file, index) => {
    const { w, h } = fitInsertedImageSize(file.width, file.height);
    const cascade = index * INSERT_CASCADE_OFFSET;
    return {
      id: generateDesignId('layer'),
      name: 'Imagem',
      type: 'image',
      w,
      h,
      x: (canvasWidth - w) / 2 + cascade,
      y: (canvasHeight - h) / 2 + cascade,
      rotation: 0,
      opacity: 1,
      locked: false,
      file_id: file.file_id,
      fit: 'cover',
    };
  });
}

function DockButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex items-center justify-center transition-colors"
      style={{
        width: 44,
        height: 44,
        borderRadius: 10,
        color: 'var(--text-main)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

export function LeftToolDock({
  canvasWidth,
  canvasHeight,
  onAddLayer,
  pasteEnabled = true,
  brandPanel,
  aiPanel,
}: LeftToolDockProps) {
  const { t } = useTranslation('estudio');
  const [shapePopoverOpen, setShapePopoverOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleInsert = (files: UploadedEstudioImage[]) => {
    for (const layer of buildImageLayers(canvasWidth, canvasHeight, files)) {
      onAddLayer(layer);
    }
  };

  const imageInsert = useImageInsert({ onInsert: handleInsert, enabled: pasteEnabled });

  return (
    <div
      ref={containerRef}
      {...imageInsert.dragDropProps}
      className="flex flex-col items-center"
      style={{
        width: 64,
        padding: '0.75rem 0.5rem',
        gap: '0.5rem',
        borderRight: '1px solid var(--border-color)',
        background: 'var(--card-bg)',
        flexShrink: 0,
        outline: imageInsert.isDragOver ? '2px dashed var(--primary-color)' : undefined,
        outlineOffset: -2,
      }}
    >
      <DockButton
        label={t('dock.addText')}
        onClick={() => onAddLayer(buildTextLayer(canvasWidth, canvasHeight, t('dock.defaultText')))}
      >
        <Type size={20} />
      </DockButton>

      <Popover open={shapePopoverOpen} onOpenChange={setShapePopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={t('dock.addShape')}
            aria-label={t('dock.addShape')}
            className="flex items-center justify-center transition-colors"
            style={{ width: 44, height: 44, borderRadius: 10, color: 'var(--text-main)' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <Shapes size={20} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="right" className="w-auto p-2 flex gap-2">
          <DockButton
            label={t('dock.addRectangle')}
            onClick={() => {
              onAddLayer(buildShapeLayer(canvasWidth, canvasHeight, 'rect'));
              setShapePopoverOpen(false);
            }}
          >
            <Square size={20} />
          </DockButton>
          <DockButton
            label={t('dock.addEllipse')}
            onClick={() => {
              onAddLayer(buildShapeLayer(canvasWidth, canvasHeight, 'ellipse'));
              setShapePopoverOpen(false);
            }}
          >
            <Circle size={20} />
          </DockButton>
        </PopoverContent>
      </Popover>

      <DockButton label={t('dock.uploadImage')} onClick={imageInsert.openFileDialog}>
        <Upload size={20} />
      </DockButton>

      <DockButton label={t('dock.openArquivos')} onClick={imageInsert.openArquivosPicker}>
        <FolderOpen size={20} />
      </DockButton>

      {brandPanel && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t('dock.brand')}
              aria-label={t('dock.brand')}
              data-testid="estudio-dock-brand"
              className="flex items-center justify-center transition-colors"
              style={{ width: 44, height: 44, borderRadius: 10, color: 'var(--text-main)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Palette size={20} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-auto p-4">
            {brandPanel}
          </PopoverContent>
        </Popover>
      )}

      {aiPanel && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              title={t('dock.generateImage')}
              aria-label={t('dock.generateImage')}
              data-testid="estudio-dock-ai"
              className="flex items-center justify-center transition-colors"
              style={{ width: 44, height: 44, borderRadius: 10, color: 'var(--primary-hover)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Sparkles size={20} />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-auto p-4">
            {aiPanel}
          </PopoverContent>
        </Popover>
      )}

      <input
        ref={imageInsert.fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={imageInsert.onFileInputChange}
      />

      <FilePickerModal
        open={imageInsert.isArquivosPickerOpen}
        onClose={imageInsert.closeArquivosPicker}
        onSelect={imageInsert.onArquivosPickerSelect}
        filterKind={['image']}
      />
    </div>
  );
}
