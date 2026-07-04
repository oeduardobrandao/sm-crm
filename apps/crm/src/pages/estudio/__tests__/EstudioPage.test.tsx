import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage, makeTextLayer } from './fixtures';
import type { NormalizedLayer } from '../types';

vi.mock('../components/PostPicker', () => ({
  default: () => <div>picker-stub</div>,
}));

// CanvasStage owns the real satori/yoga render pipeline (useSatoriRenderer.test.tsx's concern) —
// stubbed here so this file stays focused on EstudioPage's own routing/loading/error logic +
// chrome-wiring (LeftToolDock/ContextualToolbar/SlideStrip <-> useDesignDocState's dispatch).
vi.mock('../components/Canvas/CanvasStage', () => ({
  CanvasStage: ({
    doc,
    selection,
    onUpdateLayer,
    onEditingChange,
  }: {
    doc: { pages: { layers: NormalizedLayer[] }[] };
    selection: string[];
    onUpdateLayer: (layerId: string, patch: Partial<NormalizedLayer>) => void;
    onEditingChange?: (v: boolean) => void;
  }) => (
    <div>
      canvas-stage-stub pages={doc.pages.length}
      <button onClick={() => onUpdateLayer(selection[0], { x: 999 })}>stub-update-layer</button>
      <button onClick={() => onEditingChange?.(true)}>stub-start-editing</button>
    </div>
  ),
}));

// The rest of the chrome (T2.8/2.9/2.10/2.12, built by sibling agents + this PR) gets thin stubs
// here — each one is unit-tested in its own file (LeftToolDock.test.tsx, ContextualToolbar.test.tsx,
// SlideStrip.test.tsx); this file's job is only to prove EstudioPage wires the right callbacks
// through to `state.dispatch`/`onUpdateLayer`, not to re-test each component's own internals.
vi.mock('../components/Dock', () => ({
  LeftToolDock: ({
    onAddLayer,
    pasteEnabled,
  }: {
    onAddLayer: (layer: NormalizedLayer) => void;
    pasteEnabled?: boolean;
  }) => (
    <div>
      dock-stub pasteEnabled={String(pasteEnabled)}
      <button
        onClick={() =>
          onAddLayer({
            id: 'new-layer',
            name: 'Texto',
            type: 'text',
            x: 0,
            y: 0,
            w: 100,
            rotation: 0,
            opacity: 1,
            locked: false,
            text: 'novo',
            font_key: 'inter',
            font_weight: 400,
            font_size: 32,
            line_height: 1.2,
            letter_spacing: 0,
            color: '#000000',
            align: 'left',
          })
        }
      >
        stub-add-layer
      </button>
    </div>
  ),
  BrandPanel: () => <div>brand-panel-stub</div>,
  GerarImagemPanel: () => <div>ai-panel-stub</div>,
}));

// usePostBrand queries supabase (post -> cliente -> hub_brand) — irrelevant to these tests,
// stubbed to an empty brand so no network is attempted.
vi.mock('../hooks/usePostBrand', () => ({
  usePostBrand: () => ({
    clienteId: null,
    brand: null,
    brandColors: [],
    brandFonts: [],
    logoFileId: null,
    logoUrl: null,
  }),
}));

vi.mock('../components/Toolbar', () => ({
  TopToolbar: ({
    title,
    summary,
    saveStatus,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
  }: {
    title: string;
    summary: string;
    saveStatus: string;
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
  }) => (
    <div>
      top-toolbar-stub {title} {summary}
      <span data-testid="estudio-save-pill" data-status={saveStatus}>
        {saveStatus}
      </span>
      <button disabled={!canUndo} onClick={onUndo}>
        stub-undo
      </button>
      <button disabled={!canRedo} onClick={onRedo}>
        stub-redo
      </button>
    </div>
  ),
  default: ({
    layer,
    onReplaceImage,
  }: {
    layer: { id: string } | null;
    onReplaceImage?: (layerId: string) => void;
  }) => (
    <div>
      toolbar-stub layer={layer ? layer.id : 'none'}
      {layer && <button onClick={() => onReplaceImage?.(layer.id)}>stub-replace-image</button>}
    </div>
  ),
}));

