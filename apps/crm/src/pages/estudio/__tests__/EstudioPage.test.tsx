import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

vi.mock('../components/PostPicker', () => ({
  default: () => <div>picker-stub</div>,
}));

// CanvasStage owns the real satori/yoga render pipeline (useSatoriRenderer.test.tsx's concern) —
// stubbed here so this file stays focused on EstudioPage's own routing/loading/error logic.
vi.mock('../components/Canvas/CanvasStage', () => ({
  CanvasStage: ({ doc }: { doc: { pages: unknown[] } }) => (
    <div>canvas-stage-stub pages={doc.pages.length}</div>
  ),
}));

const usePostDesignQuery = vi.fn();
vi.mock('../hooks/usePostDesignQuery', async () => {
  const actual = await vi.importActual<typeof import('../hooks/usePostDesignQuery')>(
    '../hooks/usePostDesignQuery',
  );
  return { ...actual, usePostDesignQuery: (...args: unknown[]) => usePostDesignQuery(...args) };
});

import EstudioPage from '../EstudioPage';
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
});
