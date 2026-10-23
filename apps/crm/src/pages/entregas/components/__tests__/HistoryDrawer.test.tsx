import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender, screen, waitFor, fireEvent, within } from '@testing-library/react';
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
    getWorkspaceUsers: vi.fn(),
    getPostStatusDefinitions: vi.fn(),
  };
});

// The rich-text editor needs a Router and TipTap; this suite only cares about the sections around it.
vi.mock('../PostEditor', () => ({ PostEditor: () => null }));

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
    (store.getWorkspaceUsers as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
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

describe('HistoryDrawer: discussão da equipe (somente leitura)', () => {
  const post = { id: 7, titulo: 'Post com discussão', tipo: 'feed', status: 'rascunho' };
  const geral = {
    id: 1,
    post_id: 7,
    conta_id: 'conta-1',
    quoted_text: '',
    status: 'active',
    created_by: 'user-1',
    resolved_by: null,
    created_at: '2026-06-01T10:00:00Z',
    resolved_at: null,
    field: 'geral',
    anchor_start: null,
    anchor_end: null,
    orphaned: false,
    post_comments: [
      {
        id: 100,
        thread_id: 1,
        author_id: 'user-1',
        content: 'Vamos trocar a capa',
        created_at: '2026-06-01T10:00:00Z',
        updated_at: null,
      },
    ],
  };

  const anchored = {
    ...geral,
    id: 2,
    quoted_text: 'Trecho citado da legenda',
    field: 'ig_caption',
    anchor_start: 0,
    anchor_end: 10,
    post_comments: [
      {
        id: 200,
        thread_id: 2,
        author_id: 'user-1',
        content: 'Ajustar este trecho',
        created_at: '2026-06-01T11:00:00Z',
        updated_at: null,
      },
    ],
  };

  beforeEach(async () => {
    const store = await import('@/store');
    (store.getWorkflowEtapas as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getWorkflowPostsWithProperties as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue([post]);
    (store.getMembros as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getPostApprovals as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getPostCommentThreads as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValue([geral, anchored]);
    (store.getPostStatusDefinitions as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getWorkflowEvents as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
    (store.getWorkspaceUsers as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
  });

  it('shows the geral thread messages with no composer, bell or chat bridge, and keeps the summary free of it', async () => {
    render(<HistoryDrawer workflow={workflow} onClose={() => {}} />);

    fireEvent.click(await screen.findByText('Post com discussão'));

    expect(await screen.findByText('Vamos trocar a capa')).toBeInTheDocument();
    expect(screen.getByText('Discussão da equipe')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Escreva para a equipe/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Seguir|Seguindo/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Discutir no chat/)).not.toBeInTheDocument();
    // The anchored thread stays out of the discussion block (geral-only filter)...
    const discussao = screen.getByRole('region', { name: 'Discussão da equipe' });
    expect(within(discussao).queryByText('Ajustar este trecho')).not.toBeInTheDocument();
    expect(within(discussao).queryByText('Trecho citado da legenda')).not.toBeInTheDocument();
    expect(screen.queryByText(/Ver no texto/)).not.toBeInTheDocument();
    // ...and the geral thread stays out of PostCommentSummary: it lists only the anchored one.
    const summary = screen
      .getByText('Comentários internos')
      .closest('.comment-summary') as HTMLElement;
    expect(within(summary).getByText('Ajustar este trecho')).toBeInTheDocument();
    expect(within(summary).queryByText('Vamos trocar a capa')).not.toBeInTheDocument();
    expect(within(summary).getByText('(1)')).toBeInTheDocument();
  });

  it('resolves authors that only exist in workspace users (no membros row)', async () => {
    const store = await import('@/store');
    (store.getWorkspaceUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'user-1', nome: 'Dona do Workspace', avatar_url: null },
    ]);

    render(<HistoryDrawer workflow={workflow} onClose={() => {}} />);
    fireEvent.click(await screen.findByText('Post com discussão'));

    const discussao = await screen.findByRole('region', { name: 'Discussão da equipe' });
    await waitFor(() => {
      expect(within(discussao).getAllByText('Dona do Workspace').length).toBeGreaterThan(0);
    });
    expect(within(discussao).queryByText('Membro')).not.toBeInTheDocument();
  });
});
