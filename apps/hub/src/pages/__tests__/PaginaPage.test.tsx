import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchPage: vi.fn(),
}));

import { fetchPage } from '../../api';
import { PaginaPage } from '../PaginaPage';
import type { HubPageFull } from '../../types';

const mockedFetchPage = vi.mocked(fetchPage);

const hubValue = {
  bootstrap: {
    workspace: {
      name: 'Mesaas',
      logo_url: 'https://cdn.mesaas.com/logo.png',
      brand_color: '#0f766e',
    },
    cliente_nome: 'Clínica Aurora',
    cliente_foto_url: null,
    is_active: true,
    cliente_id: 14,
    feature_mensagens: true,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderPagina(pageOverrides: Partial<HubPageFull> = {}) {
  const page: HubPageFull = {
    id: '42',
    title: 'Plano Editorial',
    display_order: 1,
    created_at: '2026-04-18T10:00:00.000Z',
    content: [],
    ...pageOverrides,
  };
  mockedFetchPage.mockResolvedValue({ page });

  return render(
    <QueryClientProvider client={createQueryClient()}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={['/mesaas/hub/token-publico/paginas/42']}>
          <Routes>
            <Route path="/:workspace/hub/:token/paginas/:pageId" element={<PaginaPage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

describe('PaginaPage renderBlock', () => {
  beforeEach(() => {
    mockedFetchPage.mockReset();
  });

  it('renderiza um bloco richtext pelo RichTextContent', async () => {
    renderPagina({
      content: [
        {
          type: 'richtext',
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Olá cliente' }] }],
          },
        },
      ],
    });

    expect(await screen.findByText('Olá cliente')).toBeInTheDocument();
  });

  it('continua renderizando os blocos legados', async () => {
    renderPagina({ content: [{ type: 'markdown', content: '## Título\n\nCorpo' }] });

    expect(await screen.findByRole('heading', { name: 'Título' })).toBeInTheDocument();
    expect(screen.getByText('Corpo')).toBeInTheDocument();
  });
});
