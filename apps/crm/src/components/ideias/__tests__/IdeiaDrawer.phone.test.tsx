// IdeiaDrawer's phone branch: a pushed screen (PLAN F2c, FIdeiaDetalhe) inside the shell
// below 768px. Same mocks as IdeiaDrawer.test.tsx, rendered inside PhoneLayoutProvider.
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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
  updateVisMock,
  deleteIdeiaMock,
  fetchAudioMock,
  limitsState,
} = vi.hoisted(() => ({
  convertSolicitacaoEmTarefaMock: vi.fn(),
  setTarefaTagsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastWarningMock: vi.fn(),
  toastErrorMock: vi.fn(),
  stubState: { result: null as string | null },
  mockUseAuth: vi.fn(() => ({ profile: { id: 'u1' }, can: () => true })),
  updateVisMock: vi.fn(),
  deleteIdeiaMock: vi.fn(),
  fetchAudioMock: vi.fn().mockResolvedValue({ audio: null, transcript: null }),
  limitsState: {
    features: { feature_briefing_audio: true } as { feature_briefing_audio: boolean },
  },
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
  updateIdeiaVisibilidade: updateVisMock,
  deleteIdeia: deleteIdeiaMock,
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
vi.mock('@/hooks/useCurrentMembro', () => ({
  useCurrentMembro: () => ({ membro: { id: 9, nome: 'Eduardo' }, isLoading: false }),
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: limitsState.features, isLoading: false }),
}));
vi.mock('@/services/ideiaAudio', () => ({
  fetchIdeiaAudio: fetchAudioMock,
  uploadIdeiaAudio: vi.fn(),
  retryIdeiaTranscription: vi.fn(),
  deleteIdeiaAudio: vi.fn(),
}));
// Same fakes as Task 11 (NovaIdeiaDialog.test.tsx); sendLabel defaults to 'Enviar' here
// because IdeiaAudioSection never passes one, matching the real AudioRecorder's default.
vi.mock('@mesaas/ui/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  AudioRecorder: ({
    onRecorded,
    sendLabel = 'Enviar',
  }: {
    onRecorded: (b: Blob, m: string, s: number) => Promise<void>;
    sendLabel?: string;
  }) => (
    <button
      type="button"
      onClick={() => void onRecorded(new Blob(['abc'], { type: 'audio/webm' }), 'audio/webm', 5)}
    >
      {`fake-recorder:${sendLabel}`}
    </button>
  ),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: () => <div data-testid="audio-player" />,
}));

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
import { PhoneLayoutProvider } from '@/components/layout/PhoneLayoutContext';
import { updateIdeiaStatus, toggleIdeiaReaction } from '@/store';

function renderDrawer(
  ideia: Record<string, unknown>,
  initialAction?: 'responder' | 'converter',
  overrides: { onClose?: () => void; onEdit?: () => void } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PhoneLayoutProvider isPhone>
          <IdeiaDrawer
            ideia={ideia as never}
            queryKey={['x']}
            onClose={overrides.onClose ?? (() => {})}
            onEdit={overrides.onEdit}
            initialAction={initialAction}
          />
        </PhoneLayoutProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const BASE = {
  id: 'i1',
  workspace_id: 'w1',
  cliente_id: 7,
  titulo: 'Trocar arte',
  descricao: 'Queremos um carrossel com 3 fotos.',
  links: ['https://exemplo.com/ref'],
  comentario_agencia: null,
  comentario_autor_id: null,
  comentario_at: null,
  created_at: '2026-07-30T12:00:00Z',
  updated_at: '2026-07-30T12:00:00Z',
  clientes: { nome: 'Cliente Sete' },
  comentario_autor: null,
  ideia_reactions: [],
  image_count: 0,
  origem: 'cliente' as const,
  autor: null,
  visivel_no_hub: true,
  audio_r2_key: null,
  audio_duration_seconds: null,
  audio_transcript: null,
  audio_transcription_status: null,
};

function makeIdeia(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null, ...overrides };
}

beforeEach(() => {
  stubState.result = null;
  deleteIdeiaMock.mockReset();
  updateVisMock.mockReset();
  vi.mocked(updateIdeiaStatus)
    .mockReset()
    .mockResolvedValue(undefined as never);
  vi.mocked(toggleIdeiaReaction)
    .mockReset()
    .mockResolvedValue(undefined as never);
  fetchAudioMock.mockReset().mockResolvedValue({ audio: null, transcript: null });
  mockUseAuth.mockReturnValue({ profile: { id: 'u1' }, can: () => true });
});

