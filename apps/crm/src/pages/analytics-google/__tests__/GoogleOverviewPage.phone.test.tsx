import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolio, registerGoogleI18n, review } from './fixtures';

// jsdom's matchMedia matches nothing, so the page renders its phone branch (below 768px).

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_google_business: true }, isLoading: false }),
}));
// The shell's bell and help links need the KB and notification queries; their suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));
vi.mock('../../../services/gbpAnalytics', () => ({ getGbpPortfolio: vi.fn() }));

import { getGbpPortfolio } from '../../../services/gbpAnalytics';
import GoogleOverviewPage from '../GoogleOverviewPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/google']}>
        <GoogleOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GoogleOverviewPage (phone)', () => {
  beforeAll(registerGoogleI18n);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getGbpPortfolio).mockResolvedValue(portfolio());
  });

  it('renders the phone layout with cells and no table below 768px', async () => {
    const { container } = renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Analytics do Google Meu Negócio' }),
    ).toHaveClass('phone-large-title__title');
    expect(screen.getByText(/2 unidades · 30 dias/)).toBeInTheDocument();
    expect(container.querySelector('table')).toBeNull();
    expect(container.querySelector('.header')).toBeNull();
    const list = screen.getByRole('list', { name: 'Todas as unidades' });
    expect(within(list).getByRole('link', { name: /Beta Centro/ })).toHaveAttribute(
      'href',
      '/analytics/2/google',
    );
  });

  it('shows the reviews that need attention', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({ reviewsAttention: Array.from({ length: 11 }, (_, i) => review(i)) }),
    );
    const { container } = renderPage();
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelectorAll('[data-attention-review]')).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Ver todas (11)' })).toBeInTheDocument();
  });
});
