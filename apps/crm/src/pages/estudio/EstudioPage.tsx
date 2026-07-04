// Route entry (docs/estudio-design.md §6.1): /estudio (picker) + /estudio/:postId (editor).
// PR 2.C wires up the full editor chrome: LeftToolDock (T2.9), ContextualToolbar (T2.12),
// SlideStrip (T2.10), and TextEditOverlay (T2.8, wired inside CanvasStage/InteractionOverlay).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { FilePickerModal } from '@/pages/arquivos/components/FilePickerModal';
import { listPostMedia } from '@/services/postMedia';
import { cleanupAbandonedDraft } from './hooks/useEstudioEntryFlow';
import { useAutosave } from './hooks/useAutosave';
import { TopToolbar } from './components/Toolbar';
import PostPicker from './components/PostPicker';
import { CanvasStage } from './components/Canvas/CanvasStage';
import { LeftToolDock, BrandPanel, GerarImagemPanel } from './components/Dock';
import ContextualToolbar from './components/Toolbar';
import { SlideStrip } from './components/SlideStrip';
import { usePostDesignQuery, PostDesignError } from './hooks/usePostDesignQuery';
import { useDesignDocState } from './hooks/useDesignDocState';
import { useEditorShortcuts } from './hooks/useEditorShortcuts';
import { useTextMeasurement } from './hooks/useTextMeasurement';
import { useImageInsert } from './hooks/useImageInsert';
import { usePostBrand } from './hooks/usePostBrand';
import { buildFontFamilyPatch } from './hooks/useFontManifest';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { generateDesignId } from './types';
import type { NormalizedLayer, NormalizedPage, NormalizedTextLayer } from './types';
import type { UploadedEstudioImage } from './lib/uploadEstudioImage';

/** Scales `{width,height}` so the longer side is capped at `maxSide` (floored at 100px to avoid a
 * degenerate near-zero layer on odd metadata), preserving the source aspect ratio. Mirrors
 * LeftToolDock.tsx's own `fitInsertedImageSize`, except the cap here is the layer's EXISTING `w`
 * (see `handleReplaceImage` below) rather than a fixed constant — replacing an image should not
 * wildly resize a layer the user has already carefully placed/sized. */
export function fitReplacementImageSize(
  width: number,
  height: number,
  maxSide: number,
): { w: number; h: number } {
  const longer = Math.max(width, height, 1);
  const scale = Math.min(1, maxSide / longer);
  const w = Math.max(100, Math.round(width * scale));
  const h = Math.max(100, Math.round(height * scale));
  return { w, h };
}

