import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchIdeias: vi.fn(),
  createIdeia: vi.fn(),
  updateIdeia: vi.fn(),
  deleteIdeia: vi.fn(),
  retryIdeiaTranscription: vi.fn(),
  deleteIdeiaAudio: vi.fn(),
}));
vi.mock('../../services/ideiaAudio', () => ({ uploadIdeiaAudio: vi.fn() }));
vi.mock('@mesaas/ui/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  AudioRecorder: ({
    onRecorded,
    sendLabel,
  }: {
    onRecorded: (b: Blob, m: string, s: number) => Promise<void>;
    sendLabel?: string;
  }) => (
    <button
      type="button"
      onClick={() => void onRecorded(new Blob(['abc'], { type: 'audio/webm' }), 'audio/webm', 4)}
    >
      {`fake-recorder:${sendLabel ?? 'Enviar'}`}
    </button>
  ),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: ({ src }: { src: string }) => <div data-testid="audio-player">{src}</div>,
}));

import { createIdeia, deleteIdeia, fetchIdeias, updateIdeia } from '../../api';
import { IdeiasPage } from '../IdeiasPage';

const mockedFetchIdeias = vi.mocked(fetchIdeias);
const mockedCreateIdeia = vi.mocked(createIdeia);
const mockedUpdateIdeia = vi.mocked(updateIdeia);
const mockedDeleteIdeia = vi.mocked(deleteIdeia);

const hubValue = {
  bootstrap: {
    workspace: {
      name: 'Mesaas',
      logo_url: 'https://cdn.mesaas.com/logo.png',
      brand_color: '#0f766e',
    },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
    feature_mensagens: true,
    feature_briefing_audio: true,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retryDelay: 0,
      },
    },
  });
}

function renderHubPage(
  pathname: string,
  routePath: string,
  page: ReactElement,
  queryClient = createQueryClient(),
) {
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <HubContext.Provider value={hubValue}>
          <MemoryRouter initialEntries={[pathname]}>
            <Routes>
              <Route path={routePath} element={page} />
            </Routes>
          </MemoryRouter>
        </HubContext.Provider>
      </QueryClientProvider>,
    ),
  };
}

function makeIdeia(
  overrides: Partial<{
    id: string;
    titulo: string;
    descricao: string;
    links: string[];
    tipo: 'ideia' | 'solicitacao';
    status: 'nova' | 'em_analise' | 'aprovada' | 'descartada' | 'convertida' | 'concluida';
    comentario_agencia: string | null;
    comentario_autor_id: number | null;
    comentario_at: string | null;
    comentario_autor: { nome: string } | null;
    created_at: string;
    updated_at: string;
    ideia_reactions: Array<{
      id: string;
      membro_id: number;
      emoji: string;
      membros: { nome: string };
    }>;
    origem: 'cliente' | 'agencia';
    audio: null;
  }> = {},
) {
  return {
    id: 'idea-1',
    titulo: 'Ideia padrão',
    descricao: 'Descrição padrão da ideia.',
    links: ['https://example.com'],
    tipo: 'ideia' as const,
    status: 'nova' as const,
    comentario_agencia: null,
    comentario_autor_id: null,
    comentario_at: null,
    comentario_autor: null,
    created_at: '2026-04-18T10:00:00.000Z',
    updated_at: '2026-04-18T10:00:00.000Z',
    ideia_reactions: [],
    images: [],
    origem: 'cliente' as const,
    audio: null,
    ...overrides,
  };
}

