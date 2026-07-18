import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextHelpLinks } from '../ContextHelpLinks';
import { getContextLinksForRoute } from '@/store/kb';

vi.mock('@/store/kb', () => ({ getContextLinksForRoute: vi.fn() }));

const article = (id: string, slug: string) => ({
  id,
  route_pattern: '/clientes',
  article_id: `article-${id}`,
  label: null,
  display_order: Number(id),
  article: {
    id: `article-${id}`,
    title: `Artigo ${id}`,
    slug,
    excerpt: null,
    content: null,
    content_plain: '',
    cover_image_url: null,
    category: 'clientes',
    tags: [],
    status: 'published' as const,
    display_order: Number(id),
    author_id: null,
    created_at: '',
    updated_at: '',
  },
});

function renderHelp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/clientes/42']}>
        <ContextHelpLinks />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ContextHelpLinks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 767px)' ? false : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
  });

  it('renders one trigger and reveals all valid articles', async () => {
    vi.mocked(getContextLinksForRoute).mockResolvedValue([
      article('1', 'adicionar-clientes'),
      article('2', 'conectar-instagram'),
    ]);
    renderHelp();

    const trigger = await screen.findByRole('button', { name: /Artigos relacionados/ });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(await screen.findByRole('link', { name: 'Artigo 1' })).toHaveAttribute(
      'href',
      '/ajuda/adicionar-clientes',
    );
    expect(screen.getByRole('link', { name: 'Artigo 2' })).toBeInTheDocument();
  });

  it('omits missing slugs and hides the trigger when none remain', async () => {
    vi.mocked(getContextLinksForRoute).mockResolvedValue([article('1', '')]);
    renderHelp();
    await waitFor(() => expect(getContextLinksForRoute).toHaveBeenCalledWith('/clientes'));
    expect(screen.queryByRole('button', { name: /Artigos relacionados/ })).not.toBeInTheDocument();
  });
});
