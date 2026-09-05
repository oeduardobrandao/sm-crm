import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ listKbArticles: vi.fn() }));

import { listKbArticles } from '../../lib/api';
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
  },
];

beforeEach(() => {
  vi.mocked(listKbArticles).mockResolvedValue({ articles } as never);
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

  it('shows an empty state without the clear action when the list is empty', async () => {
    vi.mocked(listKbArticles).mockResolvedValue({ articles: [] } as never);
    renderPage();
    expect(await screen.findByText('Nenhum artigo encontrado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).toBeNull();
  });
});
