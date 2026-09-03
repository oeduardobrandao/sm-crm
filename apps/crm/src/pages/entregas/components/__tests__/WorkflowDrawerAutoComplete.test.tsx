import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proves the drawer's approval auto-complete is really wired: the effect must observe the
 * awaiting -> aprovado_cliente transition on the posts query and complete the active approval
 * etapa through the re-arming advance path. The code this replaced was dead, so "the pure
 * transition rule and the store function are each tested" is not sufficient on its own.
 */

const store = vi.hoisted(() => ({
  getWorkflowPostsWithProperties: vi.fn(),
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  addWorkflowPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  removeWorkflowPost: vi.fn(),
  reorderWorkflowPosts: vi.fn(),
  sendPostsToCliente: vi.fn(),
  getPostApprovals: vi.fn().mockResolvedValue([]),
  getPostStatusEvents: vi.fn().mockResolvedValue([]),
  replyToPostApproval: vi.fn(),
  getPostCommentThreads: vi.fn().mockResolvedValue([]),
  createCommentThread: vi.fn(),
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
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  injectSignedUrls: (v: unknown) => v,
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
vi.mock('../ScheduleButton', () => ({ ScheduleButton: () => <div /> }));
vi.mock('../WorkflowCalendarView', () => ({ WorkflowCalendarView: () => <div /> }));
vi.mock('../DiffView', () => ({ DiffView: () => <div /> }));
vi.mock('../ReadOnlyTipTap', () => ({ ReadOnlyTipTap: () => <div /> }));
vi.mock('@/components/CopyPostLinkButton', () => ({ CopyPostLinkButton: () => <div /> }));
vi.mock('@/pages/estudio/ImportToEstudioDialog', () => ({ ImportToEstudioDialog: () => <div /> }));
vi.mock('@/components/ui/date-time-picker', () => ({ DateTimePicker: () => <div /> }));

import { WorkflowDrawer } from '../WorkflowDrawer';
import type { BoardCard } from '../../hooks/useEntregasData';

const approvalEtapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Aprovação da arte',
  prazo_dias: 2,
  tipo_prazo: 'corridos' as const,
  tipo: 'aprovacao_cliente' as const,
  status: 'ativo' as const,
};

const card = {
  workflow: { id: 1, cliente_id: 1, titulo: 'Posts Agosto', status: 'ativo', etapa_atual: 1 },
  etapa: approvalEtapa,
  cliente: undefined,
  membro: undefined,
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
  totalEtapas: 2,
  etapaIdx: 1,
  allEtapas: [approvalEtapa],
} as unknown as BoardCard;

function makePost(id: number, status: string, titulo = `Post ${id}`) {
  return { id, workflow_id: 1, titulo, ordem: id, status, tipo: 'feed' };
}

/**
 * The effect compares the previous rendered snapshot against the next one, so BOTH snapshots
 * have to be observed before asserting on the outcome:
 *
 * - waiting only on the query function having been *called* lets the refetch overwrite the
 *   first snapshot before it ever renders, leaving the effect with `prev === null`;
 * - asserting "did not fire" after a fixed sleep passes trivially if the refetch never landed,
 *   which is precisely the failure mode of the dead code this effect replaced.
 *
 * So every snapshot carries a DOM-visible marker title and we wait for it to render.
 */
async function waitForSnapshot(marker: string) {
  await screen.findByText(marker);
}

function renderDrawer(onRefresh = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const utils = render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <WorkflowDrawer card={card} membros={[]} onClose={vi.fn()} onRefresh={onRefresh} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, queryClient, onRefresh };
}

describe('WorkflowDrawer approval auto-complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'ativo' },
      etapas: [],
      rearmed: true,
      rearmFailed: false,
    });
  });

  it('completes the active approval etapa via the re-arming path when the last awaiting post is approved', async () => {
    store.getWorkflowPostsWithProperties
      .mockResolvedValueOnce([
        makePost(1, 'aprovado_cliente'),
        makePost(2, 'enviado_cliente', 'aguardando cliente'),
      ])
      .mockResolvedValue([
        makePost(1, 'aprovado_cliente'),
        makePost(2, 'aprovado_cliente', 'cliente aprovou'),
      ]);

    const { queryClient, onRefresh } = renderDrawer();
    await waitForSnapshot('aguardando cliente');
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();

    await queryClient.invalidateQueries({ queryKey: ['workflow-posts-with-props', 1] });
    await waitForSnapshot('cliente aprovou');

    await waitFor(() => expect(store.completeEtapaWithRearm).toHaveBeenCalledWith(1, 11));
    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Todos os posts aprovados — etapa concluída!'),
    );
    expect(toast.info).toHaveBeenCalledWith(
      'Posts voltaram para rascunho para o próximo ciclo de aprovação.',
    );
    expect(onRefresh).toHaveBeenCalled();
    expect(store.completeEtapa).not.toHaveBeenCalled();
  });

  it('does not fire on open when the cycle was already approved before the drawer opened', async () => {
    // Both snapshots are fully approved — only the marker title differs, so we can prove the
    // second one really rendered before asserting that nothing fired.
    store.getWorkflowPostsWithProperties
      .mockResolvedValueOnce([
        makePost(1, 'aprovado_cliente'),
        makePost(2, 'aprovado_cliente', 'ja aprovado'),
      ])
      .mockResolvedValue([
        makePost(1, 'aprovado_cliente'),
        makePost(2, 'aprovado_cliente', 'ainda aprovado'),
      ]);

    const { queryClient } = renderDrawer();
    await waitForSnapshot('ja aprovado');
    await queryClient.invalidateQueries({ queryKey: ['workflow-posts-with-props', 1] });

    await waitForSnapshot('ainda aprovado');
    expect(store.getWorkflowPostsWithProperties).toHaveBeenCalledTimes(2);
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();
  });

  it('does not fire while a post is still awaiting the client', async () => {
    // Post 1 gets approved, post 2 is still with the client → the cycle is not done.
    store.getWorkflowPostsWithProperties
      .mockResolvedValueOnce([
        makePost(1, 'enviado_cliente', 'ambos pendentes'),
        makePost(2, 'enviado_cliente'),
      ])
      .mockResolvedValue([
        makePost(1, 'aprovado_cliente', 'um aprovado'),
        makePost(2, 'enviado_cliente'),
      ]);

    const { queryClient } = renderDrawer();
    await waitForSnapshot('ambos pendentes');
    await queryClient.invalidateQueries({ queryKey: ['workflow-posts-with-props', 1] });

    await waitForSnapshot('um aprovado');
    expect(store.getWorkflowPostsWithProperties).toHaveBeenCalledTimes(2);
    expect(store.completeEtapaWithRearm).not.toHaveBeenCalled();
  });

  it('surfaces the manual-remediation toast when the advance succeeded but the re-arm failed', async () => {
    store.completeEtapaWithRearm.mockResolvedValue({
      workflow: { status: 'ativo' },
      etapas: [],
      rearmed: false,
      rearmFailed: true,
    });
    store.getWorkflowPostsWithProperties
      .mockResolvedValueOnce([makePost(1, 'correcao_cliente', 'correcao pedida')])
      .mockResolvedValue([makePost(1, 'aprovado_cliente', 'correcao aceita')]);

    const { queryClient, onRefresh } = renderDrawer();
    await waitForSnapshot('correcao pedida');
    await queryClient.invalidateQueries({ queryKey: ['workflow-posts-with-props', 1] });
    await waitForSnapshot('correcao aceita');

    const { toast } = await import('sonner');
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'A etapa avançou, mas não foi possível preparar os posts para o próximo ciclo de aprovação. Reinicie os status dos posts manualmente.',
      ),
    );
    expect(onRefresh).toHaveBeenCalled();
  });
});
