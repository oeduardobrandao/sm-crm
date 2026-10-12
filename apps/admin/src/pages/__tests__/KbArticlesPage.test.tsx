import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listKbArticles: vi.fn(),
  getKbViewStats: vi.fn(),
  reorderKbArticles: vi.fn(),
  updateKbArticle: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { getKbViewStats, listKbArticles, reorderKbArticles, updateKbArticle } from '../../lib/api';
import KbArticlesPage from '../KbArticlesPage';

const articles = [
  {
    id: 'k1',
    title: 'Primeiro post',
    slug: 'primeiro-post',
    excerpt: null,
    content: null,
    content_plain: '',
    cover_image_url: null,
    category: 'primeiros-passos',
    tags: [],
    status: 'published',
    display_order: 1,
    author_id: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
  },
  {
    id: 'k2',
    title: 'Rascunho secreto',
    slug: 'rascunho',
    excerpt: null,
    content: null,
    content_plain: '',
    cover_image_url: null,
    category: 'primeiros-passos',
    tags: [],
    status: 'draft',
    display_order: 2,
    author_id: null,
    created_at: '2026-09-02T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z',
  },
  {
    id: 'k3',
    title: 'Convidar equipe',
    slug: 'convidar-equipe',
    excerpt: null,
    content: null,
    content_plain: '',
    cover_image_url: null,
    category: 'equipe',
    tags: [],
    status: 'published',
    display_order: 0,
    author_id: null,
    created_at: '2026-09-03T00:00:00Z',
    updated_at: '2026-09-03T00:00:00Z',
  },
];

beforeEach(() => {
  vi.mocked(listKbArticles).mockResolvedValue({ articles } as never);
  vi.mocked(reorderKbArticles).mockReset();
  vi.mocked(reorderKbArticles).mockResolvedValue({ message: 'ok' } as never);
  vi.mocked(updateKbArticle).mockReset();
  vi.mocked(updateKbArticle).mockResolvedValue({ article: articles[0] } as never);
  vi.mocked(getKbViewStats).mockResolvedValue({
    articles: { k1: { views_30d: 48, users_30d: 12, views_total: 210, users_total: 64 } },
    videos: {},
  });
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <KbArticlesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbArticlesPage', () => {
  it('shows view counts per article and a zero state for unviewed ones', async () => {
    renderPage();
    expect((await screen.findAllByText('48 visualizações · 12 pessoas')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Total: 210 · 64 pessoas').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Sem visualizações').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Visualizações').length).toBeGreaterThan(0);
  });

  it('still lists articles when the stats call fails', async () => {
    vi.mocked(getKbViewStats).mockRejectedValue(new Error('down'));
    renderPage();
    expect((await screen.findAllByRole('link', { name: 'Primeiro post' })).length).toBeGreaterThan(
      0,
    );
    // Stats lines end in "· N pessoa(s)"; the "Visualizações" header must not count.
    expect(screen.queryByText(/· \d+ pessoas?$/)).not.toBeInTheDocument();
    expect(screen.queryByText('Sem visualizações')).not.toBeInTheDocument();
  });

  it('renders each title as a link to the editor', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: 'Primeiro post' });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(l).toHaveAttribute('href', '/admin/kb-articles/k1/edit');
  });

  it('"Novo artigo" links to the new-article route', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /Novo artigo/ })).toHaveAttribute(
      'href',
      '/admin/kb-articles/new',
    );
  });

  it('shows status badges', async () => {
    renderPage();
    expect((await screen.findAllByText('Publicado')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Rascunho').length).toBeGreaterThan(0);
  });

  it('search filters client-side and offers to clear filters when nothing matches', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro post' });
    fireEvent.change(screen.getByPlaceholderText('Buscar artigos…'), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('Nenhum artigo encontrado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.getAllByRole('link', { name: 'Primeiro post' }).length).toBeGreaterThan(0);
  });

  it('groups articles per category in canonical category order', async () => {
    renderPage();
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Getting Started', 'Team']);
  });

  it('moving an article renumbers only its own category', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro post' });
    // First of the category: can't go further up. Its own category has 2 rows, so it can go down.
    for (const b of screen.getAllByRole('button', { name: 'Mover Primeiro post para cima' })) {
      expect(b).toBeDisabled();
    }
    // Alone in its category, the Team article can't move at all.
    for (const b of screen.getAllByRole('button', { name: 'Mover Convidar equipe para baixo' })) {
      expect(b).toBeDisabled();
    }
    fireEvent.click(screen.getAllByRole('button', { name: 'Mover Primeiro post para baixo' })[0]);
    await waitFor(() =>
      expect(reorderKbArticles).toHaveBeenCalledWith([
        { id: 'k2', display_order: 10 },
        { id: 'k1', display_order: 20 },
      ]),
    );
  });

  it('hides the reorder arrows while a search hides rows', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro post' });
    fireEvent.change(screen.getByPlaceholderText('Buscar artigos…'), {
      target: { value: 'primeiro' },
    });
    expect(screen.queryAllByRole('button', { name: /^Mover / })).toHaveLength(0);
    expect(
      screen.getByText('Limpe a busca e o filtro de status para reordenar os artigos.'),
    ).toBeInTheDocument();
  });

  it('bulk-publishes the selected articles and clears the selection', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro post' });
    expect(screen.queryByRole('toolbar', { name: 'Ações em massa' })).toBeNull();

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Selecionar todos os artigos de Getting Started' }),
    );
    const toolbar = screen.getByRole('toolbar', { name: 'Ações em massa' });
    expect(within(toolbar).getByText('2 selecionados')).toBeInTheDocument();
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Publicar/ }));

    await waitFor(() => expect(updateKbArticle).toHaveBeenCalledTimes(2));
    expect(updateKbArticle).toHaveBeenCalledWith({ article_id: 'k1', status: 'published' });
    expect(updateKbArticle).toHaveBeenCalledWith({ article_id: 'k2', status: 'published' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 itens publicados.'));
    expect(screen.queryByRole('toolbar', { name: 'Ações em massa' })).toBeNull();
  });

  it('bulk actions skip selected articles hidden by a filter', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'Primeiro post' });
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Selecionar Primeiro post' })[0]);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Selecionar Convidar equipe' })[0]);
    expect(screen.getByText('2 selecionados')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar artigos…'), {
      target: { value: 'convidar' },
    });
    expect(screen.getByText('1 selecionado')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Despublicar/ }));
    await waitFor(() =>
      expect(updateKbArticle).toHaveBeenCalledWith({ article_id: 'k3', status: 'draft' }),
    );
    expect(updateKbArticle).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state without the clear action when the list is empty', async () => {
    vi.mocked(listKbArticles).mockResolvedValue({ articles: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhum artigo encontrado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
  });
});