vi.mock('../components/SlideStrip', () => ({
  SlideStrip: ({
    onAddPage,
    onDuplicatePage,
    onRemovePage,
    onReorderPages,
  }: {
    onAddPage: () => void;
    onDuplicatePage: (pageId: string) => void;
    onRemovePage: (pageId: string) => void;
    onReorderPages: (from: number, to: number) => void;
  }) => (
    <div>
      slide-strip-stub
      <button onClick={onAddPage}>stub-add-page</button>
      <button onClick={() => onDuplicatePage('page-1')}>stub-duplicate-page</button>
      <button onClick={() => onRemovePage('page-1')}>stub-remove-page</button>
      <button onClick={() => onReorderPages(0, 1)}>stub-reorder-pages</button>
    </div>
  ),
}));

vi.mock('@/pages/arquivos/components/FilePickerModal', () => ({
  FilePickerModal: () => null,
}));

// Controllable per-test post media (reels notice — plan T2.9's "no video link" condition).
let mockPostMedia: Array<{ kind: string }> = [];
vi.mock('@/services/postMedia', () => ({
  listPostMedia: vi.fn(() => Promise.resolve(mockPostMedia)),
}));

const cleanupAbandonedDraft = vi.fn();
vi.mock('../hooks/useEstudioEntryFlow', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useEstudioEntryFlow')>(
    '../hooks/useEstudioEntryFlow',
  );
  return {
    ...actual,
    cleanupAbandonedDraft: (...args: unknown[]) => cleanupAbandonedDraft(...args),
  };
});

const usePostDesignQuery = vi.fn();
const savePostDesign = vi.fn(async (_postId: number, doc: unknown, _rev: number) => ({
  design: doc,
  rev: 99,
  warnings: [],
}));
vi.mock('../hooks/usePostDesignQuery', async () => {
  const actual = await vi.importActual<typeof import('../hooks/usePostDesignQuery')>(
    '../hooks/usePostDesignQuery',
  );
  return {
    ...actual,
    usePostDesignQuery: (...args: unknown[]) => usePostDesignQuery(...args),
    savePostDesign: (...args: unknown[]) =>
      (savePostDesign as (...a: unknown[]) => unknown)(...args),
  };
});

import EstudioPage, { fitReplacementImageSize } from '../EstudioPage';
import { PostDesignError } from '../hooks/usePostDesignQuery';
import { clearEstudioStash, readEstudioStash } from '../lib/estudioStash';

// EstudioPage now also drives `useTextMeasurement` (T2.6/T2.7) directly, which calls
// `useFontManifest`'s `useQuery` — needs a real QueryClientProvider even though
// `usePostDesignQuery` itself is mocked out above.
function renderAt(path: string, state?: unknown) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Data router (createMemoryRouter), mirroring main.tsx's RouterProvider migration — the
  // editor's dirty-navigation useBlocker throws under a plain <MemoryRouter>.
  const router = createMemoryRouter(
    [
      { path: '/estudio', element: <EstudioPage /> },
      { path: '/estudio/:postId', element: <EstudioPage /> },
      { path: '/outra', element: <div>outra-pagina</div> },
    ],
    { initialEntries: [state === undefined ? path : { pathname: path, state }] },
  );
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { ...utils, router };
}

describe('fitReplacementImageSize', () => {
  it("caps a portrait replacement against the existing layer's LONGER side, not just w — regression: capping only against w let a portrait image balloon past a wide-but-short layer's own footprint", () => {
    // Existing layer: wide and short (w:400, h:100 -> longer side is w:400). A tall replacement
    // photo (900x1800, i.e. much taller than wide) must be capped against 400 (the layer's own
    // longer side), NOT left free to grow h past what a `maxSide: layer.w` cap alone would allow
    // for w while leaving h totally unbounded in the old (buggy) implementation.
    const { w, h } = fitReplacementImageSize(900, 1800, Math.max(400, 100));
    expect(Math.max(w, h)).toBeLessThanOrEqual(400);
    expect(h).toBeGreaterThan(w); // aspect ratio still preserved (portrait stays portrait)
  });

  it("caps a landscape replacement against a TALL existing layer's longer side (h, not w)", () => {
    // Existing layer: narrow and tall (w:100, h:500 -> longer side is h:500). A wide replacement
    // (1800x900) must be capped against 500 — capping against `w` alone (100, the old bug) would
    // have crushed this replacement down to a sliver instead of using the layer's real footprint.
    const { w, h } = fitReplacementImageSize(1800, 900, Math.max(100, 500));
    expect(Math.max(w, h)).toBeLessThanOrEqual(500);
    expect(w).toBeGreaterThan(h);
  });

  it('never produces a side smaller than the 100px floor even for a tiny existing layer', () => {
    const { w, h } = fitReplacementImageSize(2000, 1000, 20);
    expect(w).toBeGreaterThanOrEqual(100);
    expect(h).toBeGreaterThanOrEqual(100);
  });
});

