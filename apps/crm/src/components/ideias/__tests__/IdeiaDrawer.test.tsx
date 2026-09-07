import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Hoisted so the vi.mock factories below (which run before this file's own top-level
// statements, per Vitest's mock-hoisting) can close over them.
const {
  convertSolicitacaoEmTarefaMock,
  setTarefaTagsMock,
  toastSuccessMock,
  toastWarningMock,
  toastErrorMock,
  stubState,
  mockUseAuth,
} = vi.hoisted(() => ({
  convertSolicitacaoEmTarefaMock: vi.fn(),
  setTarefaTagsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarningMock: vi.fn(),
  toastErrorMock: vi.fn(),
  stubState: { result: null as string | null },
  mockUseAuth: vi.fn(() => ({ profile: { id: 'u1' }, can: () => true })),
}));

vi.mock('@/services/ideiaMedia', () => ({
  listIdeiaImages: vi.fn().mockResolvedValue([]),
  uploadIdeiaImage: vi.fn(),
  removeIdeiaImage: vi.fn(),
}));
vi.mock('@/store', () => ({
  updateIdeiaStatus: vi.fn(),
  upsertIdeiaComentario: vi.fn(),
  toggleIdeiaReaction: vi.fn(),
  getMembros: vi.fn().mockResolvedValue([]),
  getClientes: vi.fn().mockResolvedValue([]),
  getTarefaTags: vi.fn().mockResolvedValue([]),
  setTarefaTags: setTarefaTagsMock,
  convertSolicitacaoEmTarefa: convertSolicitacaoEmTarefaMock,
}));
vi.mock('sonner', () => ({
  toast: { success: toastSuccessMock, warning: toastWarningMock, error: toastErrorMock },
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: mockUseAuth }));

// Stubs the real form: it renders two buttons that invoke the drawer's onCreate prop
// (handleConvertCreate) directly, one with no tags and one with tags, and records
// whether the returned promise resolved or rejected so tests can assert on the
// RPC -> tags -> invalidate -> toast pipeline without driving Radix's real Dialog/Select
// through jsdom (already covered for the dialog itself in TarefaFormDialog.test.tsx).
vi.mock('@/pages/tarefas/components/TarefaFormDialog', () => ({
  TarefaFormDialog: ({
    open,
    onCreate,
  }: {
    open: boolean;
    onCreate?: (
      payload: {
        titulo: string;
        descricao: string | null;
        status: 'pendente' | 'em_andamento' | 'concluida';
        responsavel_id: number | null;
        cliente_id: number | null;
        data_limite: string | null;
      },
      tagIds: number[],
    ) => Promise<void>;
  }) => {
    if (!open || !onCreate) return null;
    const payload = {
      titulo: 'Nova tarefa',
      descricao: null,
      status: 'pendente' as const,
      responsavel_id: 5,
      cliente_id: 7,
      data_limite: null,
    };
    const submit = (tagIds: number[]) => {
      onCreate(payload, tagIds)
        .then(() => {
          stubState.result = 'resolved';
        })
        .catch((e: unknown) => {
          stubState.result = `rejected:${e instanceof Error ? e.message : String(e)}`;
        });
    };
    return (
      <div data-testid="tarefa-form-dialog-stub">
        <button onClick={() => submit([])}>submit-no-tags</button>
        <button onClick={() => submit([3])}>submit-with-tags</button>
      </div>
    );
  },
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IdeiaDrawer } from '../IdeiaDrawer';

function renderDrawer(ideia: Record<string, unknown>, client?: QueryClient) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IdeiaDrawer ideia={ideia as never} queryKey={['x']} onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BASE = {
  id: 'i1',
  workspace_id: 'w1',
  cliente_id: 7,
  titulo: 'Trocar arte',
  descricao: 'desc',
  links: [],
  comentario_agencia: null,
  comentario_autor_id: null,
  comentario_at: null,
  created_at: '2026-07-30T12:00:00Z',
  updated_at: '2026-07-30T12:00:00Z',
  clientes: { nome: 'Cliente Sete' },
  comentario_autor: null,
  ideia_reactions: [],
  image_count: 0,
};

beforeEach(() => {
  stubState.result = null;
});

describe('IdeiaDrawer conversion UI', () => {
  it('shows the convert button for an eligible solicitacao', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null });
    expect(screen.getByRole('button', { name: /converter em tarefa/i })).toBeInTheDocument();
  });

  it('hides the convert button for tipo=ideia', () => {
    renderDrawer({ ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null });
    expect(screen.queryByRole('button', { name: /converter em tarefa/i })).not.toBeInTheDocument();
  });

  it('hides the convert button for a discarded solicitacao', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'descartada', tarefa_id: null });
    expect(screen.queryByRole('button', { name: /converter em tarefa/i })).not.toBeInTheDocument();
  });

  it('locks manual status and links to the task once converted', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'convertida', tarefa_id: 42 });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: /ver tarefa/i });
    expect(link).toHaveAttribute('href', '/tarefas?tarefa=42');
  });

  it('reopens manual status for an orphaned converted solicitacao', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'convertida', tarefa_id: null });
    const combobox = screen.getByRole('combobox');
    expect(combobox).toBeInTheDocument();
    expect(combobox).toHaveTextContent('Selecionar status...');
    expect(combobox).not.toHaveTextContent('Nova');
  });
});

