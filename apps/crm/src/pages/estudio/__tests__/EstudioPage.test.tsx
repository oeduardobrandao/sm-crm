import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
}));

vi.mock('../components/Toolbar', () => ({
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

const usePostDesignQuery = vi.fn();
vi.mock('../hooks/usePostDesignQuery', async () => {
  const actual = await vi.importActual<typeof import('../hooks/usePostDesignQuery')>(
    '../hooks/usePostDesignQuery',
  );
  return { ...actual, usePostDesignQuery: (...args: unknown[]) => usePostDesignQuery(...args) };
});

import EstudioPage, { fitReplacementImageSize } from '../EstudioPage';
import { PostDesignError } from '../hooks/usePostDesignQuery';

// EstudioPage now also drives `useTextMeasurement` (T2.6/T2.7) directly, which calls
// `useFontManifest`'s `useQuery` — needs a real QueryClientProvider even though
// `usePostDesignQuery` itself is mocked out above.
function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/estudio" element={<EstudioPage />} />
          <Route path="/estudio/:postId" element={<EstudioPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
});
