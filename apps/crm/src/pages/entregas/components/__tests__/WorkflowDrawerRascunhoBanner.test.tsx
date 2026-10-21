import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Drawer "Voltar todos para rascunho" banner: shows when a pending-approval-ahead etapa is active
 * and posts are still approved; X dismisses, confirmed reset resets.
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
}));
// Desktop layout; the phone branch has its own suite (WorkflowDrawerPhone.test.tsx).
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
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, role: 'owner', can: () => true }),
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

const etapas = [
  {
    id: 10,
    workflow_id: 1,
    ordem: 1,
    nome: 'Aprovação 1',
    prazo_dias: 2,
    tipo_prazo: 'corridos' as const,
    tipo: 'aprovacao_cliente' as const,
    status: 'concluido' as const,
    concluido_em: '2026-10-20T10:00:00.123456+00:00',
  },
  {
    id: 11,
    workflow_id: 1,
    ordem: 2,
    nome: 'Ajustes',
    prazo_dias: 2,
    tipo_prazo: 'corridos' as const,
    tipo: 'padrao' as const,
    status: 'ativo' as const,
  },
  {
    id: 12,
    workflow_id: 1,
    ordem: 3,
    nome: 'Aprovação 2',
    prazo_dias: 2,
    tipo_prazo: 'corridos' as const,
    tipo: 'aprovacao_cliente' as const,
    status: 'pendente' as const,
  },
];
const CICLO = '2026-10-20T10:00:00.123456+00:00';

function makeCard(dispensado: string | null = null) {
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Posts Agosto',
      status: 'ativo',
      etapa_atual: 2,
      aviso_rascunho_dispensado_em: dispensado,
    },
    etapa: etapas[1],
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 3,
    etapaIdx: 2,
    allEtapas: etapas,
  } as unknown as BoardCard;
}

function makePost(id: number, status: string, titulo = `Post ${id}`) {
  return { id, workflow_id: 1, titulo, ordem: id, status, tipo: 'feed' };
}

function renderDrawer(card: BoardCard, onRefresh = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <WorkflowDrawer card={card} membros={[]} onClose={vi.fn()} onRefresh={onRefresh} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onRefresh };
}

describe('WorkflowDrawer rascunho banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.getWorkflowPostsWithProperties.mockResolvedValue([
      makePost(1, 'aprovado_cliente', 'post um'),
      makePost(2, 'aprovado_cliente'),
    ]);
    store.resolveWorkflowRascunhoBanner.mockResolvedValue(2);
  });

  it('shows the banner and dismisses with the exact ciclo string', async () => {
    renderDrawer(makeCard());
    expect(await screen.findByText('2 posts continuam aprovados.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    await waitFor(() =>
      expect(store.resolveWorkflowRascunhoBanner).toHaveBeenCalledWith(1, CICLO, false),
    );
    await waitFor(() => expect(screen.queryByText('2 posts continuam aprovados.')).toBeNull());
  });

  it('resets after confirmation', async () => {
    const { onRefresh } = renderDrawer(makeCard());
    await screen.findByText('2 posts continuam aprovados.');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar todos para rascunho' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar para rascunho' }));
    await waitFor(() =>
      expect(store.resolveWorkflowRascunhoBanner).toHaveBeenCalledWith(1, CICLO, true),
    );
    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Posts voltaram para rascunho.'),
    );
    expect(onRefresh).toHaveBeenCalled();
  });

  it('is absent when the dismissal is newer than the ciclo', async () => {
    renderDrawer(makeCard('2026-10-21T00:00:00+00:00'));
    await screen.findByText('post um');
    expect(screen.queryByText('2 posts continuam aprovados.')).toBeNull();
  });

  it('brings the banner back and toasts when the ciclo is stale', async () => {
    store.resolveWorkflowRascunhoBanner.mockRejectedValue(new Error('ciclo_changed'));
    const { onRefresh } = renderDrawer(makeCard());
    await screen.findByText('2 posts continuam aprovados.');
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Este aviso ficou desatualizado. Recarregue e confira.',
      ),
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(await screen.findByText('2 posts continuam aprovados.')).toBeInTheDocument();
  });
});
