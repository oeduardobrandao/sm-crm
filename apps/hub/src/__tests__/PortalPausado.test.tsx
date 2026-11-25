import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../test/shared/fetchMock';
import { HubPausedError, fetchBootstrap } from '../api';
import { HUB_SESSION_STORAGE_KEY, getHubSession } from '../lib/hubSession';
import { PortalPausado } from '../pages/PortalPausado';
import { createHubQueryClient, hubBootstrapQuery, hubPostsQuery } from '../queries';
import { HubShell } from '../shell/HubShell';

const PAUSED_BODY = { error: 'Portal pausado.', code: 'hub_paused', agency_name: 'Agência Sol' };
const fetchHarness = createFetchMock();

function queuePaused(times = 1, body: Record<string, unknown> = PAUSED_BODY) {
  for (let i = 0; i < times; i++) {
    fetchHarness.queueResponse({ ok: false, status: 403, json: body });
  }
}

describe('PortalPausado', () => {
  it('renders_agency_name_no_plan_words', () => {
    const { container } = render(<PortalPausado agencyName="Agência Sol" />);
    expect(screen.getByRole('heading', { name: 'Este portal está pausado' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Fale com Agência Sol para voltar a acessar suas aprovações, posts e materiais.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nada foi perdido. Quando a agência reativar o portal, este mesmo link volta a funcionar.',
      ),
    ).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/plano|pagamento|free|assinatura|upgrade/i);
    expect(text).not.toContain('—');
  });

  it('falls back to "a agência" when the name is unknown', () => {
    render(<PortalPausado agencyName={null} />);
    expect(
      screen.getByText(
        'Fale com a agência para voltar a acessar suas aprovações, posts e materiais.',
      ),
    ).toBeInTheDocument();
  });
});

describe('hub_paused in the api client and the query layer', () => {
  beforeEach(() => {
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('maps 403 hub_paused to HubPausedError carrying the agency name', async () => {
    queuePaused();
    const err = await fetchBootstrap('sol', 'tok').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HubPausedError);
    expect(err).toMatchObject({ status: 403, code: 'hub_paused', agencyName: 'Agência Sol' });
  });

  it('keeps a plain 403 (Hub desativado) a regular HubApiError', async () => {
    fetchHarness.queueResponse({ ok: false, status: 403, json: { error: 'Hub desativado.' } });
    const err = await fetchBootstrap('sol', 'tok').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(HubPausedError);
    expect(err).toMatchObject({ status: 403, message: 'Hub desativado.' });
  });

  it('paused_does_not_clear_session', async () => {
    localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-viva');
    const qc = createHubQueryClient();
    // Bootstrap and a regular query (default retry policy): neither clears the session,
    // and neither is retried (one request each).
    queuePaused(2);
    await expect(qc.fetchQuery(hubBootstrapQuery('sol', 'tok'))).rejects.toBeInstanceOf(
      HubPausedError,
    );
    await expect(qc.fetchQuery(hubPostsQuery('tok'))).rejects.toBeInstanceOf(HubPausedError);
    expect(fetchHarness.calls).toHaveLength(2);
    expect(getHubSession()).toBe('sess-viva');
    // The session still travels on the paused request (the server just answers paused).
    const headers = fetchHarness.calls[0].init?.headers as Record<string, string>;
    expect(headers['x-hub-session']).toBe('sess-viva');
  });

  it('HubShell renders PortalPausado instead of the invalid-link screen', async () => {
    localStorage.setItem(HUB_SESSION_STORAGE_KEY, 'sess-viva');
    queuePaused(3);
    render(
      <QueryClientProvider client={createHubQueryClient()}>
        <MemoryRouter initialEntries={['/sol/hub/tok']}>
          <Routes>
            <Route path="/:workspace/hub/:token" element={<HubShell />}>
              <Route index element={<Outlet />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Este portal está pausado' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Fale com Agência Sol/)).toBeInTheDocument();
    expect(screen.queryByText('Link inválido ou expirado.')).not.toBeInTheDocument();
    expect(getHubSession()).toBe('sess-viva');
  });
});
