import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import CancelarAvisosPage, { isGuestToken } from '../CancelarAvisosPage';

const fetchMock = vi.fn();

/** b64url(JSON) + a dummy signature: the page never verifies, the function does. */
function tokenFor(payload: object): string {
  const b64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${b64}.sig`;
}

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/cancelar-avisos/${token}`]}>
      <Routes>
        <Route path="/cancelar-avisos/:token" element={<CancelarAvisosPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('CancelarAvisosPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('client token shows the client copy and never calls the function on open', () => {
    renderAt(tokenFor({ c: 42 }));
    expect(screen.getByText('clientUnsub.bodyClient')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('guest token shows the guest copy', () => {
    renderAt(tokenFor({ g: 7 }));
    expect(screen.getByText('clientUnsub.bodyGuest')).toBeInTheDocument();
  });

  test('confirm POSTs the token to client-email-unsub and shows done', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    const token = tokenFor({ c: 42 });
    renderAt(token);
    fireEvent.click(screen.getByRole('button', { name: 'clientUnsub.cta' }));
    await waitFor(() => expect(screen.getByText('clientUnsub.doneTitle')).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url).endsWith(`/functions/v1/client-email-unsub/${token}`)).toBe(true);
    expect(init).toEqual({ method: 'POST' });
  });

  test('404 shows the invalid state; 500 keeps the button', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }));
    renderAt(tokenFor({ c: 42 }));
    fireEvent.click(screen.getByRole('button', { name: 'clientUnsub.cta' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('clientUnsub.error'));
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 404 }));
    fireEvent.click(screen.getByRole('button', { name: 'clientUnsub.cta' }));
    await waitFor(() => expect(screen.getByText('clientUnsub.invalidTitle')).toBeInTheDocument());
  });

  test('malformed token is invalid without a request', () => {
    renderAt('garbage');
    expect(screen.getByText('clientUnsub.invalidTitle')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('isGuestToken tolerates junk', () => {
    expect(isGuestToken('!!!.x')).toBe(false);
    expect(isGuestToken(tokenFor({ g: 0 }))).toBe(true);
  });
});
