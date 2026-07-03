import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

vi.mock('../components/PostPicker', () => ({
  default: () => <div>picker-stub</div>,
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/estudio" element={<EstudioPage />} />
        <Route path="/estudio/:postId" element={<EstudioPage />} />
      </Routes>
    </MemoryRouter>,
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
  });
});
