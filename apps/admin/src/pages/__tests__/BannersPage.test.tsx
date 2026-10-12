import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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

const banner = {
  id: 'b1',
  type: 'warning',
  content: 'Manutenção programada no domingo',
  link: null,
  custom_color: null,
  target_mode: 'plan',
  target_plan_ids: ['pro'],
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

const draft = { ...banner, id: 'b2', content: 'Rascunho do aviso', status: 'draft' };

afterEach(() => vi.restoreAllMocks());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteBanner).mockResolvedValue({ success: true } as never);
  vi.mocked(listBanners).mockResolvedValue({ banners: [banner, draft] } as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'pro', name: 'Pro' }] } as never);
  vi.mocked(listWorkspaces).mockResolvedValue({ workspaces: [] } as never);
  vi.mocked(createBanner).mockResolvedValue({ banner } as never);
  vi.mocked(updateBanner).mockResolvedValue({ banner } as never);
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

describe('BannersPage (desktop)', () => {
  it('lists banners with type, status, audience and the preview strip', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Banners' })).toBeInTheDocument();
    expect(await screen.findByText('Manutenção programada no domingo')).toBeInTheDocument();
    expect(screen.getAllByText('Aviso')).toHaveLength(2);
    expect(screen.getByText('Ativo')).toBeInTheDocument();
    expect(screen.getByText('Rascunho')).toBeInTheDocument();
    expect(screen.getAllByText('Pro')).toHaveLength(2);
  });

  it('filters by status', async () => {
    renderPage();
    await screen.findByText('Manutenção programada no domingo');
    fireEvent.click(screen.getByRole('radio', { name: 'Ativos' }));
    await waitFor(() => expect(listBanners).toHaveBeenLastCalledWith({ status: 'active' }));
  });

  it('"Novo banner" opens the form and Criar submits the payload', async () => {
    renderPage();
    await screen.findByText('Manutenção programada no domingo');
    fireEvent.click(screen.getByRole('button', { name: /Novo banner/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Novo banner' });
    fireEvent.change(within(dialog).getByLabelText('Conteúdo (Markdown)'), {
      target: { value: 'Aviso novo' },
    });
    fireEvent.change(within(dialog).getByLabelText('Tipo'), { target: { value: 'critical' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() =>
      expect(createBanner).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Aviso novo',
          type: 'critical',
          target_mode: 'all',
          status: 'draft',
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('"Editar" opens the form with the banner and Atualizar saves it', async () => {
    renderPage();
    await screen.findByText('Manutenção programada no domingo');
    fireEvent.click(screen.getByRole('button', { name: /^Editar: Manutenção/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    expect(within(dialog).getByLabelText('Conteúdo (Markdown)')).toHaveValue(
      'Manutenção programada no domingo',
    );
    // An active banner cannot be deleted from the form.
    expect(
      within(dialog).queryByRole('button', { name: 'Excluir banner' }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Atualizar' }));
    await waitFor(() =>
      expect(updateBanner).toHaveBeenCalledWith(
        expect.objectContaining({ banner_id: 'b1', target_plan_ids: ['pro'] }),
      ),
    );
  });

  async function openRowMenuDelete() {
    renderPage();
    await screen.findByText('Rascunho do aviso');
    const trigger = screen.getByRole('button', { name: /^Mais ações: Rascunho/ });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Excluir' }));
  }

  it('row menu Excluir deletes the draft once confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openRowMenuDelete();
    expect(confirm).toHaveBeenCalledWith('Excluir este banner?');
    await waitFor(() => expect(deleteBanner).toHaveBeenCalledWith('b2'));
  });

  it('row menu Excluir does nothing when the confirm is rejected', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openRowMenuDelete();
    expect(deleteBanner).not.toHaveBeenCalled();
  });

  it('the form delete (drafts) asks the same confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await screen.findByText('Rascunho do aviso');
    fireEvent.click(screen.getByRole('button', { name: /^Editar: Rascunho/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Editar banner' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir banner' }));
    expect(confirm).toHaveBeenCalledWith('Excluir este banner?');
    expect(deleteBanner).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Excluir banner' }));
    await waitFor(() => expect(deleteBanner).toHaveBeenCalledWith('b2'));
  });

  it('after editing and closing, "Novo banner" opens an empty create form', async () => {
    renderPage();
    await screen.findByText('Manutenção programada no domingo');
    fireEvent.click(screen.getByRole('button', { name: /^Editar: Manutenção/ }));
    const edit = await screen.findByRole('dialog', { name: 'Editar banner' });
    expect(within(edit).getByLabelText('Conteúdo (Markdown)')).toHaveValue(banner.content);
    fireEvent.click(within(edit).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Novo banner/ }));
    const create = await screen.findByRole('dialog', { name: 'Novo banner' });
    expect(within(create).getByLabelText('Conteúdo (Markdown)')).toHaveValue('');
    expect(within(create).getByRole('button', { name: 'Criar' })).toBeInTheDocument();
    expect(
      within(create).queryByRole('button', { name: 'Excluir banner' }),
    ).not.toBeInTheDocument();
  });
});
