// Hosts the satori render loop inside a fit-to-container stage (docs/estudio-design.md §6.1
// Canvas/ — CanvasStage). Deliberately minimal for this PR: no selection/drag/resize
// (T2.6/T2.7), no toggleable IG safe-zone guides (also T2.6/T2.7) — just proving the render
// pipeline (useSatoriRenderer + useCanvasTransform + SatoriPreview) actually displays a doc.
import { useTranslation } from 'react-i18next';
import { useSatoriRenderer } from '../../hooks/useSatoriRenderer';
import { useCanvasTransform } from '../../hooks/useCanvasTransform';
import { SatoriPreview } from './SatoriPreview';
import type { DesignDoc } from '../../types';

interface CanvasStageProps {
  doc: DesignDoc;
  pageIndex: number;
}

export function CanvasStage({ doc, pageIndex }: CanvasStageProps) {
  const { t } = useTranslation('estudio');
  const { svg, error } = useSatoriRenderer(doc, pageIndex);
  const { containerRef, scale } = useCanvasTransform(doc.canvas.width, doc.canvas.height);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {error ? (
        <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{t('editor.renderError')}</p>
      ) : svg ? (
        <SatoriPreview
          svg={svg}
          width={doc.canvas.width}
          height={doc.canvas.height}
          scale={scale}
        />
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('editor.rendering')}</p>
      )}
    </div>
  );
}
