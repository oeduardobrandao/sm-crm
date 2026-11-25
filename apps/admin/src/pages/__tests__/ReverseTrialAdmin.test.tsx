import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mockPhone } from '../../__tests__/phone';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  getWorkspace: vi.fn(),
  listPlans: vi.fn(),
  setWorkspacePlan: vi.fn(),
  unsetWorkspacePlan: vi.fn(),
  endReverseTrial: vi.fn(),
  extendReverseTrial: vi.fn(),
  resendDemoAccess: vi.fn(),
  setWorkspaceOverrides: vi.fn(),
  clearWorkspaceOverrides: vi.fn(),
  listWorkspaceMcpKeys: vi.fn(),
  revokeMcpKey: vi.fn(),
  revokeAllMcpKeys: vi.fn(),
  listWorkspaceOAuthGrants: vi.fn(),
  revokeOAuthGrant: vi.fn(),
  revokeAllOAuthGrants: vi.fn(),
  getWorkspaceInvites: vi.fn(),
  adminCancelInvite: vi.fn(),
  adminResendInvite: vi.fn(),
  adminCreateInvite: vi.fn(),
  listWorkspaceEvents: vi.fn(),
  listWorkspaceNotes: vi.fn(),
  addWorkspaceNote: vi.fn(),
  deleteWorkspaceNote: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  endReverseTrial,
  getWorkspace,
  setWorkspacePlan,
  type Plan,
  type WorkspaceDetail,
  type WorkspaceSummary,
} from '../../lib/api';
import { TooltipProvider } from '../../components/ui/tooltip';
import { WorkspacesTable } from '../workspaces/WorkspacesTable';
import { WorkspacesToolbar } from '../workspaces/WorkspacesToolbar';
import { DEFAULT_COLUMN_PREFS } from '../workspaces-columns';
import { parseWorkspacesParams, toListWorkspacesRequest } from '../workspaces-params';
import { WorkspacesFilterChips } from '../workspaces/WorkspacesFilterChips';
import { WORKSPACE, primeApi, renderPage } from './workspace-detail-fixture';

Element.prototype.scrollIntoView = vi.fn();

// 01:30 UTC on the 16th is 22:30 on the 15th in São Paulo: the badge must say 15/12.
const ENDS_AT = '2026-12-16T01:30:00Z';

const TRIAL_ROW: WorkspaceSummary = {
  id: 'ws-trial',
  name: 'Agência Teste',
  logo_url: null,
  created_at: '2026-12-02T10:00:00Z',
  last_activity_at: null,
  owner: null,
  member_count: 1,
  client_count: 0,
  plan_name: 'Pro',
  plan_source: 'trial',
  reverse_trial_ends_at: ENDS_AT,
  reverse_trial_outcome: null,
  has_overrides: false,
  subscription: null,
};

const TRIAL_DETAIL: WorkspaceDetail = {
  ...WORKSPACE,
  workspace: {
    ...WORKSPACE.workspace,
    plan_source: 'trial',
    reverse_trial_started_at: '2026-12-02T01:30:00Z',
    reverse_trial_ends_at: ENDS_AT,
    reverse_trial_outcome: null,
  },
};

describe('reverse trial in the Admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeApi();
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows_trial_badge_and_filter', () => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <WorkspacesTable
            workspaces={[TRIAL_ROW]}
            visible={DEFAULT_COLUMN_PREFS.visible}
            density="confortavel"
            sort={{ ord: 'created_at', dir: 'desc' }}
            onSort={vi.fn()}
            onOpen={vi.fn()}
            now={new Date('2026-12-05T12:00:00Z')}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Teste Pro sem cartão até 15/12/2026')).toBeInTheDocument();

    // The URL filter survives parsing, reaches the RPC and shows in the toolbar and the chips.
    const params = parseWorkspacesParams(new URLSearchParams('status=teste_sem_cartao'));
    expect(params.status).toEqual(['teste_sem_cartao']);
    expect(toListWorkspacesRequest(params, new Date()).status).toBe('teste_sem_cartao');
    const plans = [{ id: 'pro', name: 'Pro' }] as unknown as Plan[];
    render(
      <WorkspacesToolbar
        params={params}
        onChange={vi.fn()}
        plans={plans}
        prefs={DEFAULT_COLUMN_PREFS}
        onPrefs={vi.fn()}
        onExport={vi.fn()}
        exporting={false}
      />,
    );
    expect(screen.getByText('Teste sem cartão')).toBeInTheDocument();
    render(
      <WorkspacesFilterChips
        params={params}
        plans={plans}
        total={3}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(screen.getByText(/Status:/).textContent).toContain('Teste sem cartão');
  });

  it('detail shows the badge and the trial actions, not the comp button', async () => {
    vi.mocked(getWorkspace).mockResolvedValue(TRIAL_DETAIL);
    renderPage();
    expect(await screen.findByText('Teste Pro sem cartão até 15/12/2026')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Estender teste' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar agora' })).toBeInTheDocument();
    expect(screen.queryByText(/Remover comp/)).toBeNull();
  });

  it('Encerrar agora asks first and only ends the trial on confirm', async () => {
    vi.mocked(getWorkspace).mockResolvedValue(TRIAL_DETAIL);
    vi.mocked(endReverseTrial).mockResolvedValue({ message: 'ok' });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Encerrar agora' });
    fireEvent.click(btn);
    expect(endReverseTrial).not.toHaveBeenCalled();
    fireEvent.click(btn);
    await waitFor(() => expect(endReverseTrial).toHaveBeenCalledWith('ws1'));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it('changing the plan of a trial workspace asks first; cancelling keeps the plan', async () => {
    vi.mocked(getWorkspace).mockResolvedValue({
      ...TRIAL_DETAIL,
      plan: { id: 'pro', name: 'Pro' },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('combobox', { name: /plano do workspace/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Sem plano' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(setWorkspacePlan).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole('combobox', { name: /plano do workspace/i })).getByText('Pro'),
    ).toBeInTheDocument();
  });

  it('a workspace whose trial ended shows the outcome', async () => {
    vi.mocked(getWorkspace).mockResolvedValue({
      ...WORKSPACE,
      workspace: {
        ...WORKSPACE.workspace,
        plan_source: 'system',
        reverse_trial_outcome: 'downgraded',
      },
    });
    renderPage();
    expect(await screen.findByText('Teste sem cartão: voltou ao Free')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encerrar agora' })).toBeNull();
  });
});

describe('reverse trial in the Admin (phone)', () => {
  let restore: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    primeApi();
    restore = mockPhone();
  });
  afterEach(async () => {
    cleanup();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    restore();
    vi.restoreAllMocks();
  });

  it('detail shows the badge and the Estender teste and Encerrar agora rows', async () => {
    vi.mocked(getWorkspace).mockResolvedValue(TRIAL_DETAIL);
    vi.mocked(endReverseTrial).mockResolvedValue({ message: 'ok' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    expect(await screen.findByText('Teste Pro sem cartão até 15/12/2026')).toBeInTheDocument();
    expect(screen.getByText('Estender teste')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Encerrar agora'));
    await waitFor(() => expect(endReverseTrial).toHaveBeenCalledWith('ws1'));
  });
});
