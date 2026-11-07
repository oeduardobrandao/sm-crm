import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ getEmailList: vi.fn() }));
vi.mock('../../hooks/useIsPhone', () => ({ useIsPhone: vi.fn(() => false) }));

import EmailsListPage from '../EmailsListPage';
import * as api from '../../lib/api';

const item = (n: number, over: Partial<api.EmailListItem> = {}): api.EmailListItem => ({
  email_id: `id-${n}`,
  sent_at: `2026-11-0${n}T12:00:00.123456+00:00`,
  category: 'notificacoes',
  type: 'notification_digest',
  last_event: 'delivered',
  source: 'webhook',
  bounce_type: null,
  bounce_message: null,
  recipient_masked: null,
  subject: null,
  ...over,
});

const CURSOR = { sent_at: '2026-11-01T12:00:00.123456+00:00', email_id: 'id-1' };

const PAGE1: api.EmailListResponse = {
  items: [
    item(2, { last_event: 'bounced', recipient_masked: 'a***@x.com', subject: 'Olá mundo' }),
    item(1),
  ],
  next_cursor: CURSOR,
  types: [
    { category: 'notificacoes', type: 'notification_digest' },
    { category: 'interno', type: 'desconhecido' },
  ],
};

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.search}</div>;
}

function renderPage(url = '/admin/emails/lista?preset=7d') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <EmailsListPage />
        <Loc />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(api.getEmailList).mockReset();
  vi.mocked(api.getEmailList).mockResolvedValue(PAGE1);
});

describe('EmailsListPage', () => {
  it('renders rows with badge label and a safe Resend link', async () => {
    renderPage();
    expect(await screen.findByText('Bounce')).toBeInTheDocument();
    expect(screen.getByText('Entregue')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Ver no Resend/ });
    expect(links[0]).toHaveAttribute('href', 'https://resend.com/emails/id-2');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0].getAttribute('rel')).toContain('noopener');
    expect(screen.getByText('2 e-mails carregados')).toBeInTheDocument();
  });

  it('shows recipient and subject only when present', async () => {
    renderPage();
    await screen.findByText('Bounce');
    expect(screen.getByText(/a\*\*\*@x\.com/)).toBeInTheDocument();
    expect(screen.getByText('Olá mundo')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows[1].querySelectorAll('td')[4].textContent).toContain('Olá mundo');
    expect(rows[2].querySelectorAll('td')[4].textContent).toBe('');
  });

  it('Carregar mais sends the page 1 cursor and hides at the end', async () => {
    vi.mocked(api.getEmailList)
      .mockResolvedValueOnce(PAGE1)
      .mockResolvedValueOnce({ items: [item(3)], next_cursor: null, types: null });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(api.getEmailList).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.getEmailList).mock.calls[0][0].cursor).toBeNull();
    expect(vi.mocked(api.getEmailList).mock.calls[1][0].cursor).toEqual(CURSOR);
    await waitFor(() => expect(screen.getByText('3 e-mails carregados')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).toBeNull();
  });

  it('status filter refetches without cursor, expanded events, and updates the URL', async () => {
    renderPage();
    await screen.findByText('Bounce');
    await userEvent.click(screen.getByRole('button', { name: 'Status' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Não enviado' }));
    await waitFor(() =>
      expect(vi.mocked(api.getEmailList).mock.calls.at(-1)?.[0]).toMatchObject({
        cursor: null,
        events: ['failed', 'suppressed', 'canceled'],
      }),
    );
    expect(screen.getByTestId('loc')).toHaveTextContent('status=nao_enviado');
  });

  it('type options come from page 1 types, labelled', async () => {
    renderPage();
    await screen.findByText('Bounce');
    await userEvent.click(screen.getByRole('button', { name: 'Tipo' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitemcheckbox', { name: 'Não identificado' })).toBeVisible();
    expect(
      within(menu).getByRole('menuitemcheckbox', { name: 'Resumo de notificações' }),
    ).toBeVisible();
  });

  it('shows the empty state with a clear button', async () => {
    vi.mocked(api.getEmailList).mockResolvedValue({ items: [], next_cursor: null, types: [] });
    renderPage('/admin/emails/lista?preset=7d&cat=interno');
    expect(await screen.findByText('Nenhum e-mail com esses filtros')).toBeInTheDocument();
    const clears = screen.getAllByRole('button', { name: 'Limpar filtros' });
    await userEvent.click(clears[clears.length - 1]);
    await waitFor(() => expect(screen.getByTestId('loc')).not.toHaveTextContent('cat='));
  });

  it('shows ErrorState and retries', async () => {
    vi.mocked(api.getEmailList).mockRejectedValueOnce(new Error('x')).mockResolvedValue(PAGE1);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Bounce')).toBeInTheDocument();
  });

  it('invalid custom URL falls back to the 7d list without an error', async () => {
    renderPage('/admin/emails/lista?preset=custom&start=2026-02-30&end=2026-03-01');
    expect(await screen.findByText('Bounce')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    const call = vi.mocked(api.getEmailList).mock.calls[0][0];
    expect(call.end > call.start).toBe(true);
    expect(screen.getByRole('radio', { name: '7 dias' })).toBeChecked();
  });

  it('typing an invalid custom date does not change the URL', async () => {
    renderPage();
    await screen.findByText('Bounce');
    await userEvent.click(screen.getByRole('radio', { name: 'Personalizado' }));
    await waitFor(() => expect(screen.getByTestId('loc')).toHaveTextContent('preset=custom'));
    const before = screen.getByTestId('loc').textContent;
    const calls = vi.mocked(api.getEmailList).mock.calls.length;
    const input = screen.getByLabelText('Data inicial');
    fireEvent.change(input, { target: { value: '2026-02-30' } });
    expect(screen.getByTestId('loc').textContent).toBe(before);
    expect(vi.mocked(api.getEmailList).mock.calls.length).toBe(calls);
  });

  it('drops selected types whose category is no longer selected', async () => {
    renderPage('/admin/emails/lista?preset=7d&cat=notificacoes,interno&type=desconhecido');
    await screen.findByText('Bounce');
    await userEvent.click(screen.getByRole('button', { name: /^Categoria/ }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Interno' }));
    await waitFor(() => expect(screen.getByTestId('loc')).not.toHaveTextContent('type='));
    expect(screen.getByTestId('loc')).toHaveTextContent('cat=notificacoes');
  });

  it('a failed Carregar mais keeps the rows and retries inline', async () => {
    vi.mocked(api.getEmailList)
      .mockResolvedValueOnce(PAGE1)
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce({ items: [item(3)], next_cursor: null, types: null });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Não foi possível carregar mais.')).toBeInTheDocument();
    expect(screen.getByText('Bounce')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await waitFor(() => expect(screen.getByText('3 e-mails carregados')).toBeInTheDocument());
    expect(vi.mocked(api.getEmailList).mock.calls[2][0].cursor).toEqual(CURSOR);
  });
});
