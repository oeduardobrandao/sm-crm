import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Acesso por cliente: a restricted member opening a fluxo of a client outside their scope
 * (they have a post assigned there) gets the client's identity from get_cliente_contexto,
 * because the client is not in their visible clients list.
 */

const store = vi.hoisted(() => ({
  getWorkflowPostsWithProperties: vi.fn(),
  advanceWorkflowFromApproval: vi.fn(),
  resolveWorkflowRascunhoBanner: vi.fn(),
  addWorkflowPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  removeWorkflowPost: vi.fn(),
  reorderWorkflowPosts: vi.fn(),
  sendPostsToCliente: vi.fn(),
  getPostApprovals: vi.fn().mockResolvedValue([]),
  getPostStatusEvents: vi.fn().mockResolvedValue([]),
  getPostProcessEvents: vi.fn().mockResolvedValue([]),
  replyToPostApproval: vi.fn(),
  getPostCommentThreads: vi.fn().mockResolvedValue([]),
  createCommentThread: vi.fn(),
  saveIgCaption: vi.fn(),
  addPostComment: vi.fn(),
  updatePostComment: vi.fn(),
  deletePostComment: vi.fn(),
  resolveCommentThread: vi.fn(),
  reopenCommentThread: vi.fn(),
  deleteCommentThread: vi.fn(),
  getWorkspaceUsers: vi.fn().mockResolvedValue([]),
  getPostEditSuggestions: vi.fn().mockResolvedValue([]),
  acceptEditSuggestion: vi.fn(),
  rejectEditSuggestion: vi.fn(),
  createDesign: vi.fn(),
  getDesignForPost: vi.fn().mockResolvedValue(null),
  // Pulled in by MovePostsToFluxoDialog (mounted by the drawer); inert here.
  getWorkflows: vi.fn().mockResolvedValue([]),
  movePostsToNewFlow: vi.fn(),
  movePostsToExistingFlow: vi.fn(),
  isFinalClientApprovalCycle: vi.fn(() => true),
  cardAutoScheduleGates: vi.fn(() => ({ autoPublishOnApproval: true, isFinalApprovalCycle: true })),
  getClienteContexto: vi.fn(),
}));
// Desktop layout; the phone branch has its own suite (WorkflowDrawerPhone.test.tsx).
// Feedback em mídia: the drawers fetch client notes by path (not through the mocked '@/store').
vi.mock('@/store/mediaNotes', () => ({
  getMediaNotes: async () => [],
  mediaNotesKey: (ids: number[]) => ['media-notes', ids.join(',')],
  replyToMediaNote: async () => undefined,
  setMediaNoteStatus: async () => undefined,
}));

vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// Desktop editor: jsdom's matchMedia reports no match, which would render the phone editor.
vi.mock('@/pages/entregas/components/postEditorPhone/useIsPhoneEditor', () => ({
  useIsPhoneEditor: () => false,
}));
vi.mock('../../../../store', () => store);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }) },
}));
const auth = vi.hoisted(() => ({ membership: null as unknown }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'u1' },
    role: 'agent',
    can: () => true,
    membership: auth.membership,
  }),
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ limits: null, isLoading: false }),
}));
vi.mock('../../../../services/postMedia', () => ({ listPostMedia: vi.fn().mockResolvedValue([]) }));
// PostEditorBody and WorkflowDrawer read client references from this module by path.
vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  injectSignedUrls: (v: unknown) => v,
  stripSignedUrls: (v: unknown) => v,
  resolveInlineImageUrls: vi.fn().mockResolvedValue({}),
}));

