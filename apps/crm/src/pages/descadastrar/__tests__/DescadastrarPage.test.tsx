import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import DescadastrarPage from '../DescadastrarPage';

const fetchMock = vi.fn();

function renderAt(token: string) {
  return render(
    <MemoryRouter initialEntries={[`/descadastrar/${token}`]}>
      <Routes>
        <Route path="/descadastrar/:token" element={<DescadastrarPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DescadastrarPage', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('opening the page never calls the function', () => {
    renderAt('abc.def');
    expect(screen.getByText('nurtureUnsub.title')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('confirm POSTs the token and shows done', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));
    renderAt('abc.def');
    fireEvent.click(screen.getByRole('button', { name: 'nurtureUnsub.cta' }));
    await waitFor(() => expect(screen.getByText('nurtureUnsub.doneTitle')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/functions\/v1\/nurture-unsub\/abc\.def$/);
    expect(init).toEqual({ method: 'POST' });
  });

  test('404 from the function shows the invalid-link state', async () => {
    fetchMock.mockResolvedValue(new Response('no', { status: 404 }));
    renderAt('abc.def');
    fireEvent.click(screen.getByRole('button', { name: 'nurtureUnsub.cta' }));
    await waitFor(() => expect(screen.getByText('nurtureUnsub.invalidTitle')).toBeInTheDocument());
  });

  test('server or network error keeps the button for a retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    renderAt('abc.def');
    fireEvent.click(screen.getByRole('button', { name: 'nurtureUnsub.cta' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('nurtureUnsub.error'));
    expect(screen.getByRole('button', { name: 'nurtureUnsub.cta' })).toBeEnabled();
  });

  test('malformed token is rejected without a request', () => {
    renderAt('not-a-token');
    expect(screen.getByText('nurtureUnsub.invalidTitle')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
