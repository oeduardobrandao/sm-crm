import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  listPopups: vi.fn(),
  createPopup: vi.fn(),
  updatePopup: vi.fn(),
  deletePopup: vi.fn(),
  listPlans: vi.fn(),
  listWorkspaces: vi.fn(),
}));
vi.mock('../../lib/inline-image', () => ({
  uploadInlineImage: vi.fn(),
  resolveInlineImageUrls: vi.fn(),
}));

import { createPopup, listPlans, listPopups, listWorkspaces } from '../../lib/api';
import { resolveInlineImageUrls } from '../../lib/inline-image';
import PopupsPage from '../PopupsPage';

const page = (title: string) => ({
  title,
  eyebrow: null,
  body: 'b',
  image_key: null,
  cta_label: null,
  cta_url: null,
});

const popup = {
  id: 'p1',
  pages: [page('Analytics de Stories'), page('Segunda')],
  cta_label: 'Ver',
  cta_url: '/ajuda',
  cta_style: 'ink',
  secondary_label: null,
  frequency: 'once',
  require_ack: true,
  trigger: 'trial_ending',
  trigger_days: 3,
  target_mode: 'all',
  target_plan_ids: null,
  target_workspace_ids: null,
  starts_at: null,
  ends_at: null,
  status: 'active',
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  counts: { seen: 312, closed: 225, cta: 87, ack: 0 },
};
const draft = { ...popup, id: 'p2', status: 'draft', pages: [page('Rascunho de aviso')] };

let restore: () => void;
beforeEach(() => {
  restore = mockPhone();
  vi.mocked(listPopups).mockResolvedValue({ popups: [popup, draft] } as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'pro', name: 'Pro' }] } as never);
  vi.mocked(listWorkspaces).mockResolvedValue({ workspaces: [] } as never);
  vi.mocked(resolveInlineImageUrls).mockResolvedValue({});
  vi.mocked(createPopup).mockResolvedValue({ popup } as never);
});
afterEach(() => {
  restore();
  vi.clearAllMocks();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PopupsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PopupsPage (phone)', () => {
  it('shows the large title, the status filter and the popups as buttons', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Popups' })).toBeInTheDocument();
    const row = await screen.findByRole('button', { name: /Analytics de Stories/ });
    expect(within(row).getByText('2 páginas')).toBeInTheDocument();
    expect(within(row).getByText(/vistos 312/)).toBeInTheDocument();
    expect(within(row).getByText('Teste em 3 dias')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Rascunho de aviso/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Status' })).toBeInTheDocument();
  });

  it('filters by status through the segmented control', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Analytics de Stories/ });
    fireEvent.click(screen.getByRole('radio', { name: 'Rascunhos' }));
    await waitFor(() => expect(listPopups).toHaveBeenLastCalledWith({ status: 'draft' }));
  });

  it('"Novo popup" opens the editor sheet with Páginas · Configurações · Prévia and Criar submits it', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Analytics de Stories/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo popup' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo popup' });
    const sections = within(dialog).getByRole('tablist', { name: 'Seções do popup' });
    expect(
      within(sections)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Páginas', 'Configurações', 'Prévia']);
    const pages = within(dialog).getByRole('tablist', { name: 'Páginas do popup' });
    expect(within(pages).getAllByRole('tab')).toHaveLength(1);

    fireEvent.change(within(dialog).getByLabelText('Título'), { target: { value: 'Oi' } });
    fireEvent.change(within(dialog).getByLabelText('Corpo (Markdown)'), {
      target: { value: 'corpo' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Nova página' }));
    expect(within(pages).getAllByRole('tab')).toHaveLength(2);
    fireEvent.click(within(pages).getAllByRole('tab')[0]);

    fireEvent.click(within(sections).getByRole('tab', { name: 'Prévia' }));
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Oi' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    // Page 2 is empty: validation jumps back to Páginas, on the page with the error.
    expect(await within(dialog).findByText('Título é obrigatório')).toBeInTheDocument();
    expect(within(sections).getByRole('tab', { name: 'Páginas' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(pages).getAllByRole('tab')[1]).toHaveAttribute('aria-selected', 'true');
    expect(createPopup).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover página 2' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createPopup).toHaveBeenCalledTimes(1));
    expect(vi.mocked(createPopup).mock.calls[0][0].pages).toEqual([
      {
        title: 'Oi',
        eyebrow: null,
        body: 'corpo',
        image_key: null,
        cta_label: null,
        cta_url: null,
      },
    ]);
  });

  it('tapping a popup opens it for editing; settings live under Configurações', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Analytics de Stories/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar popup' });
    expect(within(dialog).getByLabelText('Título')).toHaveValue('Analytics de Stories');
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Configurações' }));
    expect(within(dialog).getByLabelText('Gatilho')).toHaveValue('trial_ending');
    expect(within(dialog).getByRole('switch', { name: /Exigir confirmação/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
