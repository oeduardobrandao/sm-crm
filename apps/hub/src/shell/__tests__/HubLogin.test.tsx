import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api');
  return { ...actual, requestLoginCode: vi.fn(), verifyLoginCode: vi.fn() };
});
vi.mock('../../lib/hubSession', () => ({
  setHubSession: vi.fn(),
  getHubSession: vi.fn(),
  clearHubSession: vi.fn(),
}));

import { HubApiError, requestLoginCode, verifyLoginCode } from '../../api';
import { setHubSession } from '../../lib/hubSession';
import type { HubLoginPayload } from '../../types';
import { HubLogin } from '../HubLogin';

const mockedRequest = vi.mocked(requestLoginCode);
const mockedVerify = vi.mocked(verifyLoginCode);
const mockedSetSession = vi.mocked(setHubSession);

const LOGIN: HubLoginPayload = {
  workspace: { name: 'Studio Aurora', logo_url: null, brand_color: '#171717' },
  hub_theme: undefined,
};

function setup(onLoggedIn = vi.fn()) {
  render(<HubLogin workspace="aurora" token="tok" login={LOGIN} onLoggedIn={onLoggedIn} />);
  return { onLoggedIn };
}

async function goToCodeStep(email = 'marina@clinicavida.com.br') {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
  await screen.findByLabelText('Código de 6 dígitos');
}

describe('HubLogin', () => {
  beforeEach(() => {
    mockedRequest.mockReset().mockResolvedValue({ ok: true });
    mockedVerify.mockReset();
    mockedSetSession.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the agency on the email step and gates the button on a valid email', () => {
    setup();
    expect(screen.getByText('Entre no seu portal')).toBeInTheDocument();
    expect(screen.getByText('Não tem acesso? Fale com a Studio Aurora.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Enviar código' });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'marina@' } });
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'marina@x.com' } });
    expect(button).toBeEnabled();
  });

  it('requests a code and moves to the code step showing the email', async () => {
    setup();
    await goToCodeStep();
    expect(mockedRequest).toHaveBeenCalledWith('aurora', 'tok', 'marina@clinicavida.com.br');
    expect(screen.getByText(/marina@clinicavida\.com\.br/)).toBeInTheDocument();
    expect(screen.getByText('O código vale por 10 minutos.')).toBeInTheDocument();
  });

  it('configures the code input for one-time codes and strips non-digits', async () => {
    setup();
    await goToCodeStep();
    const input = screen.getByLabelText('Código de 6 dígitos') as HTMLInputElement;
    expect(input).toHaveAttribute('inputmode', 'numeric');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    expect(input).toHaveAttribute('maxlength', '6');
    expect(input.className).toMatch(/text-\[(1[6-9]|[2-9]\d)px\]/);
    fireEvent.change(input, { target: { value: '48a2-9' } });
    expect(input.value).toBe('4829');
  });

  it('verifies a 6-digit code, stores the session, then calls onLoggedIn', async () => {
    mockedVerify.mockResolvedValue({ session_token: 'sess-1' });
    const { onLoggedIn } = setup();
    await goToCodeStep();
    const enter = screen.getByRole('button', { name: 'Entrar' });
    expect(enter).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '482931' } });
    fireEvent.click(enter);
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(mockedVerify).toHaveBeenCalledWith(
      'aurora',
      'tok',
      'marina@clinicavida.com.br',
      '482931',
    );
    expect(mockedSetSession).toHaveBeenCalledWith('sess-1');
    expect(mockedSetSession.mock.invocationCallOrder[0]).toBeLessThan(
      onLoggedIn.mock.invocationCallOrder[0],
    );
  });

  it('maps a 400 invalid_code to invalidCode in an alert and keeps focus on the input', async () => {
    mockedVerify.mockRejectedValue(new HubApiError('bad', 400, 'invalid_code'));
    const { onLoggedIn } = setup();
    await goToCodeStep();
    const input = screen.getByLabelText('Código de 6 dígitos');
    fireEvent.change(input, { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Código inválido ou expirado.');
    expect(input).toHaveFocus();
    expect(onLoggedIn).not.toHaveBeenCalled();
    expect(mockedSetSession).not.toHaveBeenCalled();
  });

  it('maps a 429 to tooMany and anything else to genericError', async () => {
    mockedVerify.mockRejectedValueOnce(new HubApiError('slow', 429));
    setup();
    await goToCodeStep();
    const input = screen.getByLabelText('Código de 6 dígitos');
    fireEvent.change(input, { target: { value: '111111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Aguarde alguns minutos.',
    );
    mockedVerify.mockRejectedValueOnce(new Error('network'));
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Não foi possível continuar. Tente de novo.',
      ),
    );
  });

  it('stays on the email step with the mapped error when the code request fails', async () => {
    mockedRequest.mockRejectedValue(new HubApiError('slow', 429));
    setup();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas tentativas. Aguarde alguns minutos.',
    );
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
  });

  it('maps a 400 without invalid_code to genericError on the email step', async () => {
    mockedRequest.mockRejectedValue(new HubApiError('Pedido inválido.', 400));
    setup();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível continuar. Tente de novo.',
    );
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
  });

  it('stays busy after a successful verify so the consumed code cannot be sent twice', async () => {
    mockedVerify.mockResolvedValue({ session_token: 'sess-1' });
    const { onLoggedIn } = setup();
    await goToCodeStep();
    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '482931' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    const enter = screen.getByRole('button', { name: 'Entrar' });
    expect(enter).toBeDisabled();
    fireEvent.click(enter);
    expect(mockedVerify).toHaveBeenCalledTimes(1);
  });

  it('unlocks with an error when the hub asks for login again after a successful verify', async () => {
    mockedVerify.mockResolvedValue({ session_token: 'sess-1' });
    const onLoggedIn = vi.fn();
    const { rerender } = render(
      <HubLogin workspace="aurora" token="tok" login={LOGIN} onLoggedIn={onLoggedIn} />,
    );
    await goToCodeStep();
    fireEvent.change(screen.getByLabelText('Código de 6 dígitos'), { target: { value: '482931' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    // The bootstrap refetch answered login_required again: a new payload object arrives.
    rerender(
      <HubLogin workspace="aurora" token="tok" login={{ ...LOGIN }} onLoggedIn={onLoggedIn} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível continuar. Tente de novo.',
    );
    expect(screen.getByLabelText('Código de 6 dígitos')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Usar outro e-mail' }));
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.co' } });
    expect(screen.getByRole('button', { name: 'Enviar código' })).toBeEnabled();
  });

  it('counts the resend cooldown down and lets the person resend at zero', async () => {
    vi.useFakeTimers();
    setup();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@b.co' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enviar código' }));
    });
    expect(screen.getByText('Reenviar código em 1:00')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('Reenviar código em 0:59')).toBeInTheDocument();
    // One act per second: each tick's state update re-arms the next timeout on commit.
    for (let i = 0; i < 59; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    const resend = screen.getByRole('button', { name: 'Reenviar código' });
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(resend);
    });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Reenviar código em 1:00')).toBeInTheDocument();
  });

  it('returns to an empty email step through "Usar outro e-mail"', async () => {
    setup();
    await goToCodeStep();
    fireEvent.click(screen.getByRole('button', { name: 'Usar outro e-mail' }));
    expect(screen.getByLabelText('E-mail')).toHaveValue('');
    expect(screen.getByText('Entre no seu portal')).toBeInTheDocument();
  });
});