describe('IdeiasPage', () => {
  beforeEach(() => {
    mockedFetchIdeias.mockReset();
    mockedCreateIdeia.mockReset();
    mockedUpdateIdeia.mockReset();
    mockedDeleteIdeia.mockReset();
    // jsdom doesn't implement these; the modal's pending-audio preview needs them.
    URL.createObjectURL = vi.fn(() => 'blob:mock-audio');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the loading state while ideias are pending', () => {
    mockedFetchIdeias.mockImplementation(() => new Promise(() => {}));

    const { container } = renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });

  it('does not retry 4xx failures and lets the user retry manually', async () => {
    mockedFetchIdeias.mockRejectedValueOnce(new Error('HTTP 400')).mockResolvedValueOnce({
      ideias: [makeIdeia({ id: 'idea-4xx', titulo: 'Ideia recuperada' })],
    } as never);

    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
      queryClient,
    );

    expect(await screen.findByText('Erro ao carregar ideias')).toBeInTheDocument();
    expect(screen.getByText('HTTP 400')).toBeInTheDocument();
    expect(mockedFetchIdeias).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-ideias', 'token-publico'] });
    });
    expect(await screen.findByText('Ideia recuperada')).toBeInTheDocument();
  });

  it('retries non-4xx failures before surfacing the error', async () => {
    mockedFetchIdeias.mockRejectedValue(new Error('HTTP 500'));

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    expect(await screen.findByText('Erro ao carregar ideias')).toBeInTheDocument();
    await waitFor(() => {
      expect(mockedFetchIdeias).toHaveBeenCalledTimes(3);
    });
  });

  it('renders the empty state when there are no ideias yet', async () => {
    mockedFetchIdeias.mockResolvedValue({ ideias: [] } as never);

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    expect(await screen.findByText('Nenhuma ideia ainda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adicionar ideia' })).toBeInTheDocument();
  });

  it('validates the modal before creating and trims payload fields on save', async () => {
    mockedFetchIdeias.mockResolvedValue({ ideias: [] } as never);
    mockedCreateIdeia.mockResolvedValue({
      ideia: makeIdeia({ id: 'idea-created', titulo: 'Campanha junho' }),
    } as never);

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    await screen.findByText('Nenhuma ideia ainda');

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ideia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(screen.getByText('Título obrigatório')).toBeInTheDocument();
    expect(screen.getByText('Descrição obrigatória')).toBeInTheDocument();
    expect(mockedCreateIdeia).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Ex: Reel mostrando os bastidores...'), {
      target: { value: '  Campanha junho  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('Descreva sua ideia com detalhes...'), {
      target: { value: '  Sequência de posts com depoimentos reais.  ' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://...'), {
      target: { value: '  https://www.notion.so/campanha-junho  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockedCreateIdeia).toHaveBeenCalledWith('token-publico', {
        titulo: 'Campanha junho',
        descricao: 'Sequência de posts com depoimentos reais.',
        links: ['https://www.notion.so/campanha-junho'],
        tipo: 'ideia',
      });
    });
  });

  it('portals the modal out of the transformed .hub-fade-up wrapper', async () => {
    mockedFetchIdeias.mockResolvedValue({ ideias: [] } as never);

    const { container } = renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    await screen.findByText('Nenhuma ideia ainda');

    // The page content lives inside `.hub-fade-up`, which keeps a persistent CSS
    // transform (animation fill `both` ends on translateY(0)). A transformed
    // ancestor becomes the containing block for `position: fixed` descendants, so
    // an inline modal's `fixed inset-0` overlay is clipped to the wrapper and its
    // top scrolls off-screen unreachable. The modal MUST be portaled to body.
    const wrapper = container.querySelector('.hub-fade-up');
    expect(wrapper).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ideia' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(wrapper!.contains(dialog)).toBe(false);
  });

  it('allows editing a mutable ideia and keeps immutable ideias read-only', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [
        makeIdeia({
          id: 'idea-mutable',
          titulo: 'Ideia mutável',
          descricao: 'Pode ser editada.',
          links: ['https://example.com/valid'],
        }),
        makeIdeia({
          id: 'idea-locked',
          titulo: 'Ideia travada',
          status: 'em_analise',
          comentario_agencia: 'Vamos revisar depois.',
          ideia_reactions: [{ id: 'r1', membro_id: 10, emoji: '🔥', membros: { nome: 'Ana' } }],
          links: ['javascript:alert(1)', 'nota'],
        }),
      ],
    } as never);
    // Two-phase modal destructures `{ ideia }` from updateIdeia on edit-save.
    mockedUpdateIdeia.mockResolvedValue({
      ideia: makeIdeia({ id: 'idea-mutable', titulo: 'Ideia mutável ajustada' }),
    } as never);

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    const mutableHeading = await screen.findByRole('heading', { name: 'Ideia mutável' });
    const mutableCard = mutableHeading.closest('.hub-card');
    expect(mutableCard).not.toBeNull();
    // Mutable card: edit + delete (text controls), the always-available image-add
    // button, and the audio recorder (no audio yet, so it's shown ready to record).
    expect(within(mutableCard as HTMLElement).getAllByRole('button')).toHaveLength(4);

    const immutableHeading = screen.getByRole('heading', { name: 'Ideia travada' });
    const immutableCard = immutableHeading.closest('.hub-card');
    expect(immutableCard).not.toBeNull();
    // Locked card: no edit/delete text controls, but image add/remove is lock-independent.
    const immutableButtons = within(immutableCard as HTMLElement).getAllByRole('button');
    expect(immutableButtons).toHaveLength(1);
    expect(immutableButtons[0]).toHaveTextContent('Adicionar imagem');

    const links = within(immutableCard as HTMLElement).getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '#');
    expect(links[1]).toHaveAttribute('href', '#');
    expect(links[0]).toHaveAttribute('target', '_blank');
    expect(links[0]).toHaveAttribute('rel', expect.stringContaining('noopener'));

    fireEvent.click(within(mutableCard as HTMLElement).getAllByRole('button')[0]);

    expect(await screen.findByRole('heading', { name: 'Editar ideia' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Ideia mutável')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Pode ser editada.')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('Ideia mutável'), {
      target: { value: 'Ideia mutável ajustada' },
    });
    fireEvent.change(screen.getByDisplayValue('Pode ser editada.'), {
      target: { value: 'Descrição atualizada.' },
    });
    fireEvent.change(screen.getByDisplayValue('https://example.com/valid'), {
      target: { value: 'https://example.com/valid-editada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => {
      expect(mockedUpdateIdeia).toHaveBeenCalledWith('token-publico', 'idea-mutable', {
        titulo: 'Ideia mutável ajustada',
        descricao: 'Descrição atualizada.',
        links: ['https://example.com/valid-editada'],
        tipo: 'ideia',
      });
    });
  });

  it('deletes a mutable ideia and refreshes the list after invalidation', async () => {
    mockedFetchIdeias
      .mockResolvedValueOnce({
        ideias: [
          makeIdeia({ id: 'idea-delete', titulo: 'Apagar depois' }),
          makeIdeia({
            id: 'idea-keep',
            titulo: 'Continuar',
            status: 'aprovada',
            comentario_agencia: 'Já aprovada.',
          }),
        ],
      } as never)
      .mockResolvedValueOnce({
        ideias: [
          makeIdeia({
            id: 'idea-keep',
            titulo: 'Continuar',
            status: 'aprovada',
            comentario_agencia: 'Já aprovada.',
          }),
        ],
      } as never);
    mockedDeleteIdeia.mockResolvedValue({ ok: true } as never);

    const queryClient = createQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
      queryClient,
    );

    const deletingHeading = await screen.findByRole('heading', { name: 'Apagar depois' });
    const deletingCard = deletingHeading.closest('.hub-card') as HTMLElement;

    fireEvent.click(within(deletingCard).getAllByRole('button')[1]);

    await waitFor(() => {
      expect(mockedDeleteIdeia).toHaveBeenCalledWith('token-publico', 'idea-delete');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['hub-ideias', 'token-publico'] });
    });
    expect(await screen.findByText('Continuar')).toBeInTheDocument();
    expect(screen.queryByText('Apagar depois')).not.toBeInTheDocument();
  });

  it('shows the solicitação badge and the "Em andamento" label for a converted request', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [
        makeIdeia({
          id: 'idea-solicitacao',
          titulo: 'Reduzir prazo de aprovação',
          tipo: 'solicitacao',
          status: 'convertida',
        }),
      ],
    } as never);

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );

    expect(await screen.findByText('Em andamento')).toBeInTheDocument();
    expect(screen.getByText('Solicitação')).toBeInTheDocument();
  });

  it('renders an agency ideia read-only with the "Sugestão da agência" chip', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [makeIdeia({ id: 'ag', titulo: 'Da agência', origem: 'agencia' })],
    } as never);
    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );
    expect(await screen.findByText('Da agência')).toBeInTheDocument();
    expect(screen.getByText('Sugestão da agência')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.queryByText(/adicionar imagem/i)).toBeNull();
  });

  it('holds a recording in the modal and uploads it right after create', async () => {
    mockedFetchIdeias.mockResolvedValue({ ideias: [] } as never);
    mockedCreateIdeia.mockResolvedValue({ ideia: makeIdeia({ id: 'new-1' }) } as never);
    const { uploadIdeiaAudio } = await import('../../services/ideiaAudio');
    vi.mocked(uploadIdeiaAudio).mockResolvedValue({ ok: true, transcript: 'oi', audio: null });

    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );
    await screen.findByText('Nenhuma ideia ainda');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar ideia' }));

    fireEvent.click(screen.getByRole('button', { name: 'fake-recorder:Usar este áudio' }));
    expect(await screen.findByTestId('audio-player')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeInTheDocument();
    expect(uploadIdeiaAudio).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Ex: Reel mostrando os bastidores...'), {
      target: { value: 'T' },
    });
    fireEvent.change(screen.getByPlaceholderText('Descreva sua ideia com detalhes...'), {
      target: { value: 'D' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(mockedCreateIdeia).toHaveBeenCalled());
    await waitFor(() =>
      expect(uploadIdeiaAudio).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'token-publico',
          ideiaId: 'new-1',
          mime: 'audio/webm',
          durationSeconds: 4,
        }),
      ),
    );
  });

  it('shows player, transcript, retry and remove on a mutable client ideia with audio', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [
        makeIdeia({
          id: 'a1',
          audio: {
            url: 'https://get/a.webm',
            mime: 'audio/webm',
            duration_seconds: 9,
            transcription_status: 'failed',
            recorded_at: '2026-09-10T00:00:00Z',
            transcript: null,
          },
        }),
      ],
    } as never);
    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );
    expect(await screen.findByTestId('audio-player')).toHaveTextContent('https://get/a.webm');
    expect(screen.getByText(/falha na transcrição/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover áudio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Gravar novamente' }));
    expect(await screen.findByRole('button', { name: 'fake-recorder:Enviar' })).toBeInTheDocument();
  });

  it('keeps remove available (but hides recorder/retry) on a mutable ideia when the plan lacks audio', async () => {
    hubValue.bootstrap.feature_briefing_audio = false;
    try {
      mockedFetchIdeias.mockResolvedValue({
        ideias: [
          makeIdeia({
            id: 'a2',
            audio: {
              url: 'https://get/c.webm',
              mime: 'audio/webm',
              duration_seconds: 5,
              transcription_status: 'failed',
              recorded_at: '2026-09-10T00:00:00Z',
              transcript: null,
            },
          }),
        ],
      } as never);
      renderHubPage(
        '/mesaas/hub/token-publico/ideias',
        '/:workspace/hub/:token/ideias',
        <IdeiasPage />,
      );
      expect(await screen.findByRole('button', { name: 'Remover áudio' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Gravar novamente' })).toBeNull();
      expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
    } finally {
      hubValue.bootstrap.feature_briefing_audio = true;
    }
  });

  it('hides recorder, retry and remove when the ideia is locked (not the current author)', async () => {
    mockedFetchIdeias.mockResolvedValue({
      ideias: [
        makeIdeia({
          id: 'l1',
          status: 'em_analise',
          audio: {
            url: 'https://get/b.webm',
            mime: 'audio/webm',
            duration_seconds: 9,
            transcription_status: 'done',
            recorded_at: null,
            transcript: 'Texto transcrito',
          },
        }),
      ],
    } as never);
    renderHubPage(
      '/mesaas/hub/token-publico/ideias',
      '/:workspace/hub/:token/ideias',
      <IdeiasPage />,
    );
    expect(await screen.findByText('Texto transcrito')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remover áudio' })).toBeNull();
    expect(screen.queryByRole('button', { name: /fake-recorder/ })).toBeNull();
  });
});