describe('EstudioPage', () => {
  it('renders the picker when no postId is present', () => {
    renderAt('/estudio');
    expect(screen.getByText('picker-stub')).toBeInTheDocument();
  });

  it('renders the picker for a non-numeric postId instead of crashing', () => {
    renderAt('/estudio/not-a-number');
    expect(screen.getByText('picker-stub')).toBeInTheDocument();
  });

  it('shows a loading state while the design query is in flight', () => {
    usePostDesignQuery.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    renderAt('/estudio/42');
    expect(screen.getByText('Carregando design...')).toBeInTheDocument();
  });

  it('shows a not-found message for a post_not_found error', () => {
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new PostDesignError('post_not_found', 404, null),
    });
    renderAt('/estudio/42');
    expect(screen.getByText('Design não encontrado.')).toBeInTheDocument();
  });

  it('shows a generic error message for any other error code', () => {
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new PostDesignError('post_not_editable', 409, null),
    });
    renderAt('/estudio/42');
    expect(screen.getByText('Não foi possível carregar o design.')).toBeInTheDocument();
  });

  it('shows the plan-blocked message for a feature_disabled error, not the generic one', () => {
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new PostDesignError('feature_disabled', 403, null),
    });
    renderAt('/estudio/42');
    expect(screen.getByText(/não está disponível no seu plano/i)).toBeInTheDocument();
  });

  it('shows the video-media explanation for a post_has_video_media error', () => {
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new PostDesignError('post_has_video_media', 400, null),
    });
    renderAt('/estudio/42');
    expect(screen.getByText(/este post tem vídeo/i)).toBeInTheDocument();
  });

  it('shows the "adicione o vídeo do reel" notice on a reel_cover design whose post has no video link', async () => {
    mockPostMedia = [{ kind: 'image' }];
    const doc = makeDoc({ format: 'reel_cover' });
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { design: doc, rev: 1, render: { status: 'pending', pages: [] } },
    });
    renderAt('/estudio/42');
    expect(await screen.findByTestId('reel-video-notice')).toBeInTheDocument();
  });

  it('cleans up a synthetic "Criar novo" draft abandoned with zero layers (T2.3)', () => {
    cleanupAbandonedDraft.mockClear();
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        design: makeDoc({ pages: [makePage({ layers: [] })] }),
        rev: 1,
        render: { status: 'pending', pages: [] },
      },
    });
    const { unmount } = renderAt('/estudio/42', {
      estudioSyntheticDraft: { workflowId: 5, postId: 42 },
    });
    unmount();
    expect(cleanupAbandonedDraft).toHaveBeenCalledWith(42, 5);
  });

  it('does NOT clean up when the user added a layer, or when the editor was not entered via "Criar novo"', () => {
    cleanupAbandonedDraft.mockClear();
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        design: makeDoc({ pages: [makePage({ layers: [] })] }),
        rev: 1,
        render: { status: 'pending', pages: [] },
      },
    });

    // Layer added during the session -> the draft is no longer "abandoned".
    const withLayer = renderAt('/estudio/42', {
      estudioSyntheticDraft: { workflowId: 5, postId: 42 },
    });
    fireEvent.click(screen.getByText('stub-add-layer'));
    withLayer.unmount();
    expect(cleanupAbandonedDraft).not.toHaveBeenCalled();

    // No router-state marker (existing post opened from the picker) -> never cleaned up.
    const noMarker = renderAt('/estudio/42');
    noMarker.unmount();
    expect(cleanupAbandonedDraft).not.toHaveBeenCalled();
  });

  it('hides the reel-video notice once the post has a video link, and for non-reel formats', async () => {
    mockPostMedia = [{ kind: 'video' }];
    const doc = makeDoc({ format: 'reel_cover' });
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { design: doc, rev: 1, render: { status: 'pending', pages: [] } },
    });
    const { unmount } = renderAt('/estudio/42');
    // The media query resolves async — settle it, then assert absence.
    await screen.findByText(/canvas-stage-stub/);
    await Promise.resolve();
    expect(screen.queryByTestId('reel-video-notice')).not.toBeInTheDocument();
    unmount();

    mockPostMedia = [];
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        design: makeDoc({ format: 'feed' }),
        rev: 1,
        render: { status: 'pending', pages: [] },
      },
    });
    renderAt('/estudio/43');
    await screen.findByText(/canvas-stage-stub/);
    expect(screen.queryByTestId('reel-video-notice')).not.toBeInTheDocument();
  });

  it('renders the page/layer summary once the design loads', () => {
    const doc = makeDoc({
      pages: [
        makePage({ layers: [makeTextLayer({ id: 'a' }), makeTextLayer({ id: 'b' })] }),
        makePage({ id: 'page-2', layers: [] }),
      ],
    });
    usePostDesignQuery.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { design: doc, rev: 1, render: { status: 'rendered', pages: [] } },
    });
    renderAt('/estudio/42');
    expect(screen.getByText(/2 páginas/)).toBeInTheDocument();
    expect(screen.getByText(/2 camadas/)).toBeInTheDocument();
    expect(screen.getByText(/canvas-stage-stub/)).toBeInTheDocument();
  });

  describe('chrome wiring (T2.8/2.9/2.10/2.12)', () => {
    function loadDoc() {
      const doc = makeDoc({
        format: 'carrossel',
        pages: [
          makePage({ id: 'page-1', layers: [makeTextLayer({ id: 'a' })] }),
          makePage({ id: 'page-2', layers: [] }),
        ],
      });
      usePostDesignQuery.mockReturnValue({
        isLoading: false,
        isError: false,
        data: { design: doc, rev: 1, render: { status: 'rendered', pages: [] } },
      });
      return doc;
    }

    it("LeftToolDock's onAddLayer dispatches layer/add onto the active page (reflected in the layer count)", () => {
      loadDoc();
      renderAt('/estudio/42');
      expect(screen.getByText(/1 camada\b/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('stub-add-layer'));

      expect(screen.getByText(/2 camadas/)).toBeInTheDocument();
    });

    it('ContextualToolbar receives null when selection is empty, and the selected layer id when exactly one layer is selected', () => {
      loadDoc();
      renderAt('/estudio/42');
      // No selection by default (useDesignDocState's initial state) -> toolbar gets `null`.
      expect(screen.getByText(/toolbar-stub layer=none/)).toBeInTheDocument();
    });

    it("LeftToolDock's pasteEnabled flips to false while CanvasStage reports text-edit mode active", () => {
      loadDoc();
      renderAt('/estudio/42');
      expect(screen.getByText(/dock-stub pasteEnabled=true/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('stub-start-editing'));

      expect(screen.getByText(/dock-stub pasteEnabled=false/)).toBeInTheDocument();
    });

    it("SlideStrip's onAddPage dispatches page/add (reflected in the page count)", () => {
      loadDoc();
      renderAt('/estudio/42');
      expect(screen.getByText(/2 páginas/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('stub-add-page'));

      expect(screen.getByText(/3 páginas/)).toBeInTheDocument();
    });

    it("SlideStrip's onDuplicatePage dispatches page/duplicate (reflected in the page count)", () => {
      loadDoc();
      renderAt('/estudio/42');

      fireEvent.click(screen.getByText('stub-duplicate-page'));

      expect(screen.getByText(/3 páginas/)).toBeInTheDocument();
    });

    it("SlideStrip's onRemovePage dispatches page/remove (reflected in the page count)", () => {
      loadDoc();
      renderAt('/estudio/42');

      fireEvent.click(screen.getByText('stub-remove-page'));

      expect(screen.getByText(/1 página\b/)).toBeInTheDocument();
    });

    it("SlideStrip's onReorderPages dispatches page/reorder without changing the page/layer counts", () => {
      loadDoc();
      renderAt('/estudio/42');

      fireEvent.click(screen.getByText('stub-reorder-pages'));

      expect(screen.getByText(/2 páginas/)).toBeInTheDocument();
      expect(screen.getByText(/1 camada\b/)).toBeInTheDocument();
    });

    it("CanvasStage's onUpdateLayer patch flows through to the same dispatch path a toolbar edit would use (page/layer counts stay stable, no crash)", () => {
      loadDoc();
      renderAt('/estudio/42');

      // The stub's "stub-update-layer" button calls onUpdateLayer(selection[0], {x:999}) —
      // selection is empty by default, so this proves the callback is wired without throwing even
      // when there's nothing selected (designDocOps.updateLayer no-ops on an unknown layerId).
      fireEvent.click(screen.getByText('stub-update-layer'));

      expect(screen.getByText(/2 páginas/)).toBeInTheDocument();
      expect(screen.getByText(/1 camada\b/)).toBeInTheDocument();
    });
  });
  describe('T2.11 autosave wiring (blocker + conflict banner)', () => {
    function loadCleanDoc() {
      const doc = makeDoc({ pages: [makePage({ layers: [] })] });
      usePostDesignQuery.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { design: doc, rev: 1, render: { status: 'pending', pages: [] } },
        refetch: vi.fn(),
      });
    }

    it('holds departure while dirty, flushes, and proceeds once saved (blocker engagement)', async () => {
      savePostDesign.mockClear();
      loadCleanDoc();
      const { router } = renderAt('/estudio/42');

      fireEvent.click(screen.getByText('stub-add-layer'));
      expect(screen.getByTestId('estudio-save-pill').dataset.status).toBe('dirty');

      await act(async () => {
        void router.navigate('/outra');
      });
      // The blocker flushes; the (immediately-resolving) save lands and departure proceeds.
      await waitFor(() => expect(router.state.location.pathname).toBe('/outra'));
      expect(savePostDesign).toHaveBeenCalledTimes(1);
      const savedDoc = savePostDesign.mock.calls[0][1] as { pages: { layers: unknown[] }[] };
      expect(savedDoc.pages[0].layers).toHaveLength(1);
    });

    it('does not hold departure when the doc is clean', async () => {
      savePostDesign.mockClear();
      loadCleanDoc();
      const { router } = renderAt('/estudio/42');

      await act(async () => {
        void router.navigate('/outra');
      });
      await waitFor(() => expect(router.state.location.pathname).toBe('/outra'));
      expect(savePostDesign).not.toHaveBeenCalled();
    });

    it('rev_conflict surfaces the banner, stashes the local doc, and Recarregar refetches', async () => {
      savePostDesign.mockClear();
      clearEstudioStash(42);
      savePostDesign.mockRejectedValueOnce(
        new PostDesignError('rev_conflict', 409, { error: 'rev_conflict', current_rev: 5 }),
      );
      const refetch = vi.fn();
      const doc = makeDoc({ pages: [makePage({ layers: [] })] });
      usePostDesignQuery.mockReturnValue({
        isLoading: false,
        isError: false,
        isSuccess: true,
        data: { design: doc, rev: 1, render: { status: 'pending', pages: [] } },
        refetch,
      });
      renderAt('/estudio/42');

      fireEvent.click(screen.getByText('stub-add-layer'));
      // Real timers: the 800ms debounce fires, the save rejects with rev_conflict.
      const banner = await screen.findByTestId('estudio-conflict-banner', undefined, {
        timeout: 3000,
      });
      expect(banner).toBeInTheDocument();
      expect(screen.getByTestId('estudio-save-pill').dataset.status).toBe('conflict');
      expect(readEstudioStash(42)?.doc.pages[0].layers).toHaveLength(1);

      fireEvent.click(screen.getByText('Recarregar'));
      expect(refetch).toHaveBeenCalled();
    });
  });
});