function buildBlankPage(): NormalizedPage {
  return {
    id: generateDesignId('page'),
    background: { type: 'solid', color: '#ffffff' },
    layers: [],
  };
}

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

  // T2.11 autosave (design §6.2): the full concurrency protocol lives in useAutosave; this shell
  // wires the reducer adoption path, re-baselines on every fresh server doc (initial load AND
  // the conflict banner's Recarregar refetch), renders the conflict banner, and holds departure
  // while dirty via the router blocker below.
  const adoptNormalized = useCallback(
    (doc: NonNullable<typeof query.data>['design']) => state.dispatch({ type: 'doc/adopt', doc }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const autosave = useAutosave({
    postId,
    doc: state.doc,
    adoptNormalized,
    enabled: query.isSuccess,
  });

  useEffect(() => {
    if (query.data) {
      state.load(query.data.design);
      autosave.reset(query.data.design, query.data.rev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  // Dirty-navigation blocker (design §6.2: "a React Router navigation blocker holds departure
  // while dirty"). While blocked: flush; departure proceeds when the save lands ('saved' flips
  // shouldBlock off). If the save can never succeed (deterministic 4xx) the work is stashed and
  // departure allowed — trapping the user on a page whose save always 400s helps no one.
  const shouldBlock = autosave.status === 'dirty' || autosave.status === 'saving';
  const blocker = useBlocker(shouldBlock);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (!shouldBlock) {
      blocker.proceed();
      return;
    }
    if (autosave.lastFailureWasDeterministic()) {
      autosave.stashNow();
      blocker.proceed();
      return;
    }
    void autosave.flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state, shouldBlock, autosave.status]);

  // T2.3 abandonment cleanup: this post/workflow pair was synthesized by the picker's
  // "Criar novo" moments ago (router-state marker) — if the user leaves the editor having added
  // ZERO layers, delete it again instead of leaving a junk workflow behind. Layer count comes
  // through a ref so the unmount cleanup sees the LATEST doc, not the mount-time one.
  const location = useLocation();
  const syntheticDraft = (
    location.state as {
      estudioSyntheticDraft?: { workflowId: number; postId: number };
    } | null
  )?.estudioSyntheticDraft;
  const layerCountRef = useRef(0);
  useEffect(() => {
    layerCountRef.current = state.doc.pages.reduce((n, p) => n + p.layers.length, 0);
  }, [state.doc]);
  useEffect(() => {
    if (!syntheticDraft || syntheticDraft.postId !== postId) return;
    return () => {
      if (layerCountRef.current > 0) return;
      void cleanupAbandonedDraft(syntheticDraft.postId, syntheticDraft.workflowId);
    };
  }, [syntheticDraft, postId]);

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
  const onAddLayer = useCallback(
    (layer: NormalizedLayer) => {
      state.dispatch({ type: 'layer/add', pageId: state.activePageId, layer });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.activePageId],
  );

  // TextEditOverlay's modal takeover (InteractionOverlay's `editingLayerId` !== null) is the
  // cleanest available "is the user currently typing into a text layer" signal — lifted up via
  // CanvasStage's `onEditingChange` passthrough so LeftToolDock's window-level paste-to-insert
  // listener can be disabled while it's active (JUDGMENT CALL: a slightly looser signal than
  // "some contenteditable somewhere has focus" would also work, but this one is exact and doesn't
  // require guessing at focus events from outside the editor component tree).
  const [isTextEditing, setIsTextEditing] = useState(false);

  const selection = state.selection;
  const activePage = state.doc.pages[activePageIndex];
  const selectedLayer =
    selection.length === 1 ? (activePage?.layers.find((l) => l.id === selection[0]) ?? null) : null;

  // T7.3 keyboard shortcuts — Delete, arrow-nudge (Shift = 10px, burst-coalesced), Cmd/Ctrl+D
  // duplicate, undo/redo, Escape deselect. Inert while typing (isTextEditing or a focused field).
  useEditorShortcuts({
    activePage,
    activePageId: state.activePageId,
    selection,
    dispatch: state.dispatch,
    select: state.select,
    undo: state.undo,
    redo: state.redo,
    isTextEditing,
    enabled: query.isSuccess,
  });

  // Second, independent `useImageInsert` instance dedicated to ContextualToolbar's "Substituir
  // imagem" action — LeftToolDock owns its own instance for ADDING new layers; this one PATCHES
  // an existing image layer's `file_id`/`w`/`h` instead. `replaceTargetRef` captures which layer
  // id the replacement is for at the moment the user triggers it (button click / Arquivos picker
  // open), since `onInsert` fires asynchronously afterward and by then `selectedLayer` may have
  // already changed (e.g. the picker modal briefly steals focus/selection state elsewhere).
  const replaceTargetRef = useRef<string | null>(null);
  const handleReplaceInsert = useCallback(
    (files: UploadedEstudioImage[]) => {
      const targetId = replaceTargetRef.current;
      const file = files[0];
      if (!targetId || !file) return;
      const targetLayer = activePage?.layers.find((l) => l.id === targetId);
      if (!targetLayer || targetLayer.type !== 'image') return;
      // Cap the replacement image's longer side at the EXISTING layer's own longer side (w OR h,
      // whichever is bigger) — capping against `w` alone (the original implementation) let a
      // portrait replacement swapped into a wide-but-short layer balloon `h` far past the layer's
      // own footprint, since only `w` was ever bounded. Using max(w,h) as the budget keeps the
      // "don't wildly resize a layer the user already sized" intent correct regardless of the
      // existing layer's own orientation — documented per the brief's explicit ask.
      const { w, h } = fitReplacementImageSize(
        file.width,
        file.height,
        Math.max(targetLayer.w, targetLayer.h),
      );
      onUpdateLayer(targetId, { file_id: file.file_id, w, h });
    },
    [activePage, onUpdateLayer],
  );
  const replaceImageInsert = useImageInsert({
    onInsert: handleReplaceInsert,
    // Paste is LeftToolDock's job (and is itself gated on `!isTextEditing`) — this instance only
    // ever inserts via its Arquivos picker/file dialog, both explicitly user-triggered, so its own
    // paste listener would be redundant (and a second global paste listener racing LeftToolDock's
    // would double-insert on a single paste). Always disabled.
    enabled: false,
  });
  const onReplaceImage = useCallback(
    (layerId: string) => {
      replaceTargetRef.current = layerId;
      replaceImageInsert.openArquivosPicker();
    },
    [replaceImageInsert],
  );

  // T3.6 brand kit — shares HubTab's query key/cache; see usePostBrand.
  const brand = usePostBrand(postId);
  const onApplyBrandColor = useCallback(
    (hex: string) => {
      if (!selectedLayer) return;
      if (selectedLayer.type === 'text') {
        onUpdateLayer(selectedLayer.id, { color: hex });
      } else if (selectedLayer.type === 'shape') {
        onUpdateLayer(selectedLayer.id, { fill: { type: 'solid', color: hex } });
      }
    },
    [selectedLayer, onUpdateLayer],
  );
  const onApplyBrandFont = useCallback(
    (familyKey: string) => {
      if (selectedLayer?.type !== 'text') return;
      onUpdateLayer(selectedLayer.id, buildFontFamilyPatch(familyKey, selectedLayer));
    },
    [selectedLayer, onUpdateLayer],
  );
  const onInsertLogo = useCallback(
    (fileId: number, natural: { width: number; height: number } | null) => {
      // Longer side capped at 40% of the canvas's shorter dimension — a logo is an accent, not
      // a background. `natural` comes from the panel's already-decoded thumbnail; when absent
      // (files.width/height can be null and the <img> may not be loaded), a square box is fine:
      // fit:'contain' letterboxes inside it without distorting the logo.
      const cap = Math.round(Math.min(state.doc.canvas.width, state.doc.canvas.height) * 0.4);
      const { w, h } = fitReplacementImageSize(natural?.width ?? cap, natural?.height ?? cap, cap);
      onAddLayer({
        id: generateDesignId('layer'),
        name: 'Logo',
        type: 'image',
        w,
        h,
        x: (state.doc.canvas.width - w) / 2,
        y: (state.doc.canvas.height - h) / 2,
        rotation: 0,
        opacity: 1,
        locked: false,
        file_id: fileId,
        fit: 'contain',
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.doc.canvas.width, state.doc.canvas.height, onAddLayer],
  );

  // T6.4 AI image gen — feature-gated (fail-open, same as the button/nav). A generated file
  // becomes either a centered image layer (≤80% canvas) or the active page's background.
  const { features, limits } = useWorkspaceLimits();
  const aiImagesEnabled = features?.feature_ai_images !== false;
  const onInsertAiLayer = useCallback(
    (fileId: number, natural: { width: number; height: number }) => {
      const cap = Math.round(Math.min(state.doc.canvas.width, state.doc.canvas.height) * 0.8);
      const { w, h } = fitReplacementImageSize(natural.width, natural.height, cap);
      onAddLayer({
        id: generateDesignId('layer'),
        name: 'Imagem IA',
        type: 'image',
        w,
        h,
        x: (state.doc.canvas.width - w) / 2,
        y: (state.doc.canvas.height - h) / 2,
        rotation: 0,
        opacity: 1,
        locked: false,
        file_id: fileId,
        fit: 'cover',
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.doc.canvas.width, state.doc.canvas.height, onAddLayer],
  );
  const onSetAiBackground = useCallback(
    (fileId: number) => {
      state.dispatch({
        type: 'page/background',
        pageId: state.activePageId,
        background: { type: 'image', file_id: fileId, fit: 'cover' },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.activePageId],
  );

  const pageDispatchHandlers = useMemo(
    () => ({
      onAddPage: () => state.dispatch({ type: 'page/add', page: buildBlankPage() }),
      onDuplicatePage: (pageId: string) => state.dispatch({ type: 'page/duplicate', pageId }),
      onRemovePage: (pageId: string) => state.dispatch({ type: 'page/remove', pageId }),
      onReorderPages: (fromIndex: number, toIndex: number) =>
        state.dispatch({ type: 'page/reorder', fromIndex, toIndex }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Live view state reported by CanvasStage (effective zoom scale + reset) for the TopToolbar's
  // zoom control — the transform itself stays inside the stage (canvas-box contract).
  const [view, setView] = useState<{ scale: number; resetView: () => void } | null>(null);

  // Plan T2.9: the reels-format editor must warn when the post has no video link yet — the
  // server render composites the cover onto the reel video's thumbnail and fails without one.
  const isReelCover = query.data?.design.format === 'reel_cover';
  const mediaQuery = useQuery({
    queryKey: ['estudio-post-media', postId],
    queryFn: () => listPostMedia(postId),
    enabled: isReelCover,
  });
  const showReelVideoNotice =
    isReelCover && mediaQuery.isSuccess && !mediaQuery.data.some((m) => m.kind === 'video');

  if (query.isLoading) {
    return (
      <div className="page-full-bleed flex items-center justify-center">
        <p style={{ color: 'var(--text-muted)' }}>{t('editor.loading')}</p>
      </div>
    );
  }

  if (query.isError) {
    const err = query.error;
    const code = err instanceof PostDesignError ? err.code : undefined;
    const message =
      code === 'post_not_found'
        ? t('editor.notFound')
        : code === 'feature_disabled'
          ? t('featureBlocked')
          : code === 'post_has_video_media'
            ? t('editor.videoMediaBlocked')
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
      <TopToolbar
        title={t('title')}
        summary={`${t('editor.pageCount', { count: state.doc.pages.length })} · ${t('editor.layerCount', { count: layerCount })}`}
        saveStatus={autosave.status}
        canUndo={state.canUndo}
        canRedo={state.canRedo}
        onUndo={state.undo}
        onRedo={state.redo}
        zoom={view?.scale}
        onZoomReset={view?.resetView}
      />
      {autosave.status === 'conflict' && (
        <div
          role="alert"
          data-testid="estudio-conflict-banner"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem clamp(1.25rem, 3vw, 2.5rem)',
            background: 'rgba(245, 90, 66, 0.12)',
            borderBottom: '1px solid rgba(245, 90, 66, 0.4)',
            color: 'var(--text-main)',
            fontSize: '0.8rem',
            flexShrink: 0,
          }}
        >
          <span>{t('editor.conflictBanner')}</span>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="btn-secondary"
            style={{ padding: '0.15rem 0.6rem', borderRadius: 8, fontSize: '0.75rem' }}
          >
            {t('editor.reload')}
          </button>
        </div>
      )}
      {showReelVideoNotice && (
        <div
          role="status"
          data-testid="reel-video-notice"
          style={{
            padding: '0.5rem clamp(1.25rem, 3vw, 2.5rem)',
            background: 'rgba(245, 163, 66, 0.12)',
            borderBottom: '1px solid rgba(245, 163, 66, 0.4)',
            color: 'var(--text-main)',
            fontSize: '0.8rem',
            flexShrink: 0,
          }}
        >
          {t('editor.reelVideoNotice')}
        </div>
      )}
      <ContextualToolbar
        layer={selectedLayer}
        onUpdateLayer={onUpdateLayer}
        onReplaceImage={onReplaceImage}
        brandColors={brand.brandColors}
        brandFonts={brand.brandFonts}
        canvasWidth={state.doc.canvas.width}
        canvasHeight={state.doc.canvas.height}
        getTextHeight={getTextHeight}
      />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <LeftToolDock
          canvasWidth={state.doc.canvas.width}
          canvasHeight={state.doc.canvas.height}
          onAddLayer={onAddLayer}
          pasteEnabled={!isTextEditing}
          brandPanel={
            <BrandPanel
              brand={brand}
              selectedLayerType={selectedLayer?.type ?? null}
              onApplyColor={onApplyBrandColor}
              onApplyFont={onApplyBrandFont}
              onInsertLogo={onInsertLogo}
            />
          }
          aiPanel={
            aiImagesEnabled ? (
              <GerarImagemPanel
                postId={postId}
                clienteId={brand.clienteId}
                hasBrandLogo={brand.logoFileId !== null}
                canvasAspectRatio={state.doc.aspect_ratio}
                monthlyLimit={limits?.rate_ai_images_per_month ?? null}
                onInsertLayer={onInsertAiLayer}
                onSetBackground={onSetAiBackground}
              />
            ) : undefined
          }
        />
        <div
          style={{ flex: 1, minHeight: 0, minWidth: 0 }}
          // A dropped file outside the dock's drop zone would hit the browser default (navigate
          // to the file), discarding the whole editor session. Swallow it — the dock rail is the
          // designed drop target for inserts (design leaves the drop surface open; a canvas-wide
          // insert can layer on later without this guard changing).
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => e.preventDefault()}
          data-testid="estudio-canvas-area"
        >
          <CanvasStage
            doc={state.doc}
            pageIndex={activePageIndex}
            selection={state.selection}
            select={state.select}
            onUpdateLayer={onUpdateLayer}
            getTextHeight={getTextHeight}
            onEditingChange={setIsTextEditing}
            onViewChange={setView}
          />
        </div>
      </div>
      <SlideStrip
        doc={state.doc}
        activePageId={state.activePageId}
        setActivePage={state.setActivePage}
        {...pageDispatchHandlers}
      />
      {/* Hidden file input + FilePickerModal for the "Substituir imagem" flow live inside
          `useImageInsert`'s own consumer contract (see LeftToolDock.tsx for the established
          pattern) — but that hook only returns callbacks/refs, it doesn't render anything itself,
          so this shell renders the modal directly for its dedicated replace-image instance. */}
      <input
        ref={replaceImageInsert.fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={replaceImageInsert.onFileInputChange}
      />
      {replaceImageInsert.isArquivosPickerOpen && (
        <ReplaceImagePickerModal
          onClose={replaceImageInsert.closeArquivosPicker}
          onSelect={replaceImageInsert.onArquivosPickerSelect}
        />
      )}
    </div>
  );
}

function ReplaceImagePickerModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (fileIds: number[]) => void;
}) {
  return <FilePickerModal open onClose={onClose} onSelect={onSelect} filterKind={['image']} />;
}

export default function EstudioPage() {
  const { postId: postIdParam } = useParams<{ postId?: string }>();

  if (!postIdParam) return <PostPicker />;

  const postId = parseInt(postIdParam, 10);
  if (isNaN(postId)) return <PostPicker />;

  return <EstudioEditorShell postId={postId} />;
}
