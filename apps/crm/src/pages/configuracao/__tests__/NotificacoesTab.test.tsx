import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NOTIFICATION_CATALOG, CATEGORY_ORDER, CATEGORY_LABELS } from '@/lib/notification-catalog';

// Real catalog + category constants (Task 3) are pure static data: kept real
// here so the "5 groups / 22 rows" assertions exercise the actual catalog,
// not a stand-in. Only the prefs store (network calls) is mocked.
const getInapp = vi.fn();
const setInapp = vi.fn().mockResolvedValue(undefined);
const getEmail = vi.fn();
const setEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/notificationPrefs', () => ({
  getNotificationInappPrefs: (...a: unknown[]) => getInapp(...a),
  setNotificationInappPref: (...a: unknown[]) => setInapp(...a),
  getNotificationEmailPrefs: (...a: unknown[]) => getEmail(...a),
  setNotificationEmailPref: (...a: unknown[]) => setEmail(...a),
  MASTER_PAUSE_TYPE: '__all__',
}));

// Only the exported query-key constant is needed here; mocking the hook
// module directly avoids dragging in its own store imports for this test.
vi.mock('@/hooks/useNotifications', () => ({
  INAPP_PREFS_KEY: ['notification-inapp-prefs'],
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// EmailsAutomaticosSection (Task 8): reads/writes profiles.marketing_opt_in
// via useAuth() + a direct supabase update, same shape as PerfilTab.tsx.
const { mockUseAuth, mockSupabaseUpdate, mockSupabaseEq } = vi.hoisted(() => ({
  mockUseAuth: vi.fn(),
  mockSupabaseUpdate: vi.fn(),
  mockSupabaseEq: vi.fn(),
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: mockUseAuth }));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(() => ({ update: mockSupabaseUpdate })) },
}));

// SeusClientesSection (Task 9): reads/writes the per-client + workspace-wide
// monthly report toggle via @/store, gated to owner/admin by NotificacoesTab.
const getClientesMock = vi.fn();
const updateClienteMock = vi.fn().mockResolvedValue(undefined);
const getWorkspaceBrandingMock = vi.fn();
const updateWorkspaceBrandingMock = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store', () => ({
  getClientes: (...a: unknown[]) => getClientesMock(...a),
  updateCliente: (...a: unknown[]) => updateClienteMock(...a),
  getWorkspaceBranding: (...a: unknown[]) => getWorkspaceBrandingMock(...a),
  updateWorkspaceBranding: (...a: unknown[]) => updateWorkspaceBrandingMock(...a),
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
    id: 2,
    nome: 'Beto Estética',
    email: 'beto@example.com',
    status: 'ativo',
    send_report_email: false,
    send_event_email: false,
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
  // Task 8: status != 'ativo' shows a muted "(pausado)"/"(encerrado)" tag next
  // to the name — the real gate lives server-side, this is just explanatory.
  {
    id: 4,
    nome: 'Davi Pausado',
    email: 'davi@example.com',
    status: 'pausado',
    send_report_email: true,
    send_event_email: true,
    event_email_unsub_at: null,
  },
  {
    id: 5,
    nome: 'Fernanda Encerrada',
    email: 'fernanda@example.com',
    status: 'encerrado',
    send_report_email: false,
    send_event_email: true,
    event_email_unsub_at: null,
  },
  // Task 8: a client who clicked the unsubscribe link in a digest email —
  // reactivating requires the AlertDialog confirm, not a plain toggle.
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

// Radix Switch: mocked to a plain native checkbox (checked/onCheckedChange/
// disabled/aria-label), same convention as MembrosTab.test.tsx and the
// previous NotificacoesTab.test.tsx, so toggling can be driven with a plain
// fireEvent.click and asserted via `.checked`.
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import NotificacoesTab from '../tabs/NotificacoesTab';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificacoesTab />
    </QueryClientProvider>,
  );
}

