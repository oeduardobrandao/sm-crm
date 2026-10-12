// Shared by WorkspaceDetailPage.test.tsx and WorkspaceDetailPage.phone.test.tsx.
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, RouterProvider, createBrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import type { Plan, WorkspaceDetail } from '../../lib/api';
import * as api from '../../lib/api';
import WorkspaceDetailPage from '../WorkspaceDetailPage';

export const PLAN = {
  id: 'pro',
  name: 'Pro',
  max_clients: 10,
  max_team_members: 5,
  max_instagram_accounts: 10,
  storage_quota_bytes: 5 * 1024 ** 3,
  feature_instagram: true,
  feature_hub_portal: false,
} as unknown as Plan;

export const WORKSPACE: WorkspaceDetail = {
  workspace: {
    id: 'ws1',
    name: 'Social Bee',
    logo_url: null,
    created_at: '2026-10-02T12:00:00Z',
    plan_source: 'subscription',
  },
  owner: {
    user_id: 'u1',
    name: 'Ana Ribeiro',
    email: 'ana@socialbee.com.br',
    telefone: '(11) 98765-4321',
    marketing_opt_in: false,
    role: 'owner',
    joined_at: '2026-10-02T12:00:00Z',
  },
  members: [
    {
      user_id: 'u1',
      name: 'Ana Ribeiro',
      email: 'ana@socialbee.com.br',
      telefone: '(11) 98765-4321',
      marketing_opt_in: false,
      role: 'owner',
      joined_at: '2026-10-02T12:00:00Z',
    },
    {
      user_id: 'u2',
      name: 'Caio Mendes',
      email: 'caio@socialbee.com.br',
      telefone: null,
      marketing_opt_in: false,
      role: 'admin',
      joined_at: '2026-10-03T12:00:00Z',
    },
  ],
  plan: { id: 'pro', name: 'Pro' },
  override: { resource_overrides: null, feature_overrides: null, notes: 'Ligar dia 16' },
  resolved_limits: {
    max_clients: 10,
    max_team_members: 5,
    max_instagram_accounts: 10,
    storage_quota_bytes: 5 * 1024 ** 3,
  },
  resolved_features: { feature_instagram: true, feature_hub_portal: false },
  subscription: null,
  usage: {
    client_count: 8,
    member_count: 2,
    integration_count: 0,
    instagram_account_count: 6,
    instagram_account_count_active: 5,
    storage_used_bytes: 2 * 1024 ** 3,
  },
};

export const MCP_KEY = {
  id: 'k1',
  name: 'Claude Desktop',
  token_suffix: 'ab12',
  scopes: ['read'],
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
  created_at: '2026-10-01T00:00:00Z',
};

/** Points every API call the page and its two cards make at a resolved mock. */
export function primeApi() {
  vi.mocked(api.getWorkspace).mockResolvedValue(WORKSPACE);
  vi.mocked(api.listPlans).mockResolvedValue({ plans: [PLAN] } as never);
  vi.mocked(api.listWorkspaceMcpKeys).mockResolvedValue({ keys: [MCP_KEY] });
  vi.mocked(api.listWorkspaceOAuthGrants).mockResolvedValue({ grants: [] });
  vi.mocked(api.getWorkspaceInvites).mockResolvedValue({ invites: [], total: 0 });
  vi.mocked(api.listWorkspaceEvents).mockResolvedValue({ events: [], total: 0 } as never);
  vi.mocked(api.setWorkspaceOverrides).mockResolvedValue({ message: 'ok' });
  vi.mocked(api.setWorkspacePlan).mockResolvedValue({ message: 'ok' } as never);
  vi.mocked(api.revokeMcpKey).mockResolvedValue({ message: 'ok' });
}

export function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/workspaces/ws1']}>
        <Routes>
          <Route path="/admin/workspaces/:id" element={<WorkspaceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Real window.history (createMemoryRouter never writes it), for Back-button tests. */
export function renderPageWithBrowserHistory() {
  window.history.replaceState(null, '', '/admin/workspaces/ws1');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createBrowserRouter([
    { path: '/admin/workspaces/:id', element: <WorkspaceDetailPage /> },
    { path: '*', element: <p>fora da página</p> },
  ]);
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
