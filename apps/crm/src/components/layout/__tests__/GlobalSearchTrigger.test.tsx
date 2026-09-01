import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ canSeeFinancials: false }),
}));

const { getWorkflowsMock, getAllWorkflowPostsMock } = vi.hoisted(() => ({
  getWorkflowsMock: vi.fn(),
  getAllWorkflowPostsMock: vi.fn(),
}));

vi.mock('@/store/clients', () => ({ getClientes: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/finance', () => ({
  getContratos: vi.fn().mockResolvedValue([]),
  getTransacoes: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/store/team', () => ({ getMembros: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/ideias', () => ({ getIdeias: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/hub', () => ({ getAllHubPages: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/workflows', () => ({ getWorkflows: getWorkflowsMock }));
vi.mock('@/store/posts', () => ({ getAllWorkflowPosts: getAllWorkflowPostsMock }));

import GlobalSearchTrigger from '../GlobalSearchTrigger';

function renderTrigger() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <GlobalSearchTrigger />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GlobalSearchTrigger', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    getWorkflowsMock.mockResolvedValue([{ id: 5, titulo: 'Julho', status: 'ativo' }]);
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 31, workflow_id: 5, titulo: 'Carrossel amamentação', tipo: 'carrossel' },
    ]);
  });

  // A post result has to land on that post, not just on the fluxo that contains it.
  // /entregas takes &post=<id> alongside ?drawer=<workflowId> and expands it in the drawer.
  it('navigates a post result to the post itself, not just to its fluxo', async () => {
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    fireEvent.click(await screen.findByText('Carrossel amamentação'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?drawer=5&post=31');
  });

  // The fluxo result is a WORKFLOW, so it correctly opens the whole card with no post.
  it('navigates a fluxo result to the fluxo alone', async () => {
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    fireEvent.click(await screen.findByText('Julho'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?drawer=5');
  });

  // A post avulso (no workflow_id) has nowhere to derive a `?drawer=` target from --
  // the CARRIED FINDING from Task 12's review was that the old unguarded `${p.workflow_id}`
  // produced a literal "drawer=null" for this case. It must instead use the universal
  // `?post=` form and label itself distinctly from a wired post.
  it('navigates an avulso post result via the universal ?post= form, labelled Avulso', async () => {
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 42, workflow_id: null, titulo: 'Post fora de fluxo', tipo: 'feed' },
    ]);
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    fireEvent.click(await screen.findByText('Post fora de fluxo'));

    expect(navigateMock).toHaveBeenCalledWith('/entregas?post=42');
    expect(navigateMock).not.toHaveBeenCalledWith(expect.stringContaining('drawer'));
  });

  it('shows Avulso next to the tipo for a post with no workflow', async () => {
    getAllWorkflowPostsMock.mockResolvedValue([
      { id: 42, workflow_id: null, titulo: 'Post fora de fluxo', tipo: 'feed' },
    ]);
    renderTrigger();
    fireEvent.click(screen.getByRole('button', { name: /Buscar|Search/i }));

    expect(await screen.findByText('feed · Avulso')).toBeInTheDocument();
  });
});
