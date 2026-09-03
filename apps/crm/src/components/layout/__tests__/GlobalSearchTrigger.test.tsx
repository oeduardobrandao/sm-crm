import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ canSeeFinancials: false }),
}));

const { getWorkflowsMock, getAllWorkflowPostsMock, getKbSearchIndexMock } = vi.hoisted(() => ({
  getWorkflowsMock: vi.fn(),
  getAllWorkflowPostsMock: vi.fn(),
  getKbSearchIndexMock: vi.fn(),
}));

vi.mock('@/store/clients', () => ({ getClientes: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/finance', () => ({
  getContratos: vi.fn().mockResolvedValue([]),
  getTransacoes: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/store/team', () => ({ getMembros: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/ideias', () => ({ getIdeias: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/hub', () => ({ getAllHubPages: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/workflows', () => ({ getWorkflows: getWorkflowsMock }));
vi.mock('@/store/posts', () => ({ getAllWorkflowPosts: getAllWorkflowPostsMock }));
vi.mock('@/store/kb', () => ({ getKbSearchIndex: getKbSearchIndexMock }));

import GlobalSearchTrigger from '../GlobalSearchTrigger';
import type { KbSearchEntry } from '@/store/kb';

function renderTrigger() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GlobalSearchTrigger />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GlobalSearchTrigger', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getWorkflowsMock.mockResolvedValue([{ id: 5, titulo: 'Julho', status: 'ativo' }]);
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 31, workflow_id: 5, titulo: 'Carrossel amamentação', tipo: 'carrossel' },
    ]);
    getKbSearchIndexMock.mockResolvedValue([]);
  });

  function openPalette() {
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));
  }

  function typeQuery(text: string) {
    fireEvent.change(screen.getByPlaceholderText('Buscar...'), { target: { value: text } });
  }

  const kbArticle = (over: Partial<KbSearchEntry> & { title: string; slug: string }) => ({
    id: over.slug,
    excerpt: null,
    category: 'primeiros-passos',
    tags: [],
    ...over,
  });

  // A post result has to land on that post, not just on the fluxo that contains it.
  // /entregas takes &post=<id> alongside ?drawer=<workflowId> and expands it in the drawer.
  it('navigates a post result to the post itself, not just to its fluxo', async () => {
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    fireEvent.click(await screen.findByText('Carrossel amamentação'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?drawer=5&post=31');
  });

  // The fluxo result is a WORKFLOW, so it correctly opens the whole card with no post.
  it('navigates a fluxo result to the fluxo alone', async () => {
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    fireEvent.click(await screen.findByText('Julho'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?drawer=5');
  });

  // A post avulso (no workflow_id) has nowhere to derive a `?drawer=` target from --
  // the CARRIED FINDING from Task 12's review was that the old unguarded `${p.workflow_id}`
  // produced a literal "drawer=null" for this case. It must instead use the universal
  // `?post=` form and label itself distinctly from a wired post.
  it('navigates an avulso post result via the universal ?post= form, labelled Avulso', async () => {
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 42, workflow_id: null, titulo: 'Post fora de fluxo', tipo: 'feed' },
    ]);
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    fireEvent.click(await screen.findByText('Post fora de fluxo'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?post=42');
    expect(navigateMock).not.toHaveBeenCalledWith(expect.stringContaining('drawer'));
  });

  it('shows Avulso next to the tipo for a post with no workflow', async () => {
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 42, workflow_id: null, titulo: 'Post fora de fluxo', tipo: 'feed' },
    ]);
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    expect(await screen.findByText('feed · Avulso')).toBeInTheDocument();
  });

  describe('Ajuda group', () => {
    it('does not show the Ajuda group before the user types anything', async () => {
      getKbSearchIndexMock.mockResolvedValue([
        kbArticle({ slug: 'bem-vindo', title: 'Bem-vindo ao Mesaas' }),
      ]);
      renderTrigger();
      openPalette();

      await screen.findByText('Julho');
      expect(screen.queryByText('Ajuda')).toBeNull();
      expect(screen.queryByText('Bem-vindo ao Mesaas')).toBeNull();
    });

    it('navigates a matching article to /ajuda/<slug> and shows its category', async () => {
      getKbSearchIndexMock.mockResolvedValue([
        kbArticle({
          slug: 'como-conectar-instagram',
          title: 'Como conectar o Instagram',
          category: 'instagram-e-analytics',
        }),
        kbArticle({ slug: 'bem-vindo', title: 'Bem-vindo ao Mesaas' }),
      ]);
      renderTrigger();
      openPalette();
      await screen.findByText('Julho');

      typeQuery('instagram');

      expect(await screen.findByText('Ajuda')).toBeInTheDocument();
      expect(screen.getByText('Instagram & Analytics')).toBeInTheDocument();
      expect(screen.queryByText('Bem-vindo ao Mesaas')).toBeNull();

      fireEvent.click(screen.getByText('Como conectar o Instagram'));
      expect(navigateMock).toHaveBeenCalledWith('/ajuda/como-conectar-instagram');
    });

    it('matches accent-insensitively via excerpt and tags', async () => {
      getKbSearchIndexMock.mockResolvedValue([
        kbArticle({ slug: 'automacoes', title: 'Automação de comentários' }),
        kbArticle({ slug: 'cobranca', title: 'Cobrança e plano', tags: ['fatura'] }),
        kbArticle({ slug: 'tour', title: 'Primeiro acesso', excerpt: 'Tour pelo painel' }),
      ]);
      renderTrigger();
      openPalette();
      await screen.findByText('Julho');

      typeQuery('automacao');
      expect(await screen.findByText('Automação de comentários')).toBeInTheDocument();

      typeQuery('fatura');
      expect(await screen.findByText('Cobrança e plano')).toBeInTheDocument();

      typeQuery('tour');
      expect(await screen.findByText('Primeiro acesso')).toBeInTheDocument();
    });

    it('caps at 5 articles and offers "Ver todos em Ajuda" carrying the query', async () => {
      getKbSearchIndexMock.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) =>
          kbArticle({ slug: `post-${i + 1}`, title: `Post número ${i + 1}` }),
        ),
      );
      renderTrigger();
      openPalette();
      await screen.findByText('Julho');

      typeQuery('post');

      expect(await screen.findByText('Ver todos em Ajuda')).toBeInTheDocument();
      expect(screen.getByText('+2')).toBeInTheDocument();
      expect(screen.getAllByText(/^Post número/)).toHaveLength(5);

      fireEvent.click(screen.getByText('Ver todos em Ajuda'));
      expect(navigateMock).toHaveBeenCalledWith('/ajuda?q=post');
    });

    it('does not hold the workspace results behind a slow article index', async () => {
      getKbSearchIndexMock.mockReturnValue(new Promise(() => {}));
      renderTrigger();
      openPalette();

      expect(await screen.findByText('Julho')).toBeInTheDocument();
    });
  });
});
