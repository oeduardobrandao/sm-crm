import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// EstudioPage hosts a real iframe + postMessage bridge — none of that is under test here.
// We isolate the held-banner / read-only-banner decision logic (Task 6) by stubbing the
// editor origin resolution, the embed host, and the data it reads.

vi.mock('../embedHost', () => ({
  createEmbedHost: () => ({
    handleMessage: () => {},
    sendAuth: async () => {},
    forceSave: () => {},
  }),
  buildDocUrl: () => 'doc-url',
  buildEditorUrl: () => 'http://localhost:1420/editor?doc=doc-url',
}));

vi.mock('../EstudioHome', () => ({ EstudioHome: () => <div>home</div> }));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_estudio: true, feature_ai_images: true } }),
}));

const { getDesignMock, duplicateDesignMock } = vi.hoisted(() => ({
  getDesignMock: vi.fn(),
  duplicateDesignMock: vi.fn(),
}));

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store')>();
  return { ...actual, getDesign: getDesignMock, duplicateDesign: duplicateDesignMock };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'tok' } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { status: postStatusForTest } }),
        }),
      }),
    }),
  },
}));

import EstudioPage from '../EstudioPage';

// Mutable status read by the supabase mock above — set per-test before render.
let postStatusForTest = 'rascunho';

function baseDesign(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    rev: 1,
    render_status: 'rendered',
    is_stale: false,
    post_id: 42,
    cliente_id: null,
    format: 'feed',
    name: 'Design',
    render_manifest: null,
    updated_at: '2026-07-01T00:00:00Z',
    media_apply_held: false,
    ...overrides,
  };
}

function renderPage(designId = 5) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: '/estudio/:designId', element: <EstudioPage /> }], {
    initialEntries: [`/estudio/${designId}`],
  });
  return render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  postStatusForTest = 'rascunho';
});

describe('EstudioPage held-state banners (Task 6)', () => {
  it('editable post + held: shows the slim held banner, not the read-only banner', async () => {
    postStatusForTest = 'rascunho';
    getDesignMock.mockResolvedValue(baseDesign({ media_apply_held: true }));
    renderPage();

    expect(await screen.findByTestId('held-banner')).toHaveTextContent(
      'Confira a fidelidade do design — ao salvar, ele substitui as mídias do post.',
    );
    expect(screen.queryByTestId('readonly-banner')).not.toBeInTheDocument();
  });

  it('locked post + held: shows the held-specific read-only text (not the generic one), with Duplicar', async () => {
    postStatusForTest = 'aprovado_cliente';
    getDesignMock.mockResolvedValue(baseDesign({ media_apply_held: true }));
    renderPage();

    const banner = await screen.findByTestId('readonly-banner');
    expect(banner).toHaveTextContent(
      'Este design nunca chegou a substituir as mídias do post, que agora está travado. Duplique para reaproveitar a arte em um novo post.',
    );
    expect(banner).not.toHaveTextContent('somente leitura. Duplique para editar uma cópia.');
    expect(screen.getByText('Duplicar')).toBeInTheDocument();
    expect(screen.queryByTestId('held-banner')).not.toBeInTheDocument();
  });

  it('locked post + NOT held: unchanged generic read-only banner (regression)', async () => {
    postStatusForTest = 'aprovado_cliente';
    getDesignMock.mockResolvedValue(baseDesign({ media_apply_held: false }));
    renderPage();

    const banner = await screen.findByTestId('readonly-banner');
    expect(banner).toHaveTextContent(
      'Este design pertence a um post que o cliente já aprovou — somente leitura. Duplique para editar uma cópia.',
    );
  });

  it('editable post + NOT held: neither banner shows', async () => {
    postStatusForTest = 'rascunho';
    getDesignMock.mockResolvedValue(baseDesign({ media_apply_held: false }));
    renderPage();

    await waitFor(() => expect(getDesignMock).toHaveBeenCalled());
    expect(screen.queryByTestId('held-banner')).not.toBeInTheDocument();
    expect(screen.queryByTestId('readonly-banner')).not.toBeInTheDocument();
  });
});
