import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({ fetchPosts: vi.fn(), fetchPostsInRange: vi.fn() }));
vi.mock('../../components/dashboard/DashboardSection', () => ({ DashboardSection: () => null }));
// The fake calendar exposes what Home passes and lets the test pick the shown month.
vi.mock('../../components/PostCalendar', () => ({
  PostCalendar: (props: {
    posts: Array<{ titulo: string }>;
    onMonthChange?: (y: number, m: number) => void;
    loading?: boolean;
    notice?: ReactNode;
  }) => (
    <div>
      <span>Cal: {props.posts.map((p) => p.titulo).join(', ')}</span>
      {props.loading && <span>carregando-mes</span>}
      {props.notice}
      <button onClick={() => props.onMonthChange?.(2025, 10)}>nov-2025</button>
      <button onClick={() => props.onMonthChange?.(2026, 8)}>set-2026</button>
    </div>
  ),
}));

import { fetchPosts, fetchPostsInRange } from '../../api';
import { localMonthRange } from '../../lib/postView';
import { HomePage } from '../HomePage';

const posts = vi.mocked(fetchPosts);
const range = vi.mocked(fetchPostsInRange);
const hubValue = {
  bootstrap: {
    workspace: { name: 'M', logo_url: '', brand_color: '#0f766e' },
    cliente_nome: 'Ana',
    cliente_foto_url: null,
    is_active: true,
    cliente_id: 14,
  },
  token: 'tk',
  workspace: 'mesaas',
} as never;

const p = (id: number, titulo: string, status = 'agendado') => ({
  id,
  titulo,
  status,
  scheduled_at: '2026-09-10T10:00:00.000Z',
});

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter initialEntries={['/mesaas/hub/tk']}>
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={<HomePage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

describe('Home calendar range', () => {
  beforeEach(() => {
    posts.mockReset();
    range.mockReset();
  });

  it('fetches a month that starts before historyCutoff once, by its local bounds, and merges it', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
      olderCursor: 'x|0',
    } as never);
    range.mockResolvedValue({
      posts: [p(2, 'Antigo', 'postado'), p(1, 'Recente')],
      postApprovals: [],
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    expect(await screen.findByText('Cal: Recente, Antigo')).toBeInTheDocument();
    const { from, to } = localMonthRange(2025, 10);
    expect(range).toHaveBeenCalledTimes(1);
    expect(range).toHaveBeenCalledWith('tk', from, to);
  });

  it('does not fetch a month that starts after the cutoff', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('set-2026'));
    await screen.findByText('Cal: Recente');
    expect(range).not.toHaveBeenCalled();
  });

  it('does not fetch any month when historyCutoff is null (or absent: old backend)', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: null,
    } as never);
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    await screen.findByText('Cal: Recente');
    expect(range).not.toHaveBeenCalled();
  });

  it('shows the shell posts and a retry when a month fails', async () => {
    posts.mockResolvedValue({
      posts: [p(1, 'Recente')],
      postApprovals: [],
      historyCutoff: '2026-07-04T00:00:00.000Z',
    } as never);
    range.mockRejectedValue(new Error('x'));
    renderHome();
    fireEvent.click(await screen.findByText('nov-2025'));
    expect(
      await screen.findByText('Não foi possível carregar este mês.', {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Cal: Recente')).toBeInTheDocument();
    range.mockResolvedValue({ posts: [p(2, 'Antigo', 'postado')], postApprovals: [] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(screen.getByText('Cal: Recente, Antigo')).toBeInTheDocument());
  });
});
