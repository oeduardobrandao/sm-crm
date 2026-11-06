import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  listKbArticles: vi.fn(),
  getKbViewStats: vi.fn(),
  reorderKbArticles: vi.fn(),
  updateKbArticle: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { toast } from 'sonner';
import { getKbViewStats, listKbArticles, updateKbArticle } from '../../lib/api';
import KbArticlesPage from '../KbArticlesPage';

const base = {
  excerpt: null,
  content: null,
  content_plain: '',
  cover_image_url: null,
  tags: [],
  author_id: null,
  updated_at: '2026-09-01T00:00:00Z',
};
const articles = [
  {
    ...base,
    id: 'k1',
    title: 'Primeiro post',
    slug: 'primeiro-post',
    category: 'primeiros-passos',
    status: 'published',
    display_order: 1,
    created_at: '2026-09-01T00:00:00Z',
  },
  {
    ...base,
    id: 'k2',
    title: 'Rascunho secreto',
    slug: 'rascunho',
    category: 'primeiros-passos',
    status: 'draft',
    display_order: 2,
    created_at: '2026-09-02T00:00:00Z',
  },
  {
    ...base,
    id: 'k3',
    title: 'Convidar equipe',
    slug: 'convidar-equipe',
    category: 'equipe',
    status: 'published',
    display_order: 0,
    created_at: '2026-09-03T00:00:00Z',
  },
];

let restore: () => void;

beforeEach(() => {
  restore = mockPhone();
  vi.mocked(listKbArticles).mockResolvedValue({ articles } as never);
  vi.mocked(updateKbArticle).mockReset();
  vi.mocked(updateKbArticle).mockResolvedValue({ article: articles[0] } as never);
  vi.mocked(getKbViewStats).mockResolvedValue({
    articles: { k1: { views_30d: 48, users_30d: 12, views_total: 210, users_total: 64 } },
    videos: {},
  });
});

afterEach(() => restore());

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/kb-articles']}>
        <Routes>
          <Route path="/admin/kb-articles" element={<KbArticlesPage />} />
          <Route path="/admin/kb-articles/new" element={<p>Tela de novo artigo</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('KbArticlesPage on phones', () => {
  it('shows the large title with the article count', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Artigos' })).toBeInTheDocument();
    expect(await screen.findByText('Central de Ajuda do CRM · 3 artigos')).toBeInTheDocument();
  });

  it('lists the articles per category as links to the editor, with status and views', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: /Primeiro post/ });
    expect(link).toHaveAttribute('href', '/admin/kb-articles/k1/edit');
    expect(link).toHaveTextContent('48 visualizações · 12 pessoas');
    expect(link).toHaveTextContent('Publicado');
    expect(screen.getByRole('link', { name: /Rascunho secreto/ })).toHaveTextContent(
      'Sem visualizações',
    );
    expect(screen.getByRole('link', { name: /Convidar equipe/ })).toHaveAttribute(
      'href',
      '/admin/kb-articles/k3/edit',
    );
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(['Getting Started', 'Team']);
  });

  it('filters by status with the segmented control', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro post/ });
    fireEvent.click(screen.getByRole('radio', { name: 'Rascunhos' }));
    expect(screen.getByRole('link', { name: /Rascunho secreto/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Primeiro post/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Convidar equipe/ })).toBeNull();
  });

  it('the new-article button opens the editor', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro post/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo artigo' }));
    expect(await screen.findByText('Tela de novo artigo')).toBeInTheDocument();
  });

  it('the reorder swipe actions are named after their article', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro post/ });
    expect(screen.getByRole('button', { name: 'Descer Primeiro post' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Subir Rascunho secreto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Subir Primeiro post' })).toBeNull();
  });

  it('selection mode turns rows into checkboxes and bulk-publishes from the bottom bar', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro post/ });
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar artigos' }));

    expect(screen.queryByRole('link', { name: /Primeiro post/ })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Primeiro post/ }));
    expect(screen.getByRole('checkbox', { name: /Primeiro post/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Convidar equipe/ }));
    expect(screen.getAllByText('2 selecionados').length).toBeGreaterThan(0);

    const toolbar = screen.getByRole('toolbar', { name: 'Ações em massa' });
    fireEvent.click(within(toolbar).getByRole('button', { name: /^Publicar 2/ }));
    await waitFor(() => expect(updateKbArticle).toHaveBeenCalledTimes(2));
    expect(updateKbArticle).toHaveBeenCalledWith({ article_id: 'k1', status: 'published' });
    expect(updateKbArticle).toHaveBeenCalledWith({ article_id: 'k3', status: 'published' });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('2 itens publicados.'));
    expect(screen.queryByRole('toolbar', { name: 'Ações em massa' })).toBeNull();
  });

  it('"Selecionar todos" selects a whole category and OK leaves selection mode', async () => {
    renderPage();
    await screen.findByRole('link', { name: /Primeiro post/ });
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar artigos' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Selecionar todos os artigos de Getting Started' }),
    );
    expect(screen.getAllByText('2 selecionados').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Concluir seleção' }));
    expect(screen.queryByRole('toolbar', { name: 'Ações em massa' })).toBeNull();
    expect(screen.getByRole('link', { name: /Primeiro post/ })).toBeInTheDocument();
  });
});
