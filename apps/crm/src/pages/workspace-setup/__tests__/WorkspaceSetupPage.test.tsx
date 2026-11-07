import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../saveWorkspaceSetup', () => ({ saveWorkspaceSetup: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ captureEvent: vi.fn() }));

import { useAuth } from '@/context/AuthContext';
import { captureEvent } from '@/lib/analytics';
import { saveWorkspaceSetup } from '../saveWorkspaceSetup';
import WorkspaceSetupPage from '../WorkspaceSetupPage';

const mockedUseAuth = vi.mocked(useAuth);
const mockedSave = vi.mocked(saveWorkspaceSetup);
const mockedCapture = vi.mocked(captureEvent);
const patchProfile = vi.fn();
const refetchProfile = vi.fn();

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname + location.search}</div>;
}

function renderPage(entry = '/workspace-setup?next=%2Fcomecar%3Fplan%3Dpro') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/workspace-setup" element={<WorkspaceSetupPage />} />
        <Route path="/comecar" element={<LocationProbe />} />
        <Route path="/dashboard" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
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
    patchProfile.mockReset();
    refetchProfile.mockReset();
    mockedUseAuth.mockReturnValue({
      user: { id: 'u-1' },
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
  });

  it('renders step 2 with the name prefilled and the rest empty', () => {
    renderPage();

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

  it('shows inline errors and does not save an invalid form', () => {
    renderPage();
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

  it('requires a name and re-validates as the user types', () => {
    renderPage();
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
    renderPage();
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
    renderPage('/workspace-setup');
    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/^\/comecar$/));
  });

  it('ignores a next that leaves the origin', async () => {
    mockedSave.mockResolvedValue(undefined);
    renderPage('/workspace-setup?next=%2F%2Fevil.com');
    fillValid();
    fireEvent.click(submitButton());

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent(/^\/comecar$/));
  });

  it('keeps the typed values and shows an alert when the save fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedSave.mockRejectedValue(new Error('permission denied for table workspaces'));
    renderPage();
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
    renderPage();
    fillValid();

    fireEvent.click(submitButton());
    fireEvent.click(submitButton());

    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(submitButton()).toBeDisabled();
    resolveSave();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('/comecar?plan=pro'));
    expect(mockedSave).toHaveBeenCalledTimes(1);
  });
});
