import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { getInstagramPosts } from '../../../services/instagram';
import { LatestInstagramPosts } from '../LatestInstagramPosts';
import { InstagramSection } from '../../../pages/cliente-detalhe/ClienteDetalhePage';

vi.mock('../../../services/instagram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/instagram')>()),
  getInstagramPosts: vi.fn(),
}));

vi.mock('../InstagramOverviewCard', () => ({ renderInstagramOverviewCard: vi.fn() }));
vi.mock('../InstagramFollowerChart', () => ({ renderInstagramFollowerChart: vi.fn() }));
vi.mock('../InstagramConnectButton', () => ({ renderInstagramConnectButton: vi.fn() }));

vi.mock('@/lib/supabase', () => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.single = vi.fn(() => Promise.resolve({ data: { auto_publish_on_approval: false } }));
  return { supabase: { from: vi.fn(() => query) } };
});

const mockedGetInstagramPosts = vi.mocked(getInstagramPosts);
const css = readFileSync('apps/crm/style.css', 'utf8');

const olderPost = {
  id: 'older',
  posted_at: '2026-07-10T12:00:00Z',
  media_type: 'IMAGE',
  caption: 'Publicação mais antiga',
  thumbnail_url: 'https://images.example/older.jpg',
  permalink: 'https://instagram.com/p/older',
  likes: 20,
  comments: 2,
  reach: 100,
  impressions: 150,
};

