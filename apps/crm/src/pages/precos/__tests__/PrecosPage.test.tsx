import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import PrecosPage from '../PrecosPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/precos']}>
        <PrecosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PrecosPage', () => {
  it('renders the pricing h1 and FAQ', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { level: 1, name: /Planos e preços/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Posso trocar de plano depois?')).toBeInTheDocument();
  });
});
