import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  getWorkspace: vi.fn(),
  listPlans: vi.fn(),
  setWorkspacePlan: vi.fn(),
  unsetWorkspacePlan: vi.fn(),
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
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { revokeMcpKey, setWorkspaceOverrides, setWorkspacePlan } from '../../lib/api';
import { primeApi, renderPage } from './workspace-detail-fixture';

const WARNING = 'Descartar as alterações não salvas?';

describe('WorkspaceDetailPage (phone)', () => {
  let restore: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    primeApi();
    restore = mockPhone();
  });
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('renders the nav bar, hero, usage tiles and member rows', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Social Bee', level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Voltar para Workspaces' })).toBeTruthy();
    expect(screen.getByText(/Dono: ana@socialbee\.com\.br/)).toBeTruthy();
    expect(screen.getAllByTestId('brand-metric')).toHaveLength(4);
    const members = screen.getByRole('list', { name: /Membros \(2\)/ });
    expect(within(members).getByText('Ana Ribeiro')).toBeTruthy();
    expect(within(members).getByText('Caio Mendes')).toBeTruthy();
    expect(within(members).getByText('Dono')).toBeTruthy();
    // No desktop section tabs on phones: sections are grouped rows.
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('the Plano row opens a picker that switches the plan', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Plano/ }));
    const picker = await screen.findByRole('dialog', { name: 'Plano' });
    fireEvent.click(within(picker).getByRole('button', { name: /Sem plano/ }));
    await waitFor(() => expect(setWorkspacePlan).toHaveBeenCalledWith('ws1', ''));
  });

  it('limits sheet: Cancelar asks once with edits; declining keeps them, confirming resets', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Limites de recursos/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Limites de recursos' });
    fireEvent.change(within(sheet).getByLabelText('Máx. de clientes'), {
      target: { value: '15' },
    });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(WARNING);
    expect(screen.getByRole('dialog', { name: 'Limites de recursos' })).toBeTruthy();
    expect((screen.getByLabelText('Máx. de clientes') as HTMLInputElement).value).toBe('15');

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Limites de recursos' })).toBeNull(),
    );

    fireEvent.click(screen.getByRole('button', { name: /Limites de recursos/ }));
    const reopened = await screen.findByRole('dialog', { name: 'Limites de recursos' });
    expect((within(reopened).getByLabelText('Máx. de clientes') as HTMLInputElement).value).toBe(
      '10',
    );
  });

  it('limits sheet: Salvar calls the save mutation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Limites de recursos/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Limites de recursos' });
    fireEvent.change(within(sheet).getByLabelText('Máx. de clientes'), {
      target: { value: '15' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(setWorkspaceOverrides).toHaveBeenCalledWith(
        expect.objectContaining({ resource_overrides: { max_clients: 15 } }),
      ),
    );
  });

  it('the MCP keys row drills into a sheet that revokes a key', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Chaves de API do MCP/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Chaves de API do MCP' });
    expect(within(sheet).getByText('Claude Desktop …ab12')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(revokeMcpKey).toHaveBeenCalledWith('ws1', 'k1'));
  });

  it('Convidar opens the invites sheet with the form', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Convidar' }));
    const sheet = await screen.findByRole('dialog', { name: /Convites/ });
    expect(within(sheet).getByLabelText('E-mail')).toBeTruthy();
    expect(within(sheet).getByRole('radiogroup', { name: 'Papel' })).toBeTruthy();
    expect(within(sheet).getByText('Nenhum convite')).toBeTruthy();
  });
});