const newerPost = {
  id: 'newer',
  posted_at: '2026-07-13T12:00:00Z',
  media_type: 'CAROUSEL_ALBUM',
  caption: 'Publicação mais recente',
  thumbnail_url: 'https://images.example/newer.jpg',
  permalink: 'https://instagram.com/p/safe',
  likes: 75,
  comments: 6,
  reach: 321,
  impressions: 941,
};

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('LatestInstagramPosts', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    await i18n.changeLanguage('pt');
  });

  it('renders newest-first media cards in the Últimas Publicações carousel', async () => {
    mockedGetInstagramPosts.mockResolvedValue({
      total: 2,
      posts: [olderPost, newerPost],
    });

    renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);

    const region = await screen.findByRole('region', { name: 'Últimas Publicações' });
    expect(within(region).getAllByRole('article').map((card) => card.textContent)).toEqual([
      expect.stringContaining(newerPost.caption),
      expect.stringContaining(olderPost.caption),
    ]);
    expect(mockedGetInstagramPosts).toHaveBeenCalledWith(42, 1);
  });

  it('shows media, metrics, sanitized link, and accessible pagination', async () => {
    mockedGetInstagramPosts.mockResolvedValue({ posts: [newerPost], total: 11 });

    renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);

    expect(await screen.findByText('Carrossel')).toBeTruthy();
    expect(screen.getByText(/75/)).toBeTruthy();
    expect(screen.getByText(/321/)).toBeTruthy();
    expect(document.querySelector('.latest-instagram-post-card__media img')).toHaveAttribute(
      'src',
      'https://images.example/newer.jpg',
    );
    expect(screen.getByRole('link', { name: 'Abrir publicação' })).toHaveAttribute(
      'href',
      'https://instagram.com/p/safe',
    );
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    const next = screen.getByRole('button', { name: 'Próxima página' });
    expect(next).toBeEnabled();
    expect(screen.getByText('Pg 1 de 2')).toBeTruthy();

    fireEvent.click(next);
    await waitFor(() => expect(mockedGetInstagramPosts).toHaveBeenLastCalledWith(42, 2));
    expect(await screen.findByText('Pg 2 de 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  });

  it('uses a scoped 4:5 portrait stage that contains the complete client-post preview', () => {
    expect(css).toMatch(
      /\.latest-instagram-post-card__media\s*\{[^}]*aspect-ratio:\s*4\s*\/\s*5[^}]*background:\s*#111827/s,
    );
    expect(css).toMatch(
      /\.latest-instagram-post-card__media img\s*\{[^}]*object-fit:\s*contain/s,
    );
    expect(css).toMatch(
      /\.latest-instagram-post-card\s*\{[^}]*overflow:\s*hidden[^}]*border-radius:\s*16px/s,
    );

    const portraitStageRule = css.match(/\.latest-instagram-post-card__media\s*\{[^}]*\}/s)?.[0];
    expect(portraitStageRule).not.toContain('analytics-post-card');
  });

  it('does not expose unsafe media or publication URLs', async () => {
    mockedGetInstagramPosts.mockResolvedValue({
      posts: [
        {
          ...newerPost,
          thumbnail_url: 'javascript:alert(1)',
          permalink: 'javascript:alert(2)',
        },
      ],
      total: 1,
    });

    renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);

    await screen.findByRole('article');
    expect(document.querySelector('.latest-instagram-post-card__media img')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Abrir publicação' })).toBeNull();
  });

  it('keeps an accessible previous-page escape when a later page is empty', async () => {
    mockedGetInstagramPosts.mockImplementation((_clienteId, page) =>
      Promise.resolve(page === 1 ? { posts: [newerPost], total: 11 } : { posts: [], total: 10 }),
    );

    renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Próxima página' }));

    expect(await screen.findByText('Nenhuma publicação encontrada.')).toBeTruthy();
    const previous = screen.getByRole('button', { name: 'Página anterior' });
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    expect(await screen.findByRole('article')).toHaveTextContent(newerPost.caption);
  });

  it('keeps an accessible previous-page escape when a later page fails', async () => {
    mockedGetInstagramPosts.mockImplementation((_clienteId, page) =>
      page === 1
        ? Promise.resolve({ posts: [newerPost], total: 11 })
        : Promise.reject(new Error('server detail must stay private')),
    );

    renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Próxima página' }));

    expect(await screen.findByRole('alert')).not.toHaveTextContent('server detail must stay private');
    const previous = screen.getByRole('button', { name: 'Página anterior' });
    expect(previous).toBeEnabled();
    fireEvent.click(previous);
    expect(await screen.findByRole('article')).toHaveTextContent(newerPost.caption);
    expect(mockedGetInstagramPosts).toHaveBeenLastCalledWith(42, 1);
  });

  it('localizes external-link copy, numbers, and dates from the resolved English language', async () => {
    await i18n.changeLanguage('en');
    mockedGetInstagramPosts.mockResolvedValue({
      posts: [{ ...newerPost, likes: 1234 }],
      total: 1,
    });

    renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);

    expect(await screen.findByRole('link', { name: 'Open publication' })).toBeTruthy();
    expect(screen.getByLabelText('Likes: 1,234')).toBeInTheDocument();
    expect(screen.getByText('7/13/2026')).toBeInTheDocument();
  });

  it('announces loading to assistive technology', () => {
    mockedGetInstagramPosts.mockReturnValue(new Promise(() => undefined));

    renderWithQueryClient(<LatestInstagramPosts clienteId={42} />);

    expect(screen.getByRole('status')).toHaveTextContent('Carregando publicações');
  });

  it('renders the real paginated carousel through the client-detail Instagram section', async () => {
    mockedGetInstagramPosts.mockResolvedValue({ posts: [newerPost], total: 1 });

    renderWithQueryClient(
      <InstagramSection
        clienteId={42}
        loadingIg={false}
        igSummary={{ account: { last_synced_at: '2026-07-18T12:00:00Z' }, history: [] }}
        refetchIg={vi.fn()}
        onNavigateAnalytics={vi.fn()}
      />,
    );

    const region = await screen.findByRole('region', { name: 'Últimas Publicações' });
    expect(within(region).getByRole('article')).toHaveTextContent(newerPost.caption);
    expect(mockedGetInstagramPosts).toHaveBeenCalledWith(42, 1);
  });
});