describe('IdeiaDrawer handleConvertCreate', () => {
  it('calls the RPC, invalidates both query keys, and shows a success toast on a clean conversion', async () => {
    convertSolicitacaoEmTarefaMock.mockResolvedValueOnce(99);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null }, qc);
    fireEvent.click(screen.getByRole('button', { name: /converter em tarefa/i }));
    // Not getByRole: the mocked TarefaFormDialog is a plain <div>, not a real Radix Dialog,
    // so Radix's "hide other layers" behavior (triggered by the still-open Sheet) marks it
    // aria-hidden and role queries would exclude it. Text queries ignore aria-hidden.
    fireEvent.click(await screen.findByText('submit-no-tags'));

    await waitFor(() => expect(stubState.result).toBe('resolved'));

    expect(convertSolicitacaoEmTarefaMock).toHaveBeenCalledWith({
      ideiaId: 'i1',
      titulo: 'Nova tarefa',
      descricao: null,
      responsavelId: 5,
      dataLimite: null,
    });
    expect(setTarefaTagsMock).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['x'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tarefas'] });
    expect(toastSuccessMock).toHaveBeenCalledWith('Solicitação convertida em tarefa!');
    expect(toastWarningMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('still invalidates and shows a warning toast (not success) when the RPC succeeds but tags fail', async () => {
    convertSolicitacaoEmTarefaMock.mockResolvedValueOnce(100);
    setTarefaTagsMock.mockRejectedValueOnce(new Error('tags down'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null }, qc);
    fireEvent.click(screen.getByRole('button', { name: /converter em tarefa/i }));
    fireEvent.click(await screen.findByText('submit-with-tags'));

    await waitFor(() => expect(stubState.result).toBe('resolved'));

    expect(setTarefaTagsMock).toHaveBeenCalledWith(100, [3]);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['x'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tarefas'] });
    expect(toastWarningMock).toHaveBeenCalledWith(
      'Tarefa criada, mas as tags não foram aplicadas. Edite a tarefa para adicioná-las.',
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('propagates the error and skips invalidation/toasts when the conversion RPC itself fails', async () => {
    convertSolicitacaoEmTarefaMock.mockRejectedValueOnce(new Error('RPC fail'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null }, qc);
    fireEvent.click(screen.getByRole('button', { name: /converter em tarefa/i }));
    fireEvent.click(await screen.findByText('submit-no-tags'));

    // handleConvertCreate must not swallow the rejection: the dialog (the real one, not
    // this stub) is what owns the error toast and stays open on failure.
    await waitFor(() => expect(stubState.result).toBe('rejected:RPC fail'));

    expect(setTarefaTagsMock).not.toHaveBeenCalled();
    expect(invalidateSpy).not.toHaveBeenCalled();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(toastWarningMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});

/**
 * Task 14: IdeiaDrawer (the actual mutation surface behind IdeiasPage.tsx,
 * which is itself a read-only list) had NO role check at all before this
 * task -- any authenticated member could add or remove an idea's reference
 * images. AGENT_ROLE_PRESET.ideias is 'editar' (lib/permissions.ts), so
 * gating on `can('ideias', 'editar') === true` preserves that for every
 * legacy chassis role byte-for-byte; only a CUSTOM role (role_id set) can
 * now differ from full access.
 */
describe('IdeiaDrawer — image add/remove gated on ideias:editar', () => {
  it('keeps a legacy agent unrestricted: the ideias:editar preset grants Adicionar imagem', async () => {
    mockUseAuth.mockReturnValue({
      profile: { id: 'u1' },
      can: makeCan(fakeMembership({ role: 'agent' })),
    });
    renderDrawer({ ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null });

    expect(await screen.findByRole('button', { name: /adicionar imagem/i })).toBeInTheDocument();
  });

  it('hides Adicionar imagem for a custom role without ideias:editar', async () => {
    mockUseAuth.mockReturnValue({
      profile: { id: 'u1' },
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderDrawer({ ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null });

    await screen.findByText('Trocar arte');
    expect(screen.queryByRole('button', { name: /adicionar imagem/i })).not.toBeInTheDocument();
  });

  it('shows Adicionar imagem for a custom role with ideias:editar (the fix)', async () => {
    mockUseAuth.mockReturnValue({
      profile: { id: 'u1' },
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { ideias: 'editar' } }),
      ),
    });
    renderDrawer({ ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null });

    expect(await screen.findByRole('button', { name: /adicionar imagem/i })).toBeInTheDocument();
  });

  it('hides Remover imagem for a custom role without ideias:editar, even with existing images', async () => {
    const { listIdeiaImages } = await import('@/services/ideiaMedia');
    vi.mocked(listIdeiaImages).mockResolvedValueOnce([
      { file_id: 1, url: 'https://x/1.png', thumbnail_url: null },
    ] as never);
    mockUseAuth.mockReturnValue({
      profile: { id: 'u1' },
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderDrawer({ ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null });

    await screen.findByAltText('');
    expect(screen.queryByLabelText('Remover imagem')).not.toBeInTheDocument();
  });
});
