import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Workflow, WorkflowEvent } from '@/store';

import { HistoryDrawer } from '../HistoryDrawer';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getWorkflowEtapas: vi.fn(),
    getWorkflowPostsWithProperties: vi.fn(),
    getMembros: vi.fn(),
    getPostApprovals: vi.fn(),
    getPostCommentThreads: vi.fn(),
    getWorkflowEvents: vi.fn(),
    getPostStatusDefinitions: vi.fn(),
  };
});

function ev(partial: Partial<WorkflowEvent>): WorkflowEvent {
  return {
    id: 1,
    workflow_id: 10,
    conta_id: 'conta-1',
    event_type: 'criado',
    etapa_id: null,
    etapa_nome: null,
    source: 'workspace_user',
    actor_user_id: null,
    actor_name: 'Eduardo Souza',
    metadata: {},
    created_at: '2026-06-01T10:00:00Z',
    ...partial,
  };
}

const workflow = {
  id: 10,
  cliente_id: 1,
  titulo: 'Campanha concluída',
  status: 'concluido',
  template_id: null,
} as unknown as Workflow;

describe('HistoryDrawer — Histórico section', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const store = await import('@/store');
    (store.getWorkflowEtapas as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getWorkflowPostsWithProperties as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue([]);
    (store.getMembros as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getPostApprovals as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getPostCommentThreads as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getPostStatusDefinitions as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockReset();
  });

  it('renders the Histórico section with event nodes when workflow_events exist', async () => {
    const store = await import('@/store');
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
      ev({ id: 1, event_type: 'criado' }),
      ev({ id: 2, event_type: 'fluxo_concluido', created_at: '2026-06-05T10:00:00Z' }),
    ]);

    render(<HistoryDrawer workflow={workflow} onClose={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText('Histórico')).toBeInTheDocument();
    });
    expect(screen.getByText('Fluxo criado')).toBeInTheDocument();
    // "Fluxo concluído" also appears as the static final node of the unrelated
    // "Etapas" compliance timeline (rendered unconditionally), so with one
    // fluxo_concluido event we expect exactly two matches: the static Etapas
    // marker and the new Histórico event node.
    expect(screen.getAllByText('Fluxo concluído')).toHaveLength(2);
  });

  it('omits the Histórico section entirely when there are no workflow_events (no backfill)', async () => {
    const store = await import('@/store');
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<HistoryDrawer workflow={workflow} onClose={() => {}} />);

    // Wait for the drawer's other queries to resolve so we're not just
    // catching a still-loading state.
    await waitFor(() => {
      expect(screen.getByText('Posts (0)')).toBeInTheDocument();
    });
    expect(screen.queryByText('Histórico')).not.toBeInTheDocument();
  });
});
