import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';

vi.mock('../../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  getWorkspace: vi.fn(),
  listPlans: vi.fn(),
  setWorkspacePlan: vi.fn(),
  unsetWorkspacePlan: vi.fn(),
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
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { getWorkspace, revokeMcpKey, setWorkspaceOverrides, setWorkspacePlan } from '../../lib/api';
import { WORKSPACE, primeApi, renderPage } from './workspace-detail-fixture';
import { resendDemoAccess, unsetWorkspacePlan } from '../../lib/api';

// jsdom has no scrollIntoView; Radix's Select calls it when committing a selection.
Element.prototype.scrollIntoView = vi.fn();

const WARNING = 'Descartar as alterações não salvas?';

describe('WorkspaceDetailPage (desktop)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    primeApi();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders the hero: back link, name, owner line, usage tiles and the section tabs', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Social Bee', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Workspaces/ })).toHaveAttribute(
      'href',
      '/admin/workspaces',
    );
    expect(screen.getByText(/Dono: ana@socialbee\.com\.br · \(11\) 98765-4321/)).toBeTruthy();
    expect(screen.getAllByTestId('brand-metric')).toHaveLength(4);
    expect(screen.getByRole('progressbar', { name: 'Clientes' })).toHaveAttribute(
      'aria-valuenow',
      '80',
    );
    expect(screen.getByText('1 precisa reconectar')).toBeTruthy();
    const tabs = within(screen.getByRole('tablist', { name: 'Seções do workspace' }));
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Visão geral',
      'Funcionalidades',
      'Limites',
      'Membros',
      'Atividade',
    ]);
    // Only the active section is exposed; the others stay mounted but hidden.
    const overview = screen.getByRole('tabpanel', { name: 'Visão geral' });
    expect(within(overview).getByText('Caio Mendes')).toBeTruthy();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('switching the plan calls the plan mutation', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('combobox', { name: /plano do workspace/i }));
    fireEvent.click(await screen.findByRole('option', { name: 'Sem plano' }));
    await waitFor(() => expect(setWorkspacePlan).toHaveBeenCalledWith('ws1', ''));
  });

  it('limits sheet: Cancelar with edits asks once; declining keeps the sheet and the edit', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar limites' }));
    const dialog = screen.getByRole('dialog', { name: 'Limites de recursos' });
    const input = within(dialog).getByLabelText('Máx. de clientes') as HTMLInputElement;
    expect(input.value).toBe('10');
    fireEvent.change(input, { target: { value: '15' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(WARNING);
    expect(screen.getByRole('dialog', { name: 'Limites de recursos' })).toBeTruthy();
    expect((screen.getByLabelText('Máx. de clientes') as HTMLInputElement).value).toBe('15');

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // The discarded edit is gone when the sheet opens again.
    fireEvent.click(screen.getByRole('button', { name: 'Editar limites' }));
    expect((screen.getByLabelText('Máx. de clientes') as HTMLInputElement).value).toBe('10');
  });

  it('limits sheet: Cancelar without edits closes without asking', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar limites' }));
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(confirm).not.toHaveBeenCalled();
  });

  it('limits sheet: Salvar submits the override payload and closes', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar limites' }));
    fireEvent.change(screen.getByLabelText('Máx. de clientes'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(setWorkspaceOverrides).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace_id: 'ws1',
          resource_overrides: { max_clients: 15 },
          feature_overrides: {},
          notes: 'Ligar dia 16',
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('features sheet: toggling a switch and saving sends the feature override', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar funcionalidades' }));
    const dialog = screen.getByRole('dialog', { name: 'Funcionalidades' });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Portal do Hub' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(setWorkspaceOverrides).toHaveBeenCalledWith(
        expect.objectContaining({ feature_overrides: { feature_hub_portal: true } }),
      ),
    );
  });

  it('the Atividade section lists MCP keys and revokes one', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Atividade' }));
    expect(await screen.findByText('Claude Desktop')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Revogar' }));
    await waitFor(() => expect(revokeMcpKey).toHaveBeenCalledWith('ws1', 'k1'));
  });

  it('keeps an invite draft across a tab switch (sections stay mounted)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Membros' }));
    fireEvent.click(await screen.findByRole('button', { name: /\+ convidar/i }));
    const email = screen.getByLabelText('E-mail') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'nova@x.com' } });

    fireEvent.click(screen.getByRole('tab', { name: 'Atividade' }));
    expect(email.closest('[role="tabpanel"]')).toHaveAttribute('hidden'); // hidden, not unmounted
    fireEvent.click(screen.getByRole('tab', { name: 'Membros' }));
    expect(screen.getByLabelText('E-mail')).toBe(email);
    expect(email.value).toBe('nova@x.com');
  });

  it('keeps the member row cells on one line so Papel is never cut', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: 'Membros' }));
    const email = screen.getAllByText('caio@socialbee.com.br').find((el) => el.closest('tr'))!;
    const row = email.closest('tr')!;
    const cells = row.querySelectorAll('td');
    expect(cells[2]).toHaveClass('whitespace-nowrap');
    expect(cells[3]).toHaveClass('whitespace-nowrap');
    expect(email).toHaveAttribute('title', 'caio@socialbee.com.br');
  });

  it('keeps the Notes textarea in the DOM while another tab is active', async () => {
    renderPage();
    const notes = (await screen.findByLabelText('Notas do admin')) as HTMLTextAreaElement;
    fireEvent.change(notes, { target: { value: 'Rascunho' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Limites' }));
    expect(notes.isConnected).toBe(true);
    expect(notes.closest('[role="tabpanel"]')).toHaveAttribute('hidden');
    expect(notes.value).toBe('Rascunho');
  });

  it('shows both dashboard links when Stripe and Pagar.me URLs are set', async () => {
    vi.mocked(getWorkspace).mockResolvedValue({
      ...WORKSPACE,
      subscription: {
        provider: 'pagarme',
        status: 'active',
        stripe_dashboard_url: 'https://dashboard.stripe.com/x',
        pagarme_dashboard_url: 'https://dash.pagar.me/y',
      } as never,
    });
    renderPage();
    expect(await screen.findByRole('link', { name: /Abrir no Stripe/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Abrir no Pagar\.me/ })).toBeTruthy();
  });
});

const DEMO = {
  ...WORKSPACE,
  workspace: {
    ...WORKSPACE.workspace,
    plan_source: 'demo',
    demo_created_at: '2026-10-25T12:00:00Z',
  },
  affiliate: { id: 'a1', name: 'Bia Parceira', code: 'bia2026' },
};

describe('WorkspaceDetailPage demo account (desktop)', () => {
  let restore: () => void = () => {};
  beforeEach(() => {
    vi.clearAllMocks();
    primeApi();

    vi.mocked(getWorkspace).mockResolvedValue(DEMO);
    vi.mocked(unsetWorkspacePlan).mockResolvedValue({ message: 'ok', plan_source: 'subscription' });
    vi.mocked(resendDemoAccess).mockResolvedValue({ message: 'ok' });
  });
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('offers Encerrar demo, which calls unsetWorkspacePlan', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: 'Encerrar demo' });
    expect(screen.queryByText(/Remover comp/)).toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(unsetWorkspacePlan).toHaveBeenCalledWith('ws1'));
  });

  it('offers Reenviar acesso when demo_created_at is set', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reenviar acesso' }));
    await waitFor(() => expect(resendDemoAccess).toHaveBeenCalledWith('ws1'));
  });

  it('hides Reenviar acesso and Encerrar demo on a normal workspace', async () => {
    vi.mocked(getWorkspace).mockResolvedValue(WORKSPACE);
    renderPage();
    await screen.findByRole('heading', { name: 'Social Bee', level: 1 });
    expect(screen.queryByRole('button', { name: 'Reenviar acesso' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Encerrar demo' })).toBeNull();
  });

  it('shows the Afiliado row', async () => {
    renderPage();
    expect(await screen.findByRole('link', { name: /Bia Parceira/ })).toHaveAttribute(
      'href',
      '/admin/afiliados/a1',
    );
  });

  it('shows the Demo badge', async () => {
    renderPage();
    await screen.findByRole('button', { name: 'Encerrar demo' });
    expect(screen.getByText('Demo')).toBeInTheDocument();
  });
});
