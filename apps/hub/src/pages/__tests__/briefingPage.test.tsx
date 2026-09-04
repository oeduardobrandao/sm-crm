import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchBriefing: vi.fn(),
  submitBriefingAnswer: vi.fn(),
  presignBriefingAudio: vi.fn(),
  finalizeBriefingAudio: vi.fn(),
  retryBriefingTranscription: vi.fn(),
  deleteBriefingAudio: vi.fn(),
}));
vi.mock('../../services/briefingAudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/briefingAudio')>()),
  uploadBriefingAudio: vi.fn(),
}));
vi.mock('@mesaas/ui/AudioPlayer', () => ({
  AudioPlayer: ({ durationSeconds }: { durationSeconds?: number | null }) => (
    <div data-testid="audio-player">{`player ${durationSeconds ?? 0}s`}</div>
  ),
}));
vi.mock('../../components/AudioRecorder', () => ({
  isRecordingSupported: () => true,
  HUB_AUDIO_VARS: {},
  AudioRecorder: ({
    onRecorded,
    phase,
  }: {
    onRecorded: (b: Blob, m: string, s: number) => Promise<void>;
    phase: string;
  }) => (
    <button
      type="button"
      data-phase={phase}
      onClick={() => {
        // Mirrors the real AudioRecorder's send(): it awaits onRecorded and
        // swallows a rejection itself (the parent owns the error), so the
        // fake must not leave an unhandled rejection here either.
        onRecorded(new Blob(['abc']), 'audio/webm', 3).catch(() => {});
      }}
    >
      fake-record
    </button>
  ),
}));

import {
  deleteBriefingAudio,
  fetchBriefing,
  retryBriefingTranscription,
  submitBriefingAnswer,
} from '../../api';
import { uploadBriefingAudio } from '../../services/briefingAudio';
import { BriefingPage } from '../BriefingPage';

const hubValue = {
  bootstrap: {
    workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
    cliente_nome: 'Clínica Aurora',
    is_active: true,
    cliente_id: 14,
    feature_mensagens: true,
  },
  token: 'token-publico',
  workspace: 'mesaas',
};

