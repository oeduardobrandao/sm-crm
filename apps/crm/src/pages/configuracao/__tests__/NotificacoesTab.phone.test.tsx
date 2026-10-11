import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NOTIFICATION_CATALOG, CATEGORY_LABELS } from '@/lib/notification-catalog';
import { makeCan, fakeMembership } from '@/test/makeCan';

// No useIsDesktop mock: jsdom's matchMedia is false, so the tab renders its phone branch.

const getInapp = vi.fn();
const setInapp = vi.fn();
const getEmail = vi.fn();
const setEmail = vi.fn();

vi.mock('@/store/notificationPrefs', () => ({
  getNotificationInappPrefs: (...a: unknown[]) => getInapp(...a),
  setNotificationInappPref: (...a: unknown[]) => setInapp(...a),
  getNotificationEmailPrefs: (...a: unknown[]) => getEmail(...a),
  setNotificationEmailPref: (...a: unknown[]) => setEmail(...a),
  MASTER_PAUSE_TYPE: '__all__',
}));

vi.mock('@/hooks/useNotifications', () => ({
  INAPP_PREFS_KEY: ['notification-inapp-prefs'],
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_agenda: true } }),
}));

const { mockUseAuth, mockSupabaseUpdate, mockSupabaseEq } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockSupabaseUpdate: vi.fn(),
  mockSupabaseEq: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ update: mockSupabaseUpdate })) },
}));

const getClientesMock = vi.fn();
const updateClienteMock = vi.fn();
const getWorkspaceBrandingMock = vi.fn();
const updateWorkspaceBrandingMock = vi.fn();

vi.mock('@/store', () => ({
  getClientes: (...a: unknown[]) => getClientesMock(...a),
  updateCliente: (...a: unknown[]) => updateClienteMock(...a),
  getWorkspaceBranding: (...a: unknown[]) => getWorkspaceBrandingMock(...a),
  updateWorkspaceBranding: (...a: unknown[]) => updateWorkspaceBrandingMock(...a),
}));

vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

const CLIENTES_FIXTURE = [
  {
    id: 1,
    nome: 'Ana Clínica',
    email: 'ana@example.com',
    status: 'ativo',
    send_report_email: true,
    send_event_email: true,
    event_email_unsub_at: null,
  },
  {
    id: 3,
    nome: 'Clínica Sem Email',
    email: '',
    status: 'ativo',
    send_report_email: false,
    send_event_email: false,
    event_email_unsub_at: null,
  },
  {
    id: 6,
    nome: 'Eva Desativada',
    email: 'eva@example.com',
    status: 'ativo',
    send_report_email: false,
    send_event_email: false,
    event_email_unsub_at: '2026-08-01T00:00:00Z',
  },
];
const BRANDING_FIXTURE = {
  brand_color: '#eab308',
  report_splash_url: null,
  send_report_email: true,
  send_client_event_emails: false,
};

import NotificacoesTab from '../tabs/NotificacoesTab';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <NotificacoesTab />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function setAuth(can = makeCan(fakeMembership({ role: 'owner' }))) {
  mockUseAuth.mockReturnValue({
    user: { id: 'user-1' },
    profile: { id: 'user-1', marketing_opt_in: true },
    refetchProfile: vi.fn().mockResolvedValue(undefined),
    workspaceRole: 'owner',
    can,
  });
}

const sw = (name: string) => screen.getByRole('switch', { name });

