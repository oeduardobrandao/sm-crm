import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import i18n from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../saveWorkspaceSetup', () => ({ saveWorkspaceSetup: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));
vi.mock('@/services/billing', () => ({ getEffectivePlanWithSource: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import ptSetup from '../../../../../../packages/i18n/locales/pt/setup.json';
import enSetup from '../../../../../../packages/i18n/locales/en/setup.json';
import { useAuth } from '@/context/AuthContext';
import { captureEvent } from '@/lib/analytics';
import { supabase } from '@/lib/supabase';
import { getEffectivePlanWithSource } from '@/services/billing';
import { saveWorkspaceSetup } from '../saveWorkspaceSetup';
import WorkspaceSetupPage from '../WorkspaceSetupPage';

const mockedUseAuth = vi.mocked(useAuth);
const mockedSave = vi.mocked(saveWorkspaceSetup);
const mockedCapture = vi.mocked(captureEvent);
const mockedPlan = vi.mocked(getEffectivePlanWithSource);
const mockedRpc = vi.mocked(supabase.rpc);
const patchProfile = vi.fn();
const refetchProfile = vi.fn();

// `setup` is a lazy namespace the shared test setup does not bundle.
beforeAll(() => {
  i18n.addResourceBundle('pt', 'setup', ptSetup, true, true);
  i18n.addResourceBundle('en', 'setup', enSetup, true, true);
});

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname + location.search}</div>;
}

let queryClient: QueryClient;

function renderPage(entry = '/workspace-setup?next=%2Fcomecar%3Fplan%3Dpro') {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/workspace-setup" element={<WorkspaceSetupPage />} />
          <Route path="/comecar" element={<LocationProbe />} />
          <Route path="/dashboard" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Renders and waits for the form, which shows once the workspace currency is known. */
async function renderReady(entry?: string) {
  const result = renderPage(entry);
  await screen.findByRole('button', { name: /Continuar|Continue/ });
  return result;
}

function planWith(billingCurrency: 'brl' | 'usd') {
  return { planId: null, billingCurrency } as never;
}

function authAs(userMetadata: Record<string, unknown> = {}) {
  mockedUseAuth.mockReturnValue({
    user: { id: 'u-1', user_metadata: userMetadata },
    profile: {
      id: 'u-1',
      nome: 'Ana',
      role: 'owner',
      empresa: '',
      active_workspace_id: 'ws-1',
      conta_id: 'ws-1',
    },
    patchProfile,
    refetchProfile,
  } as never);
}

const companyInput = () => screen.getByLabelText('Nome da empresa ou agência');
const phoneInput = () => screen.getByLabelText('Telefone / WhatsApp');
const submitButton = () => screen.getByRole('button', { name: /Continuar/ });

function fillValid() {
  fireEvent.change(companyInput(), { target: { value: '  Agência Ótima  ' } });
  fireEvent.change(phoneInput(), { target: { value: ' (11) 99999-9999 ' } });
}

describe('WorkspaceSetupPage', () => {
  beforeEach(() => {
    mockedSave.mockReset();
    mockedCapture.mockReset();
    mockedPlan.mockReset();
    mockedPlan.mockResolvedValue(planWith('brl'));
    mockedRpc.mockReset();
    patchProfile.mockReset();
    refetchProfile.mockReset();
    authAs();
  });

  it('renders step 2 with the name prefilled and the rest empty', async () => {
    await renderReady();

    expect(screen.getByText('Passo 2 de 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Falta pouco' })).toBeInTheDocument();
    expect(screen.getByLabelText('Seu nome')).toHaveValue('Ana');
    expect(companyInput()).toHaveValue('');
    expect(phoneInput()).toHaveValue('');
    expect(phoneInput()).toHaveAttribute('type', 'tel');
    expect(phoneInput()).toHaveAttribute('autocomplete', 'tel');
    expect(
      screen.getByText('Usaremos para enviar informações da sua conta por SMS e WhatsApp.'),
    ).toBeInTheDocument();
    const optIn = screen.getByLabelText(
      'Aceito receber novidades e comunicações de marketing por SMS e WhatsApp. Você pode cancelar quando quiser.',
    );
    expect(optIn).not.toBeChecked();
    expect(
      screen.getByText('Você pode alterar essas informações depois em Configurações.'),
    ).toBeInTheDocument();
  });

  it('shows inline errors and does not save an invalid form', async () => {
    await renderReady();
    fireEvent.change(phoneInput(), { target: { value: '1234' } });
    fireEvent.click(submitButton());

    expect(screen.getByText('Informe o nome da empresa ou agência.')).toBeInTheDocument();
    expect(
      screen.getByText('Informe um telefone com DDD, como (11) 99999-9999.'),
    ).toBeInTheDocument();
    expect(mockedSave).not.toHaveBeenCalled();
    expect(companyInput()).toHaveAttribute('aria-invalid', 'true');
    expect(
      document.getElementById(companyInput().getAttribute('aria-describedby')!),
    ).toHaveTextContent('Informe o nome da empresa ou agência.');
    expect(companyInput()).toHaveFocus();
  });

  it('requires a name and re-validates as the user types', async () => {
    await renderReady();
    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: '   ' } });
    fillValid();
    fireEvent.click(submitButton());

    expect(screen.getByText('Informe seu nome.')).toBeInTheDocument();
    expect(screen.getByLabelText('Seu nome')).toHaveFocus();

    fireEvent.change(screen.getByLabelText('Seu nome'), { target: { value: 'Ana' } });
    expect(screen.queryByText('Informe seu nome.')).not.toBeInTheDocument();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it('saves trimmed values, patches the profile and continues to next', async () => {
    mockedSave.mockResolvedValue(undefined);
    await renderReady();
    fillValid();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/comecar?plan=pro'));
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith({
      userId: 'u-1',
      workspaceId: 'ws-1',
      nome: 'Ana',
      empresa: 'Agência Ótima',
      telefone: '(11) 99999-9999',
      marketingOptIn: true,
    });
    expect(patchProfile).toHaveBeenCalledWith({
      nome: 'Ana',
      empresa: 'Agência Ótima',
      telefone: '(11) 99999-9999',
      marketing_opt_in: true,
    });
    expect(mockedSave.mock.invocationCallOrder[0]).toBeLessThan(
      patchProfile.mock.invocationCallOrder[0],
    );
    expect(refetchProfile).not.toHaveBeenCalled();
    expect(mockedCapture).toHaveBeenCalledWith('workspace_setup_completed');
  });

  it('continues to /comecar when there is no next', async () => {
    mockedSave.mockResolvedValue(undefined);
    await renderReady('/workspace-setup');
    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/^\/comecar$/));
  });

  it('ignores a next that leaves the origin', async () => {
    mockedSave.mockResolvedValue(undefined);
    await renderReady('/workspace-setup?next=%2F%2Fevil.com');
    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/^\/comecar$/));
  });

  it('keeps the typed values and shows an alert when the save fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedSave.mockRejectedValue(new Error('permission denied for table workspaces'));
    await renderReady();
    fillValid();
    fireEvent.click(submitButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível salvar. Tente de novo.',
    );
    expect(screen.queryByText(/permission denied/)).not.toBeInTheDocument();
    expect(companyInput()).toHaveValue('  Agência Ótima  ');
    expect(phoneInput()).toHaveValue(' (11) 99999-9999 ');
    expect(screen.queryByTestId('probe')).not.toBeInTheDocument();
    expect(patchProfile).not.toHaveBeenCalled();
    expect(mockedCapture).not.toHaveBeenCalled();
    expect(submitButton()).toBeEnabled();
    errorSpy.mockRestore();
  });

  it('saves once on a double click', async () => {
    let resolveSave: () => void = () => {};
    mockedSave.mockImplementation(() => new Promise<void>((resolve) => (resolveSave = resolve)));
    await renderReady();
    fillValid();

    fireEvent.click(submitButton());
    fireEvent.click(submitButton());

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeDisabled();
    resolveSave();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/comecar?plan=pro'));
    expect(mockedSave).toHaveBeenCalledTimes(1);
  });

  describe('USD workspace', () => {
    afterEach(async () => {
      await act(() => i18n.changeLanguage('pt'));
    });

    it('uses US phone rules in English: no WhatsApp opt-in, digits saved', async () => {
      await act(() => i18n.changeLanguage('en'));
      mockedPlan.mockResolvedValue(planWith('usd'));
      mockedSave.mockResolvedValue(undefined);
      await renderReady();

      expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
      expect(screen.getByLabelText('Your name')).toHaveValue('Ana');
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByText(/WhatsApp/)).not.toBeInTheDocument();

      fireEvent.change(screen.getByLabelText('Company or agency name'), {
        target: { value: 'Acme Social' },
      });
      fireEvent.change(screen.getByLabelText('Phone'), {
        target: { value: '+1 (415) 555-0132' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

      await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
      expect(mockedSave).toHaveBeenCalledWith(
        expect.objectContaining({ telefone: '14155550132', marketingOptIn: false }),
      );
      expect(patchProfile).toHaveBeenCalledWith(
        expect.objectContaining({ telefone: '14155550132', marketing_opt_in: false }),
      );
      expect(mockedRpc).not.toHaveBeenCalled();
    });

    it.each([
      ['415.555.0132', '14155550132'],
      ['+44 20 7946 0958', '442079460958'],
    ])('accepts %s and saves %s', async (phone, stored) => {
      mockedPlan.mockResolvedValue(planWith('usd'));
      mockedSave.mockResolvedValue(undefined);
      await renderReady();
      fireEvent.change(screen.getByLabelText('Nome da empresa ou agência'), {
        target: { value: 'Acme' },
      });
      fireEvent.change(screen.getByLabelText('Telefone'), { target: { value: phone } });
      fireEvent.click(screen.getByRole('button', { name: /Continuar/ }));
      await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1));
      expect(mockedSave.mock.calls[0][0].telefone).toBe(stored);
    });

    it.each(['123', '+1 555'])(
      'rejects %s with the English error, never the Brazilian one',
      async (phone) => {
        await act(() => i18n.changeLanguage('en'));
        mockedPlan.mockResolvedValue(planWith('usd'));
        await renderReady();
        fireEvent.change(screen.getByLabelText('Phone'), { target: { value: phone } });
        fireEvent.click(screen.getByRole('button', { name: /Continue/ }));

        expect(
          screen.getByText('Enter a phone number with area code, like (415) 555-0132.'),
        ).toBeInTheDocument();
        expect(screen.queryByText(/\(11\) 99999-9999/)).not.toBeInTheDocument();
        expect(mockedSave).not.toHaveBeenCalled();
      },
    );
  });

  describe('US signup whose workspace reads BRL', () => {
    beforeEach(() => {
      authAs({ market: 'us' });
    });

    it('repairs the currency, then uses US rules and refreshes the cached plan', async () => {
      // The server now reads USD, as a refetch after the repair would see.
      mockedRpc.mockImplementation((async () => {
        mockedPlan.mockResolvedValue(planWith('usd'));
        return { data: 'usd', error: null };
      }) as never);
      await renderReady();

      expect(mockedRpc).toHaveBeenCalledTimes(1);
      expect(mockedRpc).toHaveBeenCalledWith('billing_market_apply');
      expect(screen.getByLabelText('Telefone')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      // /comecar reads the same cache entry: it must not keep showing BRL.
      await waitFor(() => expect(mockedPlan).toHaveBeenCalledTimes(2));
      expect(
        (
          queryClient.getQueryData(['billing', 'effective-plan-with-source']) as {
            billingCurrency: string;
          }
        ).billingCurrency,
      ).toBe('usd');
    });

    it('flips the cached workspace language to en so the pt row does not beat the hint', async () => {
      mockedRpc.mockImplementation((async () => {
        mockedPlan.mockResolvedValue(planWith('usd'));
        return { data: 'usd', error: null };
      }) as never);
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      client.setQueryData(['currentWorkspace'], { id: 'ws-1', name: 'W', language: 'pt' });
      const invalidate = vi.spyOn(client, 'invalidateQueries');
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/workspace-setup']}>
            <Routes>
              <Route path="/workspace-setup" element={<WorkspaceSetupPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await screen.findByRole('button', { name: /Continuar|Continue/ });
      expect((client.getQueryData(['currentWorkspace']) as { language: string }).language).toBe(
        'en',
      );
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['currentWorkspace'] });
    });

    it('does not invent a workspace row when none is cached', async () => {
      mockedRpc.mockImplementation((async () => {
        mockedPlan.mockResolvedValue(planWith('usd'));
        return { data: 'usd', error: null };
      }) as never);
      await renderReady();
      expect(queryClient.getQueryData(['currentWorkspace'])).toBeUndefined();
    });

    it.each([
      ['still BRL', () => mockedRpc.mockResolvedValue({ data: 'brl', error: null } as never)],
      [
        'an error',
        () => mockedRpc.mockResolvedValue({ data: null, error: { message: 'x' } } as never),
      ],
      ['a rejection', () => mockedRpc.mockRejectedValue(new Error('network'))],
    ])('blocks with Try again on %s, and Try again re-runs the repair', async (_label, arrange) => {
      await act(() => i18n.changeLanguage('en'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      arrange();
      renderPage();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        "We couldn't set up your account in US dollars. Try again in a moment.",
      );
      expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
      expect(mockedCapture).toHaveBeenCalledTimes(1);
      expect(mockedCapture).toHaveBeenCalledWith('us_signup_currency_mismatch', expect.anything());
      // Analytics is consent-gated and a us_default record reads undecided on /login, so the
      // failure must also reach the console.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('us_signup_currency_mismatch'),
        expect.anything(),
      );
      errorSpy.mockRestore();

      mockedRpc.mockReset();
      mockedRpc.mockResolvedValue({ data: 'usd', error: null } as never);
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: /Continue/ })).toBeInTheDocument();
      expect(mockedRpc).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Phone')).toBeInTheDocument();
      await act(() => i18n.changeLanguage('pt'));
    });

    it('falls back to US rules without the repair when the currency read fails', async () => {
      mockedPlan.mockRejectedValue(new Error('offline'));
      await renderReady();
      expect(screen.getByLabelText('Telefone')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(mockedRpc).not.toHaveBeenCalled();
    });
  });

  it('never calls the repair for a non-US signup', async () => {
    await renderReady();
    expect(mockedRpc).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Telefone / WhatsApp')).toBeInTheDocument();
  });

  it('uses Brazilian rules when the currency read fails for a non-US signup', async () => {
    mockedPlan.mockRejectedValue(new Error('offline'));
    await renderReady();
    expect(screen.getByLabelText('Telefone / WhatsApp')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });
});