function renderPage(page: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={hubValue}>
        <MemoryRouter>{page}</MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

const audio = {
  url: 'https://get/x.webm',
  mime: 'audio/webm',
  duration_seconds: 65,
  transcription_status: 'failed' as const,
  recorded_at: '2026-09-03T00:00:00Z',
};

function briefingWithQ2Audio(q2Audio: typeof audio | null) {
  return {
    briefings: [
      {
        id: 'b1',
        title: 'Briefing',
        display_order: 0,
        questions: [
          {
            id: 'q1',
            question: 'Marca?',
            answer: 'Antes.',
            section: null,
            display_order: 0,
            audio: null,
          },
          {
            id: 'q2',
            question: 'Público?',
            answer: null,
            section: null,
            display_order: 1,
            audio: q2Audio,
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.mocked(fetchBriefing).mockResolvedValue(briefingWithQ2Audio(audio));
});
afterEach(() => vi.clearAllMocks());

describe('BriefingPage audio', () => {
  it('locks the textarea while uploading and fills it with the returned answer', async () => {
    let resolveUpload!: (v: unknown) => void;
    vi.mocked(uploadBriefingAudio).mockImplementation(
      () =>
        new Promise((r) => {
          resolveUpload = r;
        }) as never,
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });
    expect(textareas[0]).toBeDisabled();

    await act(async () => {
      resolveUpload({
        ok: true,
        answer: 'Antes.\n\nTranscrito.',
        transcript: 'Transcrito.',
        audio: { ...audio, transcription_status: 'done' },
      });
    });
    await waitFor(() => expect(textareas[0]).not.toBeDisabled());
    expect(textareas[0]).toHaveValue('Antes.\n\nTranscrito.');
  });

  it('shows the audio player, failed status with retry, and remove', async () => {
    vi.mocked(retryBriefingTranscription).mockResolvedValue({
      ok: true,
      answer: 'Novo',
      transcript: 'Novo',
      audio: { ...audio, transcription_status: 'done' },
    });
    vi.mocked(deleteBriefingAudio).mockResolvedValue({ ok: true });
    renderPage(<BriefingPage />);
    await screen.findByText('Público?');

    expect(screen.getByText('player 65s')).toBeInTheDocument();
    expect(screen.getByText(/não foi possível transcrever/i)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    });
    expect(retryBriefingTranscription).toHaveBeenCalledWith('token-publico', 'q2');
    await waitFor(() => expect(screen.getAllByRole('textbox')[1]).toHaveValue('Novo'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /remover áudio/i }));
    });
    expect(deleteBriefingAudio).toHaveBeenCalledWith('token-publico', 'q2');
  });

  it('renders an upload/transcription failure exactly once and re-enables the textarea', async () => {
    vi.mocked(uploadBriefingAudio).mockRejectedValue(
      new Error('Áudio maior que 15 MB. Grave um trecho mais curto.'),
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });

    await waitFor(() => expect(screen.getAllByText(/áudio maior que 15 mb/i)).toHaveLength(1));
    expect(textareas[0]).not.toBeDisabled();
  });

  it('flushes a pending debounced save before starting the upload, preserving call order', async () => {
    let resolveUpload!: (v: unknown) => void;
    vi.mocked(uploadBriefingAudio).mockImplementation(
      () =>
        new Promise((r) => {
          resolveUpload = r;
        }) as never,
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    // Type, then trigger the recorder immediately — before the 800ms
    // debounce has any chance to fire on its own.
    fireEvent.change(textareas[0], { target: { value: 'Digitando rápido' } });
    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });

    expect(submitBriefingAnswer).toHaveBeenCalledWith('token-publico', 'q1', 'Digitando rápido');
    expect(uploadBriefingAudio).toHaveBeenCalled();
    const submitOrder = vi.mocked(submitBriefingAnswer).mock.invocationCallOrder[0];
    const uploadOrder = vi.mocked(uploadBriefingAudio).mock.invocationCallOrder[0];
    expect(submitOrder).toBeLessThan(uploadOrder);

    await act(async () => {
      resolveUpload({
        ok: true,
        answer: 'Digitando rápido\n\nTranscrito.',
        transcript: 'Transcrito.',
        audio: { ...audio, transcription_status: 'done' },
      });
    });
    await waitFor(() => expect(textareas[0]).toHaveValue('Digitando rápido\n\nTranscrito.'));
  });

  it('locks the textarea and puts the recorder in phase="uploading" while the flush is still in flight', async () => {
    // Regression test: setPhase('uploading') must happen BEFORE
    // flushPendingSave(), not after it resolves -- otherwise a second click
    // on "Enviar" during the flush's network round-trip could fire a second
    // presign/upload/finalize before the first one lands.
    let resolveSubmit!: (v: unknown) => void;
    vi.mocked(submitBriefingAnswer).mockImplementation(
      () =>
        new Promise((r) => {
          resolveSubmit = r;
        }) as never,
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    fireEvent.change(textareas[0], { target: { value: 'Digitando rápido' } });
    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });

    // The flush (submitBriefingAnswer) is still pending -- phase must
    // already be 'uploading' and the textarea already locked.
    expect(textareas[0]).toBeDisabled();
    expect(screen.getAllByText('fake-record')[0]).toHaveAttribute('data-phase', 'uploading');

    await act(async () => {
      resolveSubmit(undefined);
    });
  });

  it('aborts the audio action when the flushed save fails, keeping the recorder in preview', async () => {
    vi.mocked(submitBriefingAnswer).mockRejectedValue(new Error('HTTP 500'));
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    const textareas = screen.getAllByRole('textbox');

    fireEvent.change(textareas[0], { target: { value: 'Digitando rápido' } });
    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });

    expect(submitBriefingAnswer).toHaveBeenCalledWith('token-publico', 'q1', 'Digitando rápido');
    expect(uploadBriefingAudio).not.toHaveBeenCalled();
    expect(screen.getByText(/não foi possível salvar o texto/i)).toBeInTheDocument();
    expect(textareas[0]).not.toBeDisabled();
  });

  it('disables the textarea while a retry is in flight', async () => {
    let resolveRetry!: (v: unknown) => void;
    vi.mocked(retryBriefingTranscription).mockImplementation(
      () =>
        new Promise((r) => {
          resolveRetry = r;
        }) as never,
    );
    renderPage(<BriefingPage />);
    await screen.findByText('Público?');
    const textareas = screen.getAllByRole('textbox');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    });
    expect(textareas[1]).toBeDisabled();

    await act(async () => {
      resolveRetry({
        ok: true,
        answer: 'Novo',
        transcript: 'Novo',
        audio: { ...audio, transcription_status: 'done' },
      });
    });
    await waitFor(() => expect(textareas[1]).not.toBeDisabled());
  });

  it('surfaces text-save failures instead of swallowing them', async () => {
    vi.mocked(submitBriefingAnswer).mockRejectedValue(new Error('HTTP 500'));
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');
    // Fake timers only after the initial data fetch resolves: `findByText`
    // relies on @testing-library/react's async wrapper, which drains its
    // queue via a real `setTimeout(...,0)` it never recognizes as vitest
    // fake timers (it only detects a global `jest`), so it hangs if fake
    // timers are already active. See contentPages.test.tsx for the same
    // pattern.
    vi.useFakeTimers();
    fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'Novo texto' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    expect(screen.getByText(/não foi possível salvar/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('invalidates and refetches after an upload failure, syncing to the server audio state', async () => {
    vi.mocked(uploadBriefingAudio).mockRejectedValue(new Error('network error'));
    const pendingAudio = { ...audio, transcription_status: 'pending' as const };
    vi.mocked(fetchBriefing)
      .mockResolvedValueOnce(briefingWithQ2Audio(null))
      .mockResolvedValueOnce(briefingWithQ2Audio(pendingAudio));
    renderPage(<BriefingPage />);
    await screen.findByText('Marca?');

    await act(async () => {
      fireEvent.click(screen.getAllByText('fake-record')[0]);
    });

    // O upload falhou (rede), mas o servidor pode ter gravado o áudio antes
    // da falha — a página refaz o fetch em vez de confiar só no estado local.
    await waitFor(() => expect(fetchBriefing).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('player 65s')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
  });

  it('drops the local audio player when a background refetch shows the audio was removed elsewhere', async () => {
    vi.mocked(fetchBriefing)
      .mockResolvedValueOnce(briefingWithQ2Audio(audio))
      .mockResolvedValueOnce(briefingWithQ2Audio(null));
    const { qc } = renderPage(<BriefingPage />);
    await screen.findByText('player 65s');

    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['hub-briefing', 'token-publico'] });
    });

    await waitFor(() => expect(screen.queryByText('player 65s')).not.toBeInTheDocument());
  });
});