// Heavy leaf components — irrelevant to the auto-complete effect.
vi.mock('../PostEditor', () => ({ PostEditor: () => <div /> }));
vi.mock('../PropertyPanel', () => ({ PropertyPanel: () => <div /> }));
vi.mock('../PostCommentSummary', () => ({ default: () => <div /> }));
vi.mock('../PostTimelinePopover', () => ({ PostTimelinePopover: () => <div /> }));
vi.mock('../PostMediaGallery', () => ({
  PostMediaGallery: () => <div />,
  hasVideoMissingThumbnail: () => false,
}));
vi.mock('../InstagramCaptionField', () => ({ InstagramCaptionField: () => <div /> }));
vi.mock('../ScheduleButton', () => ({
  useScheduleActions: () => ({}),
  ScheduleButton: () => <div />,
}));
vi.mock('../WorkflowCalendarView', () => ({ WorkflowCalendarView: () => <div /> }));
vi.mock('../DiffView', () => ({ DiffView: () => <div /> }));
vi.mock('../ReadOnlyTipTap', () => ({ ReadOnlyTipTap: () => <div /> }));
vi.mock('@/components/CopyPostLinkButton', () => ({ CopyPostLinkButton: () => <div /> }));
vi.mock('@/pages/estudio/ImportToEstudioDialog', () => ({ ImportToEstudioDialog: () => <div /> }));
vi.mock('@/components/ui/date-time-picker', () => ({ DateTimePicker: () => <div /> }));

import { WorkflowDrawer } from '../WorkflowDrawer';
import type { BoardCard } from '../../hooks/useEntregasData';
import { fakeMembership } from '@/test/makeCan';

const etapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Produção',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'padrao' as const,
  status: 'ativo' as const,
};

function makeCard(cliente?: { id: number; nome: string }) {
  return {
    workflow: { id: 1, cliente_id: 42, titulo: 'Posts Agosto', status: 'ativo', etapa_atual: 1 },
    etapa,
    cliente,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 1,
    etapaIdx: 1,
    allEtapas: [etapa],
  } as unknown as BoardCard;
}

function renderDrawer(card: BoardCard) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <WorkflowDrawer card={card} membros={[]} onClose={vi.fn()} onRefresh={vi.fn()} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const subtitle = () => document.querySelector('.drawer-header-subtitle') as HTMLElement;

describe('WorkflowDrawer: client identity for a restricted member', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.getWorkflowPostsWithProperties.mockResolvedValue([
      { id: 1, workflow_id: 1, titulo: 'post um', ordem: 1, status: 'rascunho', tipo: 'feed' },
    ]);
    store.getClienteContexto.mockResolvedValue({
      id: 42,
      nome: 'Clínica Sol',
      sigla: 'CS',
      cor: '#ff0000',
      foto_url: null,
    });
  });

  it('post_detail_uses_context_rpc_for_hidden_client', async () => {
    auth.membership = fakeMembership({ role: 'agent', client_scope: 'atribuidos' });
    renderDrawer(makeCard(undefined));

    await waitFor(() => expect(subtitle()).toHaveTextContent('Clínica Sol'));
    expect(store.getClienteContexto).toHaveBeenCalledWith(42);
  });

  it('keeps the dash when the RPC returns nothing (not their client context)', async () => {
    auth.membership = fakeMembership({ role: 'agent', client_scope: 'atribuidos' });
    store.getClienteContexto.mockResolvedValue(null);
    renderDrawer(makeCard(undefined));

    await screen.findByText('post um');
    await waitFor(() => expect(store.getClienteContexto).toHaveBeenCalledWith(42));
    expect(subtitle()).toHaveTextContent('—');
  });

  it('never calls the RPC when the client is in the visible list', async () => {
    auth.membership = fakeMembership({ role: 'agent', client_scope: 'atribuidos' });
    renderDrawer(makeCard({ id: 42, nome: 'Clínica Visível' }));

    await screen.findByText('post um');
    expect(subtitle()).toHaveTextContent('Clínica Visível');
    expect(store.getClienteContexto).not.toHaveBeenCalled();
  });

  it('todos_unchanged: an unscoped member never calls the RPC', async () => {
    auth.membership = fakeMembership({ role: 'agent', client_scope: 'todos' });
    renderDrawer(makeCard(undefined));

    await screen.findByText('post um');
    expect(subtitle()).toHaveTextContent('—');
    expect(store.getClienteContexto).not.toHaveBeenCalled();
  });
});
