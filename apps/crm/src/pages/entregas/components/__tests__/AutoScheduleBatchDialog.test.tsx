import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the file's own top-level statements, but
// module imports are hoisted above THAT — so the component under test imports
// 'sonner' (via the factory below) before a plain `const toastSuccess = vi.fn()`
// would have run, throwing a TDZ ReferenceError. `vi.hoisted` runs before the
// import graph resolves, avoiding it (same pattern as the sibling
// AutoSchedulePromptDialog.test.tsx).
const { toastSuccess, toastError, getWorkflowPosts, scheduleApprovedPost } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  getWorkflowPosts: vi.fn(),
  scheduleApprovedPost: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError, info: vi.fn() } }));
vi.mock('@/store', () => ({ getWorkflowPosts }));
vi.mock('../../scheduleApprovedPost', () => ({
  scheduleApprovedPost,
  scheduleSuccessMessage: () => 'Post agendado para publicação no Instagram',
}));

import { AutoScheduleBatchDialog } from '../AutoScheduleBatchDialog';

const future = (h: number) => new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

const wrap = (ui: React.ReactElement) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

describe('AutoScheduleBatchDialog', () => {
  beforeEach(() => {
    getWorkflowPosts.mockReset();
    scheduleApprovedPost.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    scheduleApprovedPost.mockResolvedValue({ ok: true, status: 'agendado' });
  });

  it('renders nothing when workflowId is null and never fetches', () => {
    const { container } = wrap(
      <AutoScheduleBatchDialog
        workflowId={null}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(getWorkflowPosts).not.toHaveBeenCalled();
  });

  it('counts only aprovado_cliente posts, split by date eligibility', async () => {
    getWorkflowPosts.mockResolvedValue([
      {
        id: 1,
        titulo: 'A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(3),
      },
      { id: 2, titulo: 'B', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: null },
      {
        id: 3,
        titulo: 'C',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: past(),
      },
      { id: 4, titulo: 'D', status: 'agendado', platform: 'instagram', scheduled_at: future(5) },
      { id: 5, titulo: 'E', status: 'rascunho', platform: 'instagram', scheduled_at: future(5) },
    ]);
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    // 3 aprovado_cliente, of which 1 is eligible
    await waitFor(() => expect(screen.getByText(/3 posts aprovados/)).toBeInTheDocument());
    expect(screen.getByText(/1 já tem data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agendar 1 post/ })).toBeEnabled();
    // The two that cannot go are listed by name.
    expect(screen.getByText(/B/)).toBeInTheDocument();
    expect(screen.getByText(/C/)).toBeInTheDocument();
  });

  it('schedules every eligible post and reports the counts', async () => {
    getWorkflowPosts.mockResolvedValue([
      {
        id: 1,
        titulo: 'A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(3),
      },
      {
        id: 2,
        titulo: 'B',
        status: 'aprovado_cliente',
        platform: 'tiktok',
        scheduled_at: future(4),
      },
    ]);
    const onScheduled = vi.fn();
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={onScheduled}
      />,
    );
    const btn = await screen.findByRole('button', { name: /Agendar 2 posts/ });
    fireEvent.click(btn);
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(2));
    expect(scheduleApprovedPost).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 1 }));
    expect(scheduleApprovedPost).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 2 }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2 posts agendados.'));
    expect(onScheduled).toHaveBeenCalled();
  });

  it('a failure in the loop does not stop the rest and is reported', async () => {
    getWorkflowPosts.mockResolvedValue([
      {
        id: 1,
        titulo: 'A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(3),
      },
      {
        id: 2,
        titulo: 'B',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(4),
      },
    ]);
    scheduleApprovedPost
      .mockRejectedValueOnce(new Error('Legenda do Instagram não definida.'))
      .mockResolvedValueOnce({ ok: true, status: 'agendado' });
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Agendar 2 posts/ }));
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('1 post agendado, 1 falhou.'));
  });

  it('closes itself when the fluxo has no aprovado_cliente post left', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 9, titulo: 'X', status: 'agendado', platform: 'instagram', scheduled_at: future(5) },
    ]);
    const onClose = vi.fn();
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={onClose}
        onScheduled={vi.fn()}
      />,
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // Decisão 5 da spec, aplicada por post: tiktok-publish/handler.ts:85-89 exige
  // feature_tiktok. Sem o add-on, um post tiktok/both com data válida NÃO é
  // elegível -- mas fix C da revisão final: ele tem data válida, então cai num
  // balde PRÓPRIO ("Bloqueado: requer o recurso do TikTok."), não no de
  // "sem data válida" (que seria literalmente falso para ele).
  it('moves tiktok and both posts into their own TikTok-blocked bucket when feature_tiktok is off', async () => {
    getWorkflowPosts.mockResolvedValue([
      {
        id: 1,
        titulo: 'A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(3),
      },
      {
        id: 2,
        titulo: 'B',
        status: 'aprovado_cliente',
        platform: 'tiktok',
        scheduled_at: future(4),
      },
      { id: 3, titulo: 'C', status: 'aprovado_cliente', platform: 'both', scheduled_at: future(5) },
    ]);
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled={false}
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    // 3 aprovados, mas só o de Instagram é agendável.
    await waitFor(() => expect(screen.getByText(/3 posts aprovados/)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Agendar 1 post/ })).toBeEnabled();
    // Nem post B nem C têm "sem data válida" -- os dois têm data futura válida,
    // só estão bloqueados pelo feature flag do TikTok.
    expect(screen.queryByText(/Sem data válida, agende manualmente/)).not.toBeInTheDocument();
    expect(screen.getByText(/Bloqueado.*requer o recurso do TikTok/)).toBeInTheDocument();
    // Exact matches -- a regex substring like /B/ or /C/ would also match the
    // new "Bloqueado" heading itself.
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  // Fix C: as duas causas (sem data vs. bloqueado por TikTok) coexistem e
  // rendem duas seções distintas quando ambas têm posts.
  it('renders both the missing-date and the TikTok-blocked sections when both are non-empty', async () => {
    getWorkflowPosts.mockResolvedValue([
      {
        id: 1,
        titulo: 'A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(3),
      },
      { id: 2, titulo: 'B', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: null },
      {
        id: 3,
        titulo: 'C',
        status: 'aprovado_cliente',
        platform: 'tiktok',
        scheduled_at: future(4),
      },
    ]);
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled={false}
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/3 posts aprovados/)).toBeInTheDocument());
    expect(screen.getByText(/Sem data válida, agende manualmente/)).toBeInTheDocument();
    expect(screen.getByText(/Bloqueado.*requer o recurso do TikTok/)).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('schedules tiktok and both posts normally when feature_tiktok is on', async () => {
    getWorkflowPosts.mockResolvedValue([
      {
        id: 2,
        titulo: 'B',
        status: 'aprovado_cliente',
        platform: 'tiktok',
        scheduled_at: future(4),
      },
      { id: 3, titulo: 'C', status: 'aprovado_cliente', platform: 'both', scheduled_at: future(5) },
    ]);
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Agendar 2 posts/ }));
    await waitFor(() => expect(scheduleApprovedPost).toHaveBeenCalledTimes(2));
  });

  // A trava contra agir sobre dados velhos: com staleTime 0, toda reabertura
  // refetcha, e o botão fica travado enquanto isso está em voo.
  it('keeps the action disabled while the posts are being refetched', async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    getWorkflowPosts.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    // Enquanto a busca não resolve, `approved`/`eligible` ainda estão vazios --
    // fix D da revisão: o botão fica OMITIDO por inteiro (não só desabilitado),
    // já que eligible.length é 0 até a busca resolver.
    expect(screen.queryByRole('button', { name: /Agendar/ })).not.toBeInTheDocument();
    resolveFetch([
      {
        id: 1,
        titulo: 'A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(3),
      },
    ]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Agendar 1 post/ })).toBeEnabled(),
    );
  });

  // Fix D: nada elegível mesmo depois de resolver (tudo sem data ou bloqueado
  // por TikTok) -> nenhum "Agendar 0 posts" morto, o botão simplesmente não
  // existe -- só "Agora não" no rodapé.
  it('hides the schedule button entirely when nothing ends up eligible', async () => {
    getWorkflowPosts.mockResolvedValue([
      { id: 1, titulo: 'A', status: 'aprovado_cliente', platform: 'instagram', scheduled_at: null },
    ]);
    wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText(/1 post aprovado/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Agendar/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Agora não/ })).toBeInTheDocument();
  });

  // Fix B: o diálogo passa a ter seu próprio gate de segurança (espelho do
  // PR#400) -- não só confiar que os três callers já checaram antes de setar
  // workflowId. Sem ele, um quarto caller futuro (ou um refactor de willRearm)
  // poderia reabrir exatamente a falha do PR#400 sem nada no próprio
  // componente para impedir.
  it('renders nothing when isFinalApprovalCycle is false, even with a workflowId set', () => {
    getWorkflowPosts.mockResolvedValue([
      {
        id: 1,
        titulo: 'A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: future(3),
      },
    ]);
    const { container } = wrap(
      <AutoScheduleBatchDialog
        workflowId={7}
        tiktokFeatureEnabled
        isFinalApprovalCycle={false}
        onClose={vi.fn()}
        onScheduled={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