describe('NotificacoesTab (phone)', () => {
  beforeEach(() => {
    getInapp.mockReset().mockResolvedValue({});
    setInapp.mockReset().mockResolvedValue(undefined);
    getEmail.mockReset().mockResolvedValue({});
    setEmail.mockReset().mockResolvedValue(undefined);
    setAuth();
    mockSupabaseEq.mockReset().mockResolvedValue({ error: null });
    mockSupabaseUpdate.mockReset().mockReturnValue({ eq: mockSupabaseEq });
    getClientesMock.mockReset().mockResolvedValue(CLIENTES_FIXTURE);
    updateClienteMock.mockReset().mockResolvedValue(undefined);
    getWorkspaceBrandingMock.mockReset().mockResolvedValue(BRANDING_FIXTURE);
    updateWorkspaceBrandingMock.mockReset().mockResolvedValue(undefined);
  });

  it('renders the nav bar, title, channel switcher and category groups', async () => {
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Notificações' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Configurações' })).toBeInTheDocument();
    expect(
      await screen.findByRole('radiogroup', { name: 'Canal editado pelos botões' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Os botões abaixo ligam e desligam o canal No app.')).toBeVisible();
    expect(screen.getByRole('heading', { name: CATEGORY_LABELS.equipe })).toBeInTheDocument();
    expect(screen.getByText('E-mails automáticos')).toBeInTheDocument();
    expect(screen.getByText('Seus clientes')).toBeInTheDocument();
    // The desktop matrix (three columns per row) is not rendered.
    expect(screen.queryByText('Suas notificações')).not.toBeInTheDocument();
  });

  it('edits the No app channel by default, through the same in-app mutation', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.mention.label;
    await screen.findByRole('switch', { name: label });
    expect(sw(label)).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw(label));
    await waitFor(() => expect(setInapp).toHaveBeenCalledWith('mention', false));
    expect(setEmail).not.toHaveBeenCalled();
  });

  it('switching to E-mail makes the same switches edit the e-mail channel', async () => {
    renderTab();
    await screen.findByRole('radiogroup', { name: 'Canal editado pelos botões' });
    fireEvent.click(screen.getByRole('radio', { name: 'E-mail' }));
    expect(screen.getByText('Os botões abaixo ligam e desligam o canal E-mail.')).toBeVisible();
    fireEvent.click(sw(NOTIFICATION_CATALOG.mention.label));
    await waitFor(() => expect(setEmail).toHaveBeenCalledWith('mention', false));
    expect(setInapp).not.toHaveBeenCalled();
  });

  it('shows "Não vira e-mail" instead of a switch for a type without e-mail', async () => {
    renderTab();
    await screen.findByRole('radiogroup', { name: 'Canal editado pelos botões' });
    const label = NOTIFICATION_CATALOG.idea_submitted.label;
    expect(sw(label)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'E-mail' }));
    expect(screen.queryByRole('switch', { name: label })).not.toBeInTheDocument();
    expect(screen.getByLabelText(`${label}: este tipo não vira e-mail`)).toHaveTextContent(
      'Não vira e-mail',
    );
  });

  it('Pausar tudo pauses the selected channel through the master pause type', async () => {
    renderTab();
    await screen.findByRole('switch', { name: 'Pausar tudo' });
    fireEvent.click(sw('Pausar tudo'));
    await waitFor(() => expect(setInapp).toHaveBeenCalledWith('__all__', false));

    fireEvent.click(screen.getByRole('radio', { name: 'E-mail' }));
    fireEvent.click(sw('Pausar tudo'));
    await waitFor(() => expect(setEmail).toHaveBeenCalledWith('__all__', false));
  });

  it('locks the per-type switches of a paused channel', async () => {
    getInapp.mockResolvedValue({ __all__: false });
    renderTab();
    await screen.findByRole('switch', { name: 'Pausar tudo' });
    await waitFor(() => expect(sw('Pausar tudo')).toHaveAttribute('aria-checked', 'true'));
    expect(sw(NOTIFICATION_CATALOG.mention.label)).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'E-mail' }));
    expect(sw(NOTIFICATION_CATALOG.mention.label)).not.toBeDisabled();
  });

  it('opens E-mails automáticos as a pushed screen and Back returns', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /E-mails automáticos/ }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'E-mails automáticos' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Convite para a equipe')).toBeInTheDocument();
    expect(screen.getAllByText('sempre')).toHaveLength(3);

    const marketing = sw('Novidades e dicas do Mesaas');
    expect(marketing).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(marketing);
    await waitFor(() =>
      expect(mockSupabaseUpdate).toHaveBeenCalledWith({ marketing_opt_in: false }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Notificações' })).toBeInTheDocument();
  });

  it('Seus clientes: master and per-client switches save through the same mutations', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Seus clientes/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'Seus clientes' })).toBeInTheDocument();

    await screen.findByRole('switch', { name: 'Relatório mensal' });
    fireEvent.click(sw('Relatório mensal'));
    await waitFor(() =>
      expect(updateWorkspaceBrandingMock).toHaveBeenCalledWith({ send_report_email: false }),
    );

    // Default segment: the rows edit the monthly report.
    fireEvent.click(sw('Ana Clínica'));
    await waitFor(() =>
      expect(updateClienteMock).toHaveBeenCalledWith(1, { send_report_email: false }),
    );

    // A client without e-mail has no switch.
    expect(screen.queryByRole('switch', { name: 'Clínica Sem Email' })).not.toBeInTheDocument();
    expect(screen.getByText('sem e-mail cadastrado')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Pendências do Hub' }));
    fireEvent.click(sw('Ana Clínica'));
    await waitFor(() =>
      expect(updateClienteMock).toHaveBeenCalledWith(1, { send_event_email: false }),
    );
  });

  it('filters clients with the search field', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Seus clientes/ }));
    const search = await screen.findByRole('searchbox', { name: 'Buscar cliente' });
    fireEvent.change(search, { target: { value: 'eva' } });
    expect(screen.queryByText('Ana Clínica')).not.toBeInTheDocument();
    expect(screen.getByText('Eva Desativada')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhum cliente encontrado.')).toBeInTheDocument();
  });

  it('an unsubscribed client opens the reactivation confirm instead of toggling', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Seus clientes/ }));
    await screen.findByRole('switch', { name: 'Eva Desativada' });
    fireEvent.click(screen.getByRole('radio', { name: 'Pendências do Hub' }));
    expect(screen.getByText('eva@example.com · desativado pelo cliente')).toBeInTheDocument();

    fireEvent.click(sw('Eva Desativada'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('Reativar pendências do Hub para Eva Desativada?'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'O cliente pediu para não receber estes e-mails. Reativar mesmo assim?',
      ),
    ).toBeInTheDocument();
    expect(updateClienteMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Reativar' }));
    await waitFor(() =>
      expect(updateClienteMock).toHaveBeenCalledWith(6, {
        send_event_email: true,
        event_email_unsub_at: null,
      }),
    );
  });

  it('is read-only without clientes:editar: disabled switches and the explanation', async () => {
    setAuth(
      makeCan(
        fakeMembership({
          role: 'agent',
          role_id: 'role-1',
          permissions: { configuracoes: 'ver' },
        }),
      ),
    );
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Seus clientes/ }));
    await screen.findByRole('switch', { name: 'Relatório mensal' });
    expect(screen.getByText('Somente leitura')).toBeInTheDocument();
    expect(sw('Relatório mensal')).toBeDisabled();
    expect(sw('Pendências do Hub')).toBeDisabled();
    expect(sw('Ana Clínica')).toBeDisabled();
  });

  it('hides Seus clientes without configuracoes:ver', async () => {
    setAuth(makeCan(fakeMembership({ role: 'agent' })));
    renderTab();
    await screen.findByRole('button', { name: /E-mails automáticos/ });
    expect(screen.queryByText('Seus clientes')).not.toBeInTheDocument();
    expect(getClientesMock).not.toHaveBeenCalled();
  });

  it('shows a grouped skeleton while the prefs load', () => {
    getInapp.mockReturnValue(new Promise(() => {}));
    renderTab();
    expect(screen.getByRole('heading', { level: 1, name: 'Notificações' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });
});
