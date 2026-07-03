// Route entry (docs/estudio-design.md §6.1): /estudio (picker) + /estudio/:postId (editor).
// The full editor chrome (Toolbar/Dock/SlideStrip — T2.6 onward) doesn't exist yet; this PR wires
// the picker, the entry flows, the get-or-create query, and the actual satori-rendered canvas
// (T2.4) end to end. Always shows page 0 — page switching is T2.10's SlideStrip.
import { useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PostPicker from './components/PostPicker';
import { CanvasStage } from './components/Canvas/CanvasStage';
import { usePostDesignQuery, PostDesignError } from './hooks/usePostDesignQuery';
import { useDesignDocState } from './hooks/useDesignDocState';
import { useTextMeasurement } from './hooks/useTextMeasurement';
import type { NormalizedLayer, NormalizedTextLayer } from './types';

function EstudioEditorShell({ postId }: { postId: number }) {
  const { t } = useTranslation('estudio');
  const query = usePostDesignQuery(postId);
  const state = useDesignDocState(
    query.data?.design ?? {
      version: 1,
      format: 'feed',
      aspect_ratio: '1:1',
      canvas: { width: 1080, height: 1080 },
      pages: [],
      fileIds: [],
    },
  );

  useEffect(() => {
    if (query.data) state.load(query.data.design);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const activePageIndex = Math.max(
    0,
    state.doc.pages.findIndex((p) => p.id === state.activePageId),
  );
  const measurement = useTextMeasurement(state.doc, activePageIndex);
  const getTextHeight = useCallback(
    (layer: NormalizedTextLayer) =>
      measurement.heights.get(layer.id)?.height ?? layer.font_size * layer.line_height,
    [measurement.heights],
  );
  const onUpdateLayer = useCallback(
    (layerId: string, patch: Partial<NormalizedLayer>) => {
      state.dispatch({ type: 'layer/update', pageId: state.activePageId, layerId, patch });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.activePageId],
  );

  if (query.isLoading) {
    return (
      <div className="page-full-bleed flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>{t('editor.loading')}</p>
      </div>
    );
  }

  if (query.isError) {
    const err = query.error;
    const message =
      err instanceof PostDesignError && err.code === 'post_not_found'
        ? t('editor.notFound')
        : t('editor.loadError');
    return (
      <div className="page-full-bleed flex items-center justify-center">
        <p style={{ color: 'var(--danger)' }}>{message}</p>
      </div>
    );
  }

  const layerCount = state.doc.pages.reduce((n, p) => n + p.layers.length, 0);

  return (
    <div className="page-full-bleed" style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          padding: '0.75rem clamp(1.25rem, 3vw, 2.5rem)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: 'var(--font-heading)', fontWeight: 900 }}>{t('title')}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginLeft: '0.75rem' }}>
          {t('editor.pageCount', { count: state.doc.pages.length })} ·{' '}
          {t('editor.layerCount', { count: layerCount })}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CanvasStage
          doc={state.doc}
          pageIndex={activePageIndex}
          selection={state.selection}
          select={state.select}
          onUpdateLayer={onUpdateLayer}
          getTextHeight={getTextHeight}
        />
      </div>
    </div>
  );
}

export default function EstudioPage() {
  const { postId: postIdParam } = useParams<{ postId?: string }>();

  if (!postIdParam) return <PostPicker />;

  const postId = parseInt(postIdParam, 10);
  if (isNaN(postId)) return <PostPicker />;

  return <EstudioEditorShell postId={postId} />;
}
