import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn().mockResolvedValue([]),
  getEffectivePlanWithSource: vi.fn().mockResolvedValue(null),
  getWorkspaceSubscription: vi.fn().mockResolvedValue(null),
  hasUsedTrial: () => false,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LandingPage from '../LandingPage';

function html(node: React.ReactElement): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  ).replace(`\u00a9 ${__BUILD_YEAR__}`, '\u00a9 YEAR');
}

describe('LandingPage baseline (pt)', () => {
  it('renders the Portuguese landing as it ships', () => {
    expect(html(<LandingPage />)).toMatchSnapshot();
  });
});
