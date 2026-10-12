import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
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

import {
  adminCreateInvite,
  getWorkspace,
  revokeMcpKey,
  setWorkspaceOverrides,
  setWorkspacePlan,
} from '../../lib/api';
import {
  WORKSPACE,
  primeApi,
  renderPage,
  renderPageWithBrowserHistory,
} from './workspace-detail-fixture';

const WARNING = 'Descartar as alterações não salvas?';

describe('WorkspaceDetailPage (phone)', () => {
  let restore: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    primeApi();
    restore = mockPhone();
  });
  afterEach(async () => {
    // Unmounting an open popOnUnmount sheet pops history and then re-syncs the URL on a timer.
    // Let that land while the DOM still exists, or it fires after the environment is gone
    // ("window is not defined").
    cleanup();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
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

  it('limits sheet: values are right-aligned plain numbers and labels stay on one line', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Limites de recursos/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Limites de recursos' });
    const input = within(sheet).getByLabelText('Máx. de clientes');
    expect(input.className).toContain('text-right');
    expect(input.className).toContain('[appearance:textfield]');
    const label = within(sheet).getByText('Máx. de clientes', { selector: 'label' });
    expect(label).toHaveClass('phone-cell__label');
    expect(label).toHaveAttribute('title', 'Máx. de clientes');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent(
      /plano: 10/,
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

  it('dismissing the invites sheet keeps the typed e-mail and role', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Convidar' }));
    let sheet = await screen.findByRole('dialog', { name: /Convites/ });
    fireEvent.change(within(sheet).getByLabelText('E-mail'), {
      target: { value: 'nova@socialbee.com.br' },
    });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Admin' }));

    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Convites/ })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));
    sheet = await screen.findByRole('dialog', { name: /Convites/ });
    expect((within(sheet).getByLabelText('E-mail') as HTMLInputElement).value).toBe(
      'nova@socialbee.com.br',
    );
    expect(within(sheet).getByRole('radio', { name: 'Admin' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('a successful invite send clears the draft', async () => {
    vi.mocked(adminCreateInvite).mockResolvedValue({ message: 'Convite enviado.' } as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Convidar' }));
    let sheet = await screen.findByRole('dialog', { name: /Convites/ });
    fireEvent.change(within(sheet).getByLabelText('E-mail'), {
      target: { value: 'nova@socialbee.com.br' },
    });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Admin' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(adminCreateInvite).toHaveBeenCalledWith(
        'ws1',
        'nova@socialbee.com.br',
        'admin',
        false,
      ),
    );
    await waitFor(() => expect(within(sheet).queryByLabelText('E-mail')).toBeNull());

    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Convites/ })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Convidar' }));
    sheet = await screen.findByRole('dialog', { name: /Convites/ });
    expect((within(sheet).getByLabelText('E-mail') as HTMLInputElement).value).toBe('');
    expect(within(sheet).getByRole('radio', { name: 'Agente' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('hero owner line can break anywhere, so a long e-mail never widens the page', async () => {
    renderPage();
    const line = await screen.findByText(/Dono: ana@socialbee\.com\.br/);
    expect(line.className).toContain('[overflow-wrap:anywhere]');
    expect(line.className).toContain('min-w-0');
  });

  it('subscription values sit outside the half-width nowrap value slot', async () => {
    vi.mocked(getWorkspace).mockResolvedValue({
      ...WORKSPACE,
      subscription: {
        provider: 'stripe',
        status: 'active',
        plan_id: 'pro',
        plan_name: 'Pro',
        billing_interval: 'month',
        current_period_end: '2026-10-16T12:00:00Z',
        cancel_at_period_end: false,
        failed_payment_count: 0,
        stripe_customer_id: 'cus_1',
        stripe_subscription_id: 'sub_1',
        pagarme_subscription_id: null,
        installments: null,
        amount_cents: 15760,
        gross_cents: 19700,
        currency: 'brl',
        interval: 'month',
        discount_label: 'BEMVINDO20 (−20%)',
        amount_source: 'stripe',
        stripe_dashboard_url: null,
        pagarme_dashboard_url: null,
        pagarme_live: null,
        pagarme_live_error: false,
      },
    } as never);
    renderPage();
    const coupon = await screen.findByText('BEMVINDO20 (−20%)');
    expect(coupon.closest('.phone-cell__value')).toBeNull();
    expect(coupon.closest('.phone-cell__body')).not.toBeNull();
  });

  it('features sheet: Salvar sends the toggled feature override', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Funcionalidades/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Funcionalidades' });
    fireEvent.click(within(sheet).getByRole('switch', { name: 'Portal do Hub' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(setWorkspaceOverrides).toHaveBeenCalledWith(
        expect.objectContaining({ feature_overrides: { feature_hub_portal: true } }),
      ),
    );
  });

  it('Back with dirty limits asks once; declining keeps the sheet open on the page', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const router = renderPageWithBrowserHistory();
    const idx = () => (window.history.state as { idx: number }).idx;
    fireEvent.click(await screen.findByRole('button', { name: /Limites de recursos/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Limites de recursos' });
    const start = idx();
    fireEvent.change(within(sheet).getByLabelText('Máx. de clientes'), {
      target: { value: '15' },
    });

    act(() => window.history.back());
    // The pop is async; the refused-close re-push follows it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(WARNING);
    expect(screen.getByRole('dialog', { name: 'Limites de recursos' })).toBeTruthy();
    expect((screen.getByLabelText('Máx. de clientes') as HTMLInputElement).value).toBe('15');
    expect(idx()).toBe(start);
    expect(router.state.location.pathname).toBe('/admin/workspaces/ws1');
  });
});