describe('IdeiaDrawer on phones', () => {
  it('renders a pushed screen with a nav bar, not the right Sheet', async () => {
    renderDrawer(makeIdeia());
    const screenEl = await screen.findByRole('region', { name: 'Ideia: Trocar arte' });
    expect(screenEl).toHaveClass('phone-editor-screen');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Trocar arte' })).toBeInTheDocument();
    expect(screen.getByText(/Cliente Sete ·/)).toBeInTheDocument();
    expect(screen.getByText('Queremos um carrossel com 3 fotos.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://exemplo.com/ref' })).toHaveAttribute(
      'target',
      '_blank',
    );
  });

  it('Voltar closes the screen through onClose', async () => {
    const onClose = vi.fn();
    renderDrawer(makeIdeia(), undefined, { onClose });
    fireEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('changes the status from the status pill through a picker sheet', async () => {
    renderDrawer(makeIdeia({ status: 'em_analise' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Status: Em análise. Trocar status' }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Status' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Aprovada' }));
    await waitFor(() => expect(updateIdeiaStatus).toHaveBeenCalledWith('i1', 'aprovada'));
  });

  it('locks the status and offers Ver tarefa once converted', async () => {
    renderDrawer(makeIdeia({ tipo: 'solicitacao', status: 'convertida', tarefa_id: 42 }));
    await screen.findByText('Trocar arte');
    expect(screen.queryByRole('button', { name: /Trocar status/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver tarefa' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Converter em tarefa' })).not.toBeInTheDocument();
  });

  it('puts Converter em tarefa in the bottom bar for an eligible solicitacao', async () => {
    renderDrawer(makeIdeia({ tipo: 'solicitacao', status: 'nova' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Converter em tarefa' }));
    expect(await screen.findByTestId('tarefa-form-dialog-stub')).toBeInTheDocument();
  });

  it('offers Editar and Excluir in the "…" menu, Editar closing first and then calling onEdit', async () => {
    const onEdit = vi.fn();
    renderDrawer(makeIdeia({ origem: 'agencia' }), undefined, { onEdit });
    fireEvent.click(await screen.findByRole('button', { name: 'Mais ações da ideia' }));
    const menu = await screen.findByRole('dialog', { name: 'Ações da ideia' });
    expect(within(menu).getByRole('button', { name: 'Excluir' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: 'Editar' }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
  });

  it('deletes after the confirm sheet and closes the screen', async () => {
    deleteIdeiaMock.mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderDrawer(makeIdeia(), undefined, { onClose });
    fireEvent.click(await screen.findByRole('button', { name: 'Mais ações da ideia' }));
    const menu = await screen.findByRole('dialog', { name: 'Ações da ideia' });
    // No Editar for a client-submitted ideia.
    expect(within(menu).queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: 'Excluir' }));
    const confirm = await screen.findByRole('dialog', { name: 'Excluir ideia?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir ideia' }));
    await waitFor(() => expect(deleteIdeiaMock).toHaveBeenCalledWith('i1'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('can confirm again after a failed delete', async () => {
    deleteIdeiaMock.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const onClose = vi.fn();
    renderDrawer(makeIdeia(), undefined, { onClose });
    for (let attempt = 0; attempt < 2; attempt++) {
      fireEvent.click(await screen.findByRole('button', { name: 'Mais ações da ideia' }));
      const menu = await screen.findByRole('dialog', { name: 'Ações da ideia' });
      fireEvent.click(within(menu).getByRole('button', { name: 'Excluir' }));
      const confirm = await screen.findByRole('dialog', { name: 'Excluir ideia?' });
      fireEvent.click(within(confirm).getByRole('button', { name: 'Excluir ideia' }));
      await waitFor(() => expect(deleteIdeiaMock).toHaveBeenCalledTimes(attempt + 1));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    }
    expect(toastErrorMock).toHaveBeenCalledWith('boom');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('hides the "…" menu for a custom role without ideias:editar', async () => {
    mockUseAuth.mockReturnValue({
      profile: { id: 'u1' },
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderDrawer(makeIdeia({ origem: 'agencia' }), undefined, { onEdit: vi.fn() });
    await screen.findByText('Trocar arte');
    expect(screen.queryByRole('button', { name: 'Mais ações da ideia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar imagem' })).not.toBeInTheDocument();
  });

  it('shows the Hub visibility switch only on agency ideias', async () => {
    updateVisMock.mockResolvedValue(undefined);
    renderDrawer(makeIdeia({ origem: 'agencia', visivel_no_hub: false }));
    const sw = await screen.findByRole('switch', { name: 'Visível no Hub do cliente' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/Oculta do Hub/)).toBeInTheDocument();
    fireEvent.click(sw);
    await waitFor(() => expect(updateVisMock).toHaveBeenCalledWith('i1', true));
  });

  it('toggles a reaction with 44px pills', async () => {
    renderDrawer(makeIdeia());
    fireEvent.click(await screen.findByRole('button', { name: 'Reagir com 🔥' }));
    await waitFor(() => expect(toggleIdeiaReaction).toHaveBeenCalledWith('i1', 9, '🔥'));
  });

  it('focuses the agency response for initialAction="responder"', async () => {
    renderDrawer(makeIdeia(), 'responder');
    const field = await screen.findByLabelText('Resposta da agência');
    await waitFor(() => expect(field).toHaveFocus());
  });
});
