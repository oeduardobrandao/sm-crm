import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { limitsMock, usageMock } = vi.hoisted(() => ({
  limitsMock: vi.fn(),
  usageMock: vi.fn(),
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: limitsMock }));
vi.mock('@/hooks/useWorkspaceUsage', () => ({ useWorkspaceUsage: usageMock }));
vi.mock('@/hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: () => true }));

import { UsagePanel } from '../UsagePanel';

const LIMITS = {
  max_clients: 15,
  max_team_members: 3,
  max_workflow_templates: 8,
  max_active_workflows_per_client: 10,
  max_instagram_accounts: 15,
  max_leads: 200,
  max_hub_tokens: 15,
  storage_quota_bytes: 10 * 1024 ** 3,
  max_custom_properties_per_template: 15,
  max_posts_per_workflow: null,
  max_workspaces_per_user: 1,
  max_mcp_keys: null,
  rate_instagram_syncs_per_day: null,
  rate_ai_analyses_per_month: null,
  rate_report_generations_per_month: null,
};
const USAGE = {
  clients: 13,
  team_members: 2,
  pending_invites: 1,
  leads: 37,
  hub_tokens: 9,
  workflow_templates: 5,
  instagram_accounts: 6,
  mcp_keys: 2,
  storage_used_bytes: 4.2 * 1024 ** 3,
};

function renderPanel() {
  render(
    <MemoryRouter>
      <UsagePanel />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  limitsMock.mockReturnValue({
    limits: LIMITS,
    planName: 'Pro',
    isLoading: false,
    isUnlimited: false,
  });
  usageMock.mockReturnValue({ usage: USAGE, isLoading: false, isError: false });
});

describe('UsagePanel', () => {
  it('renders a meter per workspace-wide limit with the seat total including pending invites', () => {
    renderPanel();
    expect(screen.getByText('Uso do plano')).toBeInTheDocument();
    expect(screen.getByText('13 de 15')).toBeInTheDocument(); // clientes
    expect(screen.getByText('3 de 3')).toBeInTheDocument(); // 2 membros + 1 convite
    expect(screen.getByText('2 membros e 1 convite pendente')).toBeInTheDocument();
    expect(screen.getByText('4,2 GB de 10 GB')).toBeInTheDocument();
    expect(screen.getByText('Ilimitado')).toBeInTheDocument(); // chaves MCP (null limit)
  });

  it('renders the labels matching the entitlement-error vocabulary', () => {
    renderPanel();
    expect(screen.getByText('Portais do Hub')).toBeInTheDocument();
    expect(screen.getByText('Modelos de fluxo')).toBeInTheDocument();
    expect(screen.queryByText('Tokens do Hub')).not.toBeInTheDocument();
    expect(screen.queryByText('Templates de workflow')).not.toBeInTheDocument();
  });

  it('renders the quiet fallback when the usage RPC fails', () => {
    usageMock.mockReturnValue({ usage: null, isLoading: false, isError: true });
    renderPanel();
    expect(screen.getByText('Não foi possível carregar o uso do plano.')).toBeInTheDocument();
  });

  it('renders the quiet fallback when usage is an empty object (no active workspace / stale pointer)', () => {
    usageMock.mockReturnValue({ usage: {}, isLoading: false, isError: false });
    renderPanel();
    expect(screen.getByText('Não foi possível carregar o uso do plano.')).toBeInTheDocument();
    expect(screen.queryByText('0 de 15')).not.toBeInTheDocument();
  });

  it('renders nothing when no plan resolved (isUnlimited)', () => {
    limitsMock.mockReturnValue({
      limits: null,
      planName: null,
      isLoading: false,
      isUnlimited: true,
    });
    const { container } = render(
      <MemoryRouter>
        <UsagePanel />
      </MemoryRouter>,
    );
    expect(container.firstChild).toBeNull();
  });
});
