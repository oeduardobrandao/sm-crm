import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowTemplate } from '@/store/workflows';
import type { LinhaEditorial, LinhaItem } from '@/store/linhaEditorial';

const m = vi.hoisted(() => ({
  converterItens: vi.fn(),
  applyPostProcess: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  features: { feature_post_processes: true } as Record<string, boolean> | null,
}));

vi.mock('@/store/linhaEditorial', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/linhaEditorial')>()),
  converterItens: m.converterItens,
}));
vi.mock('@/store/postProcesses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/postProcesses')>()),
  applyPostProcess: m.applyPostProcess,
}));
vi.mock('@/store/workflows', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/workflows')>()),
  getWorkflowTemplates: m.getWorkflowTemplates,
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: m.features }),
}));
vi.mock('sonner', () => ({
  toast: { success: m.toastSuccess, warning: m.toastWarning, error: m.toastError },
}));

// Radix Select needs pointer-capture/scrollIntoView, which jsdom lacks (same stubs as
// ApplyProcessDialog.test.tsx).
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

import { CriarPostsDialog } from '../CriarPostsDialog';
import { LinhaSelectionBar } from '../LinhaSelectionBar';

const LINHA: LinhaEditorial = {
  id: 'l-1',
  conta_id: 'c1',
  cliente_id: 7,
  periodo: '2026-11-01',
  status: 'aprovada',
  enviada_at: null,
  enviada_por: null,
  decidida_at: null,
  rodada: 1,
};

const item = (n: number, tipo: LinhaItem['tipo'] = 'reels'): LinhaItem => ({
  id: `i${n}`,
  linha_id: 'l-1',
  data: `2026-11-0${n}`,
  tipo,
  titulo: `Post ${n}`,
  direcao: `Direção ${n}`,
  valores: {},
  ordem: n,
  post_id: null,
});

const template = (id: number, nome: string, modo: WorkflowTemplate['modo_prazo']) =>
  ({
    id,
    nome,
    modo_prazo: modo,
    etapas: [{ nome: 'Copy', prazo_dias: 2, tipo_prazo: 'corridos', tipo: 'padrao' }],
  }) as WorkflowTemplate;

function renderDialog(itens: LinhaItem[], over: { onVerPosts?: (id: number) => void } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  const onVerPosts = over.onVerPosts ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CriarPostsDialog
        open
        onOpenChange={onOpenChange}
        linha={LINHA}
        itens={itens}
        colunas={[]}
        onDone={onDone}
        onVerPosts={onVerPosts}
      />
    </QueryClientProvider>,
  );
  return { qc, invalidate, onOpenChange, onDone, onVerPosts };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.features = { feature_post_processes: true };
  m.getWorkflowTemplates.mockResolvedValue([]);
  m.converterItens.mockImplementation(async (_l: string, _w: null, posts: { item_id: string }[]) =>
    posts.map((p, i) => ({ item_id: p.item_id, post_id: 100 + i })),
  );
  m.applyPostProcess.mockResolvedValue({ ok: true });
});

