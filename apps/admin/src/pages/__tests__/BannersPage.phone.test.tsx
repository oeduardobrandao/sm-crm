import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  listBanners: vi.fn(),
  createBanner: vi.fn(),
  updateBanner: vi.fn(),
  deleteBanner: vi.fn(),
  listPlans: vi.fn(),
  listWorkspaces: vi.fn(),
}));

import {
  createBanner,
  deleteBanner,
  listBanners,
  listPlans,
  listWorkspaces,
  updateBanner,
} from '../../lib/api';
import BannersPage from '../BannersPage';

const active = {
  id: 'b1',
  type: 'warning',
  content: 'Manutenção programada no domingo',
  link: null,
  custom_color: null,
  target_mode: 'all',
  target_plan_ids: null,
  target_workspace_ids: null,
  dismissible: true,
  starts_at: null,
  ends_at: null,
  status: 'active',
  created_by: null,
  created_at: '2026-10-01T00:00:00.000Z',
  updated_at: '2026-10-01T00:00:00.000Z',
  dismissal_count: 4,
};
const draft = {
  ...active,
  id: 'b2',
  type: 'critical',
  content: 'Instabilidade na conexão com o Instagram',
  status: 'draft',
};

let restore: () => void;
beforeEach(() => {
  restore = mockPhone();
  vi.mocked(listBanners).mockResolvedValue({ banners: [active, draft] } as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'pro', name: 'Pro' }] } as never);
  vi.mocked(listWorkspaces).mockResolvedValue({ workspaces: [] } as never);
  vi.mocked(createBanner).mockResolvedValue({ banner: active } as never);
  vi.mocked(updateBanner).mockResolvedValue({ banner: active } as never);
  vi.mocked(deleteBanner).mockResolvedValue({ success: true } as never);
});
afterEach(() => {
  restore();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BannersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BannersPage (phone)', () => {
  it('shows the large title, the status filter and the banners as buttons', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Banners' })).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: /Manutenção programada/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Instabilidade na conexão/ })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Status' })).toBeInTheDocument();
  });

  it('filters by status through the segmented control', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Manutenção programada/ });
    fireEvent.click(screen.getByRole('radio', { name: 'Rascunhos' }));
    await waitFor(() => expect(listBanners).toHaveBeenLastCalledWith({ status: 'draft' }));
  });

  it('"Novo banner" opens the form sheet and Criar submits it', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Manutenção programada/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo banner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo banner' });
    fireEvent.change(within(dialog).getByLabelText(/Conteúdo/), {
      target: { value: 'Aviso novo' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(createBanner).toHaveBeenCalledWith(
        expect.objectContaining({ content: 'Aviso novo', type: 'info', status: 'draft' }),
      ),
    );
  });

  it('tapping a banner opens it for editing and a draft can be deleted', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Instabilidade na conexão/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    expect(within(dialog).getByLabelText(/Conteúdo/)).toHaveValue(
      'Instabilidade na conexão com o Instagram',
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir banner' }));
    await waitFor(() => expect(deleteBanner).toHaveBeenCalledWith('b2'));
  });
  it('Público is a grouped picker row, not native radios, and plans drill in from it', async () => {
    renderPage();
    await screen.findByRole('button', { name: /Manutenção programada/ });
    fireEvent.click(screen.getByRole('button', { name: 'Novo banner' }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo banner' });
    expect(within(dialog).queryByRole('radio', { name: 'Todos' })).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/Conteúdo/), {
      target: { value: 'Só para o Pro' },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /Público/ }));
    const modes = await screen.findByRole('dialog', { name: 'Público' });
    fireEvent.click(within(modes).getByRole('button', { name: 'Por plano' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Público' })).toBeNull());

    fireEvent.click(within(dialog).getByRole('button', { name: /Planos/ }));
    const planSheet = await screen.findByRole('dialog', { name: 'Planos' });
    fireEvent.click(within(planSheet).getByRole('button', { name: 'Pro' }));
    // Multi select stays open until dismissed (iOS Settings behaviour).
    fireEvent.keyDown(planSheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Planos' })).toBeNull());
    expect(within(dialog).getByRole('button', { name: /Planos/ })).toHaveTextContent('Pro');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(createBanner).toHaveBeenCalledWith(
        expect.objectContaining({ target_mode: 'plan', target_plan_ids: ['pro'] }),
      ),
    );
  });

  it('draft rows mute their text instead of fading the whole row', async () => {
    renderPage();
    const row = await screen.findByRole('button', { name: /Instabilidade na conexão/ });
    expect(row.className).not.toMatch(/opacity-/);
    expect(within(row).getByText('Instabilidade na conexão com o Instagram').className).toContain(
      'text-muted-foreground',
    );
    expect(row.querySelector('.phone-cell__body')).not.toBeNull();
  });
});
