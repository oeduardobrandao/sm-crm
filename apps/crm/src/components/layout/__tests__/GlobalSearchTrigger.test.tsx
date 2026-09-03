import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function pill(name: string) {
  return screen
    .getAllByRole('button', { pressed: undefined })
    .find((b) => b.textContent?.startsWith(name));
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

  it('shows a hint instead of listing everything before the user types', async () => {
    renderTrigger();
    openPalette();

    expect(await screen.findByText(/Digite para buscar/)).toBeInTheDocument();
    expect(screen.queryByText('Julho')).toBeNull();
  });

  // A post result has to land on that post, not just on the fluxo that contains it.
  // /entregas takes &post=<id> alongside ?drawer=<workflowId> and expands it in the drawer.
  it('navigates a post result to the post itself, not just to its fluxo', async () => {
    renderTrigger();
    openPalette();
    await screen.findByText(/Digite para buscar/);
    typeQuery('carrossel');

    fireEvent.click(await screen.findByText('Carrossel amamentação'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?drawer=5&post=31');
  });

  // The fluxo result is a WORKFLOW, so it correctly opens the whole card with no post.
  it('navigates a fluxo result to the fluxo alone', async () => {
    renderTrigger();
    openPalette();
    await screen.findByText(/Digite para buscar/);
    typeQuery('julho');

    fireEvent.click(await screen.findByText('Julho'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?drawer=5');
  });

  // A post avulso (no workflow_id) has nowhere to derive a `?drawer=` target from --
  // it must use the universal `?post=` form and label itself distinctly from a wired post.
  it('navigates an avulso post result via the universal ?post= form, labelled Avulso', async () => {
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 42, workflow_id: null, titulo: 'Post fora de fluxo', tipo: 'feed' },
    ]);
    renderTrigger();
    openPalette();
    await screen.findByText(/Digite para buscar/);
    typeQuery('fora de fluxo');

    expect(await screen.findByText('feed · Avulso')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post fora de fluxo'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?post=42');
    expect(navigateMock).not.toHaveBeenCalledWith(expect.stringContaining('drawer'));
  });

  it('matches by substring, not by scattered letters like the old fuzzy filter', async () => {
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 1, workflow_id: null, titulo: 'Como eu cuido do sorriso do Henrique', tipo: 'reels' },
      { id: 2, workflow_id: null, titulo: 'Como postar no Instagram', tipo: 'feed' },
    ]);
    renderTrigger();
    openPalette();
    await screen.findByText(/Digite para buscar/);
    typeQuery('como postar');

    expect(await screen.findByText('Como postar no Instagram')).toBeInTheDocument();
    expect(screen.queryByText('Como eu cuido do sorriso do Henrique')).toBeNull();
  });

  it('shows "Nenhum resultado." when nothing matches', async () => {
    renderTrigger();
    openPalette();
    await screen.findByText(/Digite para buscar/);
    typeQuery('zzz');

    expect(await screen.findByText('Nenhum resultado.')).toBeInTheDocument();
  });

  describe('Ajuda group', () => {
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
      await screen.findByText(/Digite para buscar/);
      typeQuery('instagram');

      expect(await screen.findByText('Como conectar o Instagram')).toBeInTheDocument();
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
      await screen.findByText(/Digite para buscar/);

      typeQuery('automacao');
      expect(await screen.findByText('Automação de comentários')).toBeInTheDocument();

      typeQuery('fatura');
      expect(await screen.findByText('Cobrança e plano')).toBeInTheDocument();

      typeQuery('tour');
      expect(await screen.findByText('Primeiro acesso')).toBeInTheDocument();
    });

    it('caps at 5 articles in "Tudo" and offers "Ver todos em Ajuda" carrying the query', async () => {
      getKbSearchIndexMock.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) =>
          kbArticle({ slug: `post-${i + 1}`, title: `Post número ${i + 1}` }),
        ),
      );
      renderTrigger();
      openPalette();
      await screen.findByText(/Digite para buscar/);
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
      await screen.findByText(/Digite para buscar/);
      typeQuery('julho');

      expect(await screen.findByText('Julho')).toBeInTheDocument();
    });
  });

  describe('type pills', () => {
    beforeEach(() => {
      getAllWorkflowPostsMock.mockResolvedValue(
        Array.from({ length: 7 }, (_, i) => ({
          id: i + 1,
          workflow_id: 5,
          titulo: `Post ${i + 1}`,
          tipo: 'feed',
        })),
      );
      getKbSearchIndexMock.mockResolvedValue([
        kbArticle({ slug: 'primeiro-post', title: 'Como agendar seu primeiro post' }),
      ]);
    });

    it('renders one pill per matching type with counts, "Tudo" pressed by default', async () => {
      renderTrigger();
      openPalette();
      await screen.findByText(/Digite para buscar/);
      typeQuery('post');

      await screen.findByText('Ver todos em Postagens');
      const group = screen.getByRole('group', { name: 'Filtrar por tipo' });
      const pills = Array.from(group.querySelectorAll('button')).map((b) => ({
        text: b.textContent,
        pressed: b.getAttribute('aria-pressed'),
      }));
      expect(pills).toEqual([
        { text: 'Tudo8', pressed: 'true' },
        { text: 'Postagens7', pressed: 'false' },
        { text: 'Ajuda1', pressed: 'false' },
      ]);
    });

    it('caps posts at 5 in "Tudo" and shows all of them once the Postagens pill is selected', async () => {
      renderTrigger();
      openPalette();
      await screen.findByText(/Digite para buscar/);
      typeQuery('post');

      await screen.findByText('Ver todos em Postagens');
      expect(screen.getAllByText(/^Post \d$/)).toHaveLength(5);
      expect(screen.getByText('Como agendar seu primeiro post')).toBeInTheDocument();

      fireEvent.click(pill('Postagens')!);

      await waitFor(() => expect(screen.getAllByText(/^Post \d$/)).toHaveLength(7));
      expect(screen.queryByText('Como agendar seu primeiro post')).toBeNull();
      expect(screen.queryByText('Ver todos em Postagens')).toBeNull();
      expect(pill('Postagens')).toHaveAttribute('aria-pressed', 'true');

      fireEvent.click(pill('Tudo')!);
      await waitFor(() => expect(screen.getAllByText(/^Post \d$/)).toHaveLength(5));
    });

    it('"Ver todos em <tipo>" selects that pill instead of leaving the palette', async () => {
      renderTrigger();
      openPalette();
      await screen.findByText(/Digite para buscar/);
      typeQuery('post');

      fireEvent.click(await screen.findByText('Ver todos em Postagens'));

      await waitFor(() => expect(screen.getAllByText(/^Post \d$/)).toHaveLength(7));
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('falls back to "Tudo" when the selected type stops matching the new query', async () => {
      renderTrigger();
      openPalette();
      await screen.findByText(/Digite para buscar/);
      typeQuery('post');
      fireEvent.click(await screen.findByText('Ver todos em Postagens'));
      await waitFor(() => expect(screen.getAllByText(/^Post \d$/)).toHaveLength(7));

      typeQuery('agendar');

      expect(await screen.findByText('Como agendar seu primeiro post')).toBeInTheDocument();
      expect(pill('Tudo')).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
