import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextHelpLinks } from '../ContextHelpLinks';
import { getContextLinksForRoutes } from '@/store/kb';

vi.mock('@/store/kb', () => ({ getContextLinksForRoutes: vi.fn() }));

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

function PathProbe() {
  return <div data-testid="path">{useLocation().pathname}</div>;
}

function renderHelp(initialEntry = '/clientes/42') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ContextHelpLinks />
        <PathProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

describe('ContextHelpLinks', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 767px)' ? false : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
  });

  it('renders one trigger and reveals all valid articles', async () => {
    vi.mocked(getContextLinksForRoutes).mockResolvedValue([
      article('1', '  adicionar-clientes  '),
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

  it('omits whitespace-only slugs and hides the trigger when none remain', async () => {
    vi.mocked(getContextLinksForRoutes).mockResolvedValue([article('1', '   ')]);
    const { client } = renderHelp();
    await waitFor(() => {
      expect(client.getQueryState(['kb-context-links', '/clientes/42', '/clientes'])?.status).toBe(
        'success',
      );
    });
    expect(screen.queryByRole('button', { name: /Artigos relacionados/ })).not.toBeInTheDocument();
  });

  it('queries the deep route before the base route on nested pages', async () => {
    vi.mocked(getContextLinksForRoutes).mockResolvedValue([article('1', 'conectar-o-claude-mcp')]);
    renderHelp('/configuracao/mcp');

    await screen.findByRole('button', { name: /Artigos relacionados/ });
    expect(getContextLinksForRoutes).toHaveBeenCalledWith(['/configuracao/mcp', '/configuracao']);
  });

  it('queries only the base route on single-segment pages', async () => {
    vi.mocked(getContextLinksForRoutes).mockResolvedValue([article('1', 'gestao-financeira')]);
    renderHelp('/financeiro');

    await screen.findByRole('button', { name: /Artigos relacionados/ });
    expect(getContextLinksForRoutes).toHaveBeenCalledWith(['/financeiro']);
  });

  it('uses the kit BottomSheet on phones and navigates from its rows', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(max-width: 767px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.mocked(getContextLinksForRoutes).mockResolvedValue([article('1', 'artigo-no-celular')]);
    renderHelp();

    const trigger = await screen.findByRole('button', { name: 'Artigos relacionados, 1' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    const sheet = await screen.findByRole('dialog', { name: 'Artigos relacionados' });
    expect(sheet).toHaveClass('phone-sheet', 'context-help__sheet');
    expect(within(sheet).getByText('Escolha um artigo relacionado para abrir.')).toHaveClass(
      'sr-only',
    );
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Rows close the sheet before navigating (no dead history entry behind the article).
    fireEvent.click(within(sheet).getByRole('button', { name: 'Artigo 1' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Artigos relacionados' })).toBeNull(),
    );
    expect(screen.getByTestId('path')).toHaveTextContent('/ajuda/artigo-no-celular');
  });
});
