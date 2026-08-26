import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkflowEvent } from '@/store';

import { WorkflowHistoryView, WorkflowHistoryList } from '../WorkflowHistoryView';
import type { WorkflowTimelineNode } from '../workflowTimeline';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getWorkflowEvents: vi.fn(),
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

describe('WorkflowHistoryList', () => {
  it('renders one row per node with label, actor, and diffs', () => {
    const nodes: WorkflowTimelineNode[] = [
      {
        key: 'event-1',
        label: 'Fluxo criado',
        detail: null,
        at: '2026-06-01T10:00:00Z',
        actorLabel: 'Eduardo Souza',
        tone: 'neutral',
        diffs: [],
        eventType: 'criado',
      },
      {
        key: 'event-2',
        label: 'Fluxo editado',
        detail: null,
        at: '2026-06-02T10:00:00Z',
        actorLabel: 'Ana Costa',
        tone: 'neutral',
        diffs: ['Título: Antigo → Novo'],
        eventType: 'fluxo_editado',
      },
    ];
    render(<WorkflowHistoryList nodes={nodes} />);
    expect(screen.getByText('Fluxo criado')).toBeInTheDocument();
    expect(screen.getByText('Fluxo editado')).toBeInTheDocument();
    expect(screen.getByText('Ana Costa')).toBeInTheDocument();
    expect(screen.getByText('Título: Antigo → Novo')).toBeInTheDocument();
  });

  it('renders a fallback icon instead of crashing for an unknown/future event type', () => {
    const nodes: WorkflowTimelineNode[] = [
      {
        key: 'event-1',
        label: 'evento_futuro',
        detail: null,
        at: '2026-06-01T10:00:00Z',
        actorLabel: 'Eduardo Souza',
        tone: 'neutral',
        diffs: [],
        eventType: 'evento_futuro' as unknown as WorkflowEvent['event_type'],
      },
    ];
    expect(() => render(<WorkflowHistoryList nodes={nodes} />)).not.toThrow();
    expect(screen.getByText('evento_futuro')).toBeInTheDocument();
  });
});

describe('WorkflowHistoryView', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    const store = await import('@/store');
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockReset();
  });

  it('shows the empty state when there are no events', async () => {
    const store = await import('@/store');
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    render(<WorkflowHistoryView workflowId={10} />);

    await waitFor(() => {
      expect(screen.getByText('Nenhum evento registrado ainda.')).toBeInTheDocument();
    });
  });

  it('renders node labels once events resolve', async () => {
    const store = await import('@/store');
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockResolvedValue([
      ev({ id: 1, event_type: 'criado' }),
      ev({ id: 2, event_type: 'fluxo_concluido', created_at: '2026-06-05T10:00:00Z' }),
    ]);

    render(<WorkflowHistoryView workflowId={10} />);

    await waitFor(() => {
      expect(screen.getByText('Fluxo criado')).toBeInTheDocument();
    });
    expect(screen.getByText('Fluxo concluído')).toBeInTheDocument();
  });
});