describe('NotificacoesTab', () => {
  let refetchProfile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // The suite-wide afterEach (test/vitest.setup.ts) calls vi.restoreAllMocks(),
    // which wipes vi.fn() implementations down to a no-op returning undefined
    // after every test. Re-establishing the base implementation here keeps
    // every test's queryFn resolving a real value regardless of test order.
    getInapp.mockReset().mockResolvedValue({});
    setInapp.mockReset().mockResolvedValue(undefined);
    getEmail.mockReset().mockResolvedValue({});
    setEmail.mockReset().mockResolvedValue(undefined);

    refetchProfile = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReset().mockReturnValue({
      user: { id: 'user-1' },
      profile: { id: 'user-1', marketing_opt_in: true },
      refetchProfile,
      workspaceRole: 'owner',
    });
    mockSupabaseEq.mockReset().mockResolvedValue({ error: null });
    mockSupabaseUpdate.mockReset().mockReturnValue({ eq: mockSupabaseEq });

    getClientesMock.mockReset().mockResolvedValue(CLIENTES_FIXTURE);
    updateClienteMock.mockReset().mockResolvedValue(undefined);
    getWorkspaceBrandingMock.mockReset().mockResolvedValue(BRANDING_FIXTURE);
    updateWorkspaceBrandingMock.mockReset().mockResolvedValue(undefined);
  });

  it('renders the 5 CATEGORY_LABELS groups and all 22 catalog type rows', async () => {
    renderTab();
    for (const category of CATEGORY_ORDER) {
      expect(await screen.findByText(CATEGORY_LABELS[category])).toBeInTheDocument();
    }
    expect(CATEGORY_ORDER.length).toBe(5);
    expect(Object.keys(NOTIFICATION_CATALOG).length).toBe(22);
    for (const entry of Object.values(NOTIFICATION_CATALOG)) {
      // getAllByText, not getByText: NOTIFICATION_CATALOG.instagram_connected_by_client
      // shares its label ("Instagram conectado") with a fixed row in
      // EmailsAutomaticosSection below on this same page (Task 8) — the same
      // event, but that row is the always-on transactional email, which is
      // exactly why this catalog entry is emailEligible: false.
      expect(screen.getAllByText(entry.label).length).toBeGreaterThan(0);
    }
  });

  it('does not render an email switch for a non-eligible type (idea_submitted), showing "·" instead', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.idea_submitted.label;
    await screen.findByText(label);
    expect(screen.queryByLabelText(`${label} (e-mail)`)).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Este tipo não vira e-mail').length).toBeGreaterThan(0);
  });

  it('toggling the in-app switch for "mention" calls setNotificationInappPref(mention, false)', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.mention.label;
    const switchEl = await screen.findByLabelText(`${label} (no app)`);
    expect((switchEl as HTMLInputElement).checked).toBe(true); // no row = default on
    fireEvent.click(switchEl);
    await waitFor(() => expect(setInapp).toHaveBeenCalledWith('mention', false));
  });

  it('flips the switch immediately on click (optimistic) and rolls back if the save fails', async () => {
    // A never-(yet-)resolving promise stands in for a slow round trip: the
    // switch must flip the instant the click fires, well before this
    // resolves, then revert once it's rejected.
    let rejectSave: (err: Error) => void = () => {};
    setInapp.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );

    renderTab();
    const label = NOTIFICATION_CATALOG.mention.label;
    const switchEl = (await screen.findByLabelText(`${label} (no app)`)) as HTMLInputElement;
    expect(switchEl.checked).toBe(true); // no row = default on

    fireEvent.click(switchEl);
    // Optimistic: flips synchronously (well ahead of the pending save).
    await waitFor(() => expect(switchEl.checked).toBe(false));
    expect(setInapp).toHaveBeenCalledWith('mention', false);

    rejectSave(new Error('save failed'));
    // Rollback: reverts to the pre-click state once the save errors out.
    await waitFor(() => expect(switchEl.checked).toBe(true));
  });

  it('toggling the email switch for "post_approved" calls setNotificationEmailPref(post_approved, false)', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.post_approved.label;
    const switchEl = await screen.findByLabelText(`${label} (e-mail)`);
    expect((switchEl as HTMLInputElement).checked).toBe(true); // no row = default on
    fireEvent.click(switchEl);
    await waitFor(() => expect(setEmail).toHaveBeenCalledWith('post_approved', false));
  });

  it('the "Pausar tudo" master row calls the setter of the channel that was toggled', async () => {
    renderTab();
    const masterInapp = await screen.findByLabelText('Pausar tudo (no app)');
    expect((masterInapp as HTMLInputElement).checked).toBe(false);
    fireEvent.click(masterInapp);
    await waitFor(() => expect(setInapp).toHaveBeenCalledWith('__all__', false));
    expect(setEmail).not.toHaveBeenCalled();

    const masterEmail = screen.getByLabelText('Pausar tudo (e-mail)');
    expect((masterEmail as HTMLInputElement).checked).toBe(false);
    fireEvent.click(masterEmail);
    await waitFor(() => expect(setEmail).toHaveBeenCalledWith('__all__', false));
  });

  it('renders default state (no row for the type) as switched on, for both channels', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.post_publish_failed.label;
    const inapp = await screen.findByLabelText(`${label} (no app)`);
    const email = screen.getByLabelText(`${label} (e-mail)`);
    expect((inapp as HTMLInputElement).checked).toBe(true);
    expect((email as HTMLInputElement).checked).toBe(true);
  });

  describe('EmailsAutomaticosSection', () => {
    it('lists the 4 fixed items, with the 3 transactional rows marked "sempre" and no switch', async () => {
      renderTab();
      const heading = await screen.findByRole('heading', { name: 'E-mails automáticos' });
      // Scoped to this section's card: "Instagram conectado" is also a
      // catalog row label in SuasNotificacoesSection above (same underlying
      // event, different — always-on — email path), so an unscoped query
      // would be ambiguous.
      const section = within(heading.closest('.card') as HTMLElement);

      expect(section.getByText('Convite para a equipe')).toBeInTheDocument();
      expect(section.getByText('Cobrança e pagamento')).toBeInTheDocument();
      expect(section.getByText('Instagram conectado')).toBeInTheDocument();
      expect(section.getByText('Novidades e dicas do Mesaas')).toBeInTheDocument();

      expect(
        section.queryByRole('switch', { name: 'Convite para a equipe' }),
      ).not.toBeInTheDocument();
      expect(
        section.queryByRole('switch', { name: 'Cobrança e pagamento' }),
      ).not.toBeInTheDocument();
      expect(
        section.queryByRole('switch', { name: 'Instagram conectado' }),
      ).not.toBeInTheDocument();
      expect(section.getAllByText('sempre')).toHaveLength(3);

      expect(
        section.getByRole('switch', { name: 'Novidades e dicas do Mesaas' }),
      ).toBeInTheDocument();
      expect(section.getByText('Mesmo controle que está no seu Perfil.')).toBeInTheDocument();
    });

    it('toggling the marketing switch updates profiles.marketing_opt_in and refetches the profile', async () => {
      renderTab();
      const marketingSwitch = (await screen.findByRole('switch', {
        name: 'Novidades e dicas do Mesaas',
      })) as HTMLInputElement;
      expect(marketingSwitch.checked).toBe(true); // profile.marketing_opt_in: true

      fireEvent.click(marketingSwitch);

      await waitFor(() =>
        expect(mockSupabaseUpdate).toHaveBeenCalledWith({ marketing_opt_in: false }),
      );
      expect(mockSupabaseEq).toHaveBeenCalledWith('id', 'user-1');
      await waitFor(() => expect(refetchProfile).toHaveBeenCalled());
    });

    it('flips the marketing switch optimistically and rolls back if the save fails', async () => {
      let rejectSave: (err: Error) => void = () => {};
      mockSupabaseEq.mockReturnValue(
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
      );

      renderTab();
      const marketingSwitch = (await screen.findByRole('switch', {
        name: 'Novidades e dicas do Mesaas',
      })) as HTMLInputElement;
      expect(marketingSwitch.checked).toBe(true);

      fireEvent.click(marketingSwitch);
      await waitFor(() => expect(marketingSwitch.checked).toBe(false));

      rejectSave(new Error('save failed'));
      await waitFor(() => expect(marketingSwitch.checked).toBe(true));
    });
  });

  describe('SeusClientesSection', () => {
    it('does not render for workspaceRole agent', async () => {
      mockUseAuth.mockReturnValue({
        user: { id: 'user-1' },
        profile: { id: 'user-1', marketing_opt_in: true },
        refetchProfile,
        workspaceRole: 'agent',
      });
      renderTab();
      // Wait for the tab to finish settling before asserting an absence.
      await screen.findByRole('heading', { name: 'E-mails automáticos' });
      expect(screen.queryByText('Seus clientes')).not.toBeInTheDocument();
      expect(getClientesMock).not.toHaveBeenCalled();
    });

    it('renders the master row plus one row per client for workspaceRole owner', async () => {
      renderTab();
      expect(await screen.findByText('Todos os clientes')).toBeInTheDocument();
      expect(screen.getByText('Ana Clínica')).toBeInTheDocument();
      expect(screen.getByText('Beto Estética')).toBeInTheDocument();
      expect(screen.getByText('Clínica Sem Email')).toBeInTheDocument();
    });

    it('omits the switch for a client with no email, showing "sem e-mail cadastrado" instead', async () => {
      renderTab();
      await screen.findByText('Clínica Sem Email');
      expect(
        screen.queryByLabelText(/Relatório mensal para Clínica Sem Email/),
      ).not.toBeInTheDocument();
      expect(screen.getByText('sem e-mail cadastrado')).toBeInTheDocument();
    });

    it('toggling a client row calls updateCliente(id, { send_report_email: false })', async () => {
      renderTab();
      // O e-mail no nome acessível desambigua clientes homônimos.
      const switchEl = (await screen.findByLabelText(
        'Relatório mensal para Ana Clínica (ana@example.com)',
      )) as HTMLInputElement;
      expect(switchEl.checked).toBe(true);
      fireEvent.click(switchEl);
      await waitFor(() =>
        expect(updateClienteMock).toHaveBeenCalledWith(1, { send_report_email: false }),
      );
    });

    it('toggling the master row calls updateWorkspaceBranding({ send_report_email: false })', async () => {
      renderTab();
      const masterSwitch = (await screen.findByLabelText(
        'Relatório mensal para todos os clientes',
      )) as HTMLInputElement;
      expect(masterSwitch.checked).toBe(true);
      fireEvent.click(masterSwitch);
      await waitFor(() =>
        expect(updateWorkspaceBrandingMock).toHaveBeenCalledWith({ send_report_email: false }),
      );
    });

    describe('Pendências do Hub (Fase 2)', () => {
      it('shows the header label and subtext', async () => {
        renderTab();
        expect(await screen.findByText('Pendências do Hub')).toBeInTheDocument();
        expect(
          screen.getByText('posts a aprovar e mensagens não lidas · máx. 1 e-mail a cada 4h'),
        ).toBeInTheDocument();
      });

      it('toggling the master row calls updateWorkspaceBranding({ send_client_event_emails: true })', async () => {
        renderTab();
        const masterSwitch = (await screen.findByLabelText(
          'Pendências do Hub para todos os clientes',
        )) as HTMLInputElement;
        expect(masterSwitch.checked).toBe(false); // BRANDING_FIXTURE.send_client_event_emails: false
        fireEvent.click(masterSwitch);
        await waitFor(() =>
          expect(updateWorkspaceBrandingMock).toHaveBeenCalledWith({
            send_client_event_emails: true,
          }),
        );
      });

      it('toggling a client row calls updateCliente(id, { send_event_email: false })', async () => {
        renderTab();
        const switchEl = (await screen.findByLabelText(
          'Pendências do Hub para Ana Clínica (ana@example.com)',
        )) as HTMLInputElement;
        expect(switchEl.checked).toBe(true);
        fireEvent.click(switchEl);
        await waitFor(() =>
          expect(updateClienteMock).toHaveBeenCalledWith(1, { send_event_email: false }),
        );
      });

      it('shows "·" for a client with no email, in both columns', async () => {
        renderTab();
        await screen.findByText('Clínica Sem Email');
        expect(
          screen.queryByLabelText(/Relatório mensal para Clínica Sem Email/),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByLabelText(/Pendências do Hub para Clínica Sem Email/),
        ).not.toBeInTheDocument();
        // Two "·" placeholders on that row: one per column.
        const dots = screen.getAllByText('·').filter((el) => el.title === 'Sem e-mail cadastrado');
        expect(dots).toHaveLength(2);
      });

      it('shows a muted "(pausado)"/"(encerrado)" tag next to the name for a non-active client', async () => {
        renderTab();
        await screen.findByText('Davi Pausado');
        expect(screen.getByText('(pausado)')).toBeInTheDocument();
        await screen.findByText('Fernanda Encerrada');
        expect(screen.getByText('(encerrado)')).toBeInTheDocument();
        // The active clients in the fixture never get a status tag.
        expect(screen.queryByText('(ativo)')).not.toBeInTheDocument();
      });

      it('dims the switch and explains an unsubscribed client, gating reactivation behind an AlertDialog confirm', async () => {
        renderTab();
        const switchEl = (await screen.findByLabelText(
          'Pendências do Hub para Eva Desativada (eva@example.com)',
        )) as HTMLInputElement;
        expect(switchEl.checked).toBe(false); // send_event_email: false
        expect(screen.getByText('desativado pelo cliente')).toBeInTheDocument();

        // Clicking opens a confirm dialog instead of toggling directly.
        fireEvent.click(switchEl);
        expect(updateClienteMock).not.toHaveBeenCalled();
        expect(
          await screen.findByText(
            'O cliente pediu para não receber estes e-mails. Reativar mesmo assim?',
          ),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Reativar' }));
        await waitFor(() =>
          expect(updateClienteMock).toHaveBeenCalledWith(6, {
            send_event_email: true,
            event_email_unsub_at: null,
          }),
        );
      });

      it('cancelling the reactivation dialog makes no call', async () => {
        renderTab();
        const switchEl = await screen.findByLabelText(
          'Pendências do Hub para Eva Desativada (eva@example.com)',
        );
        fireEvent.click(switchEl);
        fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
        await waitFor(() =>
          expect(
            screen.queryByText(
              'O cliente pediu para não receber estes e-mails. Reativar mesmo assim?',
            ),
          ).not.toBeInTheDocument(),
        );
        expect(updateClienteMock).not.toHaveBeenCalled();
      });
    });

    it('filters the client list by name, case-insensitively', async () => {
      renderTab();
      await screen.findByText('Ana Clínica');
      const search = screen.getByPlaceholderText('Buscar cliente…');
      fireEvent.change(search, { target: { value: 'BETO' } });
      expect(screen.queryByText('Ana Clínica')).not.toBeInTheDocument();
      expect(screen.getByText('Beto Estética')).toBeInTheDocument();
    });

    it('shows "Nenhum cliente encontrado." when the search matches no client', async () => {
      renderTab();
      await screen.findByText('Ana Clínica');
      const search = screen.getByPlaceholderText('Buscar cliente…');
      fireEvent.change(search, { target: { value: 'zzz-nao-existe' } });
      expect(await screen.findByText('Nenhum cliente encontrado.')).toBeInTheDocument();
      expect(screen.queryByText('Ana Clínica')).not.toBeInTheDocument();
    });
  });
});
