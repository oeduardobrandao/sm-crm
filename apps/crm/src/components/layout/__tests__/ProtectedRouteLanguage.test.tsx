import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setActiveWorkspaceLanguage } from '@mesaas/i18n';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 'u' },
    profile: { empresa: 'x' },
    role: 'owner',
    can: () => true,
    loading: false,
  })),
}));
vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: null, isLoading: false, isUnlimited: true }),
}));
vi.mock('../useTrialOfferRedirect', () => ({
  useTrialOfferRedirect: () => ({ pending: false, redirect: false }),
}));
vi.mock('@/components/paywall/useReadOnlyGrandfather', () => ({
  useReadOnlyGrandfather: () => ({ readOnly: false, pending: false }),
}));
vi.mock('../useReverseTrialStart', () => ({
  useReverseTrialStart: () => ({ pending: false, welcomeEndsAt: null, dismissWelcome: () => {} }),
}));
vi.mock('@/components/billing/ReverseTrialWelcomeDialog', () => ({
  ReverseTrialWelcomeDialog: () => null,
}));
const getCurrentWorkspace = vi.fn();
vi.mock('@/store/workspace', () => ({ getCurrentWorkspace: () => getCurrentWorkspace() }));

import ProtectedRoute from '../ProtectedRoute';

describe('ProtectedRoute workspace language', () => {
  afterEach(async () => {
    localStorage.clear();
    setActiveWorkspaceLanguage(null);
    await i18n.changeLanguage('pt');
  });

  it('keeps an en workspace in English on a protected page outside AppLayout', async () => {
    getCurrentWorkspace.mockResolvedValue({ id: 'w', name: 'W', logo_url: null, language: 'en' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/comecar']}>
          <Routes>
            <Route
              path="/comecar"
              element={
                <ProtectedRoute>
                  <div>oferta</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(i18n.language).toBe('en'));
  });
});
