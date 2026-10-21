import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
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

function renderDrawer(
  ideia: Record<string, unknown>,
  client?: QueryClient,
  initialAction?: 'responder' | 'converter',
  overrides: { onClose?: () => void; onEdit?: () => void } = {},
) {
  const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <IdeiaDrawer
          ideia={ideia as never}
          queryKey={['x']}
          onClose={overrides.onClose ?? (() => {})}
          onEdit={overrides.onEdit}
          initialAction={initialAction}
        />
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
  origem: 'cliente' as const,
  autor: null,
  visivel_no_hub: true,
  audio_r2_key: null,
  audio_duration_seconds: null,
  audio_transcript: null,
  audio_transcription_status: null,
};

function makeIdeia(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE,
    tipo: 'ideia',
    status: 'nova',
    tarefa_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  stubState.result = null;
  updateVisMock.mockReset();
  deleteIdeiaMock.mockReset();
  fetchAudioMock.mockReset().mockResolvedValue({ audio: null, transcript: null });
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

describe('IdeiaDrawer initialAction shortcut', () => {
  it('does not change behavior when initialAction is omitted (existing call sites)', () => {
    renderDrawer({ ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null });
    expect(
      screen.queryByPlaceholderText('Escreva uma resposta para o cliente...'),
    ).not.toHaveFocus();
    expect(screen.queryByTestId('tarefa-form-dialog-stub')).not.toBeInTheDocument();
  });

  it('focuses the agency-response field on mount for initialAction="responder"', () => {
    renderDrawer(
      { ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null },
      undefined,
      'responder',
    );
    expect(screen.getByPlaceholderText('Escreva uma resposta para o cliente...')).toHaveFocus();
  });

  it('opens the convert flow on mount for initialAction="converter" on an eligible solicitacao', () => {
    renderDrawer(
      { ...BASE, tipo: 'solicitacao', status: 'nova', tarefa_id: null },
      undefined,
      'converter',
    );
    expect(screen.getByTestId('tarefa-form-dialog-stub')).toBeInTheDocument();
  });

  it('ignores initialAction="converter" when the idea is not convertible', () => {
    renderDrawer(
      { ...BASE, tipo: 'ideia', status: 'nova', tarefa_id: null },
      undefined,
      'converter',
    );
    expect(screen.queryByTestId('tarefa-form-dialog-stub')).not.toBeInTheDocument();
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

describe('IdeiaDrawer — origem, visibilidade e áudio', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ profile: { id: 'u1' }, can: () => true });
    limitsState.features = { feature_briefing_audio: true };
  });

  it('shows origin badge, author line and the visibility switch only for agency ideias', async () => {
    renderDrawer(
      makeIdeia({ origem: 'agencia', autor: { nome: 'Eduardo' }, visivel_no_hub: false }),
    );
    expect(await screen.findByText('Agência')).toBeInTheDocument();
    expect(screen.getByText(/por Eduardo/)).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /visível no hub/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(updateVisMock).toHaveBeenCalledWith('i1', true));

    cleanup();
    renderDrawer(makeIdeia({ origem: 'cliente' }));
    expect(await screen.findByText('Cliente')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /visível no hub/i })).toBeNull();
  });

  it('renders the audio section with player, status and transcript; write actions only on agency ideias', async () => {
    fetchAudioMock.mockResolvedValue({
      audio: {
        url: 'https://get/a.webm',
        mime: 'audio/webm',
        duration_seconds: 9,
        transcription_status: 'done',
        recorded_at: null,
      },
      transcript: 'Texto transcrito',
    });
    renderDrawer(
      makeIdeia({
        origem: 'cliente',
        audio_r2_key: 'ideia-audio/c/i/a.webm',
        audio_transcription_status: 'done',
        audio_transcript: 'Texto transcrito',
      }),
    );
    expect(await screen.findByTestId('audio-player')).toBeInTheDocument();
    expect(screen.getByText('Transcrito')).toBeInTheDocument();
    expect(screen.getByText('Texto transcrito')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover áudio' })).toBeNull();
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();

    cleanup();
    renderDrawer(
      makeIdeia({
        origem: 'agencia',
        audio_r2_key: 'ideia-audio/c/i/a.webm',
        audio_transcription_status: 'failed',
      }),
    );
    expect(await screen.findByText('Falha na transcrição')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover áudio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gravar novamente' })).toBeInTheDocument();
  });

  it('keeps remove available (but hides recorder/retry) on an agency ideia when the plan lacks audio', async () => {
    limitsState.features = { feature_briefing_audio: false };
    renderDrawer(
      makeIdeia({
        origem: 'agencia',
        audio_r2_key: 'ideia-audio/c/i/a.webm',
        audio_transcription_status: 'failed',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Remover áudio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Gravar novamente' })).toBeNull();
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
  });

  it('offers the recorder on an agency ideia without audio', async () => {
    renderDrawer(makeIdeia({ origem: 'agencia' }));
    expect(await screen.findByRole('button', { name: 'fake-recorder:Enviar' })).toBeInTheDocument();
  });
});

describe('IdeiaDrawer — editar e excluir', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ profile: { id: 'u1' }, can: () => true });
  });

  it('shows Editar only for an agencia ideia, calling onEdit when clicked', async () => {
    const onEdit = vi.fn();
    renderDrawer(makeIdeia({ origem: 'agencia' }), undefined, undefined, { onEdit });
    const editar = await screen.findByRole('button', { name: 'Editar' });
    fireEvent.click(editar);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('hides Editar for a client-submitted ideia even with ideias:editar', async () => {
    const onEdit = vi.fn();
    renderDrawer(makeIdeia({ origem: 'cliente' }), undefined, undefined, { onEdit });
    await screen.findByText('Trocar arte');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('hides Editar when the caller has no onEdit to offer (e.g. the cliente-detalhe hub tab)', async () => {
    renderDrawer(makeIdeia({ origem: 'agencia' }));
    await screen.findByText('Trocar arte');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('hides both Editar and Excluir for a custom role without ideias:editar', async () => {
    mockUseAuth.mockReturnValue({
      profile: { id: 'u1' },
      can: makeCan(fakeMembership({ role: 'agent', role_id: 'role-1', permissions: {} })),
    });
    renderDrawer(makeIdeia({ origem: 'agencia' }), undefined, undefined, { onEdit: vi.fn() });
    await screen.findByText('Trocar arte');
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
  });

  it('shows Excluir for both origins, and deleting closes the drawer after confirming', async () => {
    deleteIdeiaMock.mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderDrawer(makeIdeia({ origem: 'cliente' }), undefined, undefined, { onClose });

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Excluir ideia?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir ideia' }));

    await waitFor(() => expect(deleteIdeiaMock).toHaveBeenCalledWith('i1'));
    expect(toastSuccessMock).toHaveBeenCalledWith('Ideia excluída.');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('does not delete when the confirmation is cancelled', async () => {
    renderDrawer(makeIdeia({ origem: 'agencia' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    await screen.findByText('Excluir ideia?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Excluir ideia?')).not.toBeInTheDocument());
    expect(deleteIdeiaMock).not.toHaveBeenCalled();
  });

  it('shows an error toast and keeps the drawer open when delete fails', async () => {
    deleteIdeiaMock.mockRejectedValue(new Error('boom'));
    const onClose = vi.fn();
    renderDrawer(makeIdeia({ origem: 'agencia' }), undefined, undefined, { onClose });

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir ideia' }));

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith('boom'));
    expect(onClose).not.toHaveBeenCalled();
  });
});
