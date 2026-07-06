import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PostMedia } from '@/store';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

const { importDesignFromMediaMock } = vi.hoisted(() => ({
  importDesignFromMediaMock: vi.fn(),
}));

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store')>();
  return {
    ...actual,
    importDesignFromMedia: importDesignFromMediaMock,
  };
});

import { DesignImportError } from '@/store';
import { ImportToEstudioDialog } from '../ImportToEstudioDialog';

function makeMedia(overrides: Partial<PostMedia> = {}): PostMedia {
  return {
    id: 1,
    post_id: 42,
    conta_id: 'c1',
    r2_key: 'k',
    thumbnail_r2_key: null,
    kind: 'image',
    mime_type: 'image/jpeg',
    size_bytes: 100,
    original_filename: 'a.jpg',
    width: 1080,
    height: 1350,
    duration_seconds: null,
    is_cover: false,
    sort_order: 0,
    uploaded_by: null,
    created_at: '2026-07-01T00:00:00Z',
    url: 'https://x/a.jpg',
    ...overrides,
  };
}

function renderDialog(props: {
  postId: number | null;
  media: PostMedia | null;
  imageCount?: number;
  postTipo?: string;
  onClose?: () => void;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <ImportToEstudioDialog
          postId={props.postId}
          media={props.media}
          imageCount={props.imageCount ?? 1}
          postTipo={props.postTipo}
          onClose={props.onClose ?? vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { invalidateSpy };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ImportToEstudioDialog', () => {
  it('renders nothing when postId/media are null', () => {
    renderDialog({ postId: null, media: null });
    expect(screen.queryByText(/Tornar editável/i)).not.toBeInTheDocument();
  });

  it('shows the carrossel-specific copy with the real image count', () => {
    renderDialog({ postId: 42, media: makeMedia(), imageCount: 4, postTipo: 'carrossel' });
    expect(screen.getByText('As 4 imagens do post viram páginas do design.')).toBeInTheDocument();
  });

  it('omits the carrossel copy for a feed post', () => {
    renderDialog({ postId: 42, media: makeMedia(), imageCount: 1, postTipo: 'feed' });
    expect(screen.queryByText(/viram páginas do design/)).not.toBeInTheDocument();
  });

  it('on success: invalidates post-design-summary and navigates to the new design', async () => {
    importDesignFromMediaMock.mockResolvedValue({ design_id: 123 });
    const onClose = vi.fn();
    const { invalidateSpy } = renderDialog({
      postId: 42,
      media: makeMedia({ id: 9 }),
      onClose,
    });

    fireEvent.click(screen.getByTestId('import-confirm'));

    await waitFor(() => expect(importDesignFromMediaMock).toHaveBeenCalledWith(42, 9));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/estudio/123'));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post-design-summary', 42] });
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the pending state while the request is in flight', async () => {
    let resolvePromise: (v: { design_id: number }) => void = () => {};
    importDesignFromMediaMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );
    renderDialog({ postId: 42, media: makeMedia() });

    fireEvent.click(screen.getByTestId('import-confirm'));

    expect(await screen.findByTestId('import-pending')).toHaveTextContent(
      /pode levar até dois minutos/,
    );
    resolvePromise({ design_id: 1 });
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });

  it('cannot be dismissed while pending (onClose not called on outside interaction)', async () => {
    let resolvePromise: (v: { design_id: number }) => void = () => {};
    importDesignFromMediaMock.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );
    const onClose = vi.fn();
    renderDialog({ postId: 42, media: makeMedia(), onClose });

    fireEvent.click(screen.getByTestId('import-confirm'));
    await screen.findByTestId('import-pending');

    expect(screen.getByTestId('import-confirm')).toBeDisabled();

    resolvePromise({ design_id: 1 });
    await waitFor(() => expect(navigateMock).toHaveBeenCalled());
  });

  it.each([
    ['quota_exhausted', 'Você atingiu o limite mensal.'],
    ['post_already_designed', 'Esse post já tem um design.'],
    ['rate_limited', 'Aguarde alguns minutos.'],
    ['safety_refusal', 'O provedor recusou esta imagem.'],
  ])('maps known error code %s by surfacing the server message', async (code, message) => {
    importDesignFromMediaMock.mockRejectedValue(new DesignImportError(code, message));
    renderDialog({ postId: 42, media: makeMedia() });

    fireEvent.click(screen.getByTestId('import-confirm'));

    expect(await screen.findByTestId('import-error')).toHaveTextContent(message);
    // Retry affordance: the confirm button relabels and stays usable.
    expect(screen.getByTestId('import-confirm')).not.toBeDisabled();
  });

  it('falls back to a generic PT message for an unmapped/unknown code', async () => {
    importDesignFromMediaMock.mockRejectedValue(
      new DesignImportError('some_unmapped_code', 'raw internal detail'),
    );
    renderDialog({ postId: 42, media: makeMedia() });

    fireEvent.click(screen.getByTestId('import-confirm'));

    const errorEl = await screen.findByTestId('import-error');
    expect(errorEl).toHaveTextContent('Não foi possível tornar esta imagem editável');
    expect(errorEl).not.toHaveTextContent('raw internal detail');
  });

  it('falls back to a network-failure message for a non-DesignImportError', async () => {
    importDesignFromMediaMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderDialog({ postId: 42, media: makeMedia() });

    fireEvent.click(screen.getByTestId('import-confirm'));

    expect(await screen.findByTestId('import-error')).toHaveTextContent(
      'Falha de conexão. Verifique sua internet e tente novamente.',
    );
  });
});
