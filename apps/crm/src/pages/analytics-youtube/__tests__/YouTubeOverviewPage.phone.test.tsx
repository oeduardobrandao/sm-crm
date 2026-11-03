import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { channels, registerYouTubeI18n } from './fixtures';

// jsdom's matchMedia matches nothing, so the page renders its phone branch (below 768px).

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_youtube: true }, isLoading: false }),
}));
// The shell's bell and help links need the KB and notification queries; their suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));
vi.mock('../../../services/youtubeAnalytics', () => ({ getYouTubePortfolio: vi.fn() }));

import { getYouTubePortfolio } from '../../../services/youtubeAnalytics';
import YouTubeOverviewPage from '../YouTubeOverviewPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/youtube']}>
        <YouTubeOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('YouTubeOverviewPage (phone)', () => {
  beforeAll(registerYouTubeI18n);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getYouTubePortfolio).mockResolvedValue(channels());
  });

  it('renders cells, not a table, below 768px', async () => {
    const { container } = renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'YouTube' })).toHaveClass(
      'phone-large-title__title',
    );
    expect(screen.getByText(/3 canais conectados · 28 dias/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(container.querySelector('.header')).toBeNull();

    const list = screen.getByRole('list', { name: 'Canais' });
    expect(within(list).getByRole('link', { name: /Dra. Ana Lima/ })).toHaveAttribute(
      'href',
      '/analytics/1/youtube',
    );
    // The value column follows the sort: views by default.
    expect(within(list).getByText('212.480')).toBeInTheDocument();
    const bella = within(list).getByRole('link', { name: /Studio Bella/ });
    expect(within(bella).getByText('Reconectar')).toBeInTheDocument();
  });

  it('keeps the per-channel note and the YouTube attribution', async () => {
    const { container } = renderPage();
    await screen.findByRole('list', { name: 'Canais' });
    expect(screen.getByText('Cada número pertence só ao canal da linha.')).toBeInTheDocument();
    expect(screen.getByText(/Dados do YouTube/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Total|Média/);
  });

  it('dims the previous rows while the next period loads', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: 'Canais' });
    expect(list.closest('[aria-busy="true"]')).toBeNull();
    vi.mocked(getYouTubePortfolio).mockReturnValueOnce(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Período: 28 dias' }));
    fireEvent.click(await screen.findByRole('button', { name: '90 dias' }));
    await waitFor(() => expect(getYouTubePortfolio).toHaveBeenLastCalledWith(90));
    const kept = screen.getByRole('list', { name: 'Canais' });
    const busy = kept.closest('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect((busy as HTMLElement).style.opacity).not.toBe('1');
    expect(within(kept).getByRole('link', { name: /Dra. Ana Lima/ })).toBeInTheDocument();
  });

  it('empty state with a link to /clientes', async () => {
    vi.mocked(getYouTubePortfolio).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nenhum canal conectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
  });
});
