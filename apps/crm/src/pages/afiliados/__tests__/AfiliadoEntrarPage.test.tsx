import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AfiliadoEntrarPage from '../AfiliadoEntrarPage';
import { clearSession, readSession } from '../session';
import { AffiliateApiError, exchangeAffiliateLogin } from '@/services/affiliates';

vi.mock('@/services/affiliates', async (orig) => ({
  ...(await orig<typeof import('@/services/affiliates')>()),
  exchangeAffiliateLogin: vi.fn(),
  affiliateSendLink: vi.fn(),
}));

const LOGIN = 'L'.repeat(43);

function renderWithHash(hash: string) {
  window.history.replaceState(null, '', `/afiliados/entrar${hash}`);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/afiliados/entrar']}>
        <Routes>
          <Route path="/afiliados/entrar" element={<AfiliadoEntrarPage />} />
          <Route path="/afiliados/painel" element={<p>painel aberto</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AfiliadoEntrarPage', () => {
  beforeEach(() => {
    vi.mocked(exchangeAffiliateLogin).mockReset();
    clearSession();
  });
  afterEach(() => clearSession());

  it('does not spend the link until the click, and removes it from the address bar', async () => {
    renderWithHash(`#${LOGIN}`);
    expect(await screen.findByRole('button', { name: 'Entrar no painel' })).toBeInTheDocument();
    expect(exchangeAffiliateLogin).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });

  it('exchanges the link for a session and opens the panel', async () => {
    vi.mocked(exchangeAffiliateLogin).mockResolvedValue({ session_token: 'S'.repeat(43) });
    const user = userEvent.setup();
    renderWithHash(`#${LOGIN}`);
    await user.click(await screen.findByRole('button', { name: 'Entrar no painel' }));
    expect(await screen.findByText('painel aberto')).toBeInTheDocument();
    expect(exchangeAffiliateLogin).toHaveBeenCalledWith(LOGIN);
    expect(readSession()).toBe('S'.repeat(43));
  });

  it('a used or expired link (404) asks for a new one', async () => {
    vi.mocked(exchangeAffiliateLogin).mockRejectedValue(new AffiliateApiError('x', 404));
    const user = userEvent.setup();
    renderWithHash(`#${LOGIN}`);
    await user.click(await screen.findByRole('button', { name: 'Entrar no painel' }));
    expect(await screen.findByText('Este link expirou ou já foi usado')).toBeInTheDocument();
    expect(readSession()).toBeNull();
  });

  it('a network or server error offers a retry with the same link', async () => {
    vi.mocked(exchangeAffiliateLogin)
      .mockRejectedValueOnce(new AffiliateApiError('Falhou.', 500))
      .mockResolvedValueOnce({ session_token: 'S'.repeat(43) });
    const user = userEvent.setup();
    renderWithHash(`#${LOGIN}`);
    await user.click(await screen.findByRole('button', { name: 'Entrar no painel' }));
    await user.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(exchangeAffiliateLogin).toHaveBeenCalledTimes(2));
    expect(vi.mocked(exchangeAffiliateLogin).mock.calls[1][0]).toBe(LOGIN);
    expect(await screen.findByText('painel aberto')).toBeInTheDocument();
  });

  it('without a token in the link it shows the e-mail form', async () => {
    renderWithHash('');
    expect(await screen.findByText('Entre no painel do afiliado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enviar link de acesso' })).toBeInTheDocument();
  });
});
