import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'a'.repeat(64);
const TOKEN_NOVO = 'b'.repeat(64);
const ERRO_LINK = 'Não foi possível atualizar o link. Tente novamente.';
const BASE = 'https://abc.supabase.co';
const URL_FEED = `${BASE}/functions/v1/agenda-feed/${TOKEN}.ics`;

const { obterMock, gerarMock, desativarMock, toastSuccessMock, toastErrorMock, authState } =
  vi.hoisted(() => ({
    obterMock: vi.fn(),
    gerarMock: vi.fn(),
    desativarMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    authState: { contaId: 'conta-1' as string | null },
  }));

vi.mock('@/store/agenda', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/agenda')>()),
  obterFeedToken: obterMock,
  gerarFeedToken: gerarMock,
  desativarFeedToken: desativarMock,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ profile: authState.contaId ? { conta_id: authState.contaId } : null }),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

import { formatAgendaError } from '@/store/agenda';
import { FeedAgendaDialog } from '../FeedAgendaDialog';

let qc: QueryClient;
const writeText = vi.fn();

function abrir(open = true) {
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={qc}>
      <FeedAgendaDialog open={open} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange };
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', BASE);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  authState.contaId = 'conta-1';
  obterMock.mockReset().mockResolvedValue(TOKEN);
  gerarMock.mockReset().mockResolvedValue(TOKEN_NOVO);
  desativarMock.mockReset().mockResolvedValue(undefined);
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('FeedAgendaDialog', () => {
  it('does not fetch while closed', () => {
    abrir(false);
    expect(obterMock).not.toHaveBeenCalled();
  });

  it('shows a loading state before the token arrives', async () => {
    obterMock.mockReturnValue(new Promise(() => {}));
    abrir();
    expect(await screen.findByText('Carregando…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar link' })).not.toBeInTheDocument();
  });

  it('without a link, offers to generate one', async () => {
    obterMock.mockResolvedValue(null);
    abrir();
    expect(
      await screen.findByText(
        'Gere um link secreto para ver seus eventos do Mesaas no Google Agenda, Apple ou Outlook.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sincronizar com seu calendário' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Gerar link' }));
    await waitFor(() => expect(gerarMock).toHaveBeenCalledTimes(1));
    // The new link replaces the empty state.
    expect(
      await screen.findByDisplayValue(`${BASE}/functions/v1/agenda-feed/${TOKEN_NOVO}.ics`),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Gerar link' })).not.toBeInTheDocument();
  });

  it('with a link, shows the read-only URL, the targets and both warnings', async () => {
    abrir();
    const campo = await screen.findByDisplayValue(URL_FEED);
    expect(campo).toHaveAttribute('readonly');

    const webcal = URL_FEED.replace(/^https:/, 'webcal:');
    expect(screen.getByRole('link', { name: 'Abrir no Google Agenda' })).toHaveAttribute(
      'href',
      `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    );
    expect(screen.getByRole('link', { name: 'Abrir no Apple Calendar' })).toHaveAttribute(
      'href',
      webcal,
    );
    expect(screen.getByText(/Adicionar calendário > Da Internet/)).toBeInTheDocument();
    expect(
      screen.getByText('O Google Agenda pode levar algumas horas para mostrar mudanças.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Quem tiver este link vê seus eventos. Se ele vazar, gere um novo.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gerar novo link' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desativar link' })).toBeInTheDocument();
  });

  it('copies the URL and confirms with a toast', async () => {
    abrir();
    await screen.findByDisplayValue(URL_FEED);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_FEED));
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('Link copiado'));
  });

  it('tells the user when copying fails', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    abrir();
    await screen.findByDisplayValue(URL_FEED);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    expect(toastSuccessMock).not.toHaveBeenCalled();
  });

  it('regenerating asks first, then swaps the URL', async () => {
    abrir();
    await screen.findByDisplayValue(URL_FEED);

    fireEvent.click(screen.getByRole('button', { name: 'Gerar novo link' }));
    const confirmacao = await screen.findByRole('alertdialog');
    expect(within(confirmacao).getByText('O link atual para de funcionar.')).toBeInTheDocument();
    expect(gerarMock).not.toHaveBeenCalled();

    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Gerar novo link' }));
    await waitFor(() => expect(gerarMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByDisplayValue(`${BASE}/functions/v1/agenda-feed/${TOKEN_NOVO}.ics`),
    ).toBeInTheDocument();
    expect(screen.queryByDisplayValue(URL_FEED)).not.toBeInTheDocument();
  });

  it('cancelling the regenerate confirmation changes nothing', async () => {
    abrir();
    await screen.findByDisplayValue(URL_FEED);
    fireEvent.click(screen.getByRole('button', { name: 'Gerar novo link' }));
    const confirmacao = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(gerarMock).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(URL_FEED)).toBeInTheDocument();
  });

  it('deactivating asks first, then returns to the empty state', async () => {
    abrir();
    await screen.findByDisplayValue(URL_FEED);

    fireEvent.click(screen.getByRole('button', { name: 'Desativar link' }));
    const confirmacao = await screen.findByRole('alertdialog');
    expect(desativarMock).not.toHaveBeenCalled();

    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Desativar link' }));
    await waitFor(() => expect(desativarMock).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'Gerar link' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(URL_FEED)).not.toBeInTheDocument();
  });

  it('shows the plan message when the Agenda is not in the plan', async () => {
    obterMock.mockResolvedValue(null);
    gerarMock.mockRejectedValue({ message: 'feature_disabled:feature_agenda' });
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar link' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledTimes(1));
    const esperado = formatAgendaError({ message: 'feature_disabled:feature_agenda' });
    expect(toastErrorMock).toHaveBeenCalledWith(esperado);
    expect(esperado).not.toMatch(/atualizar o link|salvar o evento/);
    expect(screen.getByRole('button', { name: 'Gerar link' })).toBeInTheDocument();
  });

  it('uses the link copy, not the save-event copy, for a generic failure', async () => {
    obterMock.mockResolvedValue(null);
    gerarMock.mockRejectedValue(new Error('boom'));
    abrir();
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar link' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(ERRO_LINK));
  });

  it('uses the link copy when deactivating fails generically', async () => {
    desativarMock.mockRejectedValue(new Error('boom'));
    abrir();
    await screen.findByDisplayValue(URL_FEED);
    fireEvent.click(screen.getByRole('button', { name: 'Desativar link' }));
    const confirmacao = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmacao).getByRole('button', { name: 'Desativar link' }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(ERRO_LINK));
    expect(screen.getByDisplayValue(URL_FEED)).toBeInTheDocument();
  });

  it('keys the token query by workspace so another workspace never sees this link', async () => {
    abrir();
    await screen.findByDisplayValue(URL_FEED);
    expect(qc.getQueryData(['agenda-feed-token', 'conta-1'])).toBe(TOKEN);
    expect(qc.getQueryData(['agenda-feed-token', 'conta-2'])).toBeUndefined();
  });

  it('uses a null workspace key before the profile loads', async () => {
    authState.contaId = null;
    abrir();
    await screen.findByDisplayValue(URL_FEED);
    expect(qc.getQueryData(['agenda-feed-token', null])).toBe(TOKEN);
  });

  it('has no em-dash in its copy', async () => {
    abrir();
    const dialog = await screen.findByRole('dialog');
    await screen.findByDisplayValue(URL_FEED);
    expect(dialog.textContent).not.toContain('—');
  });
});