describe('LinhaSelectionBar', () => {
  const itens = [1, 2, 3, 4, 5, 6].map((n) => item(n, 'reels'));

  it('bar shows breakdown "6 reels"', () => {
    render(
      <LinhaSelectionBar
        itens={itens}
        selected={itens.map((i) => i.id)}
        linhaStatus="aprovada"
        onCriarFluxo={vi.fn()}
        onCriarPosts={vi.fn()}
        onLimpar={vi.fn()}
      />,
    );
    const bar = screen.getByRole('toolbar', { name: 'Ações da seleção' });
    expect(within(bar).getByText('6 selecionados')).toBeInTheDocument();
    expect(within(bar).getByText('6 reels')).toBeInTheDocument();
  });

  it('approved linha creates without asking', async () => {
    const onCriarPosts = vi.fn();
    render(
      <LinhaSelectionBar
        itens={itens}
        selected={['i1']}
        linhaStatus="aprovada"
        onCriarFluxo={vi.fn()}
        onCriarPosts={onCriarPosts}
        onLimpar={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Criar posts individuais' }));
    expect(onCriarPosts).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('not-approved linha asks confirm', async () => {
    const onCriarPosts = vi.fn();
    const onCriarFluxo = vi.fn();
    render(
      <LinhaSelectionBar
        itens={itens}
        selected={['i1', 'i2']}
        linhaStatus="enviada"
        onCriarFluxo={onCriarFluxo}
        onCriarPosts={onCriarPosts}
        onLimpar={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Criar posts individuais' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(
        'Esta linha ainda não foi aprovada pelo cliente. Criar mesmo assim?',
      ),
    ).toBeInTheDocument();
    expect(onCriarPosts).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar mesmo assim' }));
    expect(onCriarPosts).toHaveBeenCalledTimes(1);
    expect(onCriarFluxo).not.toHaveBeenCalled();
  });

  it('Limpar clears the selection', async () => {
    const onLimpar = vi.fn();
    render(
      <LinhaSelectionBar
        itens={itens}
        selected={['i1']}
        linhaStatus="aprovada"
        onCriarFluxo={vi.fn()}
        onCriarPosts={vi.fn()}
        onLimpar={onLimpar}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(onLimpar).toHaveBeenCalledTimes(1);
  });
});

describe('CriarPostsDialog', () => {
  it('titles the dialog with the count', () => {
    renderDialog([item(1), item(2)]);
    expect(screen.getByRole('heading', { name: 'Criar 2 posts individuais' })).toBeInTheDocument();
  });

  it('process options hidden when feature_post_processes off', () => {
    m.features = { feature_post_processes: false };
    renderDialog([item(1)]);
    expect(screen.queryByText('Sem processo')).not.toBeInTheDocument();
    expect(screen.queryByText('Um processo por formato')).not.toBeInTheDocument();
    expect(m.getWorkflowTemplates).not.toHaveBeenCalled();
  });

  it('only padrao templates listed', async () => {
    m.getWorkflowTemplates.mockResolvedValue([
      template(1, 'Padrão Reels', 'padrao'),
      template(2, 'Data fixa', 'data_fixa'),
      template(3, 'Entrega', 'data_entrega'),
    ]);
    renderDialog([item(1, 'reels')]);
    await userEvent.click(screen.getByLabelText('Um processo por formato'));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Processo para Vídeo vertical' }));
    expect(await screen.findByRole('option', { name: 'Padrão Reels' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Data fixa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Entrega' })).not.toBeInTheDocument();
  });

  it('applies process per format sequentially and continues after template_changed', async () => {
    m.getWorkflowTemplates.mockResolvedValue([
      template(1, 'Padrão Reels', 'padrao'),
      template(2, 'Padrão Feed', 'padrao'),
    ]);
    const order: number[] = [];
    let inFlight = 0;
    m.applyPostProcess.mockImplementation(async ({ postId }: { postId: number }) => {
      expect(inFlight).toBe(0);
      inFlight++;
      order.push(postId);
      await new Promise((r) => setTimeout(r, 0));
      inFlight--;
      if (postId === 101) throw new Error('template_changed');
      return { ok: true };
    });
    const { onDone } = renderDialog([item(1, 'reels'), item(2, 'reels'), item(3, 'feed')]);
    await userEvent.click(screen.getByLabelText('Um processo por formato'));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Processo para Vídeo vertical' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Padrão Reels' }));
    fireEvent.click(screen.getByRole('combobox', { name: 'Processo para Imagem' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Padrão Feed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Criar 3 posts' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(m.converterItens).toHaveBeenCalledWith('l-1', null, expect.any(Array));
    expect(order).toEqual([100, 101, 102]);
    expect(m.applyPostProcess.mock.calls.map((c) => c[0].templateId)).toEqual([1, 1, 2]);
    expect(m.applyPostProcess.mock.calls[0][0]).toMatchObject({ startOrdem: 0 });
    expect(m.toastWarning).toHaveBeenCalledWith(
      '3 posts criados. 1 sem processo: aplique pelo post.',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Ver posts' }) }),
    );
    expect(m.toastSuccess).not.toHaveBeenCalled();
  });

  it('success toast offers "Ver posts" for the client', async () => {
    const onVerPosts = vi.fn();
    renderDialog([item(1), item(2)], { onVerPosts });
    await userEvent.click(screen.getByRole('button', { name: 'Criar 2 posts' }));
    await waitFor(() => expect(m.toastSuccess).toHaveBeenCalled());
    const [msg, opts] = m.toastSuccess.mock.calls[0];
    expect(msg).toBe('2 posts criados');
    expect(opts.action.label).toBe('Ver posts');
    opts.action.onClick();
    expect(onVerPosts).toHaveBeenCalledWith(7);
    expect(m.applyPostProcess).not.toHaveBeenCalled();
  });

  it('plan limit error toast uses mapEntitlementError', async () => {
    m.converterItens.mockRejectedValue({ message: 'plan_limit_exceeded:max_posts_per_workflow' });
    const { onDone, onOpenChange } = renderDialog([item(1)]);
    await userEvent.click(screen.getByRole('button', { name: 'Criar 1 post' }));
    await waitFor(() =>
      expect(m.toastError).toHaveBeenCalledWith(
        'Você atingiu o limite de posts por fluxo do seu plano.',
      ),
    );
    expect(onDone).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('success invalidates linha-itens', async () => {
    const { invalidate } = renderDialog([item(1)]);
    await userEvent.click(screen.getByRole('button', { name: 'Criar 1 post' }));
    await waitFor(() => expect(m.toastSuccess).toHaveBeenCalled());
    const keys = invalidate.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(['linha-itens', 'l-1']);
    expect(keys).toContainEqual(['linha-posts', 'l-1']);
    expect(keys).toContainEqual(['linha-origem']);
    expect(keys).toContainEqual(['linha', '2026-11-01']);
  });
});
